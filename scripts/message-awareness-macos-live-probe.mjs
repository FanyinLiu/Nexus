#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_COMMUNICATION_APP_PATTERN,
  classifyMacWatcherError,
  filterNewNotificationMessages,
  queryMacNotificationRows,
  resolveMacNotificationDb,
} from './communication-adapters/macos-notification-center-watch.mjs'

const execFileAsync = promisify(execFile)
const DEFAULT_LIMIT = 100
const DEFAULT_WAIT_MS = 12_000
const DEFAULT_STATE_FILE = path.join(os.tmpdir(), 'nexus-message-awareness-macos-live-probe.json')

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/message-awareness-macos-live-probe.mjs [options]',
    '',
    'Private-safe macOS Notification Center live probe. It never records release',
    'evidence and never prints notification title, body, sender, chat, or message IDs.',
    '',
    'Options:',
    '  --apps <regex>               App/title regex for notification candidates',
    '  --db <path>                  Notification Center sqlite DB path',
    '  --sqlite <path>              sqlite3 executable path',
    '  --limit <n>                  Rows to inspect per poll',
    '  --state-file <path>          Seen-key state file',
    `  --wait-ms <ms>               Observation window (default: ${DEFAULT_WAIT_MS})`,
    '  --send-test-notification     Send a local diagnostic notification via osascript',
    '  --output <path>              Write private-safe report JSON to a file',
    '  --require-observed           Exit non-zero unless exactly one fresh notification is observed and no replay is detected',
    '  --help                       Show this help',
    '',
  ].join('\n'))
}

function splitOption(arg) {
  const eq = arg.indexOf('=')
  if (eq < 0) return [arg, null]
  return [arg.slice(0, eq), arg.slice(eq + 1)]
}

function readOptionValue(argv, index, inlineValue, optionName) {
  if (inlineValue !== null) return { value: inlineValue, nextIndex: index }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return { value, nextIndex: index + 1 }
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

export function parseMacosLiveProbeArgs(argv) {
  const options = {
    apps: DEFAULT_COMMUNICATION_APP_PATTERN,
    db: '',
    help: false,
    limit: DEFAULT_LIMIT,
    outputPath: '',
    requireObserved: false,
    sendTestNotification: false,
    sqlite: 'sqlite3',
    stateFile: DEFAULT_STATE_FILE,
    waitMs: DEFAULT_WAIT_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--require-observed') {
      options.requireObserved = true
      continue
    }
    if (arg === '--send-test-notification') {
      options.sendTestNotification = true
      continue
    }

    const [name, inlineValue] = splitOption(arg)
    if (
      name === '--apps'
      || name === '--db'
      || name === '--sqlite'
      || name === '--limit'
      || name === '--state-file'
      || name === '--wait-ms'
      || name === '--output'
      || name === '--output-file'
      || name === '--evidence-file'
    ) {
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--apps') options.apps = String(parsed.value)
      else if (name === '--db') options.db = String(parsed.value)
      else if (name === '--sqlite') options.sqlite = String(parsed.value)
      else if (name === '--limit') options.limit = toPositiveInteger(parsed.value, DEFAULT_LIMIT)
      else if (name === '--state-file') options.stateFile = String(parsed.value)
      else if (name === '--wait-ms') options.waitMs = toPositiveInteger(parsed.value, DEFAULT_WAIT_MS)
      else options.outputPath = String(parsed.value)
      index = parsed.nextIndex
      continue
    }

    throw new Error(`Unsupported option: ${arg}`)
  }

  return options
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

async function loadSeenKeys(stateFile) {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    return new Set(Array.isArray(parsed?.seen)
      ? parsed.seen.map(cleanString).filter(Boolean)
      : [])
  } catch {
    return new Set()
  }
}

