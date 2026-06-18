import type { ContextDiagnosticsSummary } from '../context/contextDiagnostics.ts'
import type { CompanionSurfaceEvidenceReport } from './companionSurfaceEvidence.ts'
import {
  buildPrivacySafetyEvidenceReport,
  type PrivacySafetyEvidenceReport,
} from './privacySafetyEvidence.ts'
import type { MemoryOwnershipEvidenceReport } from '../../lib/storage/memory.ts'
import type { ProactiveCareEvidenceReport } from '../../lib/storage/proactiveCare.ts'
import type { TtsEngineReadinessReport } from '../voice/ttsEngineReadiness.ts'
import type { VoiceDiagnosticsReport } from '../voice/voiceDiagnostics.ts'
import type { AppSettings } from '../../types/app.ts'

export type V04ReadinessArea =
  | 'companion_readiness'
  | 'live2d_presence'
  | 'message_awareness'
  | 'memory_map'
  | 'positioning'
  | 'privacy_safety'
  | 'proactive_care_v2'
  | 'voice_reliability'

export type V04ReadinessStatus = 'missing' | 'partial' | 'pass'

export interface V04ReadinessCheck {
  id:
    | 'companion_readiness.standard_mode'
    | 'live2d_presence.default_companion_polish'
    | 'message_awareness.release_gate'
    | 'memory_map.ownership_and_timeline'
    | 'positioning.desktop_emotional_companion'
    | 'privacy_safety.gentle_context_boundaries'
    | 'privacy_safety.support_and_age_boundaries'
    | 'proactive_care_v2.visible_reason_policy'
    | 'voice_reliability.first_audio_path'
  area: V04ReadinessArea
  status: V04ReadinessStatus
  detail: string
  evidence: Record<string, unknown>
}

export interface V04ReadinessReport {
  schema: 'nexus.v04-readiness.v1'
  generatedAt: string
  targetVersion: '0.4'
  positioning: 'desktop-emotional-companion'
  excludedDirection: 'general-productivity-agent'
  overallStatus: 'ready' | 'needs-work'
  passCount: number
  partialCount: number
  missingCount: number
  checks: V04ReadinessCheck[]
}

export type V04ReadinessSettings = Pick<
  AppSettings,
  | 'apiBaseUrl'
  | 'autonomyNotificationMessagePreviewEnabled'
  | 'companionName'
  | 'contextAwarenessEnabled'
  | 'discordAnnounceMessagePreview'
  | 'macosMessageWatcherEnabled'
  | 'model'
  | 'petModelId'
  | 'profilePersonaInChatEnabled'
  | 'speechInputEnabled'
  | 'speechOutputEnabled'
  | 'speechOutputProviderId'
  | 'systemPrompt'
  | 'telegramAnnounceMessagePreview'
  | 'userName'
  | 'voiceInterruptionEnabled'
  | 'voiceTriggerMode'
>

export interface V04MessageAwarenessReleaseStatus {
  ok?: boolean
  releaseGateComplete?: boolean
  localEvidence?: {
    audit?: {
      localWebhook?: {
        pass?: boolean
      }
    } | null
  }
  liveEvidence?: {
    audit?: {
      liveGateComplete?: boolean
      passedCount?: number
      totalCount?: number
      pendingCheckIds?: readonly string[]
    } | null
  }
  completeEvidence?: {
    audit?: {
      releaseGateComplete?: boolean
      localWebhook?: {
        pass?: boolean
      }
      liveEvidence?: {
        liveGateComplete?: boolean
        passedCount?: number
        totalCount?: number
        pendingCheckIds?: readonly string[]
      }
    } | null
  }
  nextCommands?: readonly {
    id?: string
    command?: string
  }[]
}

export interface BuildV04ReadinessReportInput {
  companionSurface: CompanionSurfaceEvidenceReport
  contextDiagnostics: ContextDiagnosticsSummary
  messageAwareness?: V04MessageAwarenessReleaseStatus
  memoryOwnership: MemoryOwnershipEvidenceReport
  proactiveCare: ProactiveCareEvidenceReport
  safetyBoundaries?: PrivacySafetyEvidenceReport
  settings: V04ReadinessSettings
  ttsEngine: TtsEngineReadinessReport
  voice: VoiceDiagnosticsReport
}

