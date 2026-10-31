#!/usr/bin/env node
/**
 * Local Qwen3-TTS latency bench — developer-only.
 *
 *   npm run voice:latency:bench
 *   npm run voice:latency:bench -- --mode=cport --port=8080
 *
 * Python mode (default) measures how long the FIRST sentence of a reply takes
 * to produce its first audio bytes through the sidecar's `/v1/audio/speech`.
 *
 * C-port mode (`--mode=cport`) measures the call-mode contract instead: the
 * WHOLE reply goes to the pure-C server's `/v1/tts/stream` in one generation,
 * so first-audio latency, total wall time, real-time underruns, and RTF all
 * describe the path the app actually uses. Chunks also run through the same
 * pitch-preserving stretcher the app applies (the stream has no `rate`
 * field), so the reported first-audio and audio length are the stretched
 * ones, with the raw pre-stretch first byte printed alongside.
 *
 * It also saves one whole-reply WAV per mood row (neutral, happy,
 * coquettish, sad, angry, shy — plus an English neutral) under
 * `~/nexus-shots/cport-rate-samples/`, each rendered with the mild instruct
 * and tempo the app would send for that mood.
 *
 * No other audio is written anywhere: every chunk is counted and discarded.
 *
 * Sidecar/server: an already-running one is reused. Otherwise the script
 * spawns one (Python from `$NEXUS_QWEN3_TTS_PYTHON` or the venv, C from
 * `~/Models/qwen3-tts-c/src/qwen_tts`). If neither is available it prints a
 * note and exits 0 — this is a developer convenience, never a gate.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { segmentTextForSpeech } from '../src/features/voice/streamingTts.ts'
import {
  resolveEmotionSpeechTempo,
  resolveSegmentVoiceStyle,
} from '../src/features/voice/voiceEmotion.ts'
import { createWsolaStretcher } from '../electron/services/wsolaStretcher.js'
import {
  buildQwen3CportArgs,
  buildQwen3CportEnv,
  mapQwen3CportLanguage,
  resolveQwen3CportConfig,
} from '../electron/services/qwen3CportService.js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(SCRIPT_DIR, '..')

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  return [key, rest.join('=') || 'true']
}))

const MODE = (args.get('mode') ?? (args.has('cport') ? 'cport' : 'python')).toLowerCase()
const BASE_URL = (args.get('base-url') ?? 'http://127.0.0.1:8002').replace(/\/+$/, '')
const CPORT_PORT = Number(args.get('port') ?? 8080)
const CPORT_ROOT = `http://127.0.0.1:${CPORT_PORT}`
const SAMPLES_DIR = args.get('samples-dir')
  ?? path.join(homedir(), 'nexus-shots', 'cport-rate-samples')
const VOICE = args.get('voice') ?? 'vivian'
const NO_SPAWN = args.has('no-spawn')
const STARTUP_TIMEOUT_MS = 240_000
const REQUEST_TIMEOUT_MS = 120_000
const SAMPLE_RATE = 24_000
// Mirrors INITIAL_STREAM_CHUNK_SIZE in electron/ttsStreamService.js: the first
// chunk the app hands the renderer.
const FIRST_CHUNK_SAMPLES = 1024

const CHINESE_REPLIES = [
  '好呀，今天天气挺好的，要不要一起出去走走？我刚刚看到窗外的云特别好看。',
  '你回来啦。我等你有一小会儿了，今天过得还顺利吗？',
  '刚泡了一杯热茶，要分你一半吗？小心烫。',
  '我刚刚把桌子收拾干净了。看起来是不是舒服多了？',
  '别急着走嘛。再陪我聊两句，就两句。',
]

const ENGLISH_REPLIES = [
  'Hi there, you are back. I was just watching the light change outside.',
  'That sounds like a long day. Do you want to tell me about it?',
  'I made some tea a minute ago. Want half? It is still warm.',
  'I tidied the desk while you were away. It feels calmer in here now.',
  'Do not rush off yet. Stay and talk with me for a little while.',
]

const allSamples = [
  ...CHINESE_REPLIES.map((reply, index) => ({ id: `zh-${index + 1}`, language: 'Chinese', reply })),
  ...ENGLISH_REPLIES.map((reply, index) => ({ id: `en-${index + 1}`, language: 'English', reply })),
]

function resolvePython() {
  const candidates = [
    process.env.NEXUS_QWEN3_TTS_PYTHON,
    path.join(homedir(), 'Models', 'qwen3-tts', '.venv', 'bin', 'python'),
    path.join(homedir(), 'Models', 'qwen3-tts', '.venv', 'Scripts', 'python.exe'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function portFromBaseUrl() {
  try {
    return Number(new URL(BASE_URL).port || 8002)
  } catch {
    return 8002
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5_000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
}

async function sidecarHealth(timeoutMs) {
  try {
    const response = await fetchWithTimeout(`${BASE_URL}/health`, {}, timeoutMs)
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function startSidecar(pythonBinary) {
  const child = spawn(
    pythonBinary,
    [path.join(repoRoot, 'scripts', 'qwen3_tts_server.py'), '--port', String(portFromBaseUrl())],
    { cwd: repoRoot, stdio: 'ignore' },
  )
  child.on('error', () => undefined)
  return child
}

function stopSidecar(child) {
  if (!child || child.exitCode !== null) return
  try {
    child.kill()
  } catch {
    // Already gone.
  }
}

function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const rank = (sorted.length - 1) * fraction
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)
}

function formatMs(value) {
  return value === null ? 'n/a' : `${value.toFixed(0)} ms`
}

async function synthFirstSentence(text, language) {
  const started = performance.now()
  const response = await fetchWithTimeout(
    `${BASE_URL}/v1/audio/speech`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        voice: VOICE,
        response_format: 'pcm',
        language,
      }),
    },
    REQUEST_TIMEOUT_MS,
  )

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new Error(`sidecar returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }

  let firstByteMs = null
  let bytes = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.byteLength === 0) continue
    if (firstByteMs === null) firstByteMs = performance.now() - started
    bytes += value.byteLength
  }

  return {
    firstByteMs,
    totalMs: performance.now() - started,
    audioSeconds: bytes / 2 / 24000,
  }
}

function firstSentence(reply) {
  return segmentTextForSpeech(reply)[0] ?? reply
}

// ── Pure-C port mode ────────────────────────────────────────────────────────

async function cportHealth(timeoutMs = 1_500) {
  try {
    const response = await fetchWithTimeout(`${CPORT_ROOT}/v1/health`, {}, timeoutMs)
    if (!response.ok) return null
    const data = await response.json()
    return data?.status === 'ok' ? data : null
  } catch {
    return null
  }
}

function startCport(config) {
  const child = spawn(
    config.binaryPath,
    buildQwen3CportArgs(config, CPORT_PORT),
    {
      cwd: path.dirname(config.binaryPath),
      env: buildQwen3CportEnv(process.env),
      stdio: 'ignore',
      detached: true,
    },
  )
  child.on('error', () => undefined)
  child.unref()
  return child
}

function stopCport(child) {
  if (!child) return
  try {
    // Detached: the negative pid reaches the server and any helper threads'
    // process group in one signal.
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }
}

/**
 * Whole-reply streaming request. Measures first-audio latency, total wall
 * time, and whether a real-time consumer would ever run dry ("underrun").
 *
 * Chunks are fed through the production stretcher as they arrive, so
 * `firstStretchedMs` is the first sample the app could actually play and
 * `audioSeconds` is the playback duration after stretching. `tempo` 1 (or
 * missing) skips the stretcher and the two first-audio numbers are equal.
 */
