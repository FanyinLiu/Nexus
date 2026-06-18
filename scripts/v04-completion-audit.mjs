#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildV04ReadinessStatusReport,
  DEFAULT_V04_ARTIFACT_DIR,
  DEFAULT_V04_COMPLETE_EVIDENCE_FILE,
  DEFAULT_V04_LIVE_EVIDENCE_FILE,
  DEFAULT_V04_LIVE_PREFLIGHT_FILE,
  DEFAULT_V04_LIVE_SESSION_FILE,
  DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE,
  DEFAULT_V04_LOCAL_EVIDENCE_FILE,
  DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
  DEFAULT_V04_REDACTED_OUTPUT_FILE,
  summarizeNextCommandAutomation,
} from './v04-readiness-status.mjs'

export const V04_COMPLETION_AUDIT_GATE = 'nexus-v04-completion-audit'

const DEFAULT_PRIVACY_SAFETY_FILE = 'artifacts/v0.3.4/privacy-safety.json'

const REQUIRED_COMPANION_READINESS_ITEMS = [
  'standard_companion',
  'presence_state',
  'text_model',
  'microphone',
  'tts',
  'live2d',
  'notification_permission',
  'local_webhook',
  'privacy_boundary',
]

const REQUIRED_MEMORY_MAP_CHECKS = [
  'has-long-term-memories',
  'has-daily-entries',
  'has-graph-nodes',
  'has-graph-edges',
  'has-source-ref-edges',
  'has-openable-source-refs',
  'has-relationship-timeline',
  'has-relationship-state-summary',
  'has-recall-governance',
  'has-core-node-kinds',
]

const REQUIRED_PROACTIVE_CARE_CHECKS = [
  'has-all-sources-observed',
  'has-v2-policy-events',
  'has-user-visible-reasons',
  'has-user-feedback-actions',
  'has-openable-source-ref-coverage',
]

const REQUIRED_LIVE2D_CHECKS = [
  'model-available',
  'expressions-covered',
  'gestures-covered',
  'lifecycle-covered',
  'presence-states-covered',
  'no-missing-live2d-targets',
]

const REQUIRED_PRIVACY_SAFETY_CHECKS = [
  'ai-companion-disclosure',
  'crisis-response-support',
  'age-and-market-boundaries',
]

const REQUIRED_LIVE_MESSAGE_CHECKS = [
  'macos-notification-center-live',
  'telegram-live-bridge',
  'discord-live-bridge',
]

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/v04-completion-audit.mjs [options]',
    '',
    'Builds a private-safe requirement-level audit for the v0.4 desktop emotional companion plan.',
    '',
    'Options:',
    `  --artifact-dir <path>             Directory containing v0.4 stabilization artifacts (default: ${DEFAULT_V04_ARTIFACT_DIR})`,
    '  --generated-at <iso>              Override report timestamp',
    `  --local-evidence-file <path>      Message-awareness local evidence file (default: ${DEFAULT_V04_LOCAL_EVIDENCE_FILE})`,
    `  --live-evidence-file <path>       Message-awareness live evidence file (default: ${DEFAULT_V04_LIVE_EVIDENCE_FILE})`,
    `  --live-preflight-file <path>      Message-awareness live preflight report (default: ${DEFAULT_V04_LIVE_PREFLIGHT_FILE})`,
    `  --live-session-file <path>         Message live-session checklist report (default: ${DEFAULT_V04_LIVE_SESSION_FILE})`,
    `  --live-session-markdown-file <path> Message live-session Markdown operator packet (default: ${DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE})`,
    `  --macos-live-probe-file <path>    macOS live probe report (default: ${DEFAULT_V04_MACOS_LIVE_PROBE_FILE})`,
    `  --complete-evidence-file <path>   Message-awareness merged release evidence file (default: ${DEFAULT_V04_COMPLETE_EVIDENCE_FILE})`,
    `  --redacted-output-file <path>     Commit-safe redacted evidence output (default: ${DEFAULT_V04_REDACTED_OUTPUT_FILE})`,
    `  --privacy-safety-file <path>      Privacy/safety evidence file (default: <artifact-dir>/privacy-safety.json)`,
    '  --output <path>                   Write the private-safe audit JSON to a file',
    '  --require-complete                Exit non-zero unless every requirement is complete',
    '  --verify-release-ran              Assert npm run verify:release already ran in this release-gate chain',
    '  --help                           Show this help',
    '',
    'Examples:',
    '  npm run v04:completion:audit',
    '  npm run v04:completion:audit -- --require-complete',
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
    case '--artifact-dir':
    case '--artifacts-dir':
    case '--input-dir':
      options.artifactDir = value
      return
    case '--generated-at':
      options.generatedAt = value
      return
    case '--local-evidence-file':
      options.localEvidenceFile = value
      return
    case '--live-evidence-file':
      options.liveEvidenceFile = value
      return
    case '--live-preflight-file':
      options.livePreflightFile = value
      return
    case '--live-session-file':
    case '--message-live-session-file':
      options.liveSessionFile = value
      return
    case '--live-session-markdown-file':
    case '--message-live-session-markdown-file':
    case '--operator-packet-file':
      options.liveSessionMarkdownFile = value
      return
    case '--macos-live-probe-file':
      options.macosLiveProbeFile = value
      return
    case '--complete-evidence-file':
      options.completeEvidenceFile = value
      return
    case '--redacted-output-file':
      options.redactedOutputFile = value
      return
    case '--privacy-safety-file':
      options.privacySafetyFile = value
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

