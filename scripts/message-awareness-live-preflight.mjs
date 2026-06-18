#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_COMMUNICATION_APP_PATTERN,
  classifyMacWatcherError,
  filterNewNotificationMessages,
  queryMacNotificationRows,
  resolveMacNotificationDb,
} from './communication-adapters/macos-notification-center-watch.mjs'

const DEFAULT_LIMIT = 20

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/message-awareness-live-preflight.mjs [options]',
    '',
    'Runs a private-safe environment preflight for live message-awareness checks.',
    'It never records release evidence and never prints notification bodies,',
    'senders, chat titles, channel ids, or webhook payloads.',
    '',
    'Options:',
    '  --apps <regex>         App/title regex for macOS notification candidates',
    '  --db <path>            macOS Notification Center sqlite DB path',
    '  --sqlite <path>        sqlite3 executable path',
    `  --limit <n>            Rows to inspect for macOS preflight (default: ${DEFAULT_LIMIT})`,
    '  --output <path>        Write the private-safe report JSON to a file',
    '  --require-ready        Exit non-zero when a machine-detected blocker exists',
    '  --help                 Show this help',
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

export function parseMessageAwarenessLivePreflightArgs(argv) {
  const options = {
    apps: DEFAULT_COMMUNICATION_APP_PATTERN,
    db: '',
    help: false,
    limit: DEFAULT_LIMIT,
    outputPath: '',
    requireReady: false,
    sqlite: 'sqlite3',
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

    const [name, inlineValue] = splitOption(arg)
    if (
      name === '--apps'
      || name === '--db'
      || name === '--sqlite'
      || name === '--limit'
      || name === '--output'
      || name === '--output-file'
      || name === '--evidence-file'
    ) {
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--apps') options.apps = String(parsed.value)
      else if (name === '--db') options.db = String(parsed.value)
      else if (name === '--sqlite') options.sqlite = String(parsed.value)
      else if (name === '--limit') options.limit = toPositiveInteger(parsed.value, DEFAULT_LIMIT)
      else options.outputPath = String(parsed.value)
      index = parsed.nextIndex
      continue
    }

    throw new Error(`Unsupported option: ${arg}`)
  }

  return options
}

function dbLocationKind(dbPath) {
  const value = String(dbPath ?? '')
  if (/group\.com\.apple\.usernoted/u.test(value)) return 'group-com-apple-usernoted'
  if (/group\.com\.apple\.UserNotifications/u.test(value)) return 'group-com-apple-usernotifications'
  if (/NotificationCenter/u.test(value)) return 'notification-center'
  return 'custom-or-unknown'
}

function classifyMacPreflightError(error) {
  const message = String(error?.message ?? error ?? '')
  if (/No macOS Notification Center database found/iu.test(message)) return 'no-database'
  return classifyMacWatcherError(message)
}

function publicMacPreflightDetail(status) {
  if (status === 'ready-for-observation') {
    return 'Notification Center is readable; record pass evidence only after a fresh real notification is observed once and old notifications do not replay after restart.'
  }
  if (status === 'needs-permission') {
    return 'The process cannot read Notification Center yet; grant Full Disk Access to Terminal, Codex, or the packaged Nexus host.'
  }
  if (status === 'no-database') {
    return 'No Notification Center database was found from the current host process.'
  }
  if (status === 'unsupported') {
    return 'macOS Notification Center live evidence can only be checked on macOS.'
  }
  return 'Notification Center preflight failed before a safe live observation could be attempted.'
}