function normalizeIso(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

function statusFor(pass: boolean, partial: boolean): V04ReadinessStatus {
  if (pass) return 'pass'
  return partial ? 'partial' : 'missing'
}

function checkPassed<TCheck extends { id: string; pass: boolean }>(
  checks: readonly TCheck[],
  id: TCheck['id'],
): boolean {
  return checks.some((check) => check.id === id && check.pass)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function summarizeMessageAwarenessReleaseStatus(
  status: V04MessageAwarenessReleaseStatus | undefined,
) {
  const localWebhookPass = status?.localEvidence?.audit?.localWebhook?.pass === true
    || status?.completeEvidence?.audit?.localWebhook?.pass === true
  const liveAudit = status?.liveEvidence?.audit
  const completeLiveAudit = status?.completeEvidence?.audit?.liveEvidence
  const liveGateComplete = liveAudit?.liveGateComplete === true
    || completeLiveAudit?.liveGateComplete === true
  const releaseGateComplete = status?.releaseGateComplete === true
    || status?.ok === true
    || status?.completeEvidence?.audit?.releaseGateComplete === true
  const livePassedCount = numberOrNull(liveAudit?.passedCount)
    ?? numberOrNull(completeLiveAudit?.passedCount)
  const liveTotalCount = numberOrNull(liveAudit?.totalCount)
    ?? numberOrNull(completeLiveAudit?.totalCount)
  const pendingCheckIds = isStringArray(liveAudit?.pendingCheckIds)
    ? [...liveAudit.pendingCheckIds]
    : isStringArray(completeLiveAudit?.pendingCheckIds)
      ? [...completeLiveAudit.pendingCheckIds]
      : []
  const redactionCommandAvailable = status?.nextCommands?.some((entry) => (
    entry.id === 'redact-release-evidence'
    || entry.command === 'npm run message:release:redact'
  )) === true

  return {
    evidenceAttached: status != null,
    localWebhookPass,
    liveGateComplete,
    livePassedCount,
    liveTotalCount,
    pendingCheckIds,
    redactionCommandAvailable,
    releaseGateComplete,
  }
}

function buildChecks(input: BuildV04ReadinessReportInput): V04ReadinessCheck[] {
  const {
    companionSurface,
    contextDiagnostics,
    messageAwareness,
    memoryOwnership,
    proactiveCare,
    safetyBoundaries = buildPrivacySafetyEvidenceReport(),
    settings,
    ttsEngine,
    voice,
  } = input
  const prompt = settings.systemPrompt.toLowerCase()
  const promptFramesCompanion = (
    prompt.includes('desktop companion')
    || prompt.includes('long-term companion')
    || prompt.includes('桌面')
    || prompt.includes('陪伴')
  )
  const promptRejectsGeneralAgent = (
    prompt.includes('not a general-purpose agent')
    || prompt.includes('不是通用')
    || prompt.includes('not a generic agent')
  )
  const modelReady = hasText(settings.apiBaseUrl) && hasText(settings.model)
  const identityReady = hasText(settings.companionName) && hasText(settings.userName)
  const petReady = companionSurface.petModel.present
  const memoryGovernanceReady = [
    'has-editable-data',
    'has-recall-governance',
    'has-source-refs',
    'has-openable-source-refs',
  ].every((id) => checkPassed(memoryOwnership.checks, id as MemoryOwnershipEvidenceReport['checks'][number]['id']))
  const memoryTimelinePartial = memoryOwnership.relationshipInsightCount > 0 || memoryOwnership.dailyEntryCount > 0
  const proactiveV2Ready = proactiveCare.v2EventCount > 0
    && proactiveCare.userVisibleReasonCount > 0
    && proactiveCare.openableSourceRefCount > 0
  const proactiveV2Partial = proactiveCare.totalEvents > 0
  const actionMapReady = [
    'has-pet-model',
    'has-action-map-coverage',
    'has-action-map-editor-targets',
  ].every((id) => checkPassed(companionSurface.checks, id as CompanionSurfaceEvidenceReport['checks'][number]['id']))
  const requiredPresenceStateCount = 7
  const presenceStatesReady = companionSurface.actionMap.presenceStates >= requiredPresenceStateCount
    && companionSurface.actionMap.mappedPresenceStates === companionSurface.actionMap.presenceStates
  const voiceEnabled = settings.speechInputEnabled || settings.speechOutputEnabled
  const pushToTalkBaseline = settings.voiceTriggerMode === 'direct_send' || settings.voiceTriggerMode === 'manual_confirm'
  const voiceRuntimeReady = voice.summary.status === 'ok' || voice.summary.status === 'active'
  const firstAudioReady = voice.tts?.firstAudioLatencyStatus === 'pass'
    || (!settings.speechOutputEnabled && pushToTalkBaseline)
  const targetLocalTtsBeta = ttsEngine.targetEngines.registeredCount > 0
    && !ttsEngine.targetEngines.activeTargetEngineId
  const contentPreviewGated = !settings.autonomyNotificationMessagePreviewEnabled
    && !settings.telegramAnnounceMessagePreview
    && !settings.discordAnnounceMessagePreview
  const contextHasGentleBoundary = contextDiagnostics.items.some((item) => (
    item.id === 'notification_center'
    || item.id === 'local_webhook'
    || item.id === 'telegram'
    || item.id === 'discord'
  ))
  const safetyBoundaryPassCount = safetyBoundaries.checks.filter((check) => check.pass).length
  const safetyBoundaryPartial = safetyBoundaryPassCount > 0
  const messageAwarenessSummary = summarizeMessageAwarenessReleaseStatus(messageAwareness)
  const messageAwarenessPartial = messageAwarenessSummary.localWebhookPass
    || messageAwarenessSummary.liveGateComplete
    || (messageAwarenessSummary.livePassedCount ?? 0) > 0

  return [
    {
      id: 'positioning.desktop_emotional_companion',
      area: 'positioning',
      status: statusFor(promptFramesCompanion && promptRejectsGeneralAgent, promptFramesCompanion),
      detail: promptFramesCompanion && promptRejectsGeneralAgent
        ? 'System prompt frames Nexus as a desktop companion, not a general productivity agent.'
        : 'System prompt should explicitly frame the companion direction and reject generic agent positioning.',
      evidence: {
        promptFramesCompanion,
        promptRejectsGeneralAgent,
      },
    },
    {
      id: 'companion_readiness.standard_mode',
      area: 'companion_readiness',
      status: statusFor(identityReady && modelReady && petReady, identityReady || modelReady || petReady),
      detail: `identity=${identityReady}; model=${modelReady}; pet=${petReady}`,
      evidence: {
        identityReady,
        modelReady,
        petReady,
        petModelId: settings.petModelId,
      },
    },
    {
      id: 'memory_map.ownership_and_timeline',
      area: 'memory_map',
      status: statusFor(memoryGovernanceReady && memoryTimelinePartial, memoryOwnership.editableItemCount > 0),
      detail: `${memoryOwnership.editableItemCount} editable memory item(s), ${memoryOwnership.relationshipInsightCount} relationship/reflection item(s), ${memoryOwnership.sourceRefCount} source ref(s)`,
      evidence: {
        editableItemCount: memoryOwnership.editableItemCount,
        relationshipInsightCount: memoryOwnership.relationshipInsightCount,
        sourceRefCount: memoryOwnership.sourceRefCount,
        openableSourceRefCount: memoryOwnership.openableSourceRefCount,
        pinnedCount: memoryOwnership.pinnedCount,
        recallPausedCount: memoryOwnership.recallPausedCount,
      },
    },
    {
      id: 'proactive_care_v2.visible_reason_policy',
      area: 'proactive_care_v2',
      status: statusFor(proactiveV2Ready, proactiveV2Partial),
      detail: `${proactiveCare.v2EventCount} v2 event(s), ${proactiveCare.userVisibleReasonCount} visible reason(s), ${proactiveCare.openableSourceRefCount} openable source ref(s)`,
      evidence: {
        totalEvents: proactiveCare.totalEvents,
        v2EventCount: proactiveCare.v2EventCount,
        userVisibleReasonCount: proactiveCare.userVisibleReasonCount,
        userActionCounts: proactiveCare.userActionCounts,
        openableSourceRefCount: proactiveCare.openableSourceRefCount,
      },
    },
    {
      id: 'live2d_presence.default_companion_polish',
      area: 'live2d_presence',
      status: statusFor(
        actionMapReady && presenceStatesReady && companionSurface.petModel.kind === 'live2d',
        companionSurface.petModel.present,
      ),
      detail: `${companionSurface.petModel.kind} model, ${Math.round(companionSurface.actionMap.coverage * 100)}% action coverage, ${companionSurface.actionMap.mappedPresenceStates}/${companionSurface.actionMap.presenceStates} companion state(s)`,
      evidence: {
        petModel: companionSurface.petModel,
        actionMap: companionSurface.actionMap,
        requiredPresenceStateCount,
        presenceStatesReady,
      },
    },
    {
      id: 'voice_reliability.first_audio_path',
      area: 'voice_reliability',
      status: statusFor(
        pushToTalkBaseline && firstAudioReady,
        pushToTalkBaseline || voiceEnabled || voiceRuntimeReady || targetLocalTtsBeta,
      ),
      detail: `trigger=${settings.voiceTriggerMode}; speechOutput=${settings.speechOutputEnabled}; firstAudio=${voice.tts?.firstAudioLatencyStatus ?? 'text-only'}; targetLocalTtsBeta=${targetLocalTtsBeta}`,
      evidence: {
        pushToTalkBaseline,
        voiceEnabled,
        voiceRuntimeStatus: voice.summary.status,
        speechOutputProviderId: settings.speechOutputProviderId,
        firstAudioLatencyStatus: voice.tts?.firstAudioLatencyStatus ?? null,
        targetLocalTtsBeta,
        voiceInterruptionEnabled: settings.voiceInterruptionEnabled,
      },
    },
    {
      id: 'message_awareness.release_gate',
      area: 'message_awareness',
      status: statusFor(
        messageAwarenessSummary.releaseGateComplete,
        messageAwarenessSummary.evidenceAttached && messageAwarenessPartial,
      ),
      detail: messageAwarenessSummary.releaseGateComplete
        ? `Message-awareness local smoke, live checks, and merged release gate are ready${messageAwarenessSummary.redactionCommandAvailable ? '; release redaction command is available' : ''}.`
        : messageAwarenessSummary.evidenceAttached
          ? `Message-awareness release gate pending: ${messageAwarenessSummary.pendingCheckIds.length ? messageAwarenessSummary.pendingCheckIds.join(', ') : 'complete release evidence is not green yet'}.`
          : 'Message-awareness release status evidence is not attached; run npm run message:status:release and attach the report before v0.4 release.',
      evidence: {
        localWebhookPass: messageAwarenessSummary.localWebhookPass,
        liveGateComplete: messageAwarenessSummary.liveGateComplete,
        livePassedCount: messageAwarenessSummary.livePassedCount,
        liveTotalCount: messageAwarenessSummary.liveTotalCount,
        pendingCheckIds: messageAwarenessSummary.pendingCheckIds,
        redactionCommandAvailable: messageAwarenessSummary.redactionCommandAvailable,
        releaseGateComplete: messageAwarenessSummary.releaseGateComplete,
      },
    },
    {
      id: 'privacy_safety.gentle_context_boundaries',
      area: 'privacy_safety',
      status: statusFor(contentPreviewGated && contextHasGentleBoundary, contentPreviewGated),
      detail: contentPreviewGated
        ? 'Message awareness keeps content previews gated by default.'
        : 'Disable automatic message previews before using this as v0.4 release evidence.',
      evidence: {
        contentPreviewGated,
        contextAwarenessEnabled: settings.contextAwarenessEnabled,
        macosMessageWatcherEnabled: settings.macosMessageWatcherEnabled,
        profilePersonaInChatEnabled: settings.profilePersonaInChatEnabled,
        diagnosticSurfaceCount: contextDiagnostics.items.length,
      },
    },
    {
      id: 'privacy_safety.support_and_age_boundaries',
      area: 'privacy_safety',
      status: statusFor(safetyBoundaries.ok, safetyBoundaryPartial),
      detail: safetyBoundaries.ok
        ? 'AI disclosure, crisis support, age posture, and adult-market boundaries are covered.'
        : `Privacy/safety boundary evidence has ${safetyBoundaries.failedCheckIds.length} failed check(s).`,
      evidence: {
        gate: safetyBoundaries.gate,
        passCount: safetyBoundaryPassCount,
        totalCount: safetyBoundaries.checks.length,
        failedCheckIds: safetyBoundaries.failedCheckIds,
        adultOrNsfwMarketplaceAllowed: safetyBoundaries.policy.adultOrNsfwMarketplaceAllowed,
        dependencyReinforcementMechanicsAllowed: safetyBoundaries.policy.dependencyReinforcementMechanicsAllowed,
        humanRelationshipSubstituteClaimAllowed: safetyBoundaries.policy.humanRelationshipSubstituteClaimAllowed,
        minorDirectedExperienceAllowed: safetyBoundaries.policy.minorDirectedExperienceAllowed,
        relationshipScoreMechanicsAllowed: safetyBoundaries.policy.relationshipScoreMechanicsAllowed,
      },
    },
  ]
}

export function buildV04ReadinessReport(
  input: BuildV04ReadinessReportInput,
  options: { generatedAt?: string } = {},
): V04ReadinessReport {
  const checks = buildChecks(input)
  const passCount = checks.filter((check) => check.status === 'pass').length
  const partialCount = checks.filter((check) => check.status === 'partial').length
  const missingCount = checks.filter((check) => check.status === 'missing').length

  return {
    schema: 'nexus.v04-readiness.v1',
    generatedAt: normalizeIso(options.generatedAt),
    targetVersion: '0.4',
    positioning: 'desktop-emotional-companion',
    excludedDirection: 'general-productivity-agent',
    overallStatus: missingCount === 0 && partialCount === 0 ? 'ready' : 'needs-work',
    passCount,
    partialCount,
    missingCount,
    checks,
  }
}