async function saveSeenKeys(stateFile, seenKeys) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, `${JSON.stringify({
    seen: [...seenKeys].slice(-500),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendDiagnosticNotification() {
  await execFileAsync('osascript', [
    '-e',
    'display notification "NexusLiveCheck adapter diagnostic notification" with title "NexusLiveCheck" subtitle "macOS live probe"',
  ])
}

async function collectFreshNotifications(options, seenKeys, context) {
  const dbPath = await (context.resolveMacNotificationDb ?? resolveMacNotificationDb)({
    db: options.db,
  })
  const rows = await (context.queryMacNotificationRows ?? queryMacNotificationRows)({
    dbPath,
    limit: options.limit,
    sqlitePath: options.sqlite,
  })
  const messages = (context.filterNewNotificationMessages ?? filterNewNotificationMessages)(rows, {
    pattern: options.apps,
    seenKeys,
  })
  for (const message of messages) {
    if (message?.messageId) seenKeys.add(message.messageId)
  }
  return {
    dbResolved: true,
    rowsInspected: rows.length,
    freshCount: messages.length,
  }
}

function buildStatus({ observedCount, replayCount, errorKind }) {
  if (errorKind) return 'environment-blocked'
  if (replayCount > 0) return 'replay-detected'
  if (observedCount === 1) return 'observed-once'
  if (observedCount > 1) return 'multiple-fresh-notifications'
  return 'no-fresh-notification'
}

function nextActionsForStatus(status, sendTestNotification) {
  if (status === 'observed-once') {
    return sendTestNotification
      ? [
          'The adapter saw one diagnostic notification and did not replay it.',
          'Repeat with a real communication-app notification before recording release evidence.',
        ]
      : [
          'Confirm the same notification produced exactly one Nexus event.',
          'Restart Nexus and confirm the old notification does not replay.',
          'Only then record macOS live evidence with the v04 message live record command.',
        ]
  }
  if (status === 'no-fresh-notification') {
    return [
      'Send one fresh communication-app notification while this probe is waiting.',
      'If using --send-test-notification, confirm macOS notifications are enabled for the automation host.',
      'Rerun npm run v04:message:preflight:live if the probe still sees nothing.',
    ]
  }
  if (status === 'multiple-fresh-notifications') {
    return [
      'Quiet other notification sources and repeat the probe.',
      'Record release evidence only after exactly one intended notification is observed.',
    ]
  }
  if (status === 'replay-detected') {
    return [
      'Inspect the watcher state file and repeat from a fresh state after marking backlog as seen.',
      'Do not record release evidence until an immediate replay probe returns zero fresh events.',
    ]
  }
  return [
    'Grant Full Disk Access to Terminal, Codex, or the packaged Nexus host.',
    'Restart the host process and rerun the live preflight.',
  ]
}

export async function buildMacosLiveProbeReport(options = {}, context = {}) {
  const generatedAt = new Date(context.now ?? Date.now()).toISOString()
  const platform = context.platform ?? process.platform
  const stateFile = cleanString(options.stateFile) || DEFAULT_STATE_FILE
  const seenKeys = await loadSeenKeys(stateFile)
  let initial = { dbResolved: false, rowsInspected: 0, freshCount: 0 }
  let observed = { dbResolved: false, rowsInspected: 0, freshCount: 0 }
  let replay = { dbResolved: false, rowsInspected: 0, freshCount: 0 }
  let errorKind = ''

  if (platform !== 'darwin') {
    errorKind = 'unsupported'
  } else {
    try {
      initial = await collectFreshNotifications(options, seenKeys, context)
      await saveSeenKeys(stateFile, seenKeys)
      if (options.sendTestNotification) {
        await (context.sendDiagnosticNotification ?? sendDiagnosticNotification)()
      }
      await (context.sleep ?? sleep)(options.waitMs ?? DEFAULT_WAIT_MS)
      observed = await collectFreshNotifications(options, seenKeys, context)
      await saveSeenKeys(stateFile, seenKeys)
      replay = await collectFreshNotifications(options, seenKeys, context)
      await saveSeenKeys(stateFile, seenKeys)
    } catch (error) {
      errorKind = classifyMacWatcherError(error?.message ?? error)
    }
  }

  const status = buildStatus({
    observedCount: observed.freshCount,
    replayCount: replay.freshCount,
    errorKind,
  })
  const ok = status === 'observed-once'

  return {
    schemaVersion: 1,
    gate: 'message-awareness-macos-live-probe',
    generatedAt,
    ok,
    status,
    releaseEvidenceRecorded: false,
    releaseEvidenceCandidate: ok && options.sendTestNotification !== true,
    detail: ok
      ? 'Exactly one fresh macOS notification candidate was observed and the immediate replay probe found zero fresh events.'
      : 'macOS live probe did not produce release-ready adapter evidence.',
    diagnostics: {
      platform,
      machineChecked: true,
      errorKind: errorKind || null,
      stateFileConfigured: Boolean(stateFile),
      testNotificationRequested: options.sendTestNotification === true,
      initialBacklogMarkedSeen: initial.freshCount,
      observedFreshCount: observed.freshCount,
      replayFreshCount: replay.freshCount,
      rowsInspected: {
        initial: initial.rowsInspected,
        observed: observed.rowsInspected,
        replay: replay.rowsInspected,
      },
    },
    nextActions: nextActionsForStatus(status, options.sendTestNotification === true),
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'notification title/body/sender/chat values',
        'notification message ids and conversation ids',
        'webhook payloads and responses',
      ],
    },
  }
}

async function writeReportFile(report, outputPath) {
  const target = cleanString(outputPath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runMacosLiveProbeCli(argv = process.argv.slice(2), context = {}) {
  const options = parseMacosLiveProbeArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  const report = await buildMacosLiveProbeReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireObserved && !report.ok ? 2 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMacosLiveProbeCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