export function parseV04CompletionAuditArgs(argv) {
  const options = {
    artifactDir: DEFAULT_V04_ARTIFACT_DIR,
    completeEvidenceFile: DEFAULT_V04_COMPLETE_EVIDENCE_FILE,
    generatedAt: '',
    help: false,
    liveEvidenceFile: DEFAULT_V04_LIVE_EVIDENCE_FILE,
    livePreflightFile: DEFAULT_V04_LIVE_PREFLIGHT_FILE,
    liveSessionFile: DEFAULT_V04_LIVE_SESSION_FILE,
    liveSessionMarkdownFile: DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE,
    macosLiveProbeFile: DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
    localEvidenceFile: DEFAULT_V04_LOCAL_EVIDENCE_FILE,
    outputPath: '',
    privacySafetyFile: '',
    redactedOutputFile: DEFAULT_V04_REDACTED_OUTPUT_FILE,
    requireComplete: false,
    verifyReleaseRan: false,
  }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--require-complete' || arg === '--require-ready') {
      options.requireComplete = true
      continue
    }
    if (arg === '--verify-release-ran') {
      options.verifyReleaseRan = true
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

  if (positional.length > 0 && options.artifactDir === DEFAULT_V04_ARTIFACT_DIR) {
    options.artifactDir = positional[0]
  }

  return options
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

async function readJsonArtifact(filePath) {
  const target = cleanString(filePath)
  const resolved = path.resolve(process.cwd(), target)
  try {
    return {
      exists: true,
      path: target,
      raw: JSON.parse(await fs.readFile(resolved, 'utf8')),
      error: null,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, path: target, raw: null, error: 'missing' }
    }
    return { exists: true, path: target, raw: null, error: 'invalid-json' }
  }
}

function checkPasses(report, id) {
  return Array.isArray(report?.checks)
    && report.checks.some((check) => check?.id === id && check.pass === true)
}

function missingCheckIds(report, ids) {
  return ids.filter((id) => !checkPasses(report, id))
}

function missingReadinessItems(report) {
  const covered = new Set(Array.isArray(report?.coveredItemIds) ? report.coveredItemIds : [])
  return REQUIRED_COMPANION_READINESS_ITEMS.filter((id) => !covered.has(id))
}

function findReadinessCheck(readiness, id) {
  return Array.isArray(readiness?.checks)
    ? readiness.checks.find((check) => check?.id === id)
    : undefined
}

function requirement({
  id,
  area,
  label,
  status,
  detail,
  evidence,
  blockers = [],
  nextCommands = [],
  nextCommandDetails = [],
  automationSafeNextCommands = [],
  nextCommandAutomation = null,
}) {
  const output = {
    id,
    area,
    label,
    status,
    pass: status === 'complete',
    detail,
    evidence,
    blockers,
    nextCommands,
  }
  if (nextCommandDetails.length > 0) output.nextCommandDetails = nextCommandDetails
  if (automationSafeNextCommands.length > 0) output.automationSafeNextCommands = automationSafeNextCommands
  if (nextCommandAutomation) output.nextCommandAutomation = nextCommandAutomation
  return output
}

