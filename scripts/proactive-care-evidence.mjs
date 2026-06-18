#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildPublicProactiveCareEvidenceReport,
  normalizeProactiveCareEvents,
} from '../src/lib/storage/proactiveCare.ts'
import { PROACTIVE_CARE_EVENTS_STORAGE_KEY } from '../src/lib/storage/core.ts'

export const SAMPLE_PROACTIVE_CARE_EVENTS = [
  {
    id: 'sample-away-fired',
    source: 'away_notification',
    outcome: 'fired',
    reason: 'fire',
    detail: 'Synthetic due-item evidence for the away notification scheduler.',
    createdAt: '2026-06-16T09:00:00Z',
    occurrences: 1,
    carePolicyVersion: 2,
    userVisibleReason: 'You were away long enough for a gentle check-in.',
    userAction: 'open_source',
    sourceRef: { kind: 'message', id: 'sample-message', label: 'Synthetic message context' },
  },
  {
    id: 'sample-daily-rate-limited',
    source: 'daily_bracket',
    outcome: 'skipped',
    reason: 'morning_already_fired_today',
    detail: 'Synthetic rate-limit evidence for the morning bracket.',
    createdAt: '2026-06-16T10:15:00Z',
    occurrences: 2,
    carePolicyVersion: 2,
    userVisibleReason: 'Morning care was skipped because today already had one bracket.',
    sourceRef: { kind: 'bracket', id: 'morning', label: 'Synthetic morning bracket' },
  },
  {
    id: 'sample-open-arc-fired',
    source: 'open_arc',
    outcome: 'fired',
    reason: 'fire',
    detail: 'Synthetic due-item evidence for an open arc.',
    createdAt: '2026-06-16T11:30:00Z',
    occurrences: 1,
    carePolicyVersion: 2,
    userVisibleReason: 'An open arc became ready for a small follow-up.',
    sourceRef: { kind: 'arc', id: 'sample-arc', label: 'Synthetic open arc' },
  },
  {
    id: 'sample-future-capsule-quiet',
    source: 'future_capsule',
    outcome: 'skipped',
    reason: 'quiet_hours',
    detail: 'Synthetic quiet-hours evidence for a future capsule.',
    createdAt: '2026-06-16T12:45:00Z',
    occurrences: 1,
    carePolicyVersion: 2,
    userVisibleReason: 'A future capsule was due, but quiet hours kept Nexus silent.',
    sourceRef: { kind: 'capsule', id: 'sample-capsule', label: 'Synthetic capsule' },
  },
]

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/proactive-care-evidence.mjs [options]',
    '',
    'Options:',
    '  --events-file <path>       JSON array of proactive-care events, or - for stdin',
    '  --input <path>             Alias for --events-file',
    '  --local-storage-leveldb <path>',
    '                            Read the Chromium/Electron Local Storage leveldb directly',
    '  --sample                   Use built-in synthetic events for private-safe report QA',
    '  --generated-at <iso>       Override report timestamp',
    '  --output <path>            Write the private-safe report JSON to a file',
    '  --require-ready            Exit non-zero unless every evidence check passes',
    '  --help                     Show this help',
    '',
    'Examples:',
    '  npm run proactive:care:evidence -- --events-file artifacts/proactive-care-events.json',
    '  npm run proactive:care:evidence -- --local-storage-leveldb "$HOME/Library/Application Support/nexus/Local Storage/leveldb"',
    '  npm run proactive:care:evidence -- --sample',
    '  npm run proactive:care:evidence -- --events-file artifacts/proactive-care-events.json --output artifacts/v0.3.4/proactive-care-evidence.json --require-ready',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').trim()
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
    case '--events-file':
    case '--input':
    case '--json':
      options.eventsFile = value
      return
    case '--local-storage-leveldb':
    case '--leveldb':
      options.localStorageLevelDb = value
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

export function parseProactiveCareEvidenceArgs(argv) {
  const options = {
    eventsFile: '',
    generatedAt: '',
    localStorageLevelDb: '',
    outputPath: '',
    requireReady: false,
    sample: false,
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
    if (arg === '--sample') {
      options.sample = true
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

  if (!options.eventsFile && positional.length > 0) {
    options.eventsFile = positional[0]
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
    throw new Error('--events-file is required')
  }
  const text = cleanPath === '-'
    ? await readStdinText()
    : await fs.readFile(path.resolve(process.cwd(), cleanPath), 'utf8')
  return JSON.parse(text)
}

function findNeedleOffsets(buffer, needle) {
  const offsets = []
  let offset = buffer.indexOf(needle)
  while (offset >= 0) {
    offsets.push(offset)
    offset = buffer.indexOf(needle, offset + needle.length)
  }
  return offsets
}

function extractBalancedJsonText(buffer, startOffset) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startOffset; index < buffer.length; index += 1) {
    const byte = buffer[index]
    if (byte === 0) continue

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (byte === 92) {
        escaped = true
        continue
      }
      if (byte === 34) inString = false
      continue
    }

    if (byte === 34) {
      inString = true
      continue
    }
    if (byte === 91 || byte === 123) {
      depth += 1
      continue
    }
    if (byte === 93 || byte === 125) {
      depth -= 1
      if (depth === 0) {
        return buffer.subarray(startOffset, index + 1).toString('utf8').replace(/\u0000/g, '')
      }
    }
  }

  return ''
}

