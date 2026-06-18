#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_V04_MESSAGE_STATUS_FILE = 'artifacts/v0.4.0/message-awareness-status.json'
export const DEFAULT_V04_LIVE_PREFLIGHT_FILE = 'artifacts/v0.4.0/message-awareness-live-preflight.json'
export const DEFAULT_V04_MACOS_LIVE_PROBE_FILE = 'artifacts/v0.4.0/message-awareness-macos-live-probe.json'
export const DEFAULT_V04_BRIDGE_TRACE_FILE = 'artifacts/v0.4.0/message-awareness-bridge-trace.json'
export const DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE = 'artifacts/v0.4.0/message-awareness-live-session.md'

const LIVE_CHECKS = [
  {
    id: 'macos-notification-center-live',
    stepId: 'record-macos-notification-center-live',
    label: 'macOS Notification Center',
  },
  {
    id: 'telegram-live-bridge',
    stepId: 'record-telegram-live-bridge',
    label: 'Telegram live bridge',
  },
  {
    id: 'discord-live-bridge',
    stepId: 'record-discord-live-bridge',
    label: 'Discord live bridge',
  },
]

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/v04-message-live-session.mjs [options]',
    '',
    'Builds a private-safe operator checklist for the v0.4 message-awareness',
    'live evidence session. It does not record evidence and does not copy',
    'notification bodies, senders, chat ids, tokens, or raw webhook payloads.',
    '',
    'Options:',
    `  --message-status-file <path>    Message release status report (default: ${DEFAULT_V04_MESSAGE_STATUS_FILE})`,
    `  --preflight-file <path>         Live preflight report (default: ${DEFAULT_V04_LIVE_PREFLIGHT_FILE})`,
    `  --macos-live-probe-file <path>  macOS live probe report (default: ${DEFAULT_V04_MACOS_LIVE_PROBE_FILE})`,
    `  --bridge-trace-file <path>      Optional Telegram/Discord safe trace file (default: ${DEFAULT_V04_BRIDGE_TRACE_FILE})`,
    '  --output <path>                 Write JSON report to a file',
    '  --markdown-output <path>        Write a private-safe operator packet as Markdown',
    '  --require-ready-to-record       Exit non-zero if any pending live check still lacks an actionable record command',
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

export function parseV04MessageLiveSessionArgs(argv) {
  const options = {
    help: false,
    messageStatusFile: DEFAULT_V04_MESSAGE_STATUS_FILE,
    preflightFile: DEFAULT_V04_LIVE_PREFLIGHT_FILE,
    macosLiveProbeFile: DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
    bridgeTraceFile: DEFAULT_V04_BRIDGE_TRACE_FILE,
    outputPath: '',
    markdownOutputPath: '',
    requireReadyToRecord: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--require-ready-to-record') {
      options.requireReadyToRecord = true
      continue
    }

    const [name, inlineValue] = splitOption(arg)
    if (
      name === '--message-status-file'
      || name === '--status-file'
      || name === '--preflight-file'
      || name === '--macos-live-probe-file'
      || name === '--macos-probe-file'
      || name === '--bridge-trace-file'
      || name === '--bridge-trace'
      || name === '--output'
      || name === '--output-file'
      || name === '--markdown-output'
      || name === '--operator-packet'
      || name === '--packet-output'
    ) {
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--message-status-file' || name === '--status-file') {
        options.messageStatusFile = String(parsed.value)
      } else if (name === '--preflight-file') {
        options.preflightFile = String(parsed.value)
      } else if (name === '--macos-live-probe-file' || name === '--macos-probe-file') {
        options.macosLiveProbeFile = String(parsed.value)
      } else if (name === '--bridge-trace-file' || name === '--bridge-trace') {
        options.bridgeTraceFile = String(parsed.value)
      } else if (name === '--output' || name === '--output-file') {
        options.outputPath = String(parsed.value)
      } else {
        options.markdownOutputPath = String(parsed.value)
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

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function shellQuote(value) {
  return `"${String(value ?? '').replace(/(["\\$`])/g, '\\$1')}"`
}

function isValidTimestamp(value) {
  if (value == null || value === '') return false
  return Number.isFinite(Date.parse(String(value)))
}

function toIsoTimestamp(value) {
  return isValidTimestamp(value) ? new Date(value).toISOString() : ''
}

function pushObservedAtArg(args, value) {
  args.push('--observed-at', shellQuote(toIsoTimestamp(value) || 'REPLACE_WITH_OBSERVED_AT'))
}

function pushTimestampArg(args, flag, value) {
  const iso = toIsoTimestamp(value)
  if (iso) args.push(flag, shellQuote(iso))
}

