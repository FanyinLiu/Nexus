#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildPublicVoiceDiagnosticsReport,
} from '../src/features/voice/voiceDiagnostics.ts'

const VALID_PIPELINE_STEPS = new Set([
  'idle',
  'listening',
  'transcribing',
  'recognized',
  'sending',
  'manual_confirm',
  'blocked_busy',
  'blocked_wake_word',
  'reply_received',
  'reply_failed',
])
const VALID_TRACE_TONES = new Set(['info', 'success', 'error'])
const VALID_VOICE_STATES = new Set(['idle', 'listening', 'processing', 'speaking'])

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/voice-diagnostics-report.mjs [options]',
    '',
    'Options:',
    '  --input <path>            Voice diagnostics input JSON file, or - for stdin',
    '  --json <path>             Alias for --input',
    '  --generated-at <iso>      Override report timestamp',
    '  --output <path>           Write the private-safe report JSON to a file',
    '  --require-ready           Exit non-zero unless the evidence is ready',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  npm run voice:diagnostics:report -- --input artifacts/voice-diagnostics-input.json',
    '  npm run voice:diagnostics:report -- --input artifacts/voice-diagnostics-input.json --output artifacts/v0.3.4/voice-diagnostics.json --require-ready',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function splitOption(arg) {
  const eq = arg.indexOf('=')
  if (eq < 0) return [arg, null]
  return [arg.slice(0, eq), arg.slice(eq + 1)]
}

function readRequiredOptionValue(argv, index, inlineValue, optionName) {
  if (inlineValue !== null) return { value: inlineValue, nextIndex: index }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return { value, nextIndex: index + 1 }
}

function assignOption(options, name, value) {
  switch (name) {
    case '--input':
    case '--json':
      options.inputPath = value
      return
    case '--generated-at':
      options.generatedAt = value
      return
    case '--output':
    case '--output-file':
    case '--evidence-file':
      options.outputPath = value
      return
    default:
      throw new Error(`Unknown option: ${name}`)
  }
}

export function parseVoiceDiagnosticsReportArgs(argv) {
  const options = {
    inputPath: '',
    generatedAt: '',
    outputPath: '',
    requireReady: false,
    help: false,
  }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--require-ready') {
      options.requireReady = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      assignOption(options, name, parsed.value)
      index = parsed.nextIndex
      continue
    }
    positional.push(arg)
  }

  if (!options.inputPath && positional.length > 0) {
    options.inputPath = positional[0]
  }

  return options
}

async function readStdinText() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readJsonInput(inputPath) {
  const cleanPath = cleanString(inputPath)
  if (!cleanPath) {
    throw new Error('--input is required')
  }
  const text = cleanPath === '-'
    ? await readStdinText()
    : await fs.readFile(path.resolve(process.cwd(), cleanPath), 'utf8')
  return JSON.parse(text)
}

function writeableObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
}

async function writeReportFile(report, outputPath) {
  const cleanPath = cleanString(outputPath)
  if (!cleanPath) return
  const resolvedPath = path.resolve(process.cwd(), cleanPath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

function normalizePipeline(raw) {
  const obj = writeableObject(raw)
  const step = cleanString(obj.step)
  return {
    detail: cleanString(obj.detail),
    step: VALID_PIPELINE_STEPS.has(step) ? step : 'idle',
    transcript: typeof obj.transcript === 'string' ? obj.transcript : '',
    updatedAt: cleanString(obj.updatedAt),
  }
}

function normalizeVoiceState(raw) {
  const state = cleanString(raw)
  return VALID_VOICE_STATES.has(state) ? state : 'idle'
}

function normalizeTraceEntry(raw, index) {
  const obj = writeableObject(raw)
  if (Object.keys(obj).length === 0) return null
  const tone = cleanString(obj.tone)
  return {
    createdAt: cleanString(obj.createdAt) || new Date(index).toISOString(),
    detail: cleanString(obj.detail),
    id: cleanString(obj.id) || `voice-trace-${index + 1}`,
    title: cleanString(obj.title),
    tone: VALID_TRACE_TONES.has(tone) ? tone : 'info',
  }
}

function normalizeNumber(raw, fallback) {
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function normalizeNullableNumber(raw) {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function normalizeTransitionRecord(raw, index) {
  const obj = writeableObject(raw)
  if (Object.keys(obj).length === 0) return null
  return {
    eventType: cleanString(obj.eventType) || cleanString(obj.type) || 'session:started',
    latencyMs: normalizeNullableNumber(obj.latencyMs),
    meta: writeableObject(obj.meta),
    nextPhase: cleanString(obj.nextPhase) || 'idle',
    prevPhase: cleanString(obj.prevPhase) || 'idle',
    provider: cleanString(obj.provider) || null,
    reason: cleanString(obj.reason) || null,
    seq: normalizeNumber(obj.seq, index + 1),
    sessionId: cleanString(obj.sessionId) || null,
    ts: normalizeNumber(obj.ts, 0),
  }
}

function normalizeSpeechOutput(raw, source) {
  const obj = writeableObject(raw)
  const fallback = writeableObject(source)
  const providerId = cleanString(obj.providerId) || cleanString(fallback.speechOutputProviderId)
  if (!providerId) return null
  return {
    model: cleanString(obj.model) || cleanString(fallback.speechOutputModel),
    providerId,
    voice: cleanString(obj.voice) || cleanString(fallback.speechOutputVoice),
  }
}

function normalizeVoiceDiagnosticsInput(raw) {
  const source = writeableObject(raw)
  const voiceTrace = Array.isArray(source.voiceTrace) ? source.voiceTrace : source.trace
  const transitionRecords = Array.isArray(source.transitionRecords)
    ? source.transitionRecords
    : source.transitions
  return {
    speechLevel: normalizeNumber(source.speechLevel, 0),
    speechOutput: normalizeSpeechOutput(source.speechOutput ?? source.tts, source),
    transitionRecords: Array.isArray(transitionRecords)
      ? transitionRecords
        .map((entry, index) => normalizeTransitionRecord(entry, index))
        .filter((entry) => entry != null)
      : [],
    voicePipeline: normalizePipeline(source.voicePipeline ?? source.pipeline),
    voiceState: normalizeVoiceState(source.voiceState),
    voiceTrace: Array.isArray(voiceTrace)
      ? voiceTrace
        .map((entry, index) => normalizeTraceEntry(entry, index))
        .filter((entry) => entry != null)
      : [],
  }
}

export async function buildVoiceDiagnosticsReportFromInput(raw, generatedAt = new Date().toISOString()) {
  return buildPublicVoiceDiagnosticsReport(
    normalizeVoiceDiagnosticsInput(raw),
    { generatedAt },
  )
}

export async function runVoiceDiagnosticsReportCli(argv = process.argv.slice(2)) {
  const options = parseVoiceDiagnosticsReportArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const raw = await readJsonInput(options.inputPath)
  const report = await buildVoiceDiagnosticsReportFromInput(
    raw,
    options.generatedAt || new Date().toISOString(),
  )
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runVoiceDiagnosticsReportCli().then((code) => {
    process.exitCode = code
  }).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
}