function statusForArtifact({ artifact, expectedGate, expectedSchema, requiredMissing = [] }) {
  if (!artifact.exists) return 'missing'
  if (!artifact.raw || artifact.error) return 'missing'
  if (expectedGate && artifact.raw.gate !== expectedGate) return 'missing'
  if (expectedSchema && artifact.raw.schema !== expectedSchema) return 'missing'
  if (artifact.raw.ok === true && requiredMissing.length === 0) return 'complete'
  return requiredMissing.length > 0 ? 'partial' : 'missing'
}

function buildCompanionRequirement(artifact) {
  const missingItems = missingReadinessItems(artifact.raw)
  const status = statusForArtifact({
    artifact,
    expectedGate: 'companion-readiness-health',
    requiredMissing: missingItems,
  })
  return requirement({
    id: 'companion_readiness',
    area: 'key_change',
    label: 'Companion Readiness',
    status,
    detail: status === 'complete'
      ? 'First-run health covers standard companion mode, model, mic, TTS, Live2D, notification permission, local webhook, and privacy boundary.'
      : `Companion readiness artifact is not complete: ${missingItems.join(', ') || artifact.error || 'not ready'}.`,
    evidence: {
      gate: artifact.raw?.gate ?? null,
      ok: artifact.raw?.ok === true,
      status: artifact.raw?.status ?? null,
      readyCount: typeof artifact.raw?.readyCount === 'number' ? artifact.raw.readyCount : null,
      totalCount: typeof artifact.raw?.totalCount === 'number' ? artifact.raw.totalCount : null,
      requiredItemIds: REQUIRED_COMPANION_READINESS_ITEMS,
      missingItemIds: missingItems,
    },
    blockers: missingItems,
    nextCommands: status === 'complete'
      ? []
      : ['npm run companion:readiness:report -- --sample --output artifacts/v0.3.4/companion-readiness.json --require-ready'],
  })
}

function buildMemoryRequirement(artifact) {
  const missingChecks = missingCheckIds(artifact.raw, REQUIRED_MEMORY_MAP_CHECKS)
  const status = statusForArtifact({
    artifact,
    expectedGate: 'memory-map-observability',
    requiredMissing: missingChecks,
  })
  const summary = artifact.raw?.summary ?? {}
  return requirement({
    id: 'memory_map',
    area: 'key_change',
    label: 'Memory Map',
    status,
    detail: status === 'complete'
      ? 'Derived graph, source jumps, relationship timeline, pinned state, and recall pause state are covered.'
      : `Memory Map evidence is not complete: ${missingChecks.join(', ') || artifact.error || 'not ready'}.`,
    evidence: {
      gate: artifact.raw?.gate ?? null,
      ok: artifact.raw?.ok === true,
      viewSchema: artifact.raw?.viewSchema ?? null,
      nodeCount: typeof artifact.raw?.nodeCount === 'number' ? artifact.raw.nodeCount : null,
      edgeCount: typeof artifact.raw?.edgeCount === 'number' ? artifact.raw.edgeCount : null,
      relationshipTimelineCount: typeof artifact.raw?.relationshipTimelineCount === 'number'
        ? artifact.raw.relationshipTimelineCount
        : null,
      sourceRefCount: typeof summary.sourceRefCount === 'number' ? summary.sourceRefCount : null,
      openableSourceRefCount: typeof summary.openableSourceRefCount === 'number'
        ? summary.openableSourceRefCount
        : null,
      pinnedCount: typeof summary.pinnedCount === 'number' ? summary.pinnedCount : null,
      recallPausedCount: typeof summary.recallPausedCount === 'number' ? summary.recallPausedCount : null,
      requiredCheckIds: REQUIRED_MEMORY_MAP_CHECKS,
      missingCheckIds: missingChecks,
      interactionSurfaceEvidence: {
        component: 'src/features/memory/components/MemoryPanel.tsx',
        tests: [
          'tests/memory-map.test.ts',
          'tests/memory-storage.test.ts',
          'tests/memory-recall-edit-evidence.test.ts',
        ],
      },
    },
    blockers: missingChecks,
    nextCommands: status === 'complete'
      ? []
      : ['npm run memory:map:report -- --sample --output artifacts/v0.3.4/memory-map.json --require-ready'],
  })
}

