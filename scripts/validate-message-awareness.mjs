#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_WEBHOOK_URL,
  buildMessageWebhookPayload,
  parseMessageWebhookArgs,
  postMessageWebhookPayload,
  readWebhookToken,
} from './send-message-webhook.mjs'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/validate-message-awareness.mjs [options]',
    '',
    'Sends a synthetic communication message to the running Nexus local webhook.',
    'This validates local ingress only; real macOS Notification Center and',
    'Telegram/Discord validation still require real app/network checks.',
    '',
    'Options:',
    '  --token <token>                    Bearer token from Settings, with or without "Bearer "',
    '  --token-file <path>                Token file path',
    '  --url <url>                        Nexus webhook URL',
    '  --source <app>                     Source app name (default: Nexus Validation)',
    '  --sender <name>                    Sender display name (default: Validation Probe)',
    '  --chat-title <name>                Conversation title (default: Stabilization Gate)',
    '  --conversation-id <id>             Stable conversation id',
    '  --message-id <id>                  Stable message id',
    '  --text <message>                   Message text',
    '  --evidence-file <path>             Write a message-awareness gate evidence report',
    '  --merge-evidence-file <path>       Merge existing local evidence with --live-evidence-file',
    '  --check-evidence-file <path>       Validate and summarize a full gate evidence report',
    '  --require-release-complete         Exit non-zero unless the full gate evidence is complete',
    '  --redact-evidence-file <path>      Read a full gate report and redact private release evidence',
    '  --redacted-output-file <path>      Write redacted release evidence instead of printing only',
    '  --live-evidence-file <path>        Merge real macOS/Telegram/Discord check evidence',
    '  --write-live-template <path>       Write the live evidence JSON template and exit',
    '  --force-live-template              Overwrite an existing live evidence template file',
    '  --check-live-evidence <path>       Validate and summarize a live evidence JSON file',
    '  --require-live-complete            Exit non-zero unless every live evidence gate passes',
    '  --record-live-check <id>           Update one live evidence check in --live-evidence-file',
    '  --live-status <status>             pass, fail, or manual-required for --record-live-check',
    '  --observed-at <timestamp>          Observation time for --record-live-check',
    '  --operator <name>                  Person who performed the real check',
    '  --note <text>                      Add a live evidence note; repeatable',
    '  --evidence <key=value>             Add a proof field; repeatable',
    '  --dry-run                         Print the validation payload without sending',
    '',
    'Example:',
    '  npm run message:validate -- --token "Bearer nexus_..."',
    '',
  ].join('\n'))
}

const BOOLEAN_LIVE_EVIDENCE_FLAGS = {
  '--full-disk-access-granted': 'fullDiskAccessGranted',
  '--notification-observed-once': 'notificationObservedOnce',
  '--replay-checked-after-restart': 'replayCheckedAfterRestart',
  '--pairing-approved': 'pairingApproved',
  '--owner-text-reply-returned': 'ownerTextReplyReturned',
  '--busy-message-queued-or-retried': 'busyMessageQueuedOrRetried',
  '--reconnect-replay-checked': 'reconnectReplayChecked',
  '--message-content-intent-enabled': 'messageContentIntentEnabled',
  '--approved-channel-reply-returned': 'approvedChannelReplyReturned',
  '--bot-echo-suppressed': 'botEchoSuppressed',
  '--reconnect-status-visible': 'reconnectStatusVisible',
}

function makeRunId(now = new Date()) {
  return now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
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

function cleanString(value) {
  return String(value ?? '').trim()
}

export function parseMessageAwarenessValidationArgs(argv) {
  const webhookArgs = []
  const validation = {
    evidenceFile: '',
    mergeEvidenceFile: '',
    evidenceCheckFile: '',
    redactEvidenceFile: '',
    redactedOutputFile: '',
    liveEvidenceFile: '',
    liveTemplateFile: '',
    liveCheckFile: '',
    forceLiveTemplate: false,
    requireReleaseComplete: false,
    requireLiveComplete: false,
    recordLiveCheckId: '',
    recordLiveStatus: 'pass',
    recordObservedAt: '',
    recordOperator: '',
    recordNotes: [],
    recordEvidencePairs: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force-live-template') {
      validation.forceLiveTemplate = true
      continue
    }
    if (arg === '--require-live-complete') {
      validation.requireLiveComplete = true
      continue
    }
    if (arg === '--require-release-complete') {
      validation.requireReleaseComplete = true
      continue
    }

    const booleanEvidenceField = BOOLEAN_LIVE_EVIDENCE_FLAGS[arg]
    if (booleanEvidenceField) {
      validation.recordEvidencePairs.push(`${booleanEvidenceField}=true`)
      continue
    }

    if (
      arg.startsWith('--evidence-file')
      || arg.startsWith('--merge-evidence-file')
      || arg.startsWith('--check-evidence-file')
      || arg.startsWith('--redact-evidence-file')
      || arg.startsWith('--redacted-output-file')
      || arg.startsWith('--live-evidence-file')
      || arg.startsWith('--write-live-template')
      || arg.startsWith('--check-live-evidence')
      || arg.startsWith('--record-live-check')
      || arg.startsWith('--live-status')
      || arg.startsWith('--observed-at')
      || arg.startsWith('--operator')
      || arg.startsWith('--note')
      || arg.startsWith('--evidence')
      || arg.startsWith('--set')
      || arg.startsWith('--app-name')
    ) {
      const [name, inlineValue] = splitOption(arg)
      if (
        name !== '--evidence-file'
        && name !== '--merge-evidence-file'
        && name !== '--check-evidence-file'
        && name !== '--redact-evidence-file'
        && name !== '--redacted-output-file'
        && name !== '--live-evidence-file'
        && name !== '--write-live-template'
        && name !== '--check-live-evidence'
        && name !== '--record-live-check'
        && name !== '--live-status'
        && name !== '--observed-at'
        && name !== '--operator'
        && name !== '--note'
        && name !== '--evidence'
        && name !== '--set'
        && name !== '--app-name'
      ) {
        webhookArgs.push(arg)
        continue
      }
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--evidence-file') validation.evidenceFile = parsed.value
      else if (name === '--merge-evidence-file') validation.mergeEvidenceFile = parsed.value
      else if (name === '--check-evidence-file') validation.evidenceCheckFile = parsed.value
      else if (name === '--redact-evidence-file') validation.redactEvidenceFile = parsed.value
      else if (name === '--redacted-output-file') validation.redactedOutputFile = parsed.value
      else if (name === '--live-evidence-file') validation.liveEvidenceFile = parsed.value
      else if (name === '--write-live-template') validation.liveTemplateFile = parsed.value
      else if (name === '--check-live-evidence') validation.liveCheckFile = parsed.value
      else if (name === '--record-live-check') validation.recordLiveCheckId = parsed.value
      else if (name === '--live-status') validation.recordLiveStatus = parsed.value
      else if (name === '--observed-at') validation.recordObservedAt = parsed.value
      else if (name === '--operator') validation.recordOperator = parsed.value
      else if (name === '--note') validation.recordNotes.push(parsed.value)
      else if (name === '--app-name') validation.recordEvidencePairs.push(`appName=${parsed.value}`)
      else validation.recordEvidencePairs.push(parsed.value)
      index = parsed.nextIndex
      continue
    }
    webhookArgs.push(arg)
  }

  return {
    validation,
    webhook: parseMessageWebhookArgs(webhookArgs),
  }
}

