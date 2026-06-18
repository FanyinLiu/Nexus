#!/usr/bin/env node

import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import process from 'node:process'

export const DEFAULT_LIVE_EVIDENCE_FILE = 'artifacts/v0.3.4/message-awareness-live.json'
export const DEFAULT_MACOS_LIVE_PROBE_MAX_AGE_MS = 30 * 60 * 1000

const LIVE_RECORD_PROFILES = {
  macos: {
    checkId: 'macos-notification-center-live',
    label: 'macOS Notification Center',
    requiredBooleanOptions: new Set([
      '--full-disk-access-granted',
      '--notification-observed-once',
      '--replay-checked-after-restart',
    ]),
    requiredValueOptions: new Set(['--app-name']),
    valueOptions: new Set(['--app-name']),
    proofValueLabels: {
      '--app-name': 'appName',
    },
    booleanOptions: new Set([
      '--full-disk-access-granted',
      '--notification-observed-once',
      '--replay-checked-after-restart',
    ]),
    example: [
      'npm run message:live:record -- macos --app-name "WeChat"',
      '  --operator "YOUR_NAME"',
      '  --full-disk-access-granted --notification-observed-once --replay-checked-after-restart',
      '  --note "One real WeChat notification appeared once and did not replay after restart."',
    ].join(' \\\n'),
  },
  telegram: {
    checkId: 'telegram-live-bridge',
    label: 'Telegram live bridge',
    requiredBooleanOptions: new Set([
      '--pairing-approved',
      '--owner-text-reply-returned',
      '--busy-message-queued-or-retried',
      '--reconnect-replay-checked',
    ]),
    requiredValueOptions: new Set([]),
    valueOptions: new Set([
      '--update-offset',
      '--last-outbound-at',
      '--last-outbound-kind',
      '--last-outbound-target',
      '--last-outbound-error',
    ]),
    evidenceValueOptions: {
      '--update-offset': 'updateOffset',
      '--last-outbound-at': 'lastOutboundAt',
      '--last-outbound-kind': 'lastOutboundKind',
      '--last-outbound-target': 'lastOutboundTarget',
      '--last-outbound-error': 'lastOutboundError',
    },
    booleanOptions: new Set([
      '--pairing-approved',
      '--owner-text-reply-returned',
      '--busy-message-queued-or-retried',
      '--reconnect-replay-checked',
    ]),
    example: [
      'npm run message:live:record -- telegram',
      '  --operator "YOUR_NAME"',
      '  --pairing-approved --owner-text-reply-returned',
      '  --busy-message-queued-or-retried --reconnect-replay-checked',
      '  --note "Owner DM paired, replied, queued while busy, and did not replay after restart."',
    ].join(' \\\n'),
  },
  discord: {
    checkId: 'discord-live-bridge',
    label: 'Discord live bridge',
    requiredBooleanOptions: new Set([
      '--message-content-intent-enabled',
      '--approved-channel-reply-returned',
      '--bot-echo-suppressed',
      '--reconnect-status-visible',
    ]),
    requiredValueOptions: new Set([]),
    valueOptions: new Set([
      '--last-reconnect-at',
      '--last-reconnect-reason',
      '--last-outbound-at',
      '--last-outbound-kind',
      '--last-outbound-target',
      '--last-outbound-error',
    ]),
    evidenceValueOptions: {
      '--last-reconnect-at': 'lastReconnectAt',
      '--last-reconnect-reason': 'lastReconnectReason',
      '--last-outbound-at': 'lastOutboundAt',
      '--last-outbound-kind': 'lastOutboundKind',
      '--last-outbound-target': 'lastOutboundTarget',
      '--last-outbound-error': 'lastOutboundError',
    },
    booleanOptions: new Set([
      '--message-content-intent-enabled',
      '--approved-channel-reply-returned',
      '--bot-echo-suppressed',
      '--reconnect-status-visible',
    ]),
    example: [
      'npm run message:live:record -- discord',
      '  --operator "YOUR_NAME"',
      '  --message-content-intent-enabled --approved-channel-reply-returned',
      '  --bot-echo-suppressed --reconnect-status-visible',
      '  --note "Allowed channel replied once, ignored bot echoes, and exposed reconnect status."',
    ].join(' \\\n'),
  },
}