function pushTextArg(args, flag, value) {
  const text = cleanString(value)
  if (text) args.push(flag, shellQuote(text))
}

function pushPositiveIntegerArg(args, flag, value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return
  args.push(flag, String(Math.floor(parsed)))
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

function summarizePreflight(source) {
  const raw = source.raw
  const checks = safeArray(raw?.checks)
  return {
    exists: source.exists,
    error: source.error,
    ok: raw?.ok === true,
    overallStatus: raw?.overallStatus ?? (source.exists ? 'unknown' : 'missing'),
    blockingCheckIds: safeArray(raw?.blockingCheckIds).map(cleanString).filter(Boolean),
    checks: checks.map((check) => ({
      id: cleanString(check?.id),
      status: cleanString(check?.status) || null,
      blocking: check?.blocking === true,
    })).filter((check) => check.id),
  }
}

function summarizeGatewayBridgeTrace(raw, kind) {
  const lastEventAt = toIsoTimestamp(raw?.lastEventAt)
  const lastOutboundAt = toIsoTimestamp(raw?.lastOutboundAt)
  const lastReconnectAt = toIsoTimestamp(raw?.lastReconnectAt)
  const updateOffset = Number(raw?.updateOffset)
  const reconnectAttempt = Number(raw?.reconnectAttempt)
  const summary = {
    state: cleanString(raw?.state) || null,
    lastEventAt: lastEventAt || null,
    updateOffset: Number.isFinite(updateOffset) && updateOffset > 0 ? Math.floor(updateOffset) : null,
    lastOutboundAt: lastOutboundAt || null,
    lastOutboundKind: cleanString(raw?.lastOutboundKind) || null,
    lastOutboundTargetPresent: raw?.lastOutboundTargetPresent === true || Boolean(cleanString(raw?.lastOutboundTarget)),
    lastOutboundErrorPresent: raw?.lastOutboundErrorPresent === true || Boolean(cleanString(raw?.lastOutboundError)),
    lastReconnectAt: kind === 'discord' ? (lastReconnectAt || null) : null,
    lastReconnectReason: kind === 'discord' ? (cleanString(raw?.lastReconnectReason) || null) : null,
    reconnectAttempt: kind === 'discord' && Number.isFinite(reconnectAttempt) && reconnectAttempt > 0
      ? Math.floor(reconnectAttempt)
      : null,
  }
  return {
    ...summary,
    hasTraceEvidence: Boolean(
      summary.lastEventAt
        || summary.updateOffset
        || summary.lastOutboundAt
        || summary.lastOutboundKind
        || summary.lastReconnectAt
        || summary.lastReconnectReason
        || summary.lastOutboundTargetPresent
        || summary.lastOutboundErrorPresent,
    ),
  }
}

function summarizeBridgeTrace(source) {
  const raw = source.raw ?? {}
  return {
    exists: source.exists,
    error: source.error,
    telegram: summarizeGatewayBridgeTrace(raw.telegram ?? raw.telegramStatus ?? {}, 'telegram'),
    discord: summarizeGatewayBridgeTrace(raw.discord ?? raw.discordStatus ?? {}, 'discord'),
  }
}

function summarizeMacosLiveProbe(source) {
  const raw = source.raw
  return {
    exists: source.exists,
    error: source.error,
    ok: raw?.ok === true,
    status: raw?.status ?? (source.exists ? 'unknown' : 'missing'),
    releaseEvidenceCandidate: raw?.releaseEvidenceCandidate === true,
    diagnostics: raw
      ? {
          platform: raw.diagnostics?.platform ?? null,
          machineChecked: raw.diagnostics?.machineChecked === true,
          errorKind: raw.diagnostics?.errorKind ?? null,
          testNotificationRequested: raw.diagnostics?.testNotificationRequested === true,
          observedFreshCount: Number(raw.diagnostics?.observedFreshCount ?? 0),
          replayFreshCount: Number(raw.diagnostics?.replayFreshCount ?? 0),
        }
      : null,
  }
}

function summarizeMessageStatus(source) {
  const raw = source.raw
  const audit = raw?.liveEvidence?.audit
  return {
    exists: source.exists,
    error: source.error,
    ok: raw?.ok === true,
    releaseGateComplete: raw?.releaseGateComplete === true,
    rawReleaseGateComplete: raw?.rawReleaseGateComplete === true,
    redactionGateComplete: raw?.redactionGateComplete === true,
    pendingCheckIds: safeArray(audit?.pendingCheckIds).map(cleanString).filter(Boolean),
    failedCheckIds: safeArray(audit?.failedCheckIds).map(cleanString).filter(Boolean),
    nextCommandIds: safeArray(raw?.nextCommands).map((entry) => cleanString(entry?.id)).filter(Boolean),
  }
}

function findChecklistEntry(statusRaw, checkId) {
  return safeArray(statusRaw?.liveVerificationChecklist).find((entry) => entry?.id === checkId) ?? null
}

function findPreflightCheck(preflightRaw, checkId) {
  return safeArray(preflightRaw?.checks).find((entry) => entry?.id === checkId) ?? null
}

function stepStatusForRecord({ checkId, statusRaw, pendingIds }) {
  const check = safeArray(statusRaw?.liveEvidence?.audit?.checks).find((entry) => entry?.id === checkId)
  if (check?.status === 'pass') return 'complete'
  if (pendingIds.includes(checkId)) return 'manual-required'
  if (check?.status === 'fail') return 'failed'
  return 'unknown'
}

function traceForCheck(checkId, bridgeTrace) {
  if (checkId === 'telegram-live-bridge') return bridgeTrace?.telegram ?? null
  if (checkId === 'discord-live-bridge') return bridgeTrace?.discord ?? null
  return null
}

function uniqueStrings(values) {
  return [...new Set(safeArray(values).map(cleanString).filter(Boolean))]
}

function extractCommandPlaceholderTokens(command) {
  const text = cleanString(command)
  if (!text) return []
  return uniqueStrings(text.match(/REPLACE_WITH_[A-Z0-9_]+/g) ?? [])
}

function buildRecordCommandSafety({
  status,
  readyToAttempt,
  recordCommand,
  dryRunCommand,
  preflightCommand,
  recordCommandIsTemplate,
  mustReplacePlaceholders,
  missingProofFields,
  machinePrerequisite,
}) {
  const placeholderTokens = extractCommandPlaceholderTokens(recordCommand)
  const missingProofFieldIds = safeArray(missingProofFields)
    .map((field) => cleanString(field?.field))
    .filter(Boolean)
  const reasons = []
  let safetyStatus = 'ready'

  if (status === 'complete') {
    safetyStatus = 'complete'
  } else if (!cleanString(recordCommand)) {
    safetyStatus = 'unavailable'
    reasons.push('record command is missing')
  } else if (readyToAttempt !== true) {
    safetyStatus = 'blocked'
    reasons.push('record step is not ready to attempt')
    if (machinePrerequisite && machinePrerequisite.releaseEvidenceCandidate !== true) {
      reasons.push(`${machinePrerequisite.id} status ${machinePrerequisite.status} is not a release evidence candidate`)
    }
  } else if (
    recordCommandIsTemplate === true
    || mustReplacePlaceholders === true
    || placeholderTokens.length > 0
    || missingProofFieldIds.length > 0
  ) {
    safetyStatus = 'needs-operator-values'
    if (recordCommandIsTemplate === true || mustReplacePlaceholders === true || placeholderTokens.length > 0) {
      reasons.push('replace every template placeholder before recording release evidence')
    }
    if (missingProofFieldIds.length > 0) {
      reasons.push(`missing proof field(s): ${missingProofFieldIds.join(', ')}`)
    }
  }

  return {
    status: safetyStatus,
    safeToRunRecordCommand: safetyStatus === 'ready',
    dryRunRecommended: status !== 'complete' && cleanString(dryRunCommand).length > 0,
    preflightRecommended: status !== 'complete' && cleanString(preflightCommand).length > 0,
    placeholderTokens,
    missingProofFieldIds,
    reasons: uniqueStrings(reasons),
  }
}

function buildBridgeTraceRecordCommand(checkId, trace, mode = 'record') {
  const target = checkId === 'telegram-live-bridge'
    ? 'telegram'
    : checkId === 'discord-live-bridge'
      ? 'discord'
      : ''
  if (!target) return ''

  const args = ['npm run v04:message:live:record --', target]
  if (mode === 'dry-run') args.push('--dry-run')
  if (mode === 'preflight') args.push('--preflight')
  pushObservedAtArg(args, trace?.lastEventAt)
  args.push('--operator', shellQuote('REPLACE_WITH_OPERATOR'))

  if (checkId === 'telegram-live-bridge') {
    pushPositiveIntegerArg(args, '--update-offset', trace?.updateOffset)
    pushTimestampArg(args, '--last-outbound-at', trace?.lastOutboundAt)
    pushTextArg(args, '--last-outbound-kind', trace?.lastOutboundKind)
    args.push(
      '--pairing-approved',
      '--owner-text-reply-returned',
      '--busy-message-queued-or-retried',
      '--reconnect-replay-checked',
      '--note',
      shellQuote('Owner DM paired, replied, queued or retried while busy, and did not replay after reconnect.'),
    )
  } else {
    pushTimestampArg(args, '--last-reconnect-at', trace?.lastReconnectAt)
    pushTextArg(args, '--last-reconnect-reason', trace?.lastReconnectReason)
    pushTimestampArg(args, '--last-outbound-at', trace?.lastOutboundAt)
    pushTextArg(args, '--last-outbound-kind', trace?.lastOutboundKind)
    args.push(
      '--message-content-intent-enabled',
      '--approved-channel-reply-returned',
      '--bot-echo-suppressed',
      '--reconnect-status-visible',
      '--note',
      shellQuote('Allowed Discord channel or DM replied once, bot echoes were suppressed, and reconnect status was visible.'),
    )
  }

  return args.join(' ')
}

function bridgeTraceCommandSet(checkId, checklist, bridgeTrace) {
  const trace = traceForCheck(checkId, bridgeTrace)
  if (!trace?.hasTraceEvidence) {
    return {
      bridgeTrace: trace,
      bridgeTraceApplied: false,
      recordCommand: checklist?.recordCommand ?? null,
      dryRunCommand: checklist?.dryRunCommand ?? null,
      preflightCommand: checklist?.preflightCommand ?? null,
    }
  }
  return {
    bridgeTrace: trace,
    bridgeTraceApplied: true,
    recordCommand: buildBridgeTraceRecordCommand(checkId, trace, 'record'),
    dryRunCommand: buildBridgeTraceRecordCommand(checkId, trace, 'dry-run'),
    preflightCommand: buildBridgeTraceRecordCommand(checkId, trace, 'preflight'),
  }
}

function recordStepForCheck({ check, statusRaw, preflightRaw, pendingIds, macosProbe, bridgeTrace }) {
  const checklist = findChecklistEntry(statusRaw, check.id)
  const preflight = findPreflightCheck(preflightRaw, check.id)
  const status = stepStatusForRecord({ checkId: check.id, statusRaw, pendingIds })
  const commands = bridgeTraceCommandSet(check.id, checklist, bridgeTrace)
  const needsMacosProbeCandidate = check.id === 'macos-notification-center-live'
    && status === 'manual-required'
    && macosProbe?.releaseEvidenceCandidate !== true
  const readyToAttempt = status === 'manual-required'
    && preflight?.blocking !== true
    && !needsMacosProbeCandidate
  const machinePrerequisite = check.id === 'macos-notification-center-live'
    ? {
        id: 'macos-live-probe',
        status: macosProbe?.status ?? 'missing',
        releaseEvidenceCandidate: macosProbe?.releaseEvidenceCandidate === true,
      }
    : null
  const missingProofFields = safeArray(checklist?.missingProofFields).map((field) => ({
    field: cleanString(field?.field),
    type: cleanString(field?.type),
  })).filter((field) => field.field)
  const recordCommandIsTemplate = checklist?.recordCommandIsTemplate === true
  const mustReplacePlaceholders = checklist?.mustReplacePlaceholders === true
  return {
    id: check.stepId,
    checkId: check.id,
    label: check.label,
    status,
    readyToAttempt,
    detail: status === 'complete'
      ? 'Live proof for this check is already recorded.'
      : needsMacosProbeCandidate
        ? 'Run the macOS live probe with one fresh real notification before recording pass evidence.'
      : checklist?.status
        ? `Current live proof status: ${checklist.status}.`
        : 'Live proof still needs a real observation.',
    machinePrerequisite,
    bridgeTrace: commands.bridgeTrace,
    bridgeTraceApplied: commands.bridgeTraceApplied,
    requiredBeforeRecording: safeArray(checklist?.beforeRecording).map(cleanString).filter(Boolean),
    diagnosticsToCheck: safeArray(checklist?.diagnostics).map(cleanString).filter(Boolean),
    recordCommand: commands.recordCommand,
    dryRunCommand: commands.dryRunCommand,
    preflightCommand: commands.preflightCommand,
    recordCommandIsTemplate,
    mustReplacePlaceholders,
    placeholderFields: safeArray(checklist?.placeholderFields).map(cleanString).filter(Boolean),
    missingProofFields,
    recordCommandSafety: buildRecordCommandSafety({
      status,
      readyToAttempt,
      recordCommand: commands.recordCommand,
      dryRunCommand: commands.dryRunCommand,
      preflightCommand: commands.preflightCommand,
      recordCommandIsTemplate,
      mustReplacePlaceholders,
      missingProofFields,
      machinePrerequisite,
    }),
  }
}

function buildSteps({ statusSource, preflightSource, macosProbeSource, bridgeTraceSource }) {
  const statusRaw = statusSource.raw
  const preflightRaw = preflightSource.raw
  const pendingIds = safeArray(statusRaw?.liveEvidence?.audit?.pendingCheckIds).map(cleanString).filter(Boolean)
  const preflightSummary = summarizePreflight(preflightSource)
  const macosProbe = summarizeMacosLiveProbe(macosProbeSource)
  const bridgeTrace = summarizeBridgeTrace(bridgeTraceSource)
  const statusSummary = summarizeMessageStatus(statusSource)
  const macosPreflight = findPreflightCheck(preflightRaw, 'macos-notification-center-live')

  const steps = [
    {
      id: 'live-preflight',
      label: 'Run live environment preflight',
      status: preflightSummary.ok ? 'ready' : 'needs-run',
      readyToAttempt: true,
      detail: preflightSummary.ok
        ? `Preflight is ${preflightSummary.overallStatus}.`
        : 'Run the private-safe live preflight before recording live evidence.',
      command: 'npm run v04:message:preflight:live',
      blockingCheckIds: preflightSummary.blockingCheckIds,
    },
  ]

  if (pendingIds.includes('macos-notification-center-live')) {
    steps.push({
      id: 'macos-live-probe',
      label: 'Machine-check one macOS notification candidate',
      status: macosProbe.releaseEvidenceCandidate
        ? 'observed-candidate'
        : macosPreflight?.blocking === true
          ? 'blocked-by-preflight'
          : 'needs-real-notification',
      readyToAttempt: macosPreflight?.blocking !== true,
      detail: macosProbe.releaseEvidenceCandidate
        ? 'The latest macOS probe saw exactly one fresh real candidate; still confirm the Nexus event and restart no-replay before recording pass evidence.'
        : `Latest macOS probe status: ${macosProbe.status}.`,
      command: 'npm run v04:message:probe:macos',
      safeProbeSummary: macosProbe,
    })
  }

  for (const check of LIVE_CHECKS) {
    steps.push(recordStepForCheck({
      check,
      statusRaw,
      preflightRaw,
      pendingIds,
      macosProbe,
      bridgeTrace,
    }))
  }

  steps.push({
    id: 'live-gate',
    label: 'Validate live evidence',
    status: pendingIds.length === 0 && statusSummary.failedCheckIds.length === 0
      ? 'ready'
      : 'blocked-until-live-evidence',
    readyToAttempt: pendingIds.length === 0,
    detail: pendingIds.length === 0
      ? 'All live checks are recorded; run the live gate and then finalize release evidence.'
      : `Pending live checks: ${pendingIds.join(', ')}.`,
    command: 'npm run v04:message:gate:live',
  })

  steps.push({
    id: 'finalize-message-evidence',
    label: 'Finalize message release evidence',
    status: statusSummary.releaseGateComplete ? 'complete' : 'blocked-until-live-gate',
    readyToAttempt: pendingIds.length === 0 && statusSummary.failedCheckIds.length === 0,
    detail: statusSummary.releaseGateComplete
      ? 'Message-awareness release evidence is complete.'
      : 'Finalization is intentionally blocked until local and all live proof pass.',
    command: 'npm run v04:message:finalize',
  })

  return steps
}

function summarizeRecordSafety(steps, pendingCheckIds) {
  const pendingRecordSteps = safeArray(steps).filter((step) => (
    cleanString(step?.id).startsWith('record-')
    && pendingCheckIds.includes(cleanString(step?.checkId))
  ))
  const countBySafetyStatus = pendingRecordSteps.reduce((counts, step) => {
    const status = cleanString(step?.recordCommandSafety?.status) || 'unknown'
    counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {})
  const unsafeRecordStepIds = pendingRecordSteps
    .filter((step) => step?.recordCommandSafety?.safeToRunRecordCommand !== true)
    .map((step) => cleanString(step?.id))
    .filter(Boolean)
  return {
    pendingRecordCount: pendingRecordSteps.length,
    readyToAttemptCount: pendingRecordSteps.filter((step) => step.readyToAttempt === true).length,
    safeToRunCount: pendingRecordSteps.filter((step) => (
      step?.recordCommandSafety?.safeToRunRecordCommand === true
    )).length,
    blockedCount: countBySafetyStatus.blocked ?? 0,
    needsOperatorValuesCount: countBySafetyStatus['needs-operator-values'] ?? 0,
    unavailableCount: countBySafetyStatus.unavailable ?? 0,
    unknownCount: countBySafetyStatus.unknown ?? 0,
    unsafeRecordStepIds,
  }
}

function summarizeStepExecution(steps, pendingCheckIds) {
  const pendingSet = new Set(safeArray(pendingCheckIds).map(cleanString).filter(Boolean))
  const automationSafeCommands = []
  const manualRecordStepIds = []
  const blockedStepIds = []
  const unsafeRecordStepIds = []

  for (const step of safeArray(steps)) {
    const id = cleanString(step?.id)
    if (!id) continue
    const isRecordStep = id.startsWith('record-')
    const isPendingRecordStep = isRecordStep && pendingSet.has(cleanString(step?.checkId))
    const command = cleanString(isRecordStep ? step?.recordCommand : step?.command)
    const recordSafeToRun = step?.recordCommandSafety?.safeToRunRecordCommand === true
    const blocked = step?.readyToAttempt === false && step?.status !== 'complete'

    if (isPendingRecordStep && !recordSafeToRun) {
      manualRecordStepIds.push(id)
      unsafeRecordStepIds.push(id)
    }
    if (blocked) blockedStepIds.push(id)

    if (
      command
      && step?.status !== 'complete'
      && (
        (!isRecordStep && (step?.readyToAttempt === true || id === 'live-gate'))
        || (isPendingRecordStep && recordSafeToRun)
      )
    ) {
      automationSafeCommands.push({ id, command })
    }
  }

  return {
    automationSafeCommandCount: automationSafeCommands.length,
    manualRecordStepCount: manualRecordStepIds.length,
    blockedStepCount: blockedStepIds.length,
    unsafeRecordStepCount: unsafeRecordStepIds.length,
    automationSafeCommandIds: automationSafeCommands.map((entry) => entry.id),
    manualRecordStepIds,
    blockedStepIds,
    unsafeRecordStepIds,
    automationSafeCommands,
  }
}

export async function buildV04MessageLiveSessionReport(options = {}, context = {}) {
  const messageStatusFile = options.messageStatusFile || DEFAULT_V04_MESSAGE_STATUS_FILE
  const preflightFile = options.preflightFile || DEFAULT_V04_LIVE_PREFLIGHT_FILE
  const macosLiveProbeFile = options.macosLiveProbeFile || DEFAULT_V04_MACOS_LIVE_PROBE_FILE
  const bridgeTraceFile = options.bridgeTraceFile || DEFAULT_V04_BRIDGE_TRACE_FILE
  const [statusSource, preflightSource, macosProbeSource, bridgeTraceSource] = await Promise.all([
    readJsonEvidence(messageStatusFile),
    readJsonEvidence(preflightFile),
    readJsonEvidence(macosLiveProbeFile),
    readJsonEvidence(bridgeTraceFile),
  ])
  const messageStatus = summarizeMessageStatus(statusSource)
  const preflight = summarizePreflight(preflightSource)
  const macosLiveProbe = summarizeMacosLiveProbe(macosProbeSource)
  const bridgeTrace = summarizeBridgeTrace(bridgeTraceSource)
  const steps = buildSteps({ statusSource, preflightSource, macosProbeSource, bridgeTraceSource })
  const pendingCheckIds = messageStatus.pendingCheckIds
  const recordSafetySummary = summarizeRecordSafety(steps, pendingCheckIds)
  const stepExecutionSummary = summarizeStepExecution(steps, pendingCheckIds)
  const actionablePendingSteps = steps.filter((step) => (
    step.id.startsWith('record-')
    && pendingCheckIds.includes(step.checkId)
    && step.readyToAttempt === true
    && typeof step.recordCommand === 'string'
    && step.recordCommand.length > 0
  ))
  const ok = messageStatus.releaseGateComplete === true
  const preflightBlocked = preflight.blockingCheckIds.length > 0
  const overallStatus = ok
    ? 'release-gate-complete'
    : preflightBlocked
      ? 'preflight-blocked'
      : 'manual-live-evidence-required'

  return {
    schemaVersion: 1,
    gate: 'nexus-v04-message-live-session',
    generatedAt: new Date(context.now ?? Date.now()).toISOString(),
    ok,
    overallStatus,
    readyToRecordPendingChecks: pendingCheckIds.length > 0
      && actionablePendingSteps.length === pendingCheckIds.length,
    safeToRunPendingRecordCommands: pendingCheckIds.length === 0
      || (
        recordSafetySummary.pendingRecordCount > 0
        && recordSafetySummary.safeToRunCount === recordSafetySummary.pendingRecordCount
      ),
    recordSafetySummary,
    stepExecutionSummary,
    releaseGateComplete: messageStatus.releaseGateComplete,
    pendingCheckIds,
    failedCheckIds: messageStatus.failedCheckIds,
    files: {
      messageStatus: {
        path: messageStatusFile,
        exists: statusSource.exists,
        error: statusSource.error,
      },
      preflight: {
        path: preflightFile,
        exists: preflightSource.exists,
        error: preflightSource.error,
      },
      macosLiveProbe: {
        path: macosLiveProbeFile,
        exists: macosProbeSource.exists,
        error: macosProbeSource.error,
      },
      bridgeTrace: {
        path: bridgeTraceFile,
        exists: bridgeTraceSource.exists,
        error: bridgeTraceSource.error,
      },
    },
    sourceReports: {
      messageStatus,
      preflight,
      macosLiveProbe,
      bridgeTrace,
    },
    steps,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'message sender/text/id values',
        'notification title/body/sender/chat values',
        'webhook payloads and responses',
        'Telegram and Discord tokens, chat ids, and channel ids',
        'Telegram and Discord bridge trace target/error values',
        'live-check operators and notes',
        'raw live evidence payload bodies',
      ],
    },
  }
}