async function synthWholeReplyStream(text, language, options = {}) {
  const tempo = Number(options.tempo)
  const stretcher = Number.isFinite(tempo) && tempo !== 1
    ? createWsolaStretcher(tempo)
    : null
  const collect = options.collect === true
  const started = performance.now()
  const response = await fetchWithTimeout(
    `${CPORT_ROOT}/v1/tts/stream`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        speaker: VOICE,
        language: mapQwen3CportLanguage(language),
        seed: 42,
        ...(options.instruct ? { instruct: options.instruct } : {}),
      }),
    },
    REQUEST_TIMEOUT_MS,
  )

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new Error(`C server returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }

  let firstByteMs = null
  let firstStretchedMs = null
  let firstStretchedAt = null
  // The app does not hand the renderer a single sample: it waits for
  // INITIAL_STREAM_CHUNK_SIZE (1024) samples before the first chunk. Measure
  // both paths at that same threshold, otherwise "before" and "after" are not
  // comparable.
  let rawChunkMs = null
  let outputChunkMs = null
  let rawSamples = 0
  let outputSamples = 0
  let oddByte = null
  let underruns = 0
  let dry = false
  const collected = collect ? [] : null

  const consume = (samples, now) => {
    const output = stretcher ? stretcher.push(samples) : samples
    if (!output.length) return
    if (firstStretchedMs === null) {
      firstStretchedMs = now - started
      firstStretchedAt = now
    }
    outputSamples += output.length
    if (outputChunkMs === null && outputSamples >= FIRST_CHUNK_SAMPLES) {
      outputChunkMs = now - started
    }
    if (collected) {
      const pcm = Buffer.alloc(output.length * 2)
      for (let index = 0; index < output.length; index += 1) {
        pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(output[index] * 32767))), index * 2)
      }
      collected.push(pcm)
    }
    // Same 50 ms slack as the raw path: scheduler jitter is not a dry buffer.
    const playedSeconds = outputSamples / SAMPLE_RATE
    const elapsedSeconds = (now - firstStretchedAt) / 1000
    if (playedSeconds + 0.05 < elapsedSeconds) {
      if (!dry) underruns += 1
      dry = true
    } else {
      dry = false
    }
  }

  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.byteLength === 0) continue

    const now = performance.now()
    if (firstByteMs === null) firstByteMs = now - started

    const chunk = oddByte ? Buffer.concat([oddByte, Buffer.from(value)]) : Buffer.from(value)
    const usable = chunk.length - (chunk.length % 2)
    if (usable > 0) {
      const samples = new Float32Array(usable / 2)
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = chunk.readInt16LE(index * 2) / 32768
      }
      rawSamples += samples.length
      if (rawChunkMs === null && rawSamples >= FIRST_CHUNK_SAMPLES) {
        rawChunkMs = now - started
      }
      consume(samples, now)
    }
    oddByte = usable < chunk.length ? chunk.subarray(usable) : null
  }

  if (stretcher) {
    const tail = stretcher.flush()
    if (tail.length) consume(tail, performance.now())
  }

  return {
    firstByteMs,
    firstStretchedMs,
    rawChunkMs,
    outputChunkMs,
    totalMs: performance.now() - started,
    audioSeconds: outputSamples / SAMPLE_RATE,
    rawAudioSeconds: rawSamples / SAMPLE_RATE,
    underruns,
    pcm: collected ? Buffer.concat(collected) : null,
  }
}

/** Minimal 16-bit mono WAV wrapper; the bench owns no audio library. */
function encodeWav(pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/**
 * One row per rate-table mood. The emotion cue is the strongest T6 input, so
 * the bench resolves exactly the instruction and tempo the app would send for
 * that mood, independently of the sentence's own wording.
 */
const RATE_TABLE_SAMPLES = [
  {
    id: 'neutral',
    theMood: 'neutral / calm',
    emotion: 'neutral',
    language: 'Chinese',
    text: '你回来啦。我等你有一小会儿了，今天过得还顺利吗？',
  },
  {
    id: 'happy',
    theMood: 'happy / excited / joy',
    emotion: 'happy',
    language: 'Chinese',
    text: '你回来啦。我等你有一小会儿了，今天过得还顺利吗？',
  },
  {
    id: 'coquettish',
    theMood: 'coquettish (撒娇) / playful-sulk',
    emotion: 'sulky',
    language: 'Chinese',
    text: '你回来啦。我等你有一小会儿了，今天过得还顺利吗？',
  },
  {
    id: 'sad',
    theMood: 'sad / hurt / aggrieved',
    emotion: 'sad',
    language: 'Chinese',
    text: '你回来啦。我等你有一小会儿了，今天过得还顺利吗？',
  },
  {
    id: 'angry',
    theMood: 'angry / annoyed',
    emotion: 'angry',
    language: 'Chinese',
    text: '你回来啦。我等你有一小会儿了，今天过得还顺利吗？',
  },
  {
    id: 'shy',
    theMood: 'shy / hesitant / embarrassed',
    emotion: 'embarrassed',
    language: 'Chinese',
    text: '你回来啦。我等你有一小会儿了，今天过得还顺利吗？',
  },
  {
    id: 'en-neutral',
    theMood: 'neutral / calm (en)',
    emotion: 'neutral',
    language: 'English',
    text: 'You are back. I waited for you a little while — did today go alright?',
  },
]

function styleForRateSample(sample) {
  return resolveSegmentVoiceStyle({
    text: sample.text,
    providerId: 'qwen3-tts-local',
    cue: { kind: 'tts', value: sample.emotion },
  })
}

async function saveRateSample(sample) {
  const style = styleForRateSample(sample)
  const result = await synthWholeReplyStream(sample.text, sample.language, {
    instruct: style.instruction,
    tempo: style.speechTempo,
    collect: true,
  })
  mkdirSync(SAMPLES_DIR, { recursive: true })
  const file = path.join(SAMPLES_DIR, `${sample.id}.wav`)
  writeFileSync(file, encodeWav(result.pcm ?? Buffer.alloc(0)))
  return { file, style, result, sample }
}

async function runCportBench() {
  const config = resolveQwen3CportConfig({
    env: process.env,
    homedir,
    existsSync,
  })
  if (!config.available) {
    console.log(
      `C Qwen3-TTS server is not installed (${config.reason ?? 'unknown'}); `
      + 'nothing to measure in cport mode. Exiting.',
    )
    return
  }

  let spawned = null
  let health = await cportHealth()
  if (!health) {
    if (NO_SPAWN) {
      console.log(`No C Qwen3-TTS server at ${CPORT_ROOT} (--no-spawn set). Nothing to measure; exiting.`)
      return
    }
    console.log(`Starting C Qwen3-TTS server on port ${CPORT_PORT} ...`)
    spawned = startCport(config)
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      health = await cportHealth()
      if (health) break
      if (spawned.exitCode !== null) {
        console.log('C server exited before becoming healthy; exiting.')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!health) {
      console.log('C server did not become healthy in time. Nothing to measure; exiting.')
      return
    }
  }

  try {
    console.log(`Warm C server: mode=${health.mode ?? 'unknown'}`)
    await synthWholeReplyStream('你好，今天过得怎么样？', 'Chinese')

    // Every latency row is measured through the stretcher at the neutral
    // tempo, which is what a plain reply sounds like now.
    const neutralTempo = resolveEmotionSpeechTempo('neutral')
    console.log(`Stretching all rows at the neutral tempo ${neutralTempo}x (pitch-preserving WSOLA).`)

    const rows = []
    for (const sample of allSamples) {
      const result = await synthWholeReplyStream(sample.reply, sample.language, {
        tempo: neutralTempo,
      })
      rows.push({ ...sample, ...result })
      console.log(
        `${sample.id}  chars=${sample.reply.length}`
        + `  first-chunk=${formatMs(result.outputChunkMs)}`
        + `  (raw ${formatMs(result.rawChunkMs)})`
        + `  first-sample=${formatMs(result.firstStretchedMs)}`
        + `  total=${formatMs(result.totalMs)}`
        + `  audio=${result.audioSeconds.toFixed(2)}s`
        + `  raw-audio=${result.rawAudioSeconds.toFixed(2)}s`
        + `  RTF=${(result.totalMs / 1000 / result.audioSeconds).toFixed(2)}`
        + `  underruns=${result.underruns}`,
      )
    }

    const zh = rows.filter((row) => row.language === 'Chinese')
    const en = rows.filter((row) => row.language === 'English')
    const firstAudio = (list) => list.map((row) => row.outputChunkMs)
    const rawFirstAudio = (list) => list.map((row) => row.rawChunkMs)
    const totals = (list) => list.map((row) => row.totalMs)

    console.log('')
    console.log(
      'whole reply -> first 1024-sample chunk after stretching / total '
      + `(warm C server, one generation per reply, tempo ${neutralTempo}x)`,
    )
    printStats('zh  ', firstAudio(zh), totals(zh))
    printStats('en  ', firstAudio(en), totals(en))
    printStats('all ', firstAudio(rows), totals(rows))
    console.log(
      'first chunk before stretching (same threshold, raw PCM): '
      + `p50=${formatMs(percentile(rawFirstAudio(rows), 0.5))}`
      + `  p90=${formatMs(percentile(rawFirstAudio(rows), 0.9))}`,
    )
    console.log(
      'stretcher cost at the first chunk: '
      + `p50=${formatMs(percentile(
        rows.map((row) => row.outputChunkMs - row.rawChunkMs),
        0.5,
      ))}`
      + `  p90=${formatMs(percentile(
        rows.map((row) => row.outputChunkMs - row.rawChunkMs),
        0.9,
      ))}`,
    )
    console.log(
      `underruns (real-time playback simulation): `
      + `${rows.reduce((sum, row) => sum + row.underruns, 0)} across ${rows.length} replies`,
    )

    console.log('')
    console.log(`mood samples -> ${SAMPLES_DIR}`)
    for (const sample of RATE_TABLE_SAMPLES) {
      const saved = await saveRateSample(sample)
      const instruct = saved.style.instruction || '(none)'
      console.log(
        `${saved.sample.id.padEnd(11)} ${String(saved.sample.theMood).padEnd(34)}`
        + ` tempo=${saved.style.speechTempo}x`
        + `  audio=${saved.result.audioSeconds.toFixed(2)}s`
        + `  instruct=${instruct}`,
      )
      console.log(`            ${saved.file}`)
    }
    console.log('')
    console.log('Budget (call mode, end of user speech -> first audio): p50 <= 2500 ms, p90 <= 4000 ms.')
    console.log('This bench covers synthesis only; STT and the LLM round trip are measured in-app.')
  } finally {
    stopCport(spawned)
  }
}

async function warmUp() {
  const health = await sidecarHealth(5_000)
  if (health?.loaded === true) return health

  const response = await fetchWithTimeout(`${BASE_URL}/v1/warmup`, { method: 'POST' }, STARTUP_TIMEOUT_MS)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`warmup failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }
  return response.json()
}