function findJsonStartAfter(buffer, offset, needleLength) {
  const searchEnd = Math.min(buffer.length, offset + needleLength + 256)
  for (let index = offset + needleLength; index < searchEnd; index += 1) {
    const byte = buffer[index]
    if (byte === 91 || byte === 123) return index
  }
  return -1
}

function maxEventTimestamp(events) {
  let latest = 0
  for (const event of normalizeProactiveCareEvents(events)) {
    const createdMs = Date.parse(event.createdAt)
    if (Number.isFinite(createdMs)) latest = Math.max(latest, createdMs)
  }
  return latest
}

function extractLocalStorageCandidates(buffer) {
  const needles = [
    Buffer.from(PROACTIVE_CARE_EVENTS_STORAGE_KEY, 'utf8'),
    Buffer.from(PROACTIVE_CARE_EVENTS_STORAGE_KEY, 'utf16le'),
  ]
  const candidates = []

  for (const needle of needles) {
    for (const offset of findNeedleOffsets(buffer, needle)) {
      const jsonStart = findJsonStartAfter(buffer, offset, needle.length)
      if (jsonStart < 0) continue
      const jsonText = extractBalancedJsonText(buffer, jsonStart)
      if (!jsonText) continue

      try {
        const events = extractEventRows(JSON.parse(jsonText))
        const normalized = normalizeProactiveCareEvents(events)
        if (normalized.length === 0) continue
        candidates.push({
          eventCount: normalized.length,
          latestEventMs: maxEventTimestamp(normalized),
          events,
        })
      } catch {
        // LevelDB files contain many unrelated binary fragments; ignore
        // candidates that do not parse as this localStorage value.
      }
    }
  }

  return candidates
}

export async function extractProactiveCareEventsFromLocalStorageLevelDb(levelDbDir) {
  const resolvedDir = path.resolve(process.cwd(), cleanString(levelDbDir))
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true })
  const candidates = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/\.(?:ldb|log)$/i.test(entry.name)) continue
    const filePath = path.join(resolvedDir, entry.name)
    const buffer = await fs.readFile(filePath)
    candidates.push(...extractLocalStorageCandidates(buffer))
  }

  candidates.sort((a, b) => {
    if (b.latestEventMs !== a.latestEventMs) return b.latestEventMs - a.latestEventMs
    return b.eventCount - a.eventCount
  })
  return candidates[0]?.events ?? []
}

function extractEventRows(raw) {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Array.isArray(raw.events)) return raw.events
  throw new Error('Expected a JSON array of proactive-care events, or an object with an events array')
}

async function readRawEvents(options) {
  const sourceCount = [
    options.sample,
    Boolean(cleanString(options.localStorageLevelDb)),
    Boolean(cleanString(options.eventsFile)),
  ].filter(Boolean).length
  if (sourceCount > 1) {
    throw new Error('Choose only one input source: --sample, --events-file, or --local-storage-leveldb')
  }
  if (options.sample) return SAMPLE_PROACTIVE_CARE_EVENTS
  if (cleanString(options.localStorageLevelDb)) {
    return await extractProactiveCareEventsFromLocalStorageLevelDb(options.localStorageLevelDb)
  }
  return await readJsonInput(options.eventsFile)
}

async function writeReportFile(report, outputPath) {
  const cleanPath = cleanString(outputPath)
  if (!cleanPath) return
  const resolvedPath = path.resolve(process.cwd(), cleanPath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runProactiveCareEvidenceCli(argv = process.argv.slice(2)) {
  const options = parseProactiveCareEvidenceArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const raw = await readRawEvents(options)
  const events = normalizeProactiveCareEvents(extractEventRows(raw))
  const report = {
    ...buildPublicProactiveCareEvidenceReport(
      events,
      options.generatedAt || new Date().toISOString(),
    ),
    evidenceSource: options.sample ? 'sample-qa' : 'runtime-events',
  }
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runProactiveCareEvidenceCli().then((code) => {
    process.exitCode = code
  }).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
}