function withValidationDefaults(options, { now = new Date() } = {}) {
  const runId = makeRunId(now)
  return {
    ...options,
    url: options.url || DEFAULT_WEBHOOK_URL,
    source: options.source || 'Nexus Validation',
    sender: options.sender || 'Validation Probe',
    chatTitle: options.chatTitle || 'Stabilization Gate',
    conversationId: options.conversationId || 'nexus-validation',
    messageId: options.messageId || `nexus-validation-${runId}`,
    text: options.text || `Nexus message-awareness validation ${runId}`,
  }
}

function buildNextChecks() {
  return [
    'Open Nexus and confirm one external-message event appears.',
    'Confirm the source/sender/conversation fields match this payload.',
    'Restart Nexus and confirm this old validation message is not replayed.',
    'Run the macOS Notification Center and Telegram/Discord live checks separately before marking a stable release.',
  ]
}

function buildManualCheck(id, label, evidenceRequired) {
  return {
    id,
    label,
    status: 'manual-required',
    evidenceRequired,
    passEvidenceRequired: LIVE_CHECK_PASS_REQUIREMENTS[id] ?? [],
  }
}

const LIVE_CHECK_IDS = new Set([
  'macos-notification-center-live',
  'telegram-live-bridge',
  'discord-live-bridge',
])

const LIVE_CHECK_STATUS = new Set(['manual-required', 'pass', 'fail'])
const DEFAULT_GATE_VERSION = 'v0.3.4'
const SUPPORTED_GATE_VERSIONS = new Set([DEFAULT_GATE_VERSION, 'v0.4'])

function normalizeGateVersion(version) {
  const value = cleanString(version)
  return SUPPORTED_GATE_VERSIONS.has(value) ? value : DEFAULT_GATE_VERSION
}

