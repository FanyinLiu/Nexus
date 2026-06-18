#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildMessageAwarenessGateEvidenceAudit,
  buildMessageAwarenessLiveEvidenceAudit,
} from './validate-message-awareness.mjs'

export const DEFAULT_LOCAL_EVIDENCE_FILE = 'artifacts/v0.3.4/message-awareness-local.json'
export const DEFAULT_LIVE_EVIDENCE_FILE = 'artifacts/v0.3.4/message-awareness-live.json'
export const DEFAULT_COMPLETE_EVIDENCE_FILE = 'artifacts/v0.3.4/message-awareness-complete.json'
export const DEFAULT_REDACTED_OUTPUT_FILE = 'docs/release-evidence/v0.3.4-message-awareness.json'
export const DEFAULT_MACOS_LIVE_PROBE_FILE = 'artifacts/v0.3.4/message-awareness-macos-live-probe.json'
const V04_LOCAL_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-local.json'
const V04_LIVE_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-live.json'
const V04_COMPLETE_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-complete.json'
const V04_REDACTED_OUTPUT_FILE = 'docs/release-evidence/v0.4.0-message-awareness.json'
const V04_MACOS_LIVE_PROBE_FILE = 'artifacts/v0.4.0/message-awareness-macos-live-probe.json'

const RECORD_COMMANDS = {
  'macos-notification-center-live': 'npm run message:live:record -- macos --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --app-name "REPLACE_WITH_REAL_APP" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart."',
  'telegram-live-bridge': 'npm run message:live:record -- telegram --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired, replied, queued or retried while busy, and did not replay after reconnect."',
  'discord-live-bridge': 'npm run message:live:record -- discord --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --message-content-intent-enabled --approved-channel-reply-returned --bot-echo-suppressed --reconnect-status-visible --note "Allowed Discord channel or DM replied once, bot echoes were suppressed, and reconnect status was visible."',
}