function buildProactiveRequirement(artifact) {
  const missingChecks = missingCheckIds(artifact.raw, REQUIRED_PROACTIVE_CARE_CHECKS)
  const status = statusForArtifact({
    artifact,
    expectedGate: 'proactive-care-observability',
    requiredMissing: missingChecks,
  })
  return requirement({
    id: 'proactive_care_v2',
    area: 'key_change',
    label: 'Proactive Care v2',
    status,
    detail: status === 'complete'
      ? 'Runtime rehearsal covers explicit sources, visible reasons, openable source refs, v2 policy events, and user feedback actions.'
      : `Proactive-care v2 evidence is not complete: ${missingChecks.join(', ') || artifact.error || 'not ready'}.`,
    evidence: {
      gate: artifact.raw?.gate ?? null,
      ok: artifact.raw?.ok === true,
      evidenceSource: artifact.raw?.evidenceSource ?? null,
      totalEvents: typeof artifact.raw?.totalEvents === 'number' ? artifact.raw.totalEvents : null,
      v2EventCount: typeof artifact.raw?.v2EventCount === 'number' ? artifact.raw.v2EventCount : null,
      userVisibleReasonCount: typeof artifact.raw?.userVisibleReasonCount === 'number'
        ? artifact.raw.userVisibleReasonCount
        : null,
      openableSourceRefCount: typeof artifact.raw?.openableSourceRefCount === 'number'
        ? artifact.raw.openableSourceRefCount
        : null,
      userActionCounts: artifact.raw?.userActionCounts ?? null,
      requiredCheckIds: REQUIRED_PROACTIVE_CARE_CHECKS,
      missingCheckIds: missingChecks,
    },
    blockers: missingChecks,
    nextCommands: status === 'complete'
      ? []
      : ['npm run proactive:care:rehearsal -- --output artifacts/v0.3.4/proactive-care-evidence.json --require-ready'],
  })
}

function buildLive2dRequirement(artifact) {
  const missingChecks = missingCheckIds(artifact.raw, REQUIRED_LIVE2D_CHECKS)
  const status = statusForArtifact({
    artifact,
    expectedGate: 'live2d-action-map-coverage',
    requiredMissing: missingChecks,
  })
  const summary = artifact.raw?.summary ?? {}
  return requirement({
    id: 'live2d_presence',
    area: 'key_change',
    label: 'Live2D Presence',
    status,
    detail: status === 'complete'
      ? 'Default Live2D model action map covers expressions, gestures, lifecycle motions, presence states, and missing-slot reporting.'
      : `Live2D action-map evidence is not complete: ${missingChecks.join(', ') || artifact.error || 'not ready'}.`,
    evidence: {
      gate: artifact.raw?.gate ?? null,
      ok: artifact.raw?.ok === true,
      model: artifact.raw?.model ?? null,
      coverage: typeof summary.coverage === 'number' ? summary.coverage : null,
      presenceStates: typeof summary.presenceStates === 'number' ? summary.presenceStates : null,
      mappedPresenceStates: typeof summary.mappedPresenceStates === 'number'
        ? summary.mappedPresenceStates
        : null,
      missing: typeof summary.missing === 'number' ? summary.missing : null,
      requiredCheckIds: REQUIRED_LIVE2D_CHECKS,
      missingCheckIds: missingChecks,
    },
    blockers: missingChecks,
    nextCommands: status === 'complete'
      ? []
      : ['npm run live2d:action-map:report -- --model mao --output artifacts/v0.3.4/live2d-action-map.json --require-ready'],
  })
}