function yesNo(value) {
  return value ? 'yes' : 'no'
}

function markdownText(value) {
  return cleanString(value).replace(/\|/g, '\\|')
}

function commandText(value) {
  return cleanString(value)
}

function pushBullet(lines, label, value) {
  const text = markdownText(value)
  if (!text) return
  lines.push(`- ${label}: ${text}`)
}

function pushCodeBlock(lines, label, command) {
  const text = commandText(command)
  if (!text) return
  lines.push(`- ${label}:`)
  lines.push('')
  lines.push('```sh')
  lines.push(text)
  lines.push('```')
  lines.push('')
}

function pushStringList(lines, label, values) {
  const items = safeArray(values).map(markdownText).filter(Boolean)
  if (items.length === 0) return
  lines.push(`- ${label}:`)
  for (const item of items) lines.push(`  - ${item}`)
}

function bridgeTraceLine(trace) {
  if (!trace) return ''
  const parts = [
    `hasTraceEvidence=${yesNo(trace.hasTraceEvidence)}`,
    trace.state ? `state=${trace.state}` : '',
    trace.lastEventAt ? `lastEventAt=${trace.lastEventAt}` : '',
    trace.updateOffset ? `updateOffset=${trace.updateOffset}` : '',
    trace.lastOutboundAt ? `lastOutboundAt=${trace.lastOutboundAt}` : '',
    trace.lastOutboundKind ? `lastOutboundKind=${trace.lastOutboundKind}` : '',
    `lastOutboundTargetPresent=${yesNo(trace.lastOutboundTargetPresent)}`,
    `lastOutboundErrorPresent=${yesNo(trace.lastOutboundErrorPresent)}`,
    trace.lastReconnectAt ? `lastReconnectAt=${trace.lastReconnectAt}` : '',
    trace.lastReconnectReason ? `lastReconnectReason=${trace.lastReconnectReason}` : '',
  ].filter(Boolean)
  return parts.join(', ')
}

