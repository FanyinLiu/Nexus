#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const PROACTIVE_CARE_RUNTIME_REHEARSAL_GATE = 'proactive-care-runtime-rehearsal'
export const DEFAULT_PROACTIVE_CARE_RUNTIME_REHEARSAL_OUTPUT =
  'artifacts/v0.3.4/proactive-care-evidence.json'

const REHEARSAL_SCENARIO_VERSION = 1

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/proactive-care-runtime-rehearsal.mjs [options]',
    '',
    'Options:',
    '  --generated-at <iso>       Override report timestamp',
    `  --output <path>            Write the private-safe report JSON (default: ${DEFAULT_PROACTIVE_CARE_RUNTIME_REHEARSAL_OUTPUT})`,
    '  --require-ready            Exit non-zero unless every evidence check passes',
    '  --help                     Show this help',
    '',
    'Examples:',
    '  npm run proactive:care:rehearsal',
    '  npm run proactive:care:rehearsal -- --output artifacts/v0.3.4/proactive-care-evidence.json --require-ready',
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

export function parseProactiveCareRuntimeRehearsalArgs(argv) {
  const options = {
    generatedAt: '',
    outputPath: DEFAULT_PROACTIVE_CARE_RUNTIME_REHEARSAL_OUTPUT,
    requireReady: false,
    help: false,
  }

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
    throw new Error(`Unexpected argument: ${arg}`)
  }

  return options
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function createIsolatedLocalStorage() {
  const store = new Map()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      const normalizedKey = String(key)
      return store.has(normalizedKey) ? store.get(normalizedKey) : null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(String(key))
    },
    setItem(key, value) {
      store.set(String(key), String(value))
    },
  }
}

function replaceGlobalProperty(name, value) {
  const hadOwn = Object.prototype.hasOwnProperty.call(globalThis, name)
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  })
  return () => {
    if (hadOwn && previousDescriptor) {
      Object.defineProperty(globalThis, name, previousDescriptor)
      return
    }
    Reflect.deleteProperty(globalThis, name)
  }
}

function installIsolatedBrowserStorage() {
  const localStorage = createIsolatedLocalStorage()
  const windowShim = {
    localStorage,
    addEventListener() {},
    removeEventListener() {},
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setTimeout: globalThis.setTimeout.bind(globalThis),
  }

  const restoreWindow = replaceGlobalProperty('window', windowShim)
  const restoreLocalStorage = replaceGlobalProperty('localStorage', localStorage)
  const restoreBroadcastChannel = replaceGlobalProperty('BroadcastChannel', undefined)

  return {
    localStorage,
    restore() {
      restoreBroadcastChannel()
      restoreLocalStorage()
      restoreWindow()
    },
  }
}

function buildTimeline(generatedAt) {
  const generatedMs = Date.parse(normalizeIso(generatedAt))
  const latestMs = generatedMs - 15 * 60_000
  const firstMs = latestMs - 165 * 60_000
  return (minutesAfterFirst) => new Date(firstMs + minutesAfterFirst * 60_000).toISOString()
}

function assertRecorded(event, label) {
  if (!event) throw new Error(`Could not record proactive-care rehearsal event: ${label}`)
  return event
}

async function importProactiveCareStorage() {
  return await import('../src/lib/storage/proactiveCare.ts')
}

export async function buildProactiveCareRuntimeRehearsalReport({
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedGeneratedAt = normalizeIso(generatedAt)
  const isolated = installIsolatedBrowserStorage()
  try {
    const {
      buildPublicProactiveCareEvidenceReport,
      clearProactiveCareEvents,
      loadProactiveCareEvents,
      recordProactiveCareEvent,
      recordProactiveCareUserAction,
    } = await importProactiveCareStorage()
    const at = buildTimeline(normalizedGeneratedAt)

    clearProactiveCareEvents()

    const awayEvent = assertRecorded(recordProactiveCareEvent({
      source: 'away_notification',
      outcome: 'fired',
      reason: 'fire',
      detail: 'Runtime rehearsal due-item evidence for the away notification scheduler.',
      createdAt: at(0),
      userVisibleReason: 'You were away long enough for a gentle check-in.',
      sourceRef: { kind: 'message', id: 'rehearsal-message-1', label: 'Runtime rehearsal message' },
    }), 'away_notification fired')
    assertRecorded(recordProactiveCareUserAction(awayEvent.id, 'open_source'), 'away_notification action')

    assertRecorded(recordProactiveCareEvent({
      source: 'daily_bracket',
      outcome: 'skipped',
      reason: 'morning_already_fired_today',
      detail: 'Runtime rehearsal rate-limit evidence for the morning bracket.',
      createdAt: at(45),
      userVisibleReason: 'Morning care stayed quiet because today already had one bracket.',
      sourceRef: { kind: 'bracket', id: 'morning', label: 'Runtime rehearsal morning bracket' },
    }), 'daily_bracket rate limit')

    assertRecorded(recordProactiveCareEvent({
      source: 'open_arc',
      outcome: 'skipped',
      reason: 'quiet_hours',
      detail: 'Runtime rehearsal quiet-hours evidence for an open arc.',
      createdAt: at(105),
      userVisibleReason: 'Quiet hours kept Nexus from surfacing this open arc.',
      sourceRef: { kind: 'arc', id: 'rehearsal-arc-1', label: 'Runtime rehearsal open arc' },
    }), 'open_arc quiet hours')

    assertRecorded(recordProactiveCareEvent({
      source: 'future_capsule',
      outcome: 'fired',
      reason: 'fire',
      detail: 'Runtime rehearsal due-item evidence for a future capsule.',
      createdAt: at(165),
      userVisibleReason: 'A future capsule reached its time for a gentle follow-up.',
      sourceRef: { kind: 'capsule', id: 'rehearsal-capsule-1', label: 'Runtime rehearsal capsule' },
    }), 'future_capsule fired')

    const events = loadProactiveCareEvents()
    return {
      ...buildPublicProactiveCareEvidenceReport(events, normalizedGeneratedAt),
      evidenceSource: 'runtime-rehearsal',
      rehearsal: {
        gate: PROACTIVE_CARE_RUNTIME_REHEARSAL_GATE,
        scenarioVersion: REHEARSAL_SCENARIO_VERSION,
        isolatedStorage: true,
        exercisedStorageApi: true,
        eventCount: events.length,
      },
    }
  } finally {
    isolated.restore()
  }
}

async function writeReportFile(report, outputPath) {
  const cleanPath = cleanString(outputPath)
  if (!cleanPath) return
  const resolvedPath = path.resolve(process.cwd(), cleanPath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runProactiveCareRuntimeRehearsalCli(argv = process.argv.slice(2)) {
  const options = parseProactiveCareRuntimeRehearsalArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = await buildProactiveCareRuntimeRehearsalReport({
    generatedAt: options.generatedAt || new Date().toISOString(),
  })
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runProactiveCareRuntimeRehearsalCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