async function buildMacosPreflight(options, context) {
  const platform = context.platform ?? process.platform
  if (platform !== 'darwin') {
    return {
      id: 'macos-notification-center-live',
      label: 'macOS Notification Center',
      status: 'unsupported',
      blocking: true,
      detail: publicMacPreflightDetail('unsupported'),
      diagnostics: {
        platform,
        machineChecked: true,
      },
      nextActions: [
        'Run this preflight on the macOS host that will perform the release live check.',
      ],
    }
  }

  try {
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
      seenKeys: new Set(),
    })
    return {
      id: 'macos-notification-center-live',
      label: 'macOS Notification Center',
      status: 'ready-for-observation',
      blocking: false,
      detail: publicMacPreflightDetail('ready-for-observation'),
      diagnostics: {
        platform,
        machineChecked: true,
        dbResolved: true,
        dbLocationKind: dbLocationKind(dbPath),
        rowsInspected: rows.length,
        matchingCandidateCount: messages.length,
      },
      nextActions: [
        'Enable Desktop message awareness in Nexus.',
        'Send one fresh real communication-app notification.',
        'Confirm exactly one Nexus event appears, then restart Nexus and confirm the old notification does not replay.',
        'Record the macOS live evidence only after those observations are true.',
      ],
    }
  } catch (error) {
    const status = classifyMacPreflightError(error)
    return {
      id: 'macos-notification-center-live',
      label: 'macOS Notification Center',
      status,
      blocking: true,
      detail: publicMacPreflightDetail(status),
      diagnostics: {
        platform,
        machineChecked: true,
        errorKind: status,
      },
      nextActions: status === 'needs-permission'
        ? [
            'Grant Full Disk Access to Terminal, Codex, or the packaged Nexus host.',
            'Restart the host process after changing the permission.',
            'Rerun this preflight before recording pass evidence.',
          ]
        : [
            'Inspect the macOS Notification Center database location or pass --db <path>.',
            'Rerun this preflight before recording pass evidence.',
          ],
    }
  }
}

function buildManualBridgePreflight(id, label, nextActions) {
  return {
    id,
    label,
    status: 'manual-required',
    blocking: false,
    detail: 'This bridge requires a real paired account/channel check in the desktop app; the CLI reports the runbook without reading secrets or private chat content.',
    diagnostics: {
      machineChecked: false,
      secretValuesRead: false,
    },
    nextActions,
  }
}

export async function buildMessageAwarenessLivePreflightReport(options = {}, context = {}) {
  const macos = await buildMacosPreflight(options, context)
  const checks = [
    macos,
    buildManualBridgePreflight('telegram-live-bridge', 'Telegram live bridge', [
      'Connect the Telegram bot in Nexus settings.',
      'Approve the owner pairing code in desktop settings.',
      'Send one real owner message, confirm the companion reply returns, test busy queue/retry, and reconnect without replay.',
      'Record Telegram live evidence only after those observations are true.',
    ]),
    buildManualBridgePreflight('discord-live-bridge', 'Discord live bridge', [
      'Enable Discord Message Content Intent for the bot.',
      'Connect the Discord bot in Nexus settings and approve the target channel or DM.',
      'Send one real message, confirm the companion reply returns, suppress bot echoes, and surface reconnect status.',
      'Record Discord live evidence only after those observations are true.',
    ]),
  ]
  const blockingCheckIds = checks.filter((check) => check.blocking).map((check) => check.id)

  return {
    schemaVersion: 1,
    gate: 'message-awareness-live-preflight',
    generatedAt: new Date(context.now ?? Date.now()).toISOString(),
    ok: blockingCheckIds.length === 0,
    overallStatus: blockingCheckIds.length === 0
      ? 'ready-for-live-observation'
      : 'environment-blocked',
    releaseGateComplete: false,
    checks,
    blockingCheckIds,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'notification title/body/sender/chat values',
        'webhook payloads and responses',
        'Telegram and Discord tokens',
        'Telegram chat ids and Discord channel ids',
      ],
    },
  }
}

async function writeReportFile(report, outputPath) {
  const target = String(outputPath ?? '').trim()
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runMessageAwarenessLivePreflight(argv = process.argv.slice(2), context = {}) {
  const options = parseMessageAwarenessLivePreflightArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  const report = await buildMessageAwarenessLivePreflightReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 2 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMessageAwarenessLivePreflight().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
