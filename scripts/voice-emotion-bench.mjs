#!/usr/bin/env node
/**
 * Per-sentence voice-instruction prosody bench — developer-only.
 *
 *   npm run voice:emotion:bench
 *
 * Synthesizes ONE neutral sentence per language under every instruction in
 * `voiceEmotion.ts` (ZH table for Qwen3/OmniVoice, EN table for OpenAI-style
 * providers) with a fixed seed, then reports mean F0, F0 range, RMS dB and
 * duration against the empty (neutral) instruction. This is how the wording in
 * the instruction tables gets checked for a measurable, correctly-signed
 * effect instead of "sounds better to me".
 *
 * The instruction table comes from the product module — it is not duplicated
 * here. Synthesis and measurement live in `scripts/voice_emotion_bench.py`,
 * which receives the samples as JSON on stdin. Nothing is written to disk.
 *
 * Needs the local Qwen3-TTS checkpoint and a Python with qwen_tts + librosa
 * (`$NEXUS_QWEN3_TTS_PYTHON` or `~/Models/qwen3-tts/.venv/bin/python`). This is
 * a developer convenience, never a gate: when the model or interpreter is
 * missing the script prints a note and exits 0.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import { resolveSegmentVoiceStyle } from '../src/features/voice/voiceEmotion.ts'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(SCRIPT_DIR, '..')

// Three fixed seeds per instruction: one take can get lucky, and the whole
// point of the bench is a direction that survives re-rolls.
const SEEDS = [42, 1337, 2024]
const SPEAKER = 'vivian'

// A plain statement: no punctuation cue, no emotion word, so every measured
// delta comes from the instruction alone.
const SAMPLES = [
  { language: 'Chinese', text: '明天下午三点有个会。', providerId: 'qwen3-tts-local', table: 'ZH' },
  { language: 'English', text: 'There is a meeting at three tomorrow afternoon.', providerId: 'openai-tts', table: 'EN' },
]

// Cue words that resolve one-to-one to every entry in the instruction tables.
// `shy` is the cue for the `embarrassed` instruction.
const EMOTIONS = [
  'thinking',
  'happy',
  'sleepy',
  'surprised',
  'confused',
  'embarrassed',
  'excited',
  'affectionate',
  'proud',
  'curious',
  'worried',
  'playful',
  'sad',
  'angry',
  'sulky',
  'hesitant',
  'calm',
  'whisper',
]
const CUE_FOR_EMOTION = { embarrassed: 'shy' }

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

function resolveModelDir() {
  const configured = process.env.NEXUS_QWEN3_TTS_MODEL_DIR
    || path.join(homedir(), 'Models', 'qwen3-tts', 'Qwen3-TTS-12Hz-1.7B-CustomVoice')
  return existsSync(configured) ? configured : null
}

function instructionFor(emotion, providerId) {
  if (!emotion) return ''
  return resolveSegmentVoiceStyle({
    text: '',
    providerId,
    cue: { kind: 'tts', value: CUE_FOR_EMOTION[emotion] ?? emotion },
  }).instruction
}

function buildSamples() {
  const samples = []
  for (const sample of SAMPLES) {
    samples.push({
      id: `${sample.table}|neutral`,
      table: sample.table,
      emotion: 'neutral',
      language: sample.language,
      text: sample.text,
      instruction: '',
    })
    for (const emotion of EMOTIONS) {
      samples.push({
        id: `${sample.table}|${emotion}`,
        table: sample.table,
        emotion,
        language: sample.language,
        text: sample.text,
        instruction: instructionFor(emotion, sample.providerId),
      })
    }
  }
  return samples
}

function runBench(python, modelDir, samples) {
  const spec = JSON.stringify({ seeds: SEEDS, speaker: SPEAKER, model_dir: modelDir, samples })
  const child = spawn(python, [path.join(SCRIPT_DIR, 'voice_emotion_bench.py')], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  child.stdin.end(spec)

  const rows = new Map()
  const lines = readline.createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const trimmed = line.trim()
    // The model wrapper chatters on stdout ("********", pad_token_id notes);
    // only our own JSON records matter.
    if (!trimmed.startsWith('{')) return
    const payload = JSON.parse(trimmed)
    if (payload.event === 'model_loaded') {
      console.log(`Model loaded (torch ${payload.torch}); measuring ${samples.length} clips ...`)
      return
    }
    rows.set(payload.id, payload)
    console.log(`  measured ${payload.id}`)
  })

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    // `close` (not `exit`) so every buffered stdout line has been read before
    // the table is rendered.
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`voice_emotion_bench.py exited with ${code}`))
        return
      }
      resolve(rows)
    })
  })
}

function formatDelta(value, digits = 1, unit = '') {
  if (value === null || Number.isNaN(value)) return '   n/a'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}${unit}`
}

function printTable(table, samples, rows) {
  const neutral = rows.get(`${table}|neutral`)
  console.log('')
  console.log(`${table} instruction table (vs neutral, seeds ${SEEDS.join('/')}, speaker ${SPEAKER})`)
  console.log(
    'emotion        F0 mean      ΔF0    F0 range     RMS dB      ΔRMS    dur s     Δdur  instruction',
  )
  for (const sample of samples.filter((entry) => entry.table === table)) {
    const row = rows.get(sample.id)
    if (!row) continue
    const deltaF0 = neutral?.f0_mean != null && row.f0_mean != null ? row.f0_mean - neutral.f0_mean : null
    const deltaRms = neutral?.rms_db != null ? row.rms_db - neutral.rms_db : null
    const deltaDur = neutral?.duration != null ? row.duration - neutral.duration : null
    console.log(
      `${sample.emotion.padEnd(14)}`
      + `${String(row.f0_mean ?? 'n/a').padStart(6)} Hz  `
      + `${formatDelta(deltaF0).padStart(7)}  `
      + `${String(row.f0_range ?? 'n/a').padStart(7)} Hz  `
      + `${String(row.rms_db ?? 'n/a').padStart(6)} dB  `
      + `${formatDelta(deltaRms).padStart(7)}  `
      + `${String(row.duration ?? 'n/a').padStart(6)}  `
      + `${formatDelta(deltaDur, 2).padStart(7)}  `
      + `${row.instruction || '(neutral)'}`,
    )
  }
}

async function main() {
  const python = resolvePython()
  const modelDir = resolveModelDir()
  if (!python || !modelDir) {
    console.log(
      'Voice-emotion bench skipped: needs a Python with qwen_tts + librosa at '
      + '$NEXUS_QWEN3_TTS_PYTHON or ~/Models/qwen3-tts/.venv/bin/python, and the '
      + 'Qwen3-TTS CustomVoice checkpoint. Nothing to measure; exiting.',
    )
    return
  }

  const samples = buildSamples()
  const rows = await runBench(python, modelDir, samples)
  for (const sample of SAMPLES) printTable(sample.table, samples, rows)
  console.log('')
  console.log('Expected direction: sad lower/slower, angry louder/sharper, happy/excited higher,')
  console.log('sulky/shy/whisper softer. Re-run after editing the instruction tables.')
}

process.on('SIGINT', () => process.exit(0))

await main()
