#!/usr/bin/env node
/**
 * Smart Turn v3 bench (dev only).
 *
 * Runs the same engine the Electron main process uses on a few 16 kHz WAVs and
 * prints p(complete) plus feature / ONNX / total latency. Not part of the app
 * bundle; the model is loaded from the user model directory or `--model`.
 *
 * Usage:
 *   npm run voice:turn:bench
 *   npm run voice:turn:bench -- path/a.wav path/b.wav
 *   npm run voice:turn:bench -- --model /abs/model.onnx --download
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSmartTurnEngine } from '../electron/smartTurnEngine.js'
import { MODEL_CATALOG } from '../electron/services/modelDefinitions.js'
import { downloadModel } from '../electron/services/modelDownloader.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODEL_ID = 'smart-turn-v3'
const MODEL_RELATIVE = 'smart-turn-v3/smart-turn-v3.2-cpu.onnx'
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'smart-turn')

function appDataRoot() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'nexus')
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'nexus')
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'nexus')
}

function resolveModelPath(explicit) {
  const candidates = [
    explicit,
    process.env.NEXUS_SMART_TURN_MODEL,
    path.join(appDataRoot(), 'sherpa-models', MODEL_RELATIVE),
    path.join(ROOT, 'sherpa-models', MODEL_RELATIVE),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function readWav(filePath) {
  const buffer = readFileSync(filePath)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${filePath} is not a RIFF/WAVE file`)
  }

  let offset = 12
  let format = null
  let data = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ') {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      }
    } else if (id === 'data') {
      data = buffer.subarray(start, Math.min(buffer.length, start + size))
    }
    offset = start + size + (size % 2)
  }

  if (!format || !data) throw new Error(`${filePath} has no fmt/data chunk`)
  if (format.audioFormat !== 1) throw new Error(`${filePath} is not PCM`)
  if (format.bitsPerSample !== 16) throw new Error(`${filePath} is not 16-bit PCM`)

  const frameCount = Math.floor(data.length / (2 * format.channels))
  const samples = new Float32Array(frameCount)
  for (let i = 0; i < frameCount; i += 1) {
    let sum = 0
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE((i * format.channels + channel) * 2) / 32768
    }
    samples[i] = sum / format.channels
  }

  if (format.sampleRate === 16_000) return samples
  return resampleLinear(samples, format.sampleRate, 16_000)
}

function resampleLinear(samples, fromRate, toRate) {
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate))
  const out = new Float32Array(length)
  const ratio = fromRate / toRate
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(samples.length - 1, left + 1)
    const fraction = position - left
    out[i] = samples[left] * (1 - fraction) + samples[right] * fraction
  }
  return out
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function defaultWavs() {
  if (!existsSync(FIXTURE_DIR)) return []
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.wav'))
    .map((name) => path.join(FIXTURE_DIR, name))
    .sort()
}

async function main() {
  const args = process.argv.slice(2)
  const modelFlag = args.indexOf('--model')
  const explicitModel = modelFlag >= 0 ? args[modelFlag + 1] : null
  const download = args.includes('--download')
  const wavs = args.filter((arg, index) => (
    !arg.startsWith('--') && index !== modelFlag + 1
  ))

  if (download && !resolveModelPath(explicitModel)) {
    const model = MODEL_CATALOG.find((entry) => entry.id === MODEL_ID)
    if (!model) throw new Error(`Missing catalog entry ${MODEL_ID}`)
    const modelsRoot = path.join(ROOT, 'sherpa-models')
    console.log(`Downloading ${MODEL_ID} to ${modelsRoot} ...`)
    await downloadModel(model, {
      modelsRoot,
      onProgress: (progress) => {
        if (progress.phase === 'downloading' && progress.total) {
          const percent = Math.round((progress.downloaded / progress.total) * 100)
          process.stdout.write(`\r  ${percent}% (${progress.downloaded}/${progress.total} bytes)`)
        }
      },
    })
    process.stdout.write('\n')
  }

  const modelPath = resolveModelPath(explicitModel)
  if (!modelPath) {
    throw new Error(
      'Smart Turn model not found. Pass --model /path/to/smart-turn-v3.2-cpu.onnx, '
      + 'start a voice turn once so the app downloads it, or rerun with --download.',
    )
  }

  const files = wavs.length ? wavs : defaultWavs()
  if (!files.length) throw new Error('No WAV files found; pass one or more paths.')

  console.log('Smart Turn v3 bench')
  console.log(`model: ${modelPath} (${(statSync(modelPath).size / 1024 / 1024).toFixed(1)} MB)`)
  const engine = await createSmartTurnEngine({ modelPath })
  const threads = Math.max(1, Math.min(4, os.availableParallelism?.() ?? os.cpus().length ?? 2))
  console.log(`backend: onnxruntime-web wasm, ${threads} thread(s), proxy worker\n`)

  const header = ['file', 'duration', 'p(complete)', 'features', 'inference', 'total']
  console.log(header.map((cell, index) => cell.padEnd(index === 0 ? 38 : 12)).join(''))
  console.log('-'.repeat(98))

  const inferenceTimes = []
  const featureTimes = []
  for (const file of files) {
    const samples = readWav(file)
    const runs = []
    for (let i = 0; i < 3; i += 1) runs.push(await engine.predict(samples))
    const last = runs[runs.length - 1]
    const inferenceMs = median(runs.map((run) => run.inferenceMs))
    const featureMs = median(runs.map((run) => run.featureMs))
    inferenceTimes.push(inferenceMs)
    featureTimes.push(featureMs)
    console.log([
      path.relative(ROOT, file).slice(0, 37).padEnd(38),
      `${(samples.length / 16_000).toFixed(2)}s`.padEnd(12),
      last.probability.toFixed(4).padEnd(12),
      `${featureMs.toFixed(1)} ms`.padEnd(12),
      `${inferenceMs.toFixed(1)} ms`.padEnd(12),
      `${last.totalMs.toFixed(1)} ms`.padEnd(12),
    ].join(''))
  }

  console.log('-'.repeat(98))
  console.log(`median inference: ${median(inferenceTimes).toFixed(1)} ms | median features: ${median(featureTimes).toFixed(1)} ms`)
  console.log('budget: inference above 150 ms makes the renderer fall back to the T7 text rules.')
  await engine.dispose()
}

main().catch((error) => {
  console.error(`[voice:turn:bench] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