function recordCommandSafetyLine(safety) {
  if (!safety) return ''
  return [
    `status=${safety.status ?? 'unknown'}`,
    `safeToRunRecordCommand=${yesNo(safety.safeToRunRecordCommand === true)}`,
    `dryRunRecommended=${yesNo(safety.dryRunRecommended === true)}`,
    `preflightRecommended=${yesNo(safety.preflightRecommended === true)}`,
  ].join(', ')
}

function pushFileSummary(lines, label, file) {
  lines.push(`| ${markdownText(label)} | ${markdownText(file?.path)} | ${yesNo(file?.exists)} | ${markdownText(file?.error ?? '')} |`)
}

function markdownIdList(values) {
  const items = safeArray(values).map(markdownText).filter(Boolean)
  return items.length > 0 ? items.join(', ') : 'none'
}

function pushStepMarkdown(lines, step, index) {
  lines.push(`### ${index}. ${markdownText(step.label || step.id)}`)
  lines.push('')
  pushBullet(lines, 'Step id', `\`${step.id}\``)
  if (step.checkId) pushBullet(lines, 'Check id', `\`${step.checkId}\``)
  pushBullet(lines, 'Status', `\`${step.status ?? 'unknown'}\``)
  pushBullet(lines, 'Ready to attempt', yesNo(step.readyToAttempt === true))
  pushBullet(lines, 'Detail', step.detail)
  if (step.machinePrerequisite) {
    const machine = step.machinePrerequisite
    pushBullet(
      lines,
      'Machine prerequisite',
      `${machine.id}: status=${machine.status}, releaseEvidenceCandidate=${yesNo(machine.releaseEvidenceCandidate)}`,
    )
  }
  if (step.bridgeTrace) {
    pushBullet(lines, 'Bridge trace applied', yesNo(step.bridgeTraceApplied === true))
    pushBullet(lines, 'Safe bridge trace', bridgeTraceLine(step.bridgeTrace))
  }
  pushStringList(lines, 'Required before recording', step.requiredBeforeRecording)
  pushStringList(lines, 'Diagnostics to check', step.diagnosticsToCheck)
  pushStringList(lines, 'Placeholder fields', step.placeholderFields)
  const missingProofFields = safeArray(step.missingProofFields).map((field) => (
    field?.type ? `${field.field} (${field.type})` : field?.field
  ))
  pushStringList(lines, 'Missing proof fields', missingProofFields)
  if (step.recordCommandSafety) {
    pushBullet(lines, 'Record command safety', recordCommandSafetyLine(step.recordCommandSafety))
    pushStringList(lines, 'Record command placeholders', step.recordCommandSafety.placeholderTokens)
    pushStringList(lines, 'Record command safety reasons', step.recordCommandSafety.reasons)
  }
  pushCodeBlock(lines, 'Command', step.command)
  pushCodeBlock(lines, 'Dry-run record command', step.dryRunCommand)
  pushCodeBlock(lines, 'Preflight record command', step.preflightCommand)
  pushCodeBlock(lines, 'Record command', step.recordCommand)
  lines.push('')
}

