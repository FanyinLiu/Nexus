#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_V04_BRIDGE_TRACE_FILE = 'artifacts/v0.4.0/message-awareness-bridge-trace.json'

const PRIVATE_FIELD_LABELS = [
  'Telegram bot tokens and bot usernames',
  'Discord bot tokens and application identifiers',
  'chat ids, channel ids, sender ids, event ids, and target ids',
  'message text, notification title/body, webhook payloads, and raw replies',
  'lastOutboundTarget and lastOutboundError raw values',
  'allowedChatIds and allowedChannelIds allowlists',
  'raw gateway status objects',
]

const SAFE_STATE_VALUES = new Set([
  'connected',
  'connecting',
  'disconnected',
  'disabled',
  'error',
  'idle',
  'reconnecting',
  'stopped',
  'unknown',
])

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/v04-message-bridge-trace.mjs [options]',
    '',
    'Sanitizes Telegram/Discord runtime gateway status into a private-safe',
    'v0.4 bridge trace. The output never copies message text, sender IDs,',
    'chat/channel IDs, tokens, raw targets, or raw outbound error text.',
    '',
    'Options:',
    '  --input <path>                  Combined diagnostics JSON containing telegramStatus/discordStatus or telegram/discord',
    '  --telegram-status-file <path>   Telegram gateway status JSON',
    '  --discord-status-file <path>    Discord gateway status JSON',
    `  --output <path>                 Write JSON report (default: ${DEFAULT_V04_BRIDGE_TRACE_FILE})`,
    '  --sample                        Emit an empty safe template instead of reading input files',
    '  --require-trace                 Exit non-zero when no safe Telegram/Discord trace evidence is present',
    '  --help                          Show this help',
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