const COMMAND_ALIASES = {
  mac: 'macos',
  notification: 'macos',
  notifications: 'macos',
  'notification-center': 'macos',
  tg: 'telegram',
  tele: 'telegram',
  dc: 'discord',
}

const COMMON_VALUE_OPTIONS = new Set([
  '--live-evidence-file',
  '--macos-live-probe-file',
  '--macos-live-probe-max-age-ms',
  '--status',
  '--live-status',
  '--observed-at',
  '--operator',
  '--note',
])

const PROFILE_VALUE_OPTIONS = new Set(
  Object.values(LIVE_RECORD_PROFILES).flatMap((profile) => [...profile.valueOptions]),
)

function printUsage(stream = process.stderr, options = {}) {
  const liveEvidenceFile = options.liveEvidenceFile || DEFAULT_LIVE_EVIDENCE_FILE
  stream.write([
    'Usage: node scripts/record-message-awareness-live-evidence.mjs <macos|telegram|discord> [options]',
    '',
    'Records one real message-awareness live evidence check through',
    'scripts/validate-message-awareness.mjs. This wrapper only maps the',
    'scenario-specific proof flags; the strict gate validation still rejects',
    'passing records that lack required proof fields.',
    'Examples below are templates: replace YOUR_NAME and any sample app or',
    'diagnostic values before recording pass evidence. Placeholder values are',
    'rejected by the validator.',
    '',
    'Common options:',
    `  --live-evidence-file <path>  Evidence file (current: ${liveEvidenceFile})`,
    '  --macos-live-probe-file <path>',
    '                              Private-safe macOS probe report to require before macOS pass evidence',
    `  --macos-live-probe-max-age-ms <ms>`,
    `                              Max age for required macOS probe candidates (default: ${DEFAULT_MACOS_LIVE_PROBE_MAX_AGE_MS})`,
    '  --status <status>            pass, fail, or manual-required (default: pass)',
    '  --observed-at <timestamp>    Real observation timestamp',
    '  --operator <name>            Person who performed the check',
    '  --note <text>                Add a concrete note; repeatable',
    '  --require-macos-live-probe-candidate',
    '                              Refuse macOS pass evidence unless the probe saw one real fresh notification',
    '  --dry-run                    Print the mapped validator command without writing evidence',
    '  --preflight                  Like --dry-run, but exits non-zero unless readyToRecord=true',
    '  --help                       Show this help',
    '',
    'macOS proof flags:',
    '  --app-name <name>',
    '  --full-disk-access-granted',
    '  --notification-observed-once',
    '  --replay-checked-after-restart',
    '',
    'Telegram proof flags:',
    '  --pairing-approved',
    '  --owner-text-reply-returned',
    '  --busy-message-queued-or-retried',
    '  --reconnect-replay-checked',
    '  --update-offset <number>      Optional diagnostics checkpoint',
    '  --last-outbound-at <timestamp>     Optional outbound diagnostics timestamp',
    '  --last-outbound-kind <kind>         Optional outbound diagnostics kind',
    '  --last-outbound-target <target>     Optional outbound diagnostics target',
    '  --last-outbound-error <error>       Optional outbound diagnostics error',
    '',
    'Discord proof flags:',
    '  --message-content-intent-enabled',
    '  --approved-channel-reply-returned',
    '  --bot-echo-suppressed',
    '  --reconnect-status-visible',
    '  --last-reconnect-at <timestamp>     Optional diagnostics timestamp',
    '  --last-reconnect-reason <reason>     Optional diagnostics reason',
    '  --last-outbound-at <timestamp>       Optional outbound diagnostics timestamp',
    '  --last-outbound-kind <kind>           Optional outbound diagnostics kind',
    '  --last-outbound-target <target>       Optional outbound diagnostics target',
    '  --last-outbound-error <error>         Optional outbound diagnostics error',
    '',
    'Examples (templates; replace placeholders before running):',
    `  ${LIVE_RECORD_PROFILES.macos.example}`,
    `  ${LIVE_RECORD_PROFILES.telegram.example}`,
    `  ${LIVE_RECORD_PROFILES.discord.example}`,
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

function cleanCommand(value) {
  const command = String(value ?? '').trim().toLowerCase()
  return COMMAND_ALIASES[command] ?? command
}

function normalizeEvidenceText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function toNonNegativeInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

function isPlaceholderEvidenceText(value) {
  const normalized = normalizeEvidenceText(value)
  if (!normalized) return false
  const compact = normalized
    .replace(/[<>{}\[\]()"']/g, '')
    .replace(/[\s-]+/g, '_')
    .toUpperCase()
  return compact.startsWith('REPLACE_WITH_')
    || compact === 'REPLACE_ME'
    || compact === 'YOUR_NAME'
    || compact === 'YOURNAME'
    || compact === 'REAL_APP'
    || compact === 'TBD'
    || compact === 'TODO'
    || compact === 'UNKNOWN'
    || compact === 'N_A'
}

function isTemplateGuidanceNote(value) {
  return /^Replace manual-required with pass only after\b/.test(normalizeEvidenceText(value))
}

function assertProfileOption(command, arg) {
  const profile = LIVE_RECORD_PROFILES[command]
  const [name] = splitOption(arg)
  if (profile.booleanOptions.has(name) || profile.valueOptions.has(name)) return
  throw new Error(`${name} is not valid for ${profile.label}. Run with --help for the allowed proof flags.`)
}

export function parseMessageAwarenessLiveRecordArgs(argv) {
  const options = {
    command: '',
    help: false,
    liveEvidenceFile: DEFAULT_LIVE_EVIDENCE_FILE,
    status: 'pass',
    observedAt: '',
    operator: '',
    notes: [],
    proofArgs: [],
    macosLiveProbeFile: '',
    macosLiveProbeMaxAgeMs: DEFAULT_MACOS_LIVE_PROBE_MAX_AGE_MS,
    requireMacosLiveProbeCandidate: false,
    dryRun: false,
    preflight: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (!arg.startsWith('--')) {
      if (options.command) {
        throw new Error(`Unexpected positional argument: ${arg}`)
      }
      options.command = cleanCommand(arg)
      continue
    }

    const [name, inlineValue] = splitOption(arg)
    if (name === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (name === '--preflight' || name === '--require-ready-to-record') {
      options.dryRun = true
      options.preflight = true
      continue
    }
    if (name === '--require-macos-live-probe-candidate') {
      options.requireMacosLiveProbeCandidate = true
      continue
    }
    if (COMMON_VALUE_OPTIONS.has(name) || PROFILE_VALUE_OPTIONS.has(name)) {
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--live-evidence-file') options.liveEvidenceFile = String(parsed.value)
      else if (name === '--macos-live-probe-file') options.macosLiveProbeFile = String(parsed.value)
      else if (name === '--macos-live-probe-max-age-ms') options.macosLiveProbeMaxAgeMs = toNonNegativeInteger(parsed.value, DEFAULT_MACOS_LIVE_PROBE_MAX_AGE_MS)
      else if (name === '--status' || name === '--live-status') options.status = String(parsed.value)
      else if (name === '--observed-at') options.observedAt = String(parsed.value)
      else if (name === '--operator') options.operator = String(parsed.value)
      else if (name === '--note') options.notes.push(String(parsed.value))
      else options.proofArgs.push(name, String(parsed.value))
      index = parsed.nextIndex
      continue
    }

    options.proofArgs.push(name)
  }

  if (options.help) return options
  if (!LIVE_RECORD_PROFILES[options.command]) {
    throw new Error(`Expected live evidence target: macos, telegram, or discord. Got: ${options.command || '(missing)'}`)
  }

  for (let index = 0; index < options.proofArgs.length; index += 1) {
    const arg = options.proofArgs[index]
    assertProfileOption(options.command, arg)
    const [name] = splitOption(arg)
    if (LIVE_RECORD_PROFILES[options.command].valueOptions.has(name)) index += 1
  }

  return options
}

export function buildMessageAwarenessLiveRecordValidationArgs(options) {
  const profile = LIVE_RECORD_PROFILES[options.command]
  if (!profile) {
    throw new Error(`Unsupported live evidence target: ${options.command || '(missing)'}`)
  }

  const args = [
    'scripts/validate-message-awareness.mjs',
    '--live-evidence-file',
    options.liveEvidenceFile || DEFAULT_LIVE_EVIDENCE_FILE,
    '--record-live-check',
    profile.checkId,
    '--live-status',
    options.status || 'pass',
  ]

  if (options.observedAt) args.push('--observed-at', options.observedAt)
  if (options.operator) args.push('--operator', options.operator)
  for (const note of options.notes ?? []) {
    args.push('--note', note)
  }
  for (let index = 0; index < (options.proofArgs ?? []).length; index += 1) {
    const arg = options.proofArgs[index]
    const [name] = splitOption(arg)
    const evidenceField = profile.evidenceValueOptions?.[name]
    if (evidenceField) {
      const value = options.proofArgs[index + 1]
      args.push('--evidence', `${evidenceField}=${value}`)
      index += 1
      continue
    }
    args.push(arg)
  }
  return args
}

function warning(field, message) {
  return { field, message }
}

function normalizeProbeTimestamp(value) {
  const timestamp = normalizeEvidenceText(value)
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

function buildMacosLiveProbeWarning(options, macosLiveProbe, context = {}) {
  if (options.command !== 'macos') return null
  if (options.requireMacosLiveProbeCandidate !== true) return null
  if ((options.status || 'pass') !== 'pass') return null
  const maxAgeMs = toNonNegativeInteger(options.macosLiveProbeMaxAgeMs, DEFAULT_MACOS_LIVE_PROBE_MAX_AGE_MS)
  if (!macosLiveProbe) {
    return warning('macosLiveProbe', 'macOS pass evidence requires a private-safe live probe candidate.')
  }
  if (macosLiveProbe.exists !== true) {
    return warning('macosLiveProbe', `macOS live probe report is ${macosLiveProbe.error || 'missing'}.`)
  }
  if (macosLiveProbe.gate !== 'message-awareness-macos-live-probe') {
    return warning('macosLiveProbe', 'macOS live probe report has the wrong gate.')
  }
  if (macosLiveProbe.releaseEvidenceCandidate !== true) {
    return warning(
      'macosLiveProbe',
      `macOS live probe is not a release evidence candidate: status=${macosLiveProbe.status || 'unknown'}.`,
    )
  }
  if (macosLiveProbe.diagnostics?.testNotificationRequested === true) {
    return warning('macosLiveProbe', 'Diagnostic test notifications cannot be used as release evidence candidates.')
  }
  if (macosLiveProbe.diagnostics?.observedFreshCount !== 1) {
    return warning('macosLiveProbe', 'macOS live probe must observe exactly one fresh real notification candidate.')
  }
  if (macosLiveProbe.diagnostics?.replayFreshCount !== 0) {
    return warning('macosLiveProbe', 'macOS live probe must confirm zero immediate replay events.')
  }
  const generatedAt = normalizeProbeTimestamp(macosLiveProbe.generatedAt)
  if (!generatedAt) {
    return warning('macosLiveProbe', 'macOS live probe report must include a valid generatedAt timestamp.')
  }
  if (maxAgeMs > 0) {
    const nowMs = Date.parse(String(context.now ?? new Date()))
    const generatedMs = Date.parse(generatedAt)
    const ageMs = nowMs - generatedMs
    if (!Number.isFinite(nowMs) || !Number.isFinite(ageMs)) {
      return warning('macosLiveProbe', 'macOS live probe freshness could not be evaluated.')
    }
    if (ageMs < 0) {
      return warning('macosLiveProbe', 'macOS live probe generatedAt is in the future.')
    }
    if (ageMs > maxAgeMs) {
      return warning(
        'macosLiveProbe',
        `macOS live probe candidate is stale: ageMs=${ageMs}, maxAgeMs=${maxAgeMs}.`,
      )
    }
  }
  return null
}

export function buildMessageAwarenessLiveRecordPreflightWarnings(options, macosLiveProbe = null, context = {}) {
  const profile = LIVE_RECORD_PROFILES[options.command]
  if (!profile) {
    throw new Error(`Unsupported live evidence target: ${options.command || '(missing)'}`)
  }

  const warnings = []
  const status = options.status || 'pass'
  const proofOptions = new Map()

  for (let index = 0; index < (options.proofArgs ?? []).length; index += 1) {
    const arg = options.proofArgs[index]
    const [name] = splitOption(arg)
    if (profile.valueOptions.has(name)) {
      const value = options.proofArgs[index + 1]
      proofOptions.set(name, value)
      const field = profile.proofValueLabels?.[name]
        ?? profile.evidenceValueOptions?.[name]
        ?? name.replace(/^--/, '')
      if (isPlaceholderEvidenceText(value)) {
        warnings.push(warning(field, `${field} still looks like a placeholder; replace it with a real observed value.`))
      }
      index += 1
      continue
    }
    proofOptions.set(name, true)
  }

  if (status === 'pass') {
    if (!normalizeEvidenceText(options.observedAt)) {
      warnings.push(warning('observedAt', 'Passing live evidence should include the real observation timestamp.'))
    } else if (isPlaceholderEvidenceText(options.observedAt)) {
      warnings.push(warning('observedAt', 'observedAt still looks like a placeholder; replace it with the real observation timestamp.'))
    } else if (!Number.isFinite(Date.parse(String(options.observedAt)))) {
      warnings.push(warning('observedAt', `observedAt is not a valid timestamp: ${options.observedAt}`))
    }

    if (!normalizeEvidenceText(options.operator)) {
      warnings.push(warning('operator', 'Passing live evidence should name the person who performed the real check.'))
    } else if (isPlaceholderEvidenceText(options.operator)) {
      warnings.push(warning('operator', 'operator still looks like a placeholder; replace it with the real checker name.'))
    }

    const hasConcreteNote = (options.notes ?? []).some((note) => (
      normalizeEvidenceText(note)
        && !isTemplateGuidanceNote(note)
        && !isPlaceholderEvidenceText(note)
    ))
    if (!hasConcreteNote) {
      warnings.push(warning('notes', 'Passing live evidence should include a concrete non-template observation note.'))
    }

    for (const flag of profile.requiredBooleanOptions ?? []) {
      if (proofOptions.get(flag) !== true) {
        warnings.push(warning(flag.replace(/^--/, ''), `Missing required proof flag ${flag}.`))
      }
    }
    for (const flag of profile.requiredValueOptions ?? []) {
      const value = proofOptions.get(flag)
      const field = profile.proofValueLabels?.[flag]
        ?? profile.evidenceValueOptions?.[flag]
        ?? flag.replace(/^--/, '')
      if (!normalizeEvidenceText(value)) {
        warnings.push(warning(field, `Missing required proof value ${flag}.`))
      }
    }
  } else if (status === 'fail' && !(options.notes ?? []).some((note) => normalizeEvidenceText(note))) {
    warnings.push(warning('notes', 'Failed live evidence should include a note explaining what failed.'))
  }

  const macosLiveProbeWarning = buildMacosLiveProbeWarning(options, macosLiveProbe, context)
  if (macosLiveProbeWarning) warnings.push(macosLiveProbeWarning)

  return warnings
}

export function buildMessageAwarenessLiveRecordDryRun(options, macosLiveProbe = null, context = {}) {
  const profile = LIVE_RECORD_PROFILES[options.command]
  const validationArgs = buildMessageAwarenessLiveRecordValidationArgs(options)
  const preflightWarnings = buildMessageAwarenessLiveRecordPreflightWarnings(options, macosLiveProbe, context)
  return {
    dryRun: true,
    target: options.command,
    checkId: profile.checkId,
    label: profile.label,
    liveEvidenceFile: options.liveEvidenceFile || DEFAULT_LIVE_EVIDENCE_FILE,
    status: options.status || 'pass',
    writesEvidence: false,
    readyToRecord: preflightWarnings.length === 0,
    preflightWarnings,
    requireMacosLiveProbeCandidate: options.requireMacosLiveProbeCandidate === true,
    macosLiveProbeMaxAgeMs: options.macosLiveProbeMaxAgeMs ?? DEFAULT_MACOS_LIVE_PROBE_MAX_AGE_MS,
    ...(options.requireMacosLiveProbeCandidate === true ? { macosLiveProbe } : {}),
    validationCommand: process.execPath,
    validationArgs,
  }
}

async function readMacosLiveProbeSummary(filePath) {
  const target = normalizeEvidenceText(filePath)
  const fallback = {
    path: target,
    exists: false,
    error: target ? 'missing' : 'missing-path',
    gate: null,
    generatedAt: null,
    status: null,
    releaseEvidenceCandidate: false,
    diagnostics: null,
  }
  if (!target) return fallback
  try {
    const raw = JSON.parse(await fs.readFile(target, 'utf8'))
    return {
      path: target,
      exists: true,
      error: null,
      gate: normalizeEvidenceText(raw?.gate) || null,
      generatedAt: normalizeProbeTimestamp(raw?.generatedAt),
      status: normalizeEvidenceText(raw?.status) || null,
      releaseEvidenceCandidate: raw?.releaseEvidenceCandidate === true,
      diagnostics: raw?.diagnostics && typeof raw.diagnostics === 'object' && !Array.isArray(raw.diagnostics)
        ? {
            machineChecked: raw.diagnostics.machineChecked === true,
            errorKind: normalizeEvidenceText(raw.diagnostics.errorKind) || null,
            testNotificationRequested: raw.diagnostics.testNotificationRequested === true,
            observedFreshCount: Number.isFinite(Number(raw.diagnostics.observedFreshCount))
              ? Number(raw.diagnostics.observedFreshCount)
              : null,
            replayFreshCount: Number.isFinite(Number(raw.diagnostics.replayFreshCount))
              ? Number(raw.diagnostics.replayFreshCount)
              : null,
          }
        : null,
    }
  } catch (error) {
    return {
      ...fallback,
      error: error?.code === 'ENOENT' ? 'missing' : 'invalid-json',
    }
  }
}

async function readRequiredMacosLiveProbeSummary(options) {
  if (options.requireMacosLiveProbeCandidate !== true) return null
  if (options.command !== 'macos') return null
  return readMacosLiveProbeSummary(options.macosLiveProbeFile)
}

function formatPreflightWarnings(preflightWarnings) {
  return preflightWarnings
    .map((entry) => `${entry.field}: ${entry.message}`)
    .join('\n')
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    child.stdout?.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`live evidence recorder exited by ${signal}`))
        return
      }
      resolve(code ?? 0)
    })
  })
}