function inferGateVersionFromPath(filePath) {
  const normalized = cleanString(filePath).replace(/\\/g, '/')
  if (/\/?v0\.4\.0\//.test(normalized) || /v0\.4-message-awareness/.test(normalized)) return 'v0.4'
  if (/\/?v0\.3\.4\//.test(normalized) || /v0\.3\.4-message-awareness/.test(normalized)) return 'v0.3.4'
  return ''
}

function inferGateVersionFromPathOrDefault(filePath) {
  return inferGateVersionFromPath(filePath) || DEFAULT_GATE_VERSION
}

function messageAwarenessGateName(version = DEFAULT_GATE_VERSION) {
  return `${normalizeGateVersion(version)}-message-awareness`
}

function messageAwarenessLiveGateName(version = DEFAULT_GATE_VERSION) {
  return `${normalizeGateVersion(version)}-message-awareness-live`
}

function parseMessageAwarenessGateVersion(gate) {
  const value = cleanString(gate)
  for (const version of SUPPORTED_GATE_VERSIONS) {
    if (value === messageAwarenessGateName(version)) return version
  }
  return ''
}

const COMMON_LIVE_CHECK_PASS_REQUIREMENTS = [
  {
    field: 'observedAt',
    type: 'iso-timestamp',
    description: 'real observation timestamp',
  },
  {
    field: 'operator',
    type: 'non-empty-string',
    description: 'person who performed the real check',
  },
  {
    field: 'notes',
    type: 'concrete-notes',
    description: 'concrete non-template observation notes',
  },
]

const LIVE_CHECK_PASS_REQUIREMENTS = {
  'macos-notification-center-live': [
    ...COMMON_LIVE_CHECK_PASS_REQUIREMENTS,
    {
      field: 'appName',
      type: 'non-empty-string',
      description: 'real app name that emitted the notification',
    },
    {
      field: 'fullDiskAccessGranted',
      type: 'true',
      description: 'Full Disk Access was granted to the running Nexus host',
    },
    {
      field: 'notificationObservedOnce',
      type: 'true',
      description: 'one real notification appeared once in Nexus',
    },
    {
      field: 'replayCheckedAfterRestart',
      type: 'true',
      description: 'restart did not replay the old notification',
    },
  ],
  'telegram-live-bridge': [
    ...COMMON_LIVE_CHECK_PASS_REQUIREMENTS,
    {
      field: 'pairingApproved',
      type: 'true',
      description: 'owner pairing code was approved in desktop settings',
    },
    {
      field: 'ownerTextReplyReturned',
      type: 'true',
      description: 'owner text message entered Nexus and reply returned to Telegram',
    },
    {
      field: 'busyMessageQueuedOrRetried',
      type: 'true',
      description: 'message sent while assistant was busy was queued or retried',
    },
    {
      field: 'reconnectReplayChecked',
      type: 'true',
      description: 'gateway reconnect did not replay old updates',
    },
  ],
  'discord-live-bridge': [
    ...COMMON_LIVE_CHECK_PASS_REQUIREMENTS,
    {
      field: 'messageContentIntentEnabled',
      type: 'true',
      description: 'Discord Message Content Intent was enabled for the bot',
    },
    {
      field: 'approvedChannelReplyReturned',
      type: 'true',
      description: 'approved channel or DM received a companion reply',
    },
    {
      field: 'botEchoSuppressed',
      type: 'true',
      description: 'bot-authored echo did not re-enter the assistant',
    },
    {
      field: 'reconnectStatusVisible',
      type: 'true',
      description: 'gateway reconnect status was visible after interruption',
    },
  ],
}

export function buildMessageAwarenessLiveEvidenceTemplate() {
  return {
    checks: [
      {
        id: 'macos-notification-center-live',
        status: 'manual-required',
        observedAt: null,
        evidence: {
          appName: '',
          fullDiskAccessGranted: false,
          notificationObservedOnce: false,
          replayCheckedAfterRestart: false,
        },
        notes: [
          'Replace manual-required with pass only after one real notification is observed once and restart no-replay is checked.',
        ],
      },
      {
        id: 'telegram-live-bridge',
        status: 'manual-required',
        observedAt: null,
        evidence: {
          pairingApproved: false,
          ownerTextReplyReturned: false,
          busyMessageQueuedOrRetried: false,
          reconnectReplayChecked: false,
        },
        notes: [
          'Replace manual-required with pass only after a real owner DM, reply return, busy queue/retry, and reconnect no-replay are verified.',
        ],
      },
      {
        id: 'discord-live-bridge',
        status: 'manual-required',
        observedAt: null,
        evidence: {
          messageContentIntentEnabled: false,
          approvedChannelReplyReturned: false,
          botEchoSuppressed: false,
          reconnectStatusVisible: false,
        },
        notes: [
          'Replace manual-required with pass only after a real approved channel or DM reply, echo suppression, and reconnect status are verified.',
        ],
      },
    ],
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toOptionalIsoTimestamp(value, fieldName) {
  if (value == null || value === '') return null
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${fieldName}: ${value}`)
  }
  return new Date(parsed).toISOString()
}

function normalizeLiveEvidenceNote(value) {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 1000)
}

function isPlaceholderLiveEvidenceValue(value) {
  const normalized = normalizeLiveEvidenceNote(value)
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
    || compact === 'REPLACE_WITH_REAL_APP'
    || compact === 'TBD'
    || compact === 'TODO'
    || compact === 'UNKNOWN'
    || compact === 'N_A'
}

function normalizeOptionalPositiveInteger(value, fieldName) {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`)
  }
  return Math.floor(parsed)
}

function normalizeOptionalLiveDiagnostics(evidence, id) {
  const normalized = { ...evidence }
  const updateOffset = normalizeOptionalPositiveInteger(normalized.updateOffset, `${id}.updateOffset`)
  if (updateOffset == null) delete normalized.updateOffset
  else normalized.updateOffset = updateOffset

  const lastReconnectAt = toOptionalIsoTimestamp(normalized.lastReconnectAt, `${id}.lastReconnectAt`)
  if (lastReconnectAt == null) delete normalized.lastReconnectAt
  else normalized.lastReconnectAt = lastReconnectAt

  const lastReconnectReason = normalizeLiveEvidenceNote(normalized.lastReconnectReason)
  if (!lastReconnectReason) delete normalized.lastReconnectReason
  else normalized.lastReconnectReason = lastReconnectReason

  const lastOutboundAt = toOptionalIsoTimestamp(normalized.lastOutboundAt, `${id}.lastOutboundAt`)
  if (lastOutboundAt == null) delete normalized.lastOutboundAt
  else normalized.lastOutboundAt = lastOutboundAt

  const lastOutboundKind = normalizeLiveEvidenceNote(normalized.lastOutboundKind)
  if (!lastOutboundKind) delete normalized.lastOutboundKind
  else normalized.lastOutboundKind = lastOutboundKind

  const lastOutboundTarget = normalizeLiveEvidenceNote(normalized.lastOutboundTarget)
  if (!lastOutboundTarget) delete normalized.lastOutboundTarget
  else normalized.lastOutboundTarget = lastOutboundTarget

  const lastOutboundError = normalizeLiveEvidenceNote(normalized.lastOutboundError)
  if (!lastOutboundError) delete normalized.lastOutboundError
  else normalized.lastOutboundError = lastOutboundError

  return normalized
}

function satisfiesPassRequirement(evidence, requirement) {
  const value = evidence[requirement.field]
  if (requirement.type === 'true') return value === true
  if (requirement.type === 'non-empty-string') {
    return cleanString(value).length > 0 && !isPlaceholderLiveEvidenceValue(value)
  }
  if (requirement.type === 'iso-timestamp') return cleanString(value).length > 0 && Number.isFinite(Date.parse(String(value)))
  if (requirement.type === 'concrete-notes') {
    return Array.isArray(value) && value.some((note) => {
      const normalized = normalizeLiveEvidenceNote(note)
      return normalized
        && !isLiveTemplateGuidanceNote(normalized)
        && !isPlaceholderLiveEvidenceValue(normalized)
    })
  }
  return false
}

function validateLiveEvidenceStatus(id, status, evidence) {
  const requirements = LIVE_CHECK_PASS_REQUIREMENTS[id] ?? []
  if (status === 'pass') {
    const missing = requirements
      .filter((requirement) => !satisfiesPassRequirement(evidence, requirement))
      .map((requirement) => `${requirement.field} (${requirement.description})`)
    if (missing.length) {
      throw new Error(`Live evidence check ${id} cannot pass without: ${missing.join(', ')}`)
    }
  }

  if (status === 'fail' && !Array.isArray(evidence.notes)) {
    throw new Error(`Live evidence check ${id} failed but has no notes`)
  }

  if (status === 'fail' && evidence.notes.length === 0) {
    throw new Error(`Live evidence check ${id} failed but has no notes`)
  }
}

export function normalizeLiveEvidenceChecks(raw) {
  if (raw == null) return []
  let checks = []
  if (Array.isArray(raw)) {
    checks = raw
  } else if (Array.isArray(raw.checks)) {
    checks = raw.checks
  } else if (isPlainObject(raw.checks)) {
    checks = Object.entries(raw.checks).map(([id, value]) => {
      if (!isPlainObject(value)) {
        throw new Error(`Live evidence check ${id} must be an object`)
      }
      return { id, ...value }
    })
  }

  if (!checks.length) return []

  return checks.map((check, index) => {
    if (!isPlainObject(check)) {
      throw new Error(`Live evidence check at index ${index} must be an object`)
    }
    const id = cleanString(check.id)
    if (!LIVE_CHECK_IDS.has(id)) {
      throw new Error(`Unsupported live evidence check id: ${id || `(index ${index})`}`)
    }
    const status = cleanString(check.status || 'pass')
    if (!LIVE_CHECK_STATUS.has(status)) {
      throw new Error(`Unsupported live evidence status for ${id}: ${status}`)
    }
    const evidence = normalizeOptionalLiveDiagnostics(
      isPlainObject(check.evidence) ? check.evidence : {},
      id,
    )
    const rawNotes = check.notes ?? evidence.notes
    const notes = Array.isArray(rawNotes)
      ? rawNotes.map(normalizeLiveEvidenceNote).filter(Boolean)
      : normalizeLiveEvidenceNote(rawNotes)
        ? [normalizeLiveEvidenceNote(rawNotes)]
        : []

    const normalized = {
      id,
      status,
      evidence: {
        ...evidence,
        observedAt: toOptionalIsoTimestamp(check.observedAt ?? evidence.observedAt, `${id}.observedAt`),
        operator: normalizeLiveEvidenceNote(check.operator ?? evidence.operator) || null,
        notes,
      },
    }
    validateLiveEvidenceStatus(id, status, normalized.evidence)
    return normalized
  })
}

function publicLiveEvidenceFields(evidence) {
  const publicEvidence = { ...(evidence ?? {}) }
  delete publicEvidence.observedAt
  delete publicEvidence.operator
  delete publicEvidence.notes
  return publicEvidence
}

export function buildMessageAwarenessLiveEvidenceAudit(raw, options = {}) {
  const gateVersion = normalizeGateVersion(options.gateVersion)
  const normalizedChecks = normalizeLiveEvidenceChecks(raw)
  const byId = new Map(normalizedChecks.map((check) => [check.id, check]))
  const checks = [...LIVE_CHECK_IDS].map((id) => {
    const current = byId.get(id)
    const evidence = current?.evidence ?? {
      observedAt: null,
      operator: null,
      notes: [],
    }
    const passEvidenceRequired = LIVE_CHECK_PASS_REQUIREMENTS[id] ?? []
    const missingProofFields = passEvidenceRequired
      .filter((requirement) => !satisfiesPassRequirement(evidence, requirement))
      .map((requirement) => ({ ...requirement }))

    return {
      id,
      status: current?.status ?? 'manual-required',
      observedAt: evidence.observedAt ?? null,
      operator: evidence.operator ?? null,
      evidence: publicLiveEvidenceFields(evidence),
      notes: Array.isArray(evidence.notes) ? evidence.notes : [],
      passEvidenceRequired: passEvidenceRequired.map((requirement) => ({ ...requirement })),
      missingProofFields,
    }
  })
  const failedCheckIds = checks
    .filter((check) => check.status === 'fail')
    .map((check) => check.id)
  const pendingCheckIds = checks
    .filter((check) => check.status !== 'pass')
    .map((check) => check.id)
  const liveGateComplete = pendingCheckIds.length === 0
  const overallStatus = failedCheckIds.length
    ? 'live-check-failed'
    : liveGateComplete
      ? 'pass'
      : 'live-check-pending'

  return {
    schemaVersion: 1,
    gate: messageAwarenessLiveGateName(gateVersion),
    generatedAt: new Date().toISOString(),
    overallStatus,
    liveGateComplete,
    passedCount: checks.filter((check) => check.status === 'pass').length,
    totalCount: checks.length,
    pendingCheckIds,
    failedCheckIds,
    checks,
  }
}

function normalizeEvidenceCheckId(value) {
  return cleanString(value)
}

function findEvidenceCheck(raw, id) {
  if (!Array.isArray(raw?.checks)) return null
  const found = raw.checks.find((check) => (
    isPlainObject(check) && normalizeEvidenceCheckId(check.id) === id
  ))
  return isPlainObject(found) ? found : null
}

function summarizeLocalWebhookCheck(raw) {
  const check = findEvidenceCheck(raw, 'local-webhook-injection')
  const status = cleanString(check?.status || (check ? 'not-run' : 'missing'))
  const evidence = isPlainObject(check?.evidence) ? check.evidence : {}
  return {
    id: 'local-webhook-injection',
    status,
    pass: status === 'pass',
    hasPayload: isPlainObject(evidence.payload),
    hasResponse: evidence.response != null,
    error: evidence.error == null ? null : String(evidence.error),
  }
}

function cloneJson(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

function redactLocalWebhookPayload(payload) {
  if (!isPlainObject(payload)) return payload
  return {
    redacted: true,
    kind: cleanString(payload.kind) || 'message',
  }
}

function redactLocalWebhookResponse(response) {
  if (response == null) return response
  if (!isPlainObject(response)) {
    return {
      redacted: true,
      present: true,
    }
  }
  return {
    redacted: true,
    ok: response.ok === true,
  }
}

function redactLiveEvidenceObject(evidence) {
  if (!isPlainObject(evidence)) return evidence
  const redacted = { ...evidence }
  if ('operator' in redacted) redacted.operator = redacted.operator ? 'redacted' : null
  if ('lastOutboundTarget' in redacted) {
    redacted.lastOutboundTarget = redacted.lastOutboundTarget ? 'redacted' : null
  }
  if ('lastOutboundError' in redacted) {
    redacted.lastOutboundError = redacted.lastOutboundError ? 'redacted' : null
  }
  if (Array.isArray(redacted.notes)) {
    redacted.notes = redacted.notes.length ? ['redacted'] : []
  } else if (redacted.notes != null) {
    redacted.notes = ['redacted']
  }
  return redacted
}

function redactEvidenceCheck(check) {
  if (!isPlainObject(check)) return check
  const redacted = { ...check }
  if (redacted.id === 'local-webhook-injection' && isPlainObject(redacted.evidence)) {
    redacted.evidence = {
      ...redacted.evidence,
      payload: redactLocalWebhookPayload(redacted.evidence.payload),
      response: redactLocalWebhookResponse(redacted.evidence.response),
      error: redacted.evidence.error == null ? null : 'redacted',
      redacted: true,
    }
    return redacted
  }

  if (LIVE_CHECK_IDS.has(redacted.id)) {
    if ('operator' in redacted) redacted.operator = redacted.operator ? 'redacted' : null
    if (Array.isArray(redacted.notes)) {
      redacted.notes = redacted.notes.length ? ['redacted'] : []
    } else if (redacted.notes != null) {
      redacted.notes = ['redacted']
    }
    redacted.evidence = redactLiveEvidenceObject(redacted.evidence)
  }
  return redacted
}

export function redactMessageAwarenessEvidence(raw) {
  const redacted = cloneJson(raw)
  if (!isPlainObject(redacted)) {
    throw new Error('Message-awareness evidence report must be a JSON object')
  }
  buildMessageAwarenessGateEvidenceAudit(redacted)

  redacted.redacted = true
  redacted.redaction = {
    schemaVersion: 1,
    strategy: 'Private webhook payload fields, webhook response ids, live-check operators, notes, outbound targets, and outbound send errors are redacted; gate proof booleans and safe diagnostics are preserved.',
  }
  if (Array.isArray(redacted.checks)) {
    redacted.checks = redacted.checks.map(redactEvidenceCheck)
  }
  return redacted
}

export function buildMessageAwarenessGateEvidenceAudit(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('Message-awareness evidence report must be a JSON object')
  }

  const gate = cleanString(raw.gate)
  const gateVersion = parseMessageAwarenessGateVersion(gate)
  if (!gateVersion) {
    throw new Error(`Unsupported message-awareness evidence gate: ${gate || '(missing)'}`)
  }

  const localWebhook = summarizeLocalWebhookCheck(raw)
  const liveRaw = [...LIVE_CHECK_IDS].map((id) => findEvidenceCheck(raw, id) ?? {
    id,
    status: 'manual-required',
  })
  const liveEvidence = buildMessageAwarenessLiveEvidenceAudit(liveRaw, { gateVersion })
  const reportedReleaseGateComplete = raw.releaseGateComplete === true
  const computedReleaseGateComplete = localWebhook.pass && liveEvidence.liveGateComplete
  const inconsistencies = []
  if (reportedReleaseGateComplete !== computedReleaseGateComplete) {
    inconsistencies.push(
      `releaseGateComplete is ${reportedReleaseGateComplete} but recomputed value is ${computedReleaseGateComplete}`,
    )
  }

  const missingCheckIds = []
  if (localWebhook.status === 'missing') missingCheckIds.push('local-webhook-injection')
  for (const id of LIVE_CHECK_IDS) {
    if (!findEvidenceCheck(raw, id)) missingCheckIds.push(id)
  }

  const releaseGateComplete = computedReleaseGateComplete && inconsistencies.length === 0
  const overallStatus = inconsistencies.length
    ? 'evidence-inconsistent'
    : !localWebhook.pass
      ? 'local-webhook-pending'
      : liveEvidence.overallStatus

  return {
    schemaVersion: 1,
    gate: messageAwarenessGateName(gateVersion),
    generatedAt: new Date().toISOString(),
    evidenceGeneratedAt: toOptionalIsoTimestamp(raw.generatedAt, 'generatedAt'),
    mode: cleanString(raw.mode) || null,
    reportedOverallStatus: cleanString(raw.overallStatus) || null,
    reportedReleaseGateComplete,
    computedReleaseGateComplete,
    releaseGateComplete,
    overallStatus,
    missingCheckIds,
    inconsistencies,
    localWebhook,
    liveEvidence,
  }
}

async function readJsonFileForGate(resolvedPath, { missingMessage }) {
  try {
    return JSON.parse(await fs.readFile(resolvedPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(missingMessage)
    }
    throw error
  }
}

async function readLiveEvidenceFile(filePath) {
  const target = cleanString(filePath)
  if (!target) return []
  const resolved = path.resolve(process.cwd(), target)
  const raw = await readJsonFileForGate(resolved, {
    missingMessage: `Live evidence file is missing: ${target}. Create the live evidence template first, then record real macOS, Telegram, and Discord checks before the live gate can pass.`,
  })
  return normalizeLiveEvidenceChecks(raw)
}

function applyLiveEvidence(checks, liveEvidenceChecks) {
  if (!liveEvidenceChecks.length) return checks
  const byId = new Map(liveEvidenceChecks.map((check) => [check.id, check]))
  return checks.map((check) => {
    const live = byId.get(check.id)
    if (!live) return check
    return {
      ...check,
      status: live.status,
      evidence: live.evidence,
    }
  })
}

function resolveOverallStatus(mode, checks) {
  if (mode === 'failed') return 'failed'
  if (mode === 'dry-run') return 'dry-run-live-pending'
  if (checks.some((check) => check.status === 'fail')) return 'live-check-failed'
  if (checks.every((check) => check.status === 'pass')) return 'pass'
  return 'local-webhook-pass-live-pending'
}

export function buildMessageAwarenessEvidence({
  mode,
  payload,
  response = null,
  nextChecks = buildNextChecks(),
  startedAt = new Date(),
  completedAt = new Date(),
  error = null,
  liveEvidenceChecks = [],
  gateVersion = DEFAULT_GATE_VERSION,
} = {}) {
  const normalizedGateVersion = normalizeGateVersion(gateVersion)
  const startedIso = new Date(startedAt).toISOString()
  const completedIso = new Date(completedAt).toISOString()
  const failed = mode === 'failed'
  const dryRun = mode === 'dry-run'
  const localStatus = failed ? 'fail' : dryRun ? 'not-run' : 'pass'
  const checks = applyLiveEvidence([
    {
      id: 'local-webhook-injection',
      label: 'Local webhook injection',
      status: localStatus,
      evidence: {
        payload,
        response,
        error: error ? String(error?.message ?? error) : null,
      },
    },
    buildManualCheck('macos-notification-center-live', 'macOS Notification Center live message awareness', [
      'Full Disk Access granted to the running Nexus host',
      'one real app notification observed once in Nexus',
      'restart confirms the old notification is not replayed',
    ]),
    buildManualCheck('telegram-live-bridge', 'Telegram live bridge', [
      'real BotFather token configured',
      'owner pairing code approved in desktop settings',
      'owner text reply and reconnect no-replay verified',
    ]),
    buildManualCheck('discord-live-bridge', 'Discord live bridge', [
      'real Discord bot token and Message Content Intent configured',
      'approved channel or DM receives a companion reply',
      'bot echo suppression and reconnect status verified',
    ]),
  ], liveEvidenceChecks)
  const overallStatus = resolveOverallStatus(mode, checks)

  return {
    schemaVersion: 1,
    gate: messageAwarenessGateName(normalizedGateVersion),
    generatedAt: completedIso,
    startedAt: startedIso,
    completedAt: completedIso,
    mode,
    overallStatus,
    releaseGateComplete: overallStatus === 'pass',
    caveat: 'This report validates only the local webhook path unless the manual live checks are attached separately.',
    checks,
    nextChecks,
  }
}

export function mergeMessageAwarenessEvidence(raw, liveEvidenceChecks = [], {
  completedAt = new Date(),
  gateVersion = '',
} = {}) {
  if (!isPlainObject(raw)) {
    throw new Error('Message-awareness evidence report must be a JSON object')
  }
  buildMessageAwarenessGateEvidenceAudit(raw)
  const sourceGateVersion = parseMessageAwarenessGateVersion(raw.gate)
  const outputGateVersion = normalizeGateVersion(gateVersion || sourceGateVersion)

  const existingChecks = Array.isArray(raw.checks) ? raw.checks : []
  const byId = new Map(existingChecks
    .filter((check) => isPlainObject(check) && normalizeEvidenceCheckId(check.id))
    .map((check) => [normalizeEvidenceCheckId(check.id), check]))

  const baseChecks = [
    byId.get('local-webhook-injection') ?? {
      id: 'local-webhook-injection',
      label: 'Local webhook injection',
      status: 'missing',
      evidence: {
        payload: null,
        response: null,
        error: 'missing local webhook evidence',
      },
    },
    byId.get('macos-notification-center-live')
      ?? buildManualCheck('macos-notification-center-live', 'macOS Notification Center live message awareness', [
        'Full Disk Access granted to the running Nexus host',
        'one real app notification observed once in Nexus',
        'restart confirms the old notification is not replayed',
      ]),
    byId.get('telegram-live-bridge')
      ?? buildManualCheck('telegram-live-bridge', 'Telegram live bridge', [
        'real BotFather token configured',
        'owner pairing code approved in desktop settings',
        'owner text reply and reconnect no-replay verified',
      ]),
    byId.get('discord-live-bridge')
      ?? buildManualCheck('discord-live-bridge', 'Discord live bridge', [
        'real Discord bot token and Message Content Intent configured',
        'approved channel or DM receives a companion reply',
        'bot echo suppression and reconnect status verified',
      ]),
  ]
  const checks = applyLiveEvidence(baseChecks, liveEvidenceChecks)
  const mode = cleanString(raw.mode) || 'local-webhook'
  const completedIso = new Date(completedAt).toISOString()
  const overallStatus = resolveOverallStatus(mode, checks)
  const merged = {
    ...cloneJson(raw),
    gate: messageAwarenessGateName(outputGateVersion),
    generatedAt: completedIso,
    completedAt: completedIso,
    overallStatus,
    releaseGateComplete: overallStatus === 'pass',
    checks,
  }

  buildMessageAwarenessGateEvidenceAudit(merged)
  return merged
}

async function writeEvidenceFile(filePath, evidence) {
  const target = cleanString(filePath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}

async function writeLiveEvidenceTemplate(filePath, { force = false } = {}) {
  const target = cleanString(filePath)
  if (!target) return ''
  const resolved = path.resolve(process.cwd(), target)
  if (!force) {
    try {
      await fs.access(resolved)
      throw new Error(
        `Live evidence template already exists at ${target}. `
          + 'Pass --force-live-template only if you intentionally want to replace it.',
      )
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  const template = buildMessageAwarenessLiveEvidenceTemplate()
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(template, null, 2)}\n`, 'utf8')
  return resolved
}

function parseLiveEvidenceValue(value) {
  const text = String(value ?? '').trim()
  if (/^true$/i.test(text)) return true
  if (/^false$/i.test(text)) return false
  if (/^null$/i.test(text)) return null
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function parseLiveEvidencePair(pair) {
  const text = String(pair ?? '')
  const eq = text.indexOf('=')
  if (eq <= 0) {
    throw new Error(`Live evidence field must use key=value: ${text || '(empty)'}`)
  }
  const key = text.slice(0, eq).trim()
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid live evidence field name: ${key || '(empty)'}`)
  }
  return [key, parseLiveEvidenceValue(text.slice(eq + 1))]
}

function denormalizeLiveEvidenceCheck(check) {
  const evidence = { ...(check.evidence ?? {}) }
  const observedAt = evidence.observedAt ?? null
  const operator = evidence.operator ?? null
  const notes = Array.isArray(evidence.notes) ? evidence.notes : []
  delete evidence.observedAt
  delete evidence.operator
  delete evidence.notes
  return {
    id: check.id,
    status: check.status,
    observedAt,
    operator,
    evidence,
    notes,
  }
}

function isLiveTemplateGuidanceNote(note) {
  return /^Replace manual-required with pass only after\b/.test(String(note ?? '').trim())
}

async function readLiveEvidenceTemplateOrFile(filePath) {
  const target = cleanString(filePath)
  if (!target) {
    throw new Error('--record-live-check requires --live-evidence-file <path>')
  }
  const resolved = path.resolve(process.cwd(), target)
  try {
    return {
      resolved,
      checks: normalizeLiveEvidenceChecks(JSON.parse(await fs.readFile(resolved, 'utf8'))),
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return {
      resolved,
      checks: normalizeLiveEvidenceChecks(buildMessageAwarenessLiveEvidenceTemplate()),
    }
  }
}

async function recordLiveEvidenceCheck(filePath, validation) {
  const id = cleanString(validation.recordLiveCheckId)
  if (!LIVE_CHECK_IDS.has(id)) {
    throw new Error(`Unsupported live evidence check id: ${id || '(empty)'}`)
  }

  const status = cleanString(validation.recordLiveStatus || 'pass')
  if (!LIVE_CHECK_STATUS.has(status)) {
    throw new Error(`Unsupported live evidence status for ${id}: ${status}`)
  }

  const { resolved, checks } = await readLiveEvidenceTemplateOrFile(filePath)
  const byId = new Map(checks.map((check) => [check.id, check]))
  const current = byId.get(id) ?? {
    id,
    status: 'manual-required',
    evidence: {
      observedAt: null,
      operator: null,
      notes: [],
    },
  }
  const evidence = { ...(current.evidence ?? {}) }

  if (validation.recordObservedAt) {
    evidence.observedAt = toOptionalIsoTimestamp(validation.recordObservedAt, `${id}.observedAt`)
  } else if (!evidence.observedAt && status !== 'manual-required') {
    evidence.observedAt = new Date().toISOString()
  }

  const operator = normalizeLiveEvidenceNote(validation.recordOperator)
  if (operator) evidence.operator = operator

  for (const pair of validation.recordEvidencePairs) {
    const [field, value] = parseLiveEvidencePair(pair)
    evidence[field] = value
  }

  const existingNotes = status === 'manual-required'
    ? (Array.isArray(evidence.notes) ? evidence.notes : [])
    : (Array.isArray(evidence.notes) ? evidence.notes.filter((note) => !isLiveTemplateGuidanceNote(note)) : [])
  const notes = [
    ...existingNotes,
    ...validation.recordNotes.map(normalizeLiveEvidenceNote).filter(Boolean),
  ]
  evidence.notes = [...new Set(notes)]

  const nextCheck = normalizeLiveEvidenceChecks([{
    id,
    status,
    evidence,
    notes: evidence.notes,
  }])[0]
  byId.set(id, nextCheck)

  const orderedChecks = [...LIVE_CHECK_IDS].map((checkId) => byId.get(checkId)).filter(Boolean)
  const output = {
    checks: orderedChecks.map(denormalizeLiveEvidenceCheck),
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  return {
    resolved,
    check: denormalizeLiveEvidenceCheck(nextCheck),
    evidence: output,
  }
}

async function checkLiveEvidenceFile(filePath) {
  const target = cleanString(filePath)
  if (!target) {
    throw new Error('--check-live-evidence requires a file path')
  }
  const resolved = path.resolve(process.cwd(), target)
  const raw = await readJsonFileForGate(resolved, {
    missingMessage: `Live evidence file is missing: ${target}. Create the live evidence template first, then record real macOS, Telegram, and Discord checks before the live gate can pass.`,
  })
  return {
    resolved,
    audit: buildMessageAwarenessLiveEvidenceAudit(raw, {
      gateVersion: inferGateVersionFromPathOrDefault(target),
    }),
  }
}

async function checkGateEvidenceFile(filePath) {
  const target = cleanString(filePath)
  if (!target) {
    throw new Error('--check-evidence-file requires a file path')
  }
  const resolved = path.resolve(process.cwd(), target)
  const raw = await readJsonFileForGate(resolved, {
    missingMessage: `Release evidence file is missing: ${target}. Generate local webhook evidence and attach live evidence before running the release gate again.`,
  })
  return {
    resolved,
    audit: buildMessageAwarenessGateEvidenceAudit(raw),
  }
}

async function mergeGateEvidenceFile(inputPath, liveEvidencePath, outputPath, context = {}) {
  const target = cleanString(inputPath)
  if (!target) {
    throw new Error('--merge-evidence-file requires a file path')
  }
  if (!cleanString(liveEvidencePath)) {
    throw new Error('--merge-evidence-file requires --live-evidence-file <path>')
  }
  const outputTarget = cleanString(outputPath)
  if (!outputTarget) {
    throw new Error('--merge-evidence-file requires --evidence-file <output-path>')
  }

  const resolved = path.resolve(process.cwd(), target)
  const raw = await readJsonFileForGate(resolved, {
    missingMessage: `Local message-awareness evidence file is missing: ${target}. Generate local webhook evidence first, then record live evidence before merging.`,
  })
  const liveEvidenceChecks = await readLiveEvidenceFile(liveEvidencePath)
  const evidence = mergeMessageAwarenessEvidence(raw, liveEvidenceChecks, {
    completedAt: context.completedAt ?? context.now ?? new Date(),
    gateVersion: inferGateVersionFromPath(outputTarget),
  })
  const outputResolved = path.resolve(process.cwd(), outputTarget)
  await writeEvidenceFile(outputResolved, evidence)
  return {
    resolved,
    outputResolved,
    evidence,
    audit: buildMessageAwarenessGateEvidenceAudit(evidence),
  }
}

async function redactGateEvidenceFile(inputPath, outputPath) {
  const target = cleanString(inputPath)
  if (!target) {
    throw new Error('--redact-evidence-file requires a file path')
  }
  const resolved = path.resolve(process.cwd(), target)
  const raw = await readJsonFileForGate(resolved, {
    missingMessage: `Release evidence file is missing: ${target}. Generate local webhook evidence and attach live evidence before writing a redacted release copy.`,
  })
  const redacted = redactMessageAwarenessEvidence(raw)
  const audit = buildMessageAwarenessGateEvidenceAudit(redacted)
  if (!audit.releaseGateComplete) {
    const pending = audit.liveEvidence?.pendingCheckIds?.length
      ? `; pending=${audit.liveEvidence.pendingCheckIds.join(', ')}`
      : ''
    throw new Error(
      `Cannot write redacted release evidence until the release gate is complete: ${audit.overallStatus}${pending}`,
    )
  }
  const redactedTarget = cleanString(outputPath)
  const redactedResolved = redactedTarget
    ? path.resolve(process.cwd(), redactedTarget)
    : ''
  if (redactedResolved) {
    await writeEvidenceFile(redactedResolved, redacted)
  }
  return {
    resolved,
    redactedResolved,
    evidence: redacted,
    audit,
  }
}

export async function runMessageAwarenessValidation(argv = process.argv.slice(2), context = {}) {
  const { validation, webhook: parsed } = parseMessageAwarenessValidationArgs(argv)
  if (parsed.help) {
    printUsage(process.stdout)
    return 0
  }

  if (validation.requireLiveComplete && !validation.liveCheckFile) {
    throw new Error('--require-live-complete requires --check-live-evidence <path>')
  }
  if (validation.requireReleaseComplete && !validation.evidenceCheckFile) {
    throw new Error('--require-release-complete requires --check-evidence-file <path>')
  }
  if (validation.redactedOutputFile && !validation.redactEvidenceFile) {
    throw new Error('--redacted-output-file requires --redact-evidence-file <path>')
  }
  if (validation.mergeEvidenceFile && !validation.evidenceFile) {
    throw new Error('--merge-evidence-file requires --evidence-file <output-path>')
  }

  if (validation.liveTemplateFile) {
    const resolved = await writeLiveEvidenceTemplate(validation.liveTemplateFile, {
      force: validation.forceLiveTemplate,
    })
    const template = buildMessageAwarenessLiveEvidenceTemplate()
    process.stdout.write(`${JSON.stringify({
      ok: true,
      liveEvidenceFile: validation.liveTemplateFile,
      resolvedPath: resolved,
      template,
    }, null, 2)}\n`)
    return 0
  }

  if (validation.liveCheckFile) {
    const result = await checkLiveEvidenceFile(validation.liveCheckFile)
    const ok = !validation.requireLiveComplete || result.audit.liveGateComplete
    process.stdout.write(`${JSON.stringify({
      ok,
      liveEvidenceFile: validation.liveCheckFile,
      resolvedPath: result.resolved,
      audit: result.audit,
    }, null, 2)}\n`)
    return ok ? 0 : 2
  }

  if (validation.evidenceCheckFile) {
    const result = await checkGateEvidenceFile(validation.evidenceCheckFile)
    const ok = !validation.requireReleaseComplete || result.audit.releaseGateComplete
    process.stdout.write(`${JSON.stringify({
      ok,
      evidenceFile: validation.evidenceCheckFile,
      resolvedPath: result.resolved,
      audit: result.audit,
    }, null, 2)}\n`)
    return ok ? 0 : 2
  }

  if (validation.mergeEvidenceFile) {
    const result = await mergeGateEvidenceFile(
      validation.mergeEvidenceFile,
      validation.liveEvidenceFile,
      validation.evidenceFile,
      context,
    )
    process.stdout.write(`${JSON.stringify({
      ok: true,
      evidenceFile: validation.evidenceFile,
      resolvedPath: result.outputResolved,
      mergedFrom: validation.mergeEvidenceFile,
      mergedFromResolvedPath: result.resolved,
      liveEvidenceFile: validation.liveEvidenceFile,
      audit: result.audit,
      evidence: result.evidence,
    }, null, 2)}\n`)
    return 0
  }

  if (validation.redactEvidenceFile) {
    const result = await redactGateEvidenceFile(validation.redactEvidenceFile, validation.redactedOutputFile)
    process.stdout.write(`${JSON.stringify({
      ok: true,
      evidenceFile: validation.redactEvidenceFile,
      resolvedPath: result.resolved,
      redactedOutputFile: validation.redactedOutputFile || null,
      redactedResolvedPath: result.redactedResolved || null,
      audit: result.audit,
      evidence: result.evidence,
    }, null, 2)}\n`)
    return 0
  }

  if (validation.recordLiveCheckId) {
    const result = await recordLiveEvidenceCheck(validation.liveEvidenceFile, validation)
    process.stdout.write(`${JSON.stringify({
      ok: true,
      liveEvidenceFile: validation.liveEvidenceFile,
      resolvedPath: result.resolved,
      check: result.check,
      evidence: result.evidence,
    }, null, 2)}\n`)
    return 0
  }

  const startedAt = context.startedAt ?? context.now ?? new Date()
  const options = withValidationDefaults(parsed, context)
  const payload = buildMessageWebhookPayload(options, context)
  const nextChecks = buildNextChecks()
  const liveEvidenceChecks = await readLiveEvidenceFile(validation.liveEvidenceFile)
  const outputGateVersion = inferGateVersionFromPathOrDefault(validation.evidenceFile)

  if (options.dryRun) {
    const evidence = buildMessageAwarenessEvidence({
      mode: 'dry-run',
      payload,
      nextChecks,
      startedAt,
      completedAt: context.completedAt ?? context.now ?? new Date(),
      liveEvidenceChecks,
      gateVersion: outputGateVersion,
    })
    await writeEvidenceFile(validation.evidenceFile, evidence)
    process.stdout.write(`${JSON.stringify({ payload, nextChecks, evidence }, null, 2)}\n`)
    return 0
  }

  try {
    const token = await readWebhookToken(options, context)
    const response = await postMessageWebhookPayload(payload, {
      url: options.url,
      token,
    })
    const evidence = buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload,
      response,
      nextChecks,
      startedAt,
      completedAt: context.completedAt ?? new Date(),
      liveEvidenceChecks,
      gateVersion: outputGateVersion,
    })
    await writeEvidenceFile(validation.evidenceFile, evidence)

    process.stdout.write(`${JSON.stringify({
      ok: true,
      response,
      payload,
      nextChecks,
      evidence,
    }, null, 2)}\n`)
  } catch (error) {
    const evidence = buildMessageAwarenessEvidence({
      mode: 'failed',
      payload,
      nextChecks,
      startedAt,
      completedAt: context.completedAt ?? new Date(),
      error,
      liveEvidenceChecks,
      gateVersion: outputGateVersion,
    })
    await writeEvidenceFile(validation.evidenceFile, evidence)
    throw error
  }

  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMessageAwarenessValidation().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