export function parseV04MessageBridgeTraceArgs(argv) {
  const options = {
    help: false,
    inputPath: '',
    telegramStatusFile: '',
    discordStatusFile: '',
    outputPath: DEFAULT_V04_BRIDGE_TRACE_FILE,
    sample: false,
    requireTrace: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--sample') {
      options.sample = true
      continue
    }
    if (arg === '--require-trace') {
      options.requireTrace = true
      continue
    }

    const [name, inlineValue] = splitOption(arg)
    if (
      name === '--input'
      || name === '--input-file'
      || name === '--telegram-status-file'
      || name === '--telegram'
      || name === '--discord-status-file'
      || name === '--discord'
      || name === '--output'
      || name === '--output-file'
    ) {
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--input' || name === '--input-file') {
        options.inputPath = String(parsed.value)
      } else if (name === '--telegram-status-file' || name === '--telegram') {
        options.telegramStatusFile = String(parsed.value)
      } else if (name === '--discord-status-file' || name === '--discord') {
        options.discordStatusFile = String(parsed.value)
      } else {
        options.outputPath = String(parsed.value)
      }
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

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidTimestamp(value) {
  if (value == null || value === '') return false
  return Number.isFinite(Date.parse(String(value)))
}

function toIsoTimestamp(value) {
  return isValidTimestamp(value) ? new Date(value).toISOString() : null
}

function positiveInteger(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

function cleanSafeToken(value, { maxLength = 80 } = {}) {
  const text = cleanString(value)
  if (!text || text.length > maxLength) return null
  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : null
}

function cleanState(value) {
  const state = cleanSafeToken(value, { maxLength: 40 })
  if (!state) return null
  return SAFE_STATE_VALUES.has(state) ? state : 'unknown'
}

function hasGatewayStatusFields(value) {
  if (!isPlainObject(value)) return false
  return [
    'state',
    'lastEventAt',
    'updateOffset',
    'lastOutboundAt',
    'lastOutboundKind',
    'lastOutboundTarget',
    'lastOutboundTargetPresent',
    'lastOutboundError',
    'lastOutboundErrorPresent',
    'lastReconnectAt',
    'lastReconnectReason',
    'reconnectAttempt',
  ].some((field) => field in value)
}

function firstStatusCandidate(raw, keys) {
  if (!isPlainObject(raw)) return null
  for (const key of keys) {
    const candidate = raw[key]
    if (hasGatewayStatusFields(candidate)) return candidate
  }
  return null
}

function selectGatewayStatus(raw, kind) {
  if (hasGatewayStatusFields(raw)) return raw

  const keys = kind === 'telegram'
    ? [
        'telegram',
        'telegramStatus',
        'telegramGatewayStatus',
        'telegramBridgeStatus',
      ]
    : [
        'discord',
        'discordStatus',
        'discordGatewayStatus',
        'discordBridgeStatus',
      ]

  const direct = firstStatusCandidate(raw, keys)
  if (direct) return direct

  for (const wrapperKey of ['diagnostics', 'context', 'runtime', 'runtimeDiagnostics', 'sourceReports', 'bridgeTrace']) {
    const wrapper = isPlainObject(raw) ? raw[wrapperKey] : null
    const nested = firstStatusCandidate(wrapper, keys)
    if (nested) return nested
  }

  return {}
}

function sourceSummary(source) {
  return {
    path: source.path,
    exists: source.exists,
    error: source.error,
  }
}

async function readJsonEvidence(filePath) {
  const normalized = cleanString(filePath)
  const result = {
    path: normalized,
    exists: false,
    error: null,
    raw: null,
  }
  if (!normalized) {
    result.error = 'missing-path'
    return result
  }
  try {
    const text = await fs.readFile(normalized, 'utf8')
    result.exists = true
    result.raw = JSON.parse(text)
  } catch (error) {
    result.error = error?.code === 'ENOENT' ? 'missing' : 'invalid-json'
  }
  return result
}

function emptySource(pathValue = '') {
  return {
    path: cleanString(pathValue),
    exists: false,
    error: pathValue ? 'missing' : 'missing-path',
    raw: null,
  }
}

function sanitizeGatewayTrace(raw, kind) {
  const updateOffset = positiveInteger(raw?.updateOffset)
  const reconnectAttempt = positiveInteger(raw?.reconnectAttempt)
  const trace = {
    state: cleanState(raw?.state),
    lastEventAt: toIsoTimestamp(raw?.lastEventAt),
    updateOffset,
    lastOutboundAt: toIsoTimestamp(raw?.lastOutboundAt),
    lastOutboundKind: cleanSafeToken(raw?.lastOutboundKind, { maxLength: 40 }),
    lastOutboundTargetPresent: raw?.lastOutboundTargetPresent === true || Boolean(cleanString(raw?.lastOutboundTarget)),
    lastOutboundErrorPresent: raw?.lastOutboundErrorPresent === true || Boolean(cleanString(raw?.lastOutboundError)),
  }

  if (kind === 'discord') {
    trace.lastReconnectAt = toIsoTimestamp(raw?.lastReconnectAt)
    trace.lastReconnectReason = cleanSafeToken(raw?.lastReconnectReason, { maxLength: 80 })
    trace.reconnectAttempt = reconnectAttempt
  }

  return {
    ...trace,
    hasTraceEvidence: Boolean(
      trace.lastEventAt
        || trace.updateOffset
        || trace.lastOutboundAt
        || trace.lastOutboundKind
        || trace.lastOutboundTargetPresent
        || trace.lastOutboundErrorPresent
        || trace.lastReconnectAt
        || trace.lastReconnectReason
        || trace.reconnectAttempt,
    ),
  }
}

function buildSampleTrace(kind) {
  return sanitizeGatewayTrace({
    state: 'unknown',
    lastEventAt: null,
    updateOffset: null,
    lastOutboundAt: null,
    lastOutboundKind: null,
    lastOutboundTargetPresent: false,
    lastOutboundErrorPresent: false,
    ...(kind === 'discord'
      ? {
          lastReconnectAt: null,
          lastReconnectReason: null,
          reconnectAttempt: null,
        }
      : {}),
  }, kind)
}

export async function buildV04MessageBridgeTraceReport(options = {}, context = {}) {
  const sample = options.sample === true
  const inputSource = sample || !options.inputPath
    ? emptySource(options.inputPath)
    : await readJsonEvidence(options.inputPath)
  const telegramSource = sample || !options.telegramStatusFile
    ? emptySource(options.telegramStatusFile)
    : await readJsonEvidence(options.telegramStatusFile)
  const discordSource = sample || !options.discordStatusFile
    ? emptySource(options.discordStatusFile)
    : await readJsonEvidence(options.discordStatusFile)

  const telegramRaw = sample
    ? {}
    : selectGatewayStatus(telegramSource.exists ? telegramSource.raw : inputSource.raw, 'telegram')
  const discordRaw = sample
    ? {}
    : selectGatewayStatus(discordSource.exists ? discordSource.raw : inputSource.raw, 'discord')
  const telegram = sample ? buildSampleTrace('telegram') : sanitizeGatewayTrace(telegramRaw, 'telegram')
  const discord = sample ? buildSampleTrace('discord') : sanitizeGatewayTrace(discordRaw, 'discord')
  const ok = telegram.hasTraceEvidence || discord.hasTraceEvidence

  return {
    schemaVersion: 1,
    gate: 'nexus-v04-message-bridge-trace',
    generatedAt: new Date(context.now ?? Date.now()).toISOString(),
    ok,
    overallStatus: sample
      ? 'sample-template'
      : ok
        ? 'trace-evidence-available'
        : 'no-bridge-trace-evidence',
    sample,
    files: {
      input: sourceSummary(inputSource),
      telegramStatus: sourceSummary(telegramSource),
      discordStatus: sourceSummary(discordSource),
    },
    telegram,
    discord,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: PRIVATE_FIELD_LABELS,
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

export async function runV04MessageBridgeTraceCli(argv = process.argv.slice(2), context = {}) {
  const options = parseV04MessageBridgeTraceArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  const report = await buildV04MessageBridgeTraceReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireTrace && !report.ok ? 2 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runV04MessageBridgeTraceCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