export async function runMessageAwarenessLiveRecord(argv = process.argv.slice(2), context = {}) {
  const options = parseMessageAwarenessLiveRecordArgs(argv)
  if (options.help) {
    printUsage(process.stdout, options)
    return 0
  }
  const macosLiveProbe = await readRequiredMacosLiveProbeSummary(options)
  if (options.dryRun || options.preflight) {
    const dryRun = buildMessageAwarenessLiveRecordDryRun(options, macosLiveProbe, context)
    console.log(JSON.stringify({
      ...dryRun,
      preflight: options.preflight === true,
    }, null, 2))
    return options.preflight && !dryRun.readyToRecord ? 2 : 0
  }
  const macosLiveProbeWarning = buildMacosLiveProbeWarning(options, macosLiveProbe, context)
  const preflightWarnings = macosLiveProbeWarning ? [macosLiveProbeWarning] : []
  if (preflightWarnings.length > 0) {
    process.stderr.write(`Live evidence record preflight failed:\n${formatPreflightWarnings(preflightWarnings)}\n`)
    return 2
  }
  return runNode(buildMessageAwarenessLiveRecordValidationArgs(options))
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const exitCode = await runMessageAwarenessLiveRecord()
    process.exit(exitCode)
  } catch (error) {
    console.error(error?.message ?? error)
    process.exit(1)
  }
}