function buildVoiceRequirement(voiceArtifact, ttsSmokeArtifact, stabilizationSource) {
  const voiceStatus = statusForArtifact({
    artifact: voiceArtifact,
    expectedSchema: 'nexus.voice-diagnostics.v1',
  })
  const optionalTtsFailed = Array.isArray(stabilizationSource?.optionalFailedCheckIds)
    && stabilizationSource.optionalFailedCheckIds.includes('p2.local_tts_adapter_smoke')
  const status = voiceStatus === 'complete' ? 'complete' : voiceStatus
  return requirement({
    id: 'voice_reliability',
    area: 'key_change',
    label: 'Voice Reliability',
    status,
    detail: status === 'complete'
      ? 'Voice diagnostics are ready; target local TTS adapters remain optional/Beta for v0.4 default voice.'
      : `Voice diagnostics evidence is not complete: ${voiceArtifact.error || 'not ready'}.`,
    evidence: {
      schema: voiceArtifact.raw?.schema ?? null,
      ok: voiceArtifact.raw?.ok === true,
      summaryStatus: voiceArtifact.raw?.summary?.status ?? null,
      traceCount: typeof voiceArtifact.raw?.summary?.traceCount === 'number'
        ? voiceArtifact.raw.summary.traceCount
        : null,
      errorCount: typeof voiceArtifact.raw?.summary?.errorCount === 'number'
        ? voiceArtifact.raw.summary.errorCount
        : null,
      ttsFirstAudioLatencyStatus: voiceArtifact.raw?.tts?.firstAudioLatencyStatus ?? null,
      pushToTalkBaseline: true,
      localTtsAdapterDefaultPath: 'advanced-beta',
      localTtsAdapterSmokeOk: ttsSmokeArtifact.raw?.ok === true,
      localTtsAdapterOptionalForV04: optionalTtsFailed || ttsSmokeArtifact.raw?.ok === true,
    },
    blockers: status === 'complete' ? [] : ['voice-diagnostics'],
    nextCommands: status === 'complete'
      ? []
      : ['npm run voice:diagnostics:report -- --input artifacts/voice-diagnostics-input.json --output artifacts/v0.3.4/voice-diagnostics.json --require-ready'],
  })
}

function buildPrivacyRequirement(artifact) {
  const missingChecks = missingCheckIds(artifact.raw, REQUIRED_PRIVACY_SAFETY_CHECKS)
  const policy = artifact.raw?.policy ?? {}
  const policyBlocksUnsafeMarkets = policy.adultOrNsfwMarketplaceAllowed === false
    && policy.minorDirectedExperienceAllowed === false
    && policy.dependencyReinforcementMechanicsAllowed === false
    && policy.relationshipScoreMechanicsAllowed === false
    && policy.humanRelationshipSubstituteClaimAllowed === false
  const policyMissing = policyBlocksUnsafeMarkets ? [] : ['boundary-policy']
  const blockers = [...missingChecks, ...policyMissing]
  const status = statusForArtifact({
    artifact,
    expectedGate: 'v0.4-privacy-safety-boundaries',
    requiredMissing: blockers,
  })
  return requirement({
    id: 'privacy_safety',
    area: 'key_change',
    label: 'Privacy And Safety',
    status,
    detail: status === 'complete'
      ? 'AI disclosure, crisis support, age posture, adult-market boundary, and dependency mechanics boundary are covered.'
      : `Privacy/safety evidence is not complete: ${blockers.join(', ') || artifact.error || 'not ready'}.`,
    evidence: {
      gate: artifact.raw?.gate ?? null,
      ok: artifact.raw?.ok === true,
      aiDisclosureRequired: policy.aiDisclosureRequired ?? null,
      adultOrNsfwMarketplaceAllowed: policy.adultOrNsfwMarketplaceAllowed ?? null,
      dependencyReinforcementMechanicsAllowed: policy.dependencyReinforcementMechanicsAllowed ?? null,
      humanRelationshipSubstituteClaimAllowed: policy.humanRelationshipSubstituteClaimAllowed ?? null,
      minorDirectedExperienceAllowed: policy.minorDirectedExperienceAllowed ?? null,
      relationshipScoreMechanicsAllowed: policy.relationshipScoreMechanicsAllowed ?? null,
      requiredCheckIds: REQUIRED_PRIVACY_SAFETY_CHECKS,
      missingCheckIds: missingChecks,
    },
    blockers,
    nextCommands: status === 'complete'
      ? []
      : ['npm run privacy:safety:report -- --output artifacts/v0.3.4/privacy-safety.json --require-ready'],
  })
}

