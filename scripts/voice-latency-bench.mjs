#!/usr/bin/env node
/**
 * Local Qwen3-TTS first-sentence latency bench — developer-only.
 *
 *   npm run voice:latency:bench
 *
 * Measures, with a WARM local Qwen3-TTS sidecar, how long the FIRST sentence of
 * a reply takes to produce its first audio bytes. That is the part of the call
 * mode budget (end of user speech → first audio, p50 ≤ 2.5 s / p90 ≤ 4 s) this
 * repo can measure without a microphone and an LLM in the loop.
 *
 * For five Chinese and five English sample replies the script:
 *   1. extracts the first sentence exactly like the renderer does
 *      (`segmentTextForSpeech`),
 *   2. POSTs it to the sidecar's `/v1/audio/speech` and times the wait for the
 *      first non-empty PCM chunk,
 *   3. drains the rest of the response so the synth time is recorded too.
 *
 * No audio is written anywhere: every chunk is counted and discarded.
 *
 * Sidecar: an already-running one on `--base-url` is reused. Otherwise the
 * script spawns one with the Python at `$NEXUS_QWEN3_TTS_PYTHON` or
 * `~/Models/qwen3-tts/.venv/bin/python`. If neither the interpreter nor a
 * running sidecar is available, it prints a note and exits 0 — this is a
 * developer convenience, never a gate.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { segmentTextForSpeech } from '../src/features/voice/streamingTts.ts'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(SCRIPT_DIR, '..')

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  return [key, rest.join('=') || 'true']
}))

const BASE_URL = (args.get('base-url') ?? 'http://127.0.0.1:8002').replace(/\/+$/, '')
const VOICE = args.get('voice') ?? 'vivian'
const NO_SPAWN = args.has('no-spawn')
const STARTUP_TIMEOUT_MS = 240_000
const REQUEST_TIMEOUT_MS = 120_000

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