function shellQuote(value) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`
}

function cleanPath(value) {
  return String(value ?? '').trim()
}

function isCustomPath(value, defaultValue) {
  const normalized = cleanPath(value)
  return normalized && normalized !== defaultValue
}

function pushPathArg(args, flag, value, defaultValue) {
  const normalized = cleanPath(value)
  if (!isCustomPath(normalized, defaultValue)) return
  args.push(flag, shellQuote(normalized))
}

function buildLocalSmokeCommand(localEvidenceFile) {
  if (!isCustomPath(localEvidenceFile, DEFAULT_LOCAL_EVIDENCE_FILE)) return 'npm run message:smoke:local'
  return `npm run message:smoke:local -- --evidence-file ${shellQuote(localEvidenceFile)}`
}

function buildLiveTemplateCommand(liveEvidenceFile) {
  if (!isCustomPath(liveEvidenceFile, DEFAULT_LIVE_EVIDENCE_FILE)) return 'npm run message:live:template'
  return `npm run message:validate -- --write-live-template ${shellQuote(liveEvidenceFile)}`
}

function buildLiveGateCommand(liveEvidenceFile) {
  if (!isCustomPath(liveEvidenceFile, DEFAULT_LIVE_EVIDENCE_FILE)) return 'npm run message:gate:live'
  return `npm run message:validate -- --check-live-evidence ${shellQuote(liveEvidenceFile)} --require-live-complete`
}

function buildLivePreflightCommand() {
  return 'npm run message:preflight:live'
}

function buildMacosLiveProbeCommand() {
  return 'npm run message:probe:macos'
}

function defaultMacosLiveProbeFileForProfile(profile) {
  return profile === 'v04' ? V04_MACOS_LIVE_PROBE_FILE : DEFAULT_MACOS_LIVE_PROBE_FILE
}

function buildMergeReleaseCommand({ localEvidenceFile, liveEvidenceFile, completeEvidenceFile }) {
  if (
    !isCustomPath(localEvidenceFile, DEFAULT_LOCAL_EVIDENCE_FILE)
    && !isCustomPath(liveEvidenceFile, DEFAULT_LIVE_EVIDENCE_FILE)
    && !isCustomPath(completeEvidenceFile, DEFAULT_COMPLETE_EVIDENCE_FILE)
  ) {
    return 'npm run message:merge:release'
  }
  return [
    'npm run message:validate --',
    '--merge-evidence-file',
    shellQuote(localEvidenceFile),
    '--live-evidence-file',
    shellQuote(liveEvidenceFile),
    '--evidence-file',
    shellQuote(completeEvidenceFile),
  ].join(' ')
}

function buildReleaseGateCommand(completeEvidenceFile) {
  if (!isCustomPath(completeEvidenceFile, DEFAULT_COMPLETE_EVIDENCE_FILE)) return 'npm run message:gate:release'
  return `npm run message:validate -- --check-evidence-file ${shellQuote(completeEvidenceFile)} --require-release-complete`
}

function buildRedactReleaseCommand({ completeEvidenceFile, redactedOutputFile }) {
  if (
    !isCustomPath(completeEvidenceFile, DEFAULT_COMPLETE_EVIDENCE_FILE)
    && !isCustomPath(redactedOutputFile, DEFAULT_REDACTED_OUTPUT_FILE)
  ) {
    return 'npm run message:release:redact'
  }
  return [
    'npm run message:validate --',
    '--redact-evidence-file',
    shellQuote(completeEvidenceFile),
    '--redacted-output-file',
    shellQuote(redactedOutputFile),
  ].join(' ')
}

function usesV04EvidenceProfile(paths, redactedOutputFile) {
  return cleanPath(paths.localEvidenceFile) === V04_LOCAL_EVIDENCE_FILE
    && cleanPath(paths.liveEvidenceFile) === V04_LIVE_EVIDENCE_FILE
    && cleanPath(paths.completeEvidenceFile) === V04_COMPLETE_EVIDENCE_FILE
    && cleanPath(redactedOutputFile) === V04_REDACTED_OUTPUT_FILE
}

function toProfiledCommand(id, command, profile) {
  if (profile !== 'v04') return command
  if (id === 'local-webhook-smoke') return 'npm run v04:message:smoke:local'
  if (id === 'live-preflight') return 'npm run v04:message:preflight:live'
  if (id === 'macos-live-probe') return 'npm run v04:message:probe:macos'
  if (id === 'live-template') return 'npm run v04:message:live:template'
  if (id === 'live-gate') return 'npm run v04:message:gate:live'
  if (id === 'merge-release-evidence') return 'npm run v04:message:merge:release'
  if (id === 'finalize-release-evidence') return 'npm run v04:message:finalize'
  if (id === 'release-gate') return 'npm run v04:message:gate:release'
  if (id === 'redact-release-evidence') return 'npm run v04:message:release:redact'
  if (id.startsWith('record-')) {
    return String(command ?? '')
      .replace(/^npm run message:live:record -- /, 'npm run v04:message:live:record -- ')
      .replace(` --live-evidence-file "${V04_LIVE_EVIDENCE_FILE}"`, '')
  }
  return command
}

function normalizeCommandText(value) {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function isValidTimestamp(value) {
  if (value == null || value === '') return false
  return Number.isFinite(Date.parse(String(value)))
}

function pushTimestampArg(args, flag, value) {
  if (!isValidTimestamp(value)) return
  args.push(flag, shellQuote(new Date(value).toISOString()))
}

function pushObservedAtArg(args, value) {
  if (isValidTimestamp(value)) {
    args.push('--observed-at', shellQuote(new Date(value).toISOString()))
    return
  }
  args.push('--observed-at', shellQuote('REPLACE_WITH_OBSERVED_AT'))
}

function pushTextArg(args, flag, value) {
  const text = normalizeCommandText(value)
  if (text) args.push(flag, shellQuote(text))
}

function pushPositiveIntegerArg(args, flag, value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return
  args.push(flag, String(Math.floor(parsed)))
}

function pushOutboundDiagnosticArgs(args, evidence) {
  pushTimestampArg(args, '--last-outbound-at', evidence?.lastOutboundAt)
  pushTextArg(args, '--last-outbound-kind', evidence?.lastOutboundKind)
}

function recordCommandTemplateMetadata(check, command) {
  const checkId = cleanPath(check?.id)
  if (!LIVE_CHECK_GUIDES[checkId]) return {}
  const commandText = String(command ?? '')
  const placeholderFields = ['operator']
  if (commandText.includes('REPLACE_WITH_REAL_APP')) placeholderFields.push('appName')
  if (commandText.includes('REPLACE_WITH_OBSERVED_AT')) placeholderFields.push('observedAt')
  const dryRunCommand = commandText.replace(
    /^(npm run [^ ]+ -- (?:macos|telegram|discord))\b/,
    '$1 --dry-run',
  )
  const preflightCommand = commandText.replace(
    /^(npm run [^ ]+ -- (?:macos|telegram|discord))\b/,
    '$1 --preflight',
  )
  return {
    isTemplate: true,
    mustReplacePlaceholders: true,
    dryRunCommand,
    preflightCommand,
    placeholderFields,
    placeholderValues: placeholderFields.map((field) => (
      field === 'appName'
        ? 'REPLACE_WITH_REAL_APP'
        : field === 'observedAt'
          ? 'REPLACE_WITH_OBSERVED_AT'
          : 'REPLACE_WITH_OPERATOR'
    )),
  }
}

function buildRecordCommand(check, options = {}) {
  const evidence = check?.evidence ?? {}
  const args = ['npm run message:live:record --']

  if (check?.id === 'macos-notification-center-live') {
    args.push('macos')
    pushPathArg(args, '--live-evidence-file', options.liveEvidenceFile, DEFAULT_LIVE_EVIDENCE_FILE)
    pushObservedAtArg(args, check.observedAt)
    args.push('--operator', shellQuote('REPLACE_WITH_OPERATOR'))
    args.push('--app-name', shellQuote(normalizeCommandText(evidence.appName) || 'REPLACE_WITH_REAL_APP'))
    args.push('--full-disk-access-granted')
    args.push('--notification-observed-once')
    args.push('--replay-checked-after-restart')
    args.push('--note', shellQuote('One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart.'))
    return args.join(' ')
  }

  if (check?.id === 'telegram-live-bridge') {
    args.push('telegram')
    pushPathArg(args, '--live-evidence-file', options.liveEvidenceFile, DEFAULT_LIVE_EVIDENCE_FILE)
    pushObservedAtArg(args, check.observedAt)
    args.push('--operator', shellQuote('REPLACE_WITH_OPERATOR'))
    pushPositiveIntegerArg(args, '--update-offset', evidence.updateOffset)
    pushOutboundDiagnosticArgs(args, evidence)
    args.push('--pairing-approved')
    args.push('--owner-text-reply-returned')
    args.push('--busy-message-queued-or-retried')
    args.push('--reconnect-replay-checked')
    args.push('--note', shellQuote('Owner DM paired, replied, queued or retried while busy, and did not replay after reconnect.'))
    return args.join(' ')
  }

  if (check?.id === 'discord-live-bridge') {
    args.push('discord')
    pushPathArg(args, '--live-evidence-file', options.liveEvidenceFile, DEFAULT_LIVE_EVIDENCE_FILE)
    pushObservedAtArg(args, check.observedAt)
    args.push('--operator', shellQuote('REPLACE_WITH_OPERATOR'))
    pushTimestampArg(args, '--last-reconnect-at', evidence.lastReconnectAt)
    pushTextArg(args, '--last-reconnect-reason', evidence.lastReconnectReason)
    pushOutboundDiagnosticArgs(args, evidence)
    args.push('--message-content-intent-enabled')
    args.push('--approved-channel-reply-returned')
    args.push('--bot-echo-suppressed')
    args.push('--reconnect-status-visible')
    args.push('--note', shellQuote('Allowed Discord channel or DM replied once, bot echoes were suppressed, and reconnect status was visible.'))
    return args.join(' ')
  }

  return RECORD_COMMANDS[check?.id] ?? 'npm run message:live:record -- <macos|telegram|discord> ...'
}

const LIVE_CHECK_GUIDES = {
  'macos-notification-center-live': {
    label: 'macOS Notification Center',
    beforeRecording: [
      'Grant Full Disk Access to the running Nexus host.',
      'Enable Desktop message awareness in Nexus.',
      'Send one real app notification and confirm exactly one Nexus event appears.',
      'Restart Nexus and confirm the old notification does not replay.',
    ],
    diagnostics: [
      'Settings -> Console -> Advanced diagnostics -> Notification Center should show a recent event, source, or skip/error reason.',
    ],
  },
  'telegram-live-bridge': {
    label: 'Telegram live bridge',
    beforeRecording: [
      'Approve the owner pairing code in desktop settings.',
      'Send one real owner text message and confirm the companion reply returns to Telegram.',
      'Send a message while the assistant is busy and confirm it is queued or retried.',
      'Reconnect the gateway and confirm old updates do not replay.',
    ],
    diagnostics: [
      'Settings -> Console -> Advanced diagnostics -> Telegram should show a ready state after connect.',
      'The Telegram trace should include a non-zero update offset checkpoint before and after reconnect.',
      'The Telegram trace should show the latest outbound text/voice reply target after the owner reply returns.',
    ],
  },
  'discord-live-bridge': {
    label: 'Discord live bridge',
    beforeRecording: [
      'Enable Discord Message Content Intent for the bot.',
      'Approve the target channel or DM in desktop settings.',
      'Send one real message and confirm the companion reply returns to the same target.',
      'Confirm bot-authored echoes do not re-enter the assistant.',
      'Interrupt/reconnect the gateway and confirm reconnect status is visible.',
    ],
    diagnostics: [
      'Settings -> Console -> Advanced diagnostics -> Discord should show a ready state after connect.',
      'The Discord trace should include last reconnect reason/time after an interruption.',
      'The Discord trace should show the latest outbound text/audio reply target after the allowed channel or DM reply returns.',
    ],
  },
}

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/message-awareness-release-status.mjs [options]',
    '',
    'Reads message-awareness evidence files and prints a private-safe',
    'release status report with pending proof fields and next commands.',
    '',
    'Options:',
    `  --local-evidence-file <path>     Local evidence file (default: ${DEFAULT_LOCAL_EVIDENCE_FILE})`,
    `  --live-evidence-file <path>      Live evidence file (default: ${DEFAULT_LIVE_EVIDENCE_FILE})`,
    `  --complete-evidence-file <path>  Complete evidence file (default: ${DEFAULT_COMPLETE_EVIDENCE_FILE})`,
    `  --redacted-output-file <path>    Redacted release evidence file (default: ${DEFAULT_REDACTED_OUTPUT_FILE})`,
    '  --macos-live-probe-file <path>   macOS live probe report (default: profile-specific)',
    '  --output <path>                  Write the private-safe status JSON to a file',
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

export function parseMessageAwarenessReleaseStatusArgs(argv) {
  const options = {
    help: false,
    localEvidenceFile: DEFAULT_LOCAL_EVIDENCE_FILE,
    liveEvidenceFile: DEFAULT_LIVE_EVIDENCE_FILE,
    completeEvidenceFile: DEFAULT_COMPLETE_EVIDENCE_FILE,
    macosLiveProbeFile: '',
    outputPath: '',
    redactedOutputFile: DEFAULT_REDACTED_OUTPUT_FILE,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    const [name, inlineValue] = splitOption(arg)
    if (
      name === '--local-evidence-file'
      || name === '--live-evidence-file'
      || name === '--complete-evidence-file'
      || name === '--macos-live-probe-file'
      || name === '--output'
      || name === '--output-file'
      || name === '--evidence-file'
      || name === '--redacted-output-file'
    ) {
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--local-evidence-file') options.localEvidenceFile = parsed.value
      else if (name === '--live-evidence-file') options.liveEvidenceFile = parsed.value
      else if (name === '--complete-evidence-file') options.completeEvidenceFile = parsed.value
      else if (name === '--macos-live-probe-file') options.macosLiveProbeFile = parsed.value
      else if (name === '--output' || name === '--output-file' || name === '--evidence-file') options.outputPath = parsed.value
      else options.redactedOutputFile = parsed.value
      index = parsed.nextIndex
      continue
    }

    throw new Error(`Unsupported option: ${arg}`)
  }

  return options
}

async function readJsonEvidence(filePath) {
  const resolved = path.resolve(process.cwd(), filePath)
  try {
    return {
      path: filePath,
      resolvedPath: resolved,
      exists: true,
      raw: JSON.parse(await fs.readFile(resolved, 'utf8')),
      error: null,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        path: filePath,
        resolvedPath: resolved,
        exists: false,
        raw: null,
        error: 'missing',
      }
    }
    return {
      path: filePath,
      resolvedPath: resolved,
      exists: true,
      raw: null,
      error: String(error?.message ?? error),
    }
  }
}

function summarizeGateEvidence(source) {
  if (!source.exists || !source.raw) {
    return {
      exists: source.exists,
      error: source.error,
      audit: null,
    }
  }

  try {
    const audit = buildMessageAwarenessGateEvidenceAudit(source.raw)
    return {
      exists: true,
      error: null,
      audit: {
        overallStatus: audit.overallStatus,
        releaseGateComplete: audit.releaseGateComplete,
        missingCheckIds: audit.missingCheckIds,
        inconsistencies: audit.inconsistencies,
        localWebhook: audit.localWebhook,
        liveEvidence: summarizeLiveAudit(audit.liveEvidence),
      },
    }
  } catch (error) {
    return {
      exists: true,
      error: String(error?.message ?? error),
      audit: null,
    }
  }
}

function summarizeRedactedGateEvidence(source) {
  const summary = summarizeGateEvidence(source)
  const redacted = source.raw?.redacted === true
  const redactionGateComplete = summary.exists === true
    && summary.error == null
    && redacted
    && summary.audit?.releaseGateComplete === true
  return {
    ...summary,
    redacted,
    redactionGateComplete,
  }
}

function summarizeLiveAudit(audit) {
  return {
    overallStatus: audit.overallStatus,
    liveGateComplete: audit.liveGateComplete,
    passedCount: audit.passedCount,
    totalCount: audit.totalCount,
    pendingCheckIds: audit.pendingCheckIds,
    failedCheckIds: audit.failedCheckIds,
    checks: audit.checks.map((check) => ({
      id: check.id,
      status: check.status,
      observedAt: check.observedAt ?? null,
      evidence: summarizePublicLiveEvidence(check.evidence),
      missingProofFields: check.missingProofFields.map((field) => ({
        field: field.field,
        type: field.type,
        description: field.description,
      })),
    })),
  }
}

function summarizePublicLiveEvidence(evidence) {
  if (evidence == null || typeof evidence !== 'object' || Array.isArray(evidence)) return {}
  const publicEvidence = { ...evidence }
  const hasOutboundTarget = normalizeCommandText(publicEvidence.lastOutboundTarget).length > 0
  const hasOutboundError = normalizeCommandText(publicEvidence.lastOutboundError).length > 0
  delete publicEvidence.lastOutboundTarget
  delete publicEvidence.lastOutboundError
  if (hasOutboundTarget) publicEvidence.lastOutboundTargetPresent = true
  if (hasOutboundError) publicEvidence.lastOutboundErrorPresent = true
  return publicEvidence
}

function summarizeLiveEvidence(source) {
  if (!source.exists || !source.raw) {
    const audit = buildMessageAwarenessLiveEvidenceAudit(null)
    return {
      exists: source.exists,
      error: source.error,
      audit: summarizeLiveAudit(audit),
    }
  }

  try {
    return {
      exists: true,
      error: null,
      audit: summarizeLiveAudit(buildMessageAwarenessLiveEvidenceAudit(source.raw)),
    }
  } catch (error) {
    return {
      exists: true,
      error: String(error?.message ?? error),
      audit: summarizeLiveAudit(buildMessageAwarenessLiveEvidenceAudit(null)),
    }
  }
}

function toNullableNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function summarizeMacosLiveProbe(source, generatedAt = new Date()) {
  const base = {
    exists: source.exists,
    error: source.error,
    file: {
      path: source.path,
      exists: source.exists,
      error: source.error,
    },
  }
  if (!source.exists || !source.raw) {
    return {
      ...base,
      generatedAt: new Date(generatedAt).toISOString(),
      ok: false,
      status: source.error || 'missing',
      releaseEvidenceCandidate: false,
      releaseEvidenceRecorded: false,
      diagnostics: null,
    }
  }
  if (source.raw.gate !== 'message-awareness-macos-live-probe') {
    return {
      ...base,
      error: 'wrong-gate',
      generatedAt: new Date(generatedAt).toISOString(),
      ok: false,
      status: 'invalid',
      releaseEvidenceCandidate: false,
      releaseEvidenceRecorded: false,
      diagnostics: null,
    }
  }
  const diagnostics = source.raw.diagnostics && typeof source.raw.diagnostics === 'object'
    ? {
        platform: normalizeCommandText(source.raw.diagnostics.platform) || null,
        machineChecked: source.raw.diagnostics.machineChecked === true,
        errorKind: normalizeCommandText(source.raw.diagnostics.errorKind) || null,
        stateFileConfigured: source.raw.diagnostics.stateFileConfigured === true,
        testNotificationRequested: source.raw.diagnostics.testNotificationRequested === true,
        initialBacklogMarkedSeen: toNullableNumber(source.raw.diagnostics.initialBacklogMarkedSeen),
        observedFreshCount: toNullableNumber(source.raw.diagnostics.observedFreshCount),
        replayFreshCount: toNullableNumber(source.raw.diagnostics.replayFreshCount),
        rowsInspected: source.raw.diagnostics.rowsInspected && typeof source.raw.diagnostics.rowsInspected === 'object'
          ? {
              initial: toNullableNumber(source.raw.diagnostics.rowsInspected.initial),
              observed: toNullableNumber(source.raw.diagnostics.rowsInspected.observed),
              replay: toNullableNumber(source.raw.diagnostics.rowsInspected.replay),
            }
          : null,
      }
    : null
  return {
    ...base,
    error: null,
    generatedAt: new Date(source.raw.generatedAt || generatedAt).toISOString(),
    ok: source.raw.ok === true,
    status: normalizeCommandText(source.raw.status) || 'unknown',
    releaseEvidenceCandidate: source.raw.releaseEvidenceCandidate === true,
    releaseEvidenceRecorded: source.raw.releaseEvidenceRecorded === true,
    diagnostics,
  }
}

function addNextCommand(commands, id, command, reason, metadata = {}) {
  if (commands.some((entry) => entry.id === id)) return
  commands.push({ id, command, reason, ...metadata })
}

function macosLiveProbeReason(macosLiveProbe) {
  if (macosLiveProbe?.ok === true && macosLiveProbe?.releaseEvidenceCandidate === true) {
    return 'macOS probe saw exactly one fresh candidate with no immediate replay; confirm Nexus event/restart behavior before recording operator evidence'
  }
  const status = normalizeCommandText(macosLiveProbe?.status)
  return status
    ? `machine-check one fresh macOS notification candidate before recording operator evidence; last probe status: ${status}`
    : 'machine-check that one fresh macOS notification candidate is observed and not replayed before recording operator evidence'
}

function buildNextCommands({ local, live, complete, redacted, paths, redactedOutputFile, macosLiveProbe }) {
  const commands = []
  const commandProfile = usesV04EvidenceProfile(paths, redactedOutputFile) ? 'v04' : 'default'
  const rawCompleteGreen = complete.audit?.releaseGateComplete === true
  const redactionGreen = redacted?.redactionGateComplete === true
  const localPass = rawCompleteGreen || local.audit?.localWebhook?.pass === true
  const liveComplete = rawCompleteGreen || live.audit?.liveGateComplete === true
  const liveChecksById = new Map((live.audit?.checks ?? []).map((check) => [check.id, check]))

  if (!localPass) {
    addNextCommand(
      commands,
      'local-webhook-smoke',
      toProfiledCommand('local-webhook-smoke', buildLocalSmokeCommand(paths.localEvidenceFile), commandProfile),
      'local webhook evidence is missing or not passing',
    )
  }

  if (!rawCompleteGreen && !live.exists) {
    addNextCommand(
      commands,
      'live-template',
      toProfiledCommand('live-template', buildLiveTemplateCommand(paths.liveEvidenceFile), commandProfile),
      'live evidence file is missing',
    )
  }

  if (!rawCompleteGreen && live.audit?.liveGateComplete !== true) {
    addNextCommand(
      commands,
      'live-preflight',
      toProfiledCommand('live-preflight', buildLivePreflightCommand(), commandProfile),
      'confirm the live-check host can read safe environment status before recording real evidence',
    )
  }

  if (!rawCompleteGreen && (live.audit?.pendingCheckIds ?? []).includes('macos-notification-center-live')) {
    addNextCommand(
      commands,
      'macos-live-probe',
      toProfiledCommand('macos-live-probe', buildMacosLiveProbeCommand(), commandProfile),
      macosLiveProbeReason(macosLiveProbe),
      {
        lastProbeStatus: macosLiveProbe?.status ?? null,
        releaseEvidenceCandidate: macosLiveProbe?.releaseEvidenceCandidate === true,
      },
    )
  }

  for (const checkId of rawCompleteGreen ? [] : live.audit?.pendingCheckIds ?? []) {
    const check = liveChecksById.get(checkId) ?? { id: checkId }
    const command = toProfiledCommand(
      `record-${checkId}`,
      buildRecordCommand(check, { liveEvidenceFile: paths.liveEvidenceFile }),
      commandProfile,
    )
    addNextCommand(
      commands,
      `record-${checkId}`,
      command,
      `${checkId} is not passing yet`,
      recordCommandTemplateMetadata(check, command),
    )
  }

  if (!rawCompleteGreen && live.exists) {
    addNextCommand(
      commands,
      'live-gate',
      toProfiledCommand('live-gate', buildLiveGateCommand(paths.liveEvidenceFile), commandProfile),
      liveComplete ? 'confirm live evidence is still complete' : 'review pending live evidence proof fields',
    )
  }

  if (localPass && liveComplete && !rawCompleteGreen) {
    if (commandProfile === 'v04') {
      addNextCommand(
        commands,
        'finalize-release-evidence',
        toProfiledCommand('finalize-release-evidence', 'npm run message:merge:release', commandProfile),
        'strictly combine, gate, redact, and refresh private-safe v0.4 release status',
      )
      return commands
    }

    addNextCommand(
      commands,
      'merge-release-evidence',
      toProfiledCommand(
        'merge-release-evidence',
        buildMergeReleaseCommand({
          completeEvidenceFile: paths.completeEvidenceFile,
          liveEvidenceFile: paths.liveEvidenceFile,
          localEvidenceFile: paths.localEvidenceFile,
        }),
        commandProfile,
      ),
      'combine local webhook evidence with live evidence',
    )
  }

  if (complete.exists) {
    addNextCommand(
      commands,
      'release-gate',
      toProfiledCommand('release-gate', buildReleaseGateCommand(paths.completeEvidenceFile), commandProfile),
      rawCompleteGreen ? 'confirm release gate remains green' : 'review complete release evidence gate',
    )
  }

  if (rawCompleteGreen && !redactionGreen) {
    addNextCommand(
      commands,
      'redact-release-evidence',
      toProfiledCommand(
        'redact-release-evidence',
        buildRedactReleaseCommand({
          completeEvidenceFile: paths.completeEvidenceFile,
          redactedOutputFile,
        }),
        commandProfile,
      ),
      'write commit-safe release evidence',
    )
  }

  return commands
}

function buildLiveVerificationChecklist(live, options = {}) {
  const checks = Array.isArray(live.audit?.checks) ? live.audit.checks : []
  return checks.map((check) => {
    const guide = LIVE_CHECK_GUIDES[check.id] ?? {
      label: check.id,
      beforeRecording: [],
      diagnostics: [],
    }
    const recordCommand = toProfiledCommand(
      `record-${check.id}`,
      buildRecordCommand(check, { liveEvidenceFile: options.liveEvidenceFile }),
      options.commandProfile,
    )
    const templateMetadata = recordCommandTemplateMetadata(check, recordCommand)
    return {
      id: check.id,
      label: guide.label,
      status: check.status,
      readyForReleaseGate: check.status === 'pass',
      missingProofFields: check.missingProofFields,
      beforeRecording: guide.beforeRecording,
      diagnostics: guide.diagnostics,
      recordCommand,
      dryRunCommand: templateMetadata.dryRunCommand,
      preflightCommand: templateMetadata.preflightCommand,
      recordCommandIsTemplate: templateMetadata.isTemplate === true,
      mustReplacePlaceholders: templateMetadata.mustReplacePlaceholders === true,
      placeholderFields: templateMetadata.placeholderFields ?? [],
      placeholderValues: templateMetadata.placeholderValues ?? [],
    }
  })
}

function hasFreshLiveAuditChecks(source) {
  return source?.exists === true
    && source.error == null
    && Array.isArray(source.audit?.checks)
    && source.audit.checks.length > 0
}

export async function buildMessageAwarenessReleaseStatusReport(options = {}, context = {}) {
  const localFile = options.localEvidenceFile || DEFAULT_LOCAL_EVIDENCE_FILE
  const liveFile = options.liveEvidenceFile || DEFAULT_LIVE_EVIDENCE_FILE
  const completeFile = options.completeEvidenceFile || DEFAULT_COMPLETE_EVIDENCE_FILE
  const redactedOutputFile = options.redactedOutputFile || DEFAULT_REDACTED_OUTPUT_FILE
  const evidencePaths = {
    completeEvidenceFile: completeFile,
    liveEvidenceFile: liveFile,
    localEvidenceFile: localFile,
  }
  const commandProfile = usesV04EvidenceProfile(evidencePaths, redactedOutputFile) ? 'v04' : 'default'
  const macosLiveProbeFile = options.macosLiveProbeFile || defaultMacosLiveProbeFileForProfile(commandProfile)
  const [localSource, liveSource, completeSource, redactedSource, macosProbeSource] = await Promise.all([
    readJsonEvidence(localFile),
    readJsonEvidence(liveFile),
    readJsonEvidence(completeFile),
    readJsonEvidence(redactedOutputFile),
    readJsonEvidence(macosLiveProbeFile),
  ])

  const local = summarizeGateEvidence(localSource)
  const live = summarizeLiveEvidence(liveSource)
  const complete = summarizeGateEvidence(completeSource)
  const redacted = summarizeRedactedGateEvidence(redactedSource)
  const macosLiveProbe = summarizeMacosLiveProbe(macosProbeSource, context.now ?? Date.now())
  const rawReleaseGateComplete = complete.audit?.releaseGateComplete === true
  const redactionGateComplete = redacted.redactionGateComplete === true
  const releaseGateComplete = rawReleaseGateComplete && redactionGateComplete
  const completeLive = { audit: complete.audit?.liveEvidence }
  const checklistSource = hasFreshLiveAuditChecks(live)
    ? live
    : completeLive
  const gateVersion = commandProfile === 'v04' ? 'v0.4' : 'v0.3.4'

  return {
    schemaVersion: 1,
    gate: `${gateVersion}-message-awareness-release-status`,
    generatedAt: new Date(context.now ?? Date.now()).toISOString(),
    ok: releaseGateComplete,
    releaseGateComplete,
    files: {
      local: {
        path: localSource.path,
        exists: localSource.exists,
      },
      live: {
        path: liveSource.path,
        exists: liveSource.exists,
      },
      complete: {
        path: completeSource.path,
        exists: completeSource.exists,
      },
      redactedOutput: {
        path: redactedOutputFile,
        exists: redactedSource.exists,
      },
      macosLiveProbe: {
        path: macosProbeSource.path,
        exists: macosProbeSource.exists,
      },
    },
    localEvidence: local,
    liveEvidence: live,
    completeEvidence: complete,
    redactedEvidence: redacted,
    rawReleaseGateComplete,
    redactionGateComplete,
    macosLiveProbe,
    liveVerificationChecklist: buildLiveVerificationChecklist(checklistSource, {
      commandProfile,
      liveEvidenceFile: liveFile,
    }),
    nextCommands: buildNextCommands({
      local,
      live,
      complete,
      redacted,
      paths: evidencePaths,
      redactedOutputFile,
      macosLiveProbe,
    }),
  }
}

async function writeReportFile(report, outputPath) {
  const target = cleanPath(outputPath)
  if (!target) return
  const resolvedPath = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runMessageAwarenessReleaseStatus(argv = process.argv.slice(2), context = {}) {
  const options = parseMessageAwarenessReleaseStatusArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = await buildMessageAwarenessReleaseStatusReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMessageAwarenessReleaseStatus().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