export function formatV04MessageLiveSessionMarkdown(report) {
  const lines = [
    '# Nexus v0.4 Message-Awareness Live Evidence Packet',
    '',
    `Generated: ${markdownText(report.generatedAt)}`,
    `Status: ${markdownText(report.overallStatus)}`,
    `Release gate complete: ${yesNo(report.releaseGateComplete === true)}`,
    `Ready to record all pending checks: ${yesNo(report.readyToRecordPendingChecks === true)}`,
    `Safe to run all pending record commands: ${yesNo(report.safeToRunPendingRecordCommands === true)}`,
    `Pending checks: ${safeArray(report.pendingCheckIds).length ? safeArray(report.pendingCheckIds).map(markdownText).join(', ') : 'none'}`,
    `Failed checks: ${safeArray(report.failedCheckIds).length ? safeArray(report.failedCheckIds).map(markdownText).join(', ') : 'none'}`,
    '',
    '## Step Execution Summary',
    '',
    `Automation-safe commands: ${Number(report.stepExecutionSummary?.automationSafeCommandCount ?? 0)}`,
    `Manual record steps: ${markdownIdList(report.stepExecutionSummary?.manualRecordStepIds)}`,
    `Blocked steps: ${markdownIdList(report.stepExecutionSummary?.blockedStepIds)}`,
    `Unsafe record steps: ${markdownIdList(report.stepExecutionSummary?.unsafeRecordStepIds)}`,
    '',
    '## Privacy Boundary',
    '',
    'This packet is private-safe operator guidance. It does not record evidence and does not prove that live gates passed.',
    '',
  ]

  for (const field of safeArray(report.privacy?.privateFieldsOmitted)) {
    lines.push(`- ${markdownText(field)}`)
  }

  lines.push('')
  lines.push('## Source Files')
  lines.push('')
  lines.push('| Source | Path | Exists | Error |')
  lines.push('| --- | --- | --- | --- |')
  pushFileSummary(lines, 'message status', report.files?.messageStatus)
  pushFileSummary(lines, 'preflight', report.files?.preflight)
  pushFileSummary(lines, 'macOS live probe', report.files?.macosLiveProbe)
  pushFileSummary(lines, 'bridge trace', report.files?.bridgeTrace)

  lines.push('')
  lines.push('## Operator Steps')
  lines.push('')
  safeArray(report.steps).forEach((step, index) => {
    pushStepMarkdown(lines, step, index + 1)
  })

  lines.push('## Release Rule')
  lines.push('')
  lines.push('Do not treat v0.4 message-awareness as complete until the live gate, finalization, readiness status, and completion audit all pass against real macOS, Telegram, and Discord observations.')
  lines.push('')
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

async function writeReportFile(report, outputPath) {
  const target = cleanString(outputPath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function writeMarkdownFile(report, outputPath) {
  const target = cleanString(outputPath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, formatV04MessageLiveSessionMarkdown(report), 'utf8')
}

export async function runV04MessageLiveSessionCli(argv = process.argv.slice(2), context = {}) {
  const options = parseV04MessageLiveSessionArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  const report = await buildV04MessageLiveSessionReport(options, context)
  await writeReportFile(report, options.outputPath)
  await writeMarkdownFile(report, options.markdownOutputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReadyToRecord && !report.readyToRecordPendingChecks ? 2 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runV04MessageLiveSessionCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