function summarizeReadinessNextCommand(entry) {
  const id = cleanString(entry?.id)
  const command = cleanString(entry?.command)
  if (!id || !command) return null
  const recordCommandSafety = entry?.recordCommandSafety
  return {
    id,
    command,
    reason: cleanString(entry?.reason),
    ...(entry?.dryRunCommand ? { dryRunCommand: cleanString(entry.dryRunCommand) } : {}),
    ...(entry?.preflightCommand ? { preflightCommand: cleanString(entry.preflightCommand) } : {}),
    ...(entry?.isTemplate === true ? { isTemplate: true } : {}),
    ...(entry?.mustReplacePlaceholders === true ? { mustReplacePlaceholders: true } : {}),
    ...(typeof entry?.safeToRun === 'boolean' ? { safeToRun: entry.safeToRun } : {}),
    ...(entry?.executionMode ? { executionMode: cleanString(entry.executionMode) } : {}),
    ...(typeof entry?.readyToAttempt === 'boolean' ? { readyToAttempt: entry.readyToAttempt } : {}),
    ...(entry?.liveSessionStepStatus ? { liveSessionStepStatus: cleanString(entry.liveSessionStepStatus) } : {}),
    ...(typeof entry?.bridgeTraceApplied === 'boolean' ? { bridgeTraceApplied: entry.bridgeTraceApplied } : {}),
    ...(entry?.machinePrerequisite && typeof entry.machinePrerequisite === 'object'
      ? {
          machinePrerequisite: {
            id: cleanString(entry.machinePrerequisite.id) || null,
            status: cleanString(entry.machinePrerequisite.status) || null,
            releaseEvidenceCandidate: entry.machinePrerequisite.releaseEvidenceCandidate === true,
          },
        }
      : {}),
    ...(recordCommandSafety && typeof recordCommandSafety === 'object' && !Array.isArray(recordCommandSafety)
      ? {
          recordCommandSafety: {
            status: cleanString(recordCommandSafety.status) || null,
            safeToRunRecordCommand: recordCommandSafety.safeToRunRecordCommand === true,
            dryRunRecommended: recordCommandSafety.dryRunRecommended === true,
            preflightRecommended: recordCommandSafety.preflightRecommended === true,
            placeholderTokens: Array.isArray(recordCommandSafety.placeholderTokens)
              ? recordCommandSafety.placeholderTokens.map(cleanString).filter(Boolean)
              : [],
            missingProofFieldIds: Array.isArray(recordCommandSafety.missingProofFieldIds)
              ? recordCommandSafety.missingProofFieldIds.map(cleanString).filter(Boolean)
              : [],
            reasons: Array.isArray(recordCommandSafety.reasons)
              ? recordCommandSafety.reasons.map(cleanString).filter(Boolean)
              : [],
          },
        }
      : {}),
    ...(Array.isArray(entry?.placeholderFields)
      ? { placeholderFields: entry.placeholderFields.map(cleanString).filter(Boolean) }
      : {}),
    ...(Array.isArray(entry?.placeholderValues)
      ? { placeholderValues: entry.placeholderValues.map(cleanString).filter(Boolean) }
      : {}),
  }
}