function printStats(label, firstByteValues, synthValues) {
  console.log(
    `${label}  first-audio p50=${formatMs(percentile(firstByteValues, 0.5))}`
    + `  p90=${formatMs(percentile(firstByteValues, 0.9))}`
    + `  |  synth p50=${formatMs(percentile(synthValues, 0.5))}`
    + `  p90=${formatMs(percentile(synthValues, 0.9))}`,
  )
}

async function main() {
  if (MODE === 'cport') {
    await runCportBench()
    return
  }

  let spawnedChild = null
  let sidecarSource = 'running sidecar'

  let health = await sidecarHealth(1_500)
  if (!health) {
    if (NO_SPAWN) {
      console.log(`No Qwen3-TTS sidecar at ${BASE_URL} (--no-spawn set). Nothing to measure; exiting.`)
      return
    }

    const python = resolvePython()
    if (!python) {
      console.log(
        'Local Qwen3-TTS sidecar is not available: no running sidecar at '
        + `${BASE_URL}, and no Python at $NEXUS_QWEN3_TTS_PYTHON or `
        + '~/Models/qwen3-tts/.venv/bin/python. Nothing to measure; exiting.',
      )
      return
    }

    console.log(`Starting Qwen3-TTS sidecar with ${python} ...`)
    spawnedChild = startSidecar(python)
    sidecarSource = `spawned sidecar (${python})`

    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      health = await sidecarHealth(1_500)
      if (health) break
      if (spawnedChild.exitCode !== null) {
        console.log('Sidecar exited before becoming healthy. Check the Python environment; exiting.')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    if (!health) {
      console.log('Sidecar did not become healthy in time. Nothing to measure; exiting.')
      return
    }
  }

  try {
    console.log(`Warming the model (${sidecarSource}) ...`)
    const warm = await warmUp()
    console.log(`Warm: device=${warm?.device ?? 'unknown'} loaded=${warm?.loaded !== false}`)

    // One throwaway request so the first measured sample is not paying for
    // lazy graph compilation inside the model wrapper.
    await synthFirstSentence('你好，今天过得怎么样？', 'Chinese')

    const rows = []
    for (const sample of allSamples) {
      const sentence = firstSentence(sample.reply)
      const result = await synthFirstSentence(sentence, sample.language)
      rows.push({ ...sample, sentence, ...result })
      console.log(
        `${sample.id}  chars=${sentence.length}`
        + `  first-audio=${formatMs(result.firstByteMs)}`
        + `  synth=${formatMs(result.totalMs)}`
        + `  audio=${result.audioSeconds.toFixed(2)}s`,
      )
    }

    const zh = rows.filter((row) => row.language === 'Chinese')
    const en = rows.filter((row) => row.language === 'English')

    console.log('')
    console.log('first sentence ready -> first audio bytes (warm model)')
    printStats('zh  ', zh.map((row) => row.firstByteMs), zh.map((row) => row.totalMs))
    printStats('en  ', en.map((row) => row.firstByteMs), en.map((row) => row.totalMs))
    printStats('all ', rows.map((row) => row.firstByteMs), rows.map((row) => row.totalMs))
    console.log('')
    console.log('Budget (call mode, end of user speech -> first audio): p50 <= 2500 ms, p90 <= 4000 ms.')
    console.log('This bench covers synthesis only; STT and the LLM round trip are measured in-app.')
  } finally {
    stopSidecar(spawnedChild)
  }
}

process.on('SIGINT', () => process.exit(0))

await main()