function buildMessageAwarenessRequirement(readiness) {
  const check = findReadinessCheck(readiness, 'message_awareness.release_gate')
  const evidence = check?.evidence ?? {}
  const pending = Array.isArray(evidence.pendingCheckIds) ? evidence.pendingCheckIds : []
  const livePreflightBlockingCheckIds = Array.isArray(evidence.livePreflight?.blockingCheckIds)
    ? evidence.livePreflight.blockingCheckIds
    : []
  const allPendingAreLive = pending.length > 0
    && pending.every((id) => REQUIRED_LIVE_MESSAGE_CHECKS.includes(id))
  const rawReleaseGateComplete = evidence.rawReleaseGateComplete === true
  const redactionGateComplete = evidence.redactionGateComplete === true
  const status = check?.pass === true
    ? 'complete'
    : livePreflightBlockingCheckIds.length > 0
      ? 'partial'
      : evidence.localWebhookPass === true && allPendingAreLive
      ? 'external_required'
      : evidence.localWebhookPass === true
        ? 'partial'
        : 'missing'
  const blockers = status === 'complete'
    ? []
    : livePreflightBlockingCheckIds.length > 0
      ? livePreflightBlockingCheckIds
      : pending.length > 0
      ? pending
      : rawReleaseGateComplete && !redactionGateComplete
        ? ['redacted-release-evidence']
        : evidence.localWebhookPass === true
          ? ['complete-release-evidence']
          : ['local-webhook-injection']
  const nextCommandDetails = status === 'complete'
    ? []
    : (readiness.nextCommands ?? [])
      .filter((entry) => String(entry.id ?? '').startsWith('message-'))
      .map(summarizeReadinessNextCommand)
      .filter(Boolean)
  const nextCommandAutomation = summarizeNextCommandAutomation(nextCommandDetails)
  const automationSafeNextCommands = nextCommandDetails.filter((entry) => (
    nextCommandAutomation.automationSafeCommandIds.includes(entry.id)
  ))
  return requirement({
    id: 'message_awareness',
    area: 'release_gate',
    label: 'Message Awareness Live Gate',
    status,
    detail: status === 'complete'
      ? 'Local webhook, macOS Notification Center, Telegram, Discord, merged release evidence, and redaction path are complete.'
      : livePreflightBlockingCheckIds.length > 0
        ? `Message-awareness live preflight is blocked by host environment: ${livePreflightBlockingCheckIds.join(', ')}.`
      : status === 'external_required'
        ? `Real live evidence is still required for ${pending.join(', ')}.`
        : rawReleaseGateComplete && !redactionGateComplete
          ? 'Commit-safe redacted message-awareness release evidence is still required.'
          : 'Message-awareness evidence is incomplete before live release checks can be recorded.',
    evidence: {
      localWebhookPass: evidence.localWebhookPass === true,
      liveGateComplete: evidence.liveGateComplete === true,
      rawReleaseGateComplete,
      redactionGateComplete,
      releaseGateComplete: evidence.releaseGateComplete === true,
      livePassedCount: typeof evidence.livePassedCount === 'number' ? evidence.livePassedCount : null,
      liveTotalCount: typeof evidence.liveTotalCount === 'number' ? evidence.liveTotalCount : null,
      pendingCheckIds: pending,
      requiredLiveCheckIds: REQUIRED_LIVE_MESSAGE_CHECKS,
      livePreflight: evidence.livePreflight ?? null,
      macosLiveProbe: evidence.macosLiveProbe ?? null,
      liveSession: evidence.liveSession ?? null,
    },
    blockers,
    nextCommands: nextCommandDetails.map((entry) => entry.command),
    nextCommandDetails,
    automationSafeNextCommands,
    nextCommandAutomation,
  })
}

function buildReleaseVerificationRequirement(readiness) {
  const evidenceCheck = findReadinessCheck(readiness, 'evidence.stabilization_status')
  const privacyCheck = findReadinessCheck(readiness, 'privacy_safety.boundaries')
  const releaseCheck = findReadinessCheck(readiness, 'release.verify_release_command')
  const verifyReleaseRan = releaseCheck?.pass === true
  const status = evidenceCheck?.pass === true && privacyCheck?.pass === true
    ? 'complete'
    : 'partial'
  return requirement({
    id: 'release_evidence_gate',
    area: 'release_gate',
    label: 'Release Evidence Gate',
    status,
    detail: status === 'complete'
      ? verifyReleaseRan
        ? 'Required stabilization artifacts, source-backed privacy/safety evidence, and the release verification command are ready.'
        : 'Required stabilization artifacts and source-backed privacy/safety evidence are ready; verify:release is tracked separately.'
      : 'Required stabilization or privacy/safety evidence is not complete.',
    evidence: {
      stabilizationPass: evidenceCheck?.pass === true,
      stabilizationStatus: evidenceCheck?.status ?? null,
      privacySafetyPass: privacyCheck?.pass === true,
      privacySafetyStatus: privacyCheck?.status ?? null,
      verifyReleaseCommandRequired: !verifyReleaseRan,
      verifyReleaseRan,
    },
    blockers: status === 'complete' ? [] : [evidenceCheck?.id, privacyCheck?.id].filter(Boolean),
    nextCommands: verifyReleaseRan ? [] : ['npm run verify:release'],
  })
}

export async function buildV04CompletionAuditReport(options = {}, context = {}) {
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const artifactDir = options.artifactDir || DEFAULT_V04_ARTIFACT_DIR
  const privacySafetyFile = options.privacySafetyFile || path.join(artifactDir, 'privacy-safety.json')
  const readiness = await buildV04ReadinessStatusReport({
    artifactDir,
    completeEvidenceFile: options.completeEvidenceFile || DEFAULT_V04_COMPLETE_EVIDENCE_FILE,
    generatedAt,
    liveEvidenceFile: options.liveEvidenceFile || DEFAULT_V04_LIVE_EVIDENCE_FILE,
    livePreflightFile: options.livePreflightFile || DEFAULT_V04_LIVE_PREFLIGHT_FILE,
    liveSessionFile: options.liveSessionFile || DEFAULT_V04_LIVE_SESSION_FILE,
    liveSessionMarkdownFile: options.liveSessionMarkdownFile || DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE,
    localEvidenceFile: options.localEvidenceFile || DEFAULT_V04_LOCAL_EVIDENCE_FILE,
    macosLiveProbeFile: options.macosLiveProbeFile || DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
    privacySafetyFile,
    redactedOutputFile: options.redactedOutputFile || DEFAULT_V04_REDACTED_OUTPUT_FILE,
    verifyReleaseRan: options.verifyReleaseRan === true,
  }, { now: new Date(generatedAt) })
  const [
    companionReadiness,
    memoryMap,
    proactiveCare,
    live2dActionMap,
    voiceDiagnostics,
    ttsAdapterSmoke,
    privacySafety,
  ] = await Promise.all([
    readJsonArtifact(path.join(artifactDir, 'companion-readiness.json')),
    readJsonArtifact(path.join(artifactDir, 'memory-map.json')),
    readJsonArtifact(path.join(artifactDir, 'proactive-care-evidence.json')),
    readJsonArtifact(path.join(artifactDir, 'live2d-action-map.json')),
    readJsonArtifact(path.join(artifactDir, 'voice-diagnostics.json')),
    readJsonArtifact(path.join(artifactDir, 'tts-adapter-smoke.json')),
    readJsonArtifact(privacySafetyFile),
  ])

  const requirements = [
    buildCompanionRequirement(companionReadiness),
    buildMemoryRequirement(memoryMap),
    buildProactiveRequirement(proactiveCare),
    buildLive2dRequirement(live2dActionMap),
    buildVoiceRequirement(voiceDiagnostics, ttsAdapterSmoke, readiness.sourceReports?.stabilization),
    buildPrivacyRequirement(privacySafety),
    buildMessageAwarenessRequirement(readiness),
    buildReleaseVerificationRequirement(readiness),
  ]
  const completeCount = requirements.filter((entry) => entry.status === 'complete').length
  const externalRequirementIds = requirements
    .filter((entry) => entry.status === 'external_required')
    .map((entry) => entry.id)
  const blockingRequirementIds = requirements
    .filter((entry) => entry.status !== 'complete')
    .map((entry) => entry.id)
  const ok = blockingRequirementIds.length === 0

  return {
    schemaVersion: 1,
    gate: V04_COMPLETION_AUDIT_GATE,
    generatedAt,
    targetVersion: '0.4',
    ok,
    overallStatus: ok
      ? 'complete'
      : externalRequirementIds.length > 0
        ? 'external-live-evidence-required'
        : 'needs-work',
    completeCount,
    totalCount: requirements.length,
    requirements,
    blockingRequirementIds,
    externalRequirementIds,
    sourceReports: {
      readiness: {
        ok: readiness.ok,
        overallStatus: readiness.overallStatus,
        blockingCheckIds: readiness.blockingCheckIds,
      },
      stabilization: readiness.sourceReports?.stabilization ?? null,
      messageAwareness: readiness.sourceReports?.messageAwareness ?? null,
      messageMacosLiveProbe: readiness.sourceReports?.messageMacosLiveProbe ?? null,
      messageLivePreflight: readiness.sourceReports?.messageLivePreflight ?? null,
      messageLiveSession: readiness.sourceReports?.messageLiveSession ?? null,
      privacySafety: readiness.sourceReports?.privacySafety ?? null,
    },
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'message sender/text/id values',
        'webhook payloads and responses',
        'live-check operators and notes',
        'live-session Markdown operator packet contents',
        'memory bodies and source ids',
        'relationship timeline item labels',
        'voice transcripts',
        'TTS request text and endpoint details',
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

export async function runV04CompletionAuditCli(argv = process.argv.slice(2), context = {}) {
  const options = parseV04CompletionAuditArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = await buildV04CompletionAuditReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireComplete && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runV04CompletionAuditCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
