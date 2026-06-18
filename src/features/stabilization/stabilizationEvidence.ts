import type {
  ContextDiagnosticItemId,
  ContextDiagnosticStatus,
  ContextDiagnosticsSummary,
} from '../context/contextDiagnostics.ts'
import type { CompanionSurfaceEvidenceReport } from './companionSurfaceEvidence.ts'
import type { MemoryOwnershipEvidenceReport } from '../../lib/storage/memory.ts'
import type { ProactiveCareEvidenceReport } from '../../lib/storage/proactiveCare.ts'
import type { TtsEngineReadinessReport } from '../voice/ttsEngineReadiness.ts'
import type { VoiceDiagnosticsReport } from '../voice/voiceDiagnostics.ts'

export type StabilizationEvidenceArea = 'P1' | 'P2'
export type StabilizationEvidenceCheckStatus = 'pass' | 'partial' | 'missing'
export type StabilizationVoiceTtsEvidence = Omit<NonNullable<VoiceDiagnosticsReport['tts']>, 'model' | 'voice'> & {
  modelConfigured: boolean
  voiceConfigured: boolean
}

export type StabilizationEvidenceCheck = {
  id:
    | 'p1.context_diagnostics_visible'
    | 'p1.context_diagnostics_actions'
    | 'p1.memory_ownership'
    | 'p1.memory_source_traceability'
    | 'p1.proactive_care_observability'
    | 'p1.proactive_care_source_refs'
    | 'p1.proactive_care_coverage'
    | 'p2.companion_action_map'
    | 'p2.character_role_package'
    | 'p2.voice_diagnostics_visible'
    | 'p2.voice_tts_latency'
    | 'p2.local_tts_engine_readiness'
  area: StabilizationEvidenceArea
  status: StabilizationEvidenceCheckStatus
  detail: string
  evidence: Record<string, unknown>
}

export type StabilizationEvidenceReport = {
  schema: 'nexus.stabilization-evidence.v1'
  generatedAt: string
  scope: StabilizationEvidenceArea[]
  overallStatus: 'ready' | 'needs-evidence'
  passCount: number
  totalChecks: number
  checks: StabilizationEvidenceCheck[]
  contextDiagnostics: {
    readyCount: number
    actionCount: number
    totalItems: number
    statuses: Partial<Record<ContextDiagnosticItemId, ContextDiagnosticStatus>>
    traceLabels: Partial<Record<ContextDiagnosticItemId, string[]>>
  }
  memoryOwnership: {
    longTermCount: number
    dailyEntryCount: number
    relationshipInsightCount: number
    pinnedCount: number
    recallPausedCount: number
    sourceRefCount: number
    sourceRefCoverage: number
    openableSourceRefCount: number
    qualityIssueCount: number
    checks: MemoryOwnershipEvidenceReport['checks']
  }
  proactiveCare: {
    totalEvents: number
    totalOccurrences: number
    coverageWindowHours: number
    outcomeCounts: ProactiveCareEvidenceReport['outcomeCounts']
    decisionWindowCounts: ProactiveCareEvidenceReport['decisionWindowCounts']
    keyDecisionWindowCount: number
    sourceCounts: ProactiveCareEvidenceReport['sourceCounts']
    sourceRefCount: number
    openableSourceRefCount: number
    sourceRefCoverage: number
    openableSourceRefCoverage: number
    quietHoursSkipCount: number
    rateLimitSkipCount: number
    qualityIssueCount: number
    checks: ProactiveCareEvidenceReport['checks']
  }
  companionSurface: {
    petModel: CompanionSurfaceEvidenceReport['petModel']
    actionMap: CompanionSurfaceEvidenceReport['actionMap']
    characterProfiles: CompanionSurfaceEvidenceReport['characterProfiles']
    voicePreset: CompanionSurfaceEvidenceReport['voicePreset']
    qualityIssueCount: number
    checks: CompanionSurfaceEvidenceReport['checks']
  }
  voice: {
    summary: VoiceDiagnosticsReport['summary']
    transitionCount: number
    latencies: VoiceDiagnosticsReport['latencies']
    tts: StabilizationVoiceTtsEvidence | null
  }
  ttsEngine: {
    activeProvider: TtsEngineReadinessReport['activeProvider']
    targetEngines: TtsEngineReadinessReport['targetEngines']
    qualityIssueCount: number
    checks: TtsEngineReadinessReport['checks']
  }
}

export type BuildStabilizationEvidenceReportInput = {
  contextDiagnostics: ContextDiagnosticsSummary
  memoryOwnership: MemoryOwnershipEvidenceReport
  proactiveCare: ProactiveCareEvidenceReport
  companionSurface: CompanionSurfaceEvidenceReport
  voice: VoiceDiagnosticsReport
  ttsEngine: TtsEngineReadinessReport
}

export type BuildStabilizationEvidenceReportOptions = {
  generatedAt?: string
}

const EXPECTED_CONTEXT_ITEMS: ContextDiagnosticItemId[] = [
  'active_window',
  'clipboard',
  'screen_ocr',
  'notification_center',
  'local_webhook',
  'telegram',
  'discord',
]

function normalizeIso(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function proactiveCheckPassed(
  report: ProactiveCareEvidenceReport,
  id: ProactiveCareEvidenceReport['checks'][number]['id'],
): boolean {
  return report.checks.some((check) => check.id === id && check.pass)
}

function memoryCheckPassed(
  report: MemoryOwnershipEvidenceReport,
  id: MemoryOwnershipEvidenceReport['checks'][number]['id'],
): boolean {
  return report.checks.some((check) => check.id === id && check.pass)
}

function companionCheckPassed(
  report: CompanionSurfaceEvidenceReport,
  id: CompanionSurfaceEvidenceReport['checks'][number]['id'],
): boolean {
  return report.checks.some((check) => check.id === id && check.pass)
}

function ttsEngineCheckPassed(
  report: TtsEngineReadinessReport,
  id: TtsEngineReadinessReport['checks'][number]['id'],
): boolean {
  return report.checks.some((check) => check.id === id && check.pass)
}

function sanitizeVoiceTtsEvidence(tts: VoiceDiagnosticsReport['tts']): StabilizationVoiceTtsEvidence | null {
  if (!tts) return null
  const { model, voice, ...safeTts } = tts
  return {
    ...safeTts,
    modelConfigured: model.trim().length > 0,
    voiceConfigured: voice.trim().length > 0,
  }
}

function buildContextStatusMap(summary: ContextDiagnosticsSummary) {
  const statuses: Partial<Record<ContextDiagnosticItemId, ContextDiagnosticStatus>> = {}
  const traceLabels: Partial<Record<ContextDiagnosticItemId, string[]>> = {}
  for (const item of summary.items) {
    statuses[item.id] = item.status
    if (item.traces?.length) {
      traceLabels[item.id] = item.traces.map((trace) => trace.labelKey)
    }
  }
  return { statuses, traceLabels }
}

function createCheck(
  check: StabilizationEvidenceCheck,
): StabilizationEvidenceCheck {
  return check
}

function buildChecks(
  contextDiagnostics: ContextDiagnosticsSummary,
  memoryOwnership: MemoryOwnershipEvidenceReport,
  proactiveCare: ProactiveCareEvidenceReport,
  companionSurface: CompanionSurfaceEvidenceReport,
  voice: VoiceDiagnosticsReport,
  ttsEngine: TtsEngineReadinessReport,
): StabilizationEvidenceCheck[] {
  const presentContextIds = new Set(contextDiagnostics.items.map((item) => item.id))
  const missingContextIds = EXPECTED_CONTEXT_ITEMS.filter((id) => !presentContextIds.has(id))
  const proactiveCorePassed = [
    'has-events',
    'has-fired',
    'has-skipped',
    'has-quiet-hours-skip',
    'has-rate-limit-skip',
    'has-key-decision-window-coverage',
  ].every((id) => proactiveCheckPassed(
    proactiveCare,
    id as ProactiveCareEvidenceReport['checks'][number]['id'],
  ))
  const voiceHasRuntimeEvidence = voice.summary.traceCount > 0
    || voice.transitions.count > 0
    || voice.summary.pipelineStep !== 'idle'
    || voice.summary.voiceState !== 'idle'
  const companionActionMapReady = [
    'has-pet-model',
    'has-action-map-coverage',
    'has-action-map-editor-targets',
  ].every((id) => companionCheckPassed(
    companionSurface,
    id as CompanionSurfaceEvidenceReport['checks'][number]['id'],
  ))
  const companionRolePackageReady = [
    'has-character-profiles',
    'has-active-profile-preset',
    'has-keyless-voice-preset',
  ].every((id) => companionCheckPassed(
    companionSurface,
    id as CompanionSurfaceEvidenceReport['checks'][number]['id'],
  ))
  const targetTtsReady = [
    'has-active-provider',
    'has-local-engine',
    'has-delta-streaming',
    'has-first-audio-sample',
    'passes-first-audio-budget',
    'has-target-engine-provider',
    'active-target-engine-selected',
  ].every((id) => ttsEngineCheckPassed(
    ttsEngine,
    id as TtsEngineReadinessReport['checks'][number]['id'],
  ))
  const legacyLowLatencyTtsReady = [
    'has-active-provider',
    'has-local-engine',
    'has-delta-streaming',
    'passes-first-audio-budget',
  ].every((id) => ttsEngineCheckPassed(
    ttsEngine,
    id as TtsEngineReadinessReport['checks'][number]['id'],
  ))

  return [
    createCheck({
      id: 'p1.context_diagnostics_visible',
      area: 'P1',
      status: missingContextIds.length === 0 ? 'pass' : 'missing',
      detail: missingContextIds.length === 0
        ? `${contextDiagnostics.items.length} diagnostic surface(s) visible`
        : `missing diagnostic surface(s): ${missingContextIds.join(', ')}`,
      evidence: {
        readyCount: contextDiagnostics.readyCount,
        totalItems: contextDiagnostics.items.length,
        missingContextIds,
      },
    }),
    createCheck({
      id: 'p1.context_diagnostics_actions',
      area: 'P1',
      status: contextDiagnostics.actionCount > 0 ? 'pass' : 'partial',
      detail: `${contextDiagnostics.actionCount} remediation or evidence action(s) exposed`,
      evidence: {
        actionCount: contextDiagnostics.actionCount,
      },
    }),
    createCheck({
      id: 'p1.memory_ownership',
      area: 'P1',
      status: memoryCheckPassed(memoryOwnership, 'has-editable-data')
        ? 'pass'
        : 'missing',
      detail: `${memoryOwnership.longTermCount} long-term, ${memoryOwnership.dailyEntryCount} daily, ${memoryOwnership.relationshipInsightCount} relationship/reflection item(s)`,
      evidence: {
        longTermCount: memoryOwnership.longTermCount,
        dailyEntryCount: memoryOwnership.dailyEntryCount,
        relationshipInsightCount: memoryOwnership.relationshipInsightCount,
        pinnedCount: memoryOwnership.pinnedCount,
        recallPausedCount: memoryOwnership.recallPausedCount,
        qualityIssueCount: memoryOwnership.qualityIssueCount,
      },
    }),
    createCheck({
      id: 'p1.memory_source_traceability',
      area: 'P1',
      status: memoryCheckPassed(memoryOwnership, 'has-openable-source-refs')
        ? 'pass'
        : memoryOwnership.sourceRefCount > 0
          ? 'partial'
          : 'missing',
      detail: `${memoryOwnership.openableSourceRefCount} openable source reference(s), ${Math.round(memoryOwnership.sourceRefCoverage * 100)}% sourceRef coverage`,
      evidence: {
        sourceRefCount: memoryOwnership.sourceRefCount,
        sourceRefCoverage: memoryOwnership.sourceRefCoverage,
        openableSourceRefCount: memoryOwnership.openableSourceRefCount,
      },
    }),
    createCheck({
      id: 'p1.proactive_care_observability',
      area: 'P1',
      status: proactiveCorePassed
        ? 'pass'
        : proactiveCare.totalEvents > 0
          ? 'partial'
          : 'missing',
      detail: `${proactiveCare.outcomeCounts.fired} fired, ${proactiveCare.outcomeCounts.skipped} skipped, ${proactiveCare.outcomeCounts.error} error occurrence(s)`,
      evidence: {
        totalEvents: proactiveCare.totalEvents,
        fired: proactiveCare.outcomeCounts.fired,
        skipped: proactiveCare.outcomeCounts.skipped,
        decisionWindowCounts: proactiveCare.decisionWindowCounts,
        keyDecisionWindowCount: proactiveCare.keyDecisionWindowCount,
        quietHoursSkipCount: proactiveCare.quietHoursSkipCount,
        rateLimitSkipCount: proactiveCare.rateLimitSkipCount,
      },
    }),
    createCheck({
      id: 'p1.proactive_care_source_refs',
      area: 'P1',
      status: proactiveCheckPassed(proactiveCare, 'has-source-refs')
        && proactiveCheckPassed(proactiveCare, 'has-openable-source-ref-coverage')
        ? 'pass'
        : proactiveCare.sourceRefCount > 0
          ? 'partial'
          : 'missing',
      detail: `${proactiveCare.openableSourceRefCount}/${proactiveCare.sourceRefCount} source reference(s) route to History or Autonomy`,
      evidence: {
        sourceRefCount: proactiveCare.sourceRefCount,
        missingSourceRefCount: proactiveCare.missingSourceRefCount,
        openableSourceRefCount: proactiveCare.openableSourceRefCount,
        sourceRefCoverage: proactiveCare.sourceRefCoverage,
        openableSourceRefCoverage: proactiveCare.openableSourceRefCoverage,
        qualityIssueCount: proactiveCare.qualityIssueCount,
      },
    }),
    createCheck({
      id: 'p1.proactive_care_coverage',
      area: 'P1',
      status: proactiveCheckPassed(proactiveCare, 'has-multi-hour-coverage')
        ? 'pass'
        : proactiveCare.totalEvents > 0
          ? 'partial'
          : 'missing',
      detail: `${proactiveCare.coverageWindowHours}h covered by recent proactive-care events`,
      evidence: {
        coverageWindowHours: proactiveCare.coverageWindowHours,
        firstEventAt: proactiveCare.firstEventAt,
        lastEventAt: proactiveCare.lastEventAt,
      },
    }),
    createCheck({
      id: 'p2.companion_action_map',
      area: 'P2',
      status: companionActionMapReady
        ? 'pass'
        : companionSurface.petModel.present
          ? 'partial'
          : 'missing',
      detail: `${companionSurface.petModel.kind} model, ${Math.round(companionSurface.actionMap.coverage * 100)}% action coverage, ${companionSurface.actionMap.missing} missing target(s)`,
      evidence: {
        petModelKind: companionSurface.petModel.kind,
        hasActionMapReport: companionSurface.petModel.hasActionMapReport,
        expressionSlots: companionSurface.actionMap.expressionSlots,
        mappedExpressions: companionSurface.actionMap.mappedExpressions,
        publicGestures: companionSurface.actionMap.publicGestures,
        mappedGestures: companionSurface.actionMap.mappedGestures,
        lifecycleMotions: companionSurface.actionMap.lifecycleMotions,
        mappedLifecycleMotions: companionSurface.actionMap.mappedLifecycleMotions,
        presenceStates: companionSurface.actionMap.presenceStates,
        mappedPresenceStates: companionSurface.actionMap.mappedPresenceStates,
        idleFidgets: companionSurface.actionMap.idleFidgets,
        missing: companionSurface.actionMap.missing,
        coverage: companionSurface.actionMap.coverage,
        overrideCount: companionSurface.actionMap.overrideCount,
        activeModelHasOverride: companionSurface.actionMap.activeModelHasOverride,
      },
    }),
    createCheck({
      id: 'p2.character_role_package',
      area: 'P2',
      status: companionRolePackageReady
        ? 'pass'
        : companionSurface.characterProfiles.total > 0
          ? 'partial'
          : 'missing',
      detail: `${companionSurface.characterProfiles.total} profile(s), active=${companionSurface.characterProfiles.hasActiveProfile}, keyless/local voice=${companionSurface.voicePreset.activeUsesKeylessOrLocalProvider}`,
      evidence: {
        profileCount: companionSurface.characterProfiles.total,
        hasActiveProfile: companionSurface.characterProfiles.hasActiveProfile,
        profilesWithPetPreset: companionSurface.characterProfiles.profilesWithPetPreset,
        profilesWithVoicePreset: companionSurface.characterProfiles.profilesWithVoicePreset,
        profilesWithInstructions: companionSurface.characterProfiles.profilesWithInstructions,
        profilePersonaInChatEnabled: companionSurface.characterProfiles.profilePersonaInChatEnabled,
        activeHasProvider: companionSurface.voicePreset.activeHasProvider,
        activeHasVoice: companionSurface.voicePreset.activeHasVoice,
        activeHasModel: companionSurface.voicePreset.activeHasModel,
        activeHasInstructions: companionSurface.voicePreset.activeHasInstructions,
        activeUsesKeylessOrLocalProvider: companionSurface.voicePreset.activeUsesKeylessOrLocalProvider,
        qualityIssueCount: companionSurface.qualityIssueCount,
      },
    }),
    createCheck({
      id: 'p2.voice_diagnostics_visible',
      area: 'P2',
      status: voiceHasRuntimeEvidence ? 'pass' : 'partial',
      detail: `${voice.summary.traceCount} trace(s), ${voice.transitions.count} transition(s), status=${voice.summary.status}`,
      evidence: {
        status: voice.summary.status,
        traceCount: voice.summary.traceCount,
        transitionCount: voice.transitions.count,
        errorCount: voice.summary.errorCount,
        pipelineStep: voice.summary.pipelineStep,
        voiceState: voice.summary.voiceState,
      },
    }),
    createCheck({
      id: 'p2.voice_tts_latency',
      area: 'P2',
      status: voice.tts?.firstAudioLatencyStatus === 'pass'
        ? 'pass'
        : voice.tts
          ? 'partial'
          : 'missing',
      detail: voice.tts
        ? `first audio ${voice.tts.firstAudioLatencyStatus}; budget ${voice.tts.firstAudioBudgetMs}ms`
        : 'no TTS diagnostics available',
      evidence: {
        providerId: voice.tts?.providerId ?? null,
        requestMode: voice.tts?.requestMode ?? null,
        firstAudioLatencyStatus: voice.tts?.firstAudioLatencyStatus ?? null,
        firstAudioBudgetMs: voice.tts?.firstAudioBudgetMs ?? null,
      },
    }),
    createCheck({
      id: 'p2.local_tts_engine_readiness',
      area: 'P2',
      status: targetTtsReady
        ? 'pass'
        : legacyLowLatencyTtsReady
          ? 'partial'
          : 'missing',
      detail: `${ttsEngine.activeProvider.kind}/${ttsEngine.activeProvider.protocol ?? 'none'} provider; ${ttsEngine.targetEngines.registeredCount}/${ttsEngine.targetEngines.expectedProviderIds.length} target local engine provider(s); first audio=${ttsEngine.activeProvider.firstAudioLatencyStatus}`,
      evidence: {
        providerId: ttsEngine.activeProvider.providerId,
        catalogRegistered: ttsEngine.activeProvider.catalogRegistered,
        kind: ttsEngine.activeProvider.kind,
        protocol: ttsEngine.activeProvider.protocol,
        localEngine: ttsEngine.activeProvider.localEngine,
        legacyLocalEngine: ttsEngine.activeProvider.legacyLocalEngine,
        targetLocalEngine: ttsEngine.activeProvider.targetLocalEngine,
        deltaStreaming: ttsEngine.activeProvider.deltaStreaming,
        requestMode: ttsEngine.activeProvider.requestMode,
        firstAudioBudgetMs: ttsEngine.activeProvider.firstAudioBudgetMs,
        firstAudioTimeoutMs: ttsEngine.activeProvider.firstAudioTimeoutMs,
        firstAudioLatencyStatus: ttsEngine.activeProvider.firstAudioLatencyStatus,
        modelConfigured: ttsEngine.activeProvider.modelConfigured,
        voiceConfigured: ttsEngine.activeProvider.voiceConfigured,
        registeredTargetEngineCount: ttsEngine.targetEngines.registeredCount,
        missingTargetEngineIds: ttsEngine.targetEngines.missingProviderIds,
        activeTargetEngineId: ttsEngine.targetEngines.activeTargetEngineId,
        qualityIssueCount: ttsEngine.qualityIssueCount,
      },
    }),
  ]
}

export function buildStabilizationEvidenceReport(
  input: BuildStabilizationEvidenceReportInput,
  options: BuildStabilizationEvidenceReportOptions = {},
): StabilizationEvidenceReport {
  const { statuses, traceLabels } = buildContextStatusMap(input.contextDiagnostics)
  const checks = buildChecks(
    input.contextDiagnostics,
    input.memoryOwnership,
    input.proactiveCare,
    input.companionSurface,
    input.voice,
    input.ttsEngine,
  )
  const passCount = checks.filter((check) => check.status === 'pass').length

  return {
    schema: 'nexus.stabilization-evidence.v1',
    generatedAt: normalizeIso(options.generatedAt),
    scope: ['P1', 'P2'],
    overallStatus: passCount === checks.length ? 'ready' : 'needs-evidence',
    passCount,
    totalChecks: checks.length,
    checks,
    contextDiagnostics: {
      readyCount: input.contextDiagnostics.readyCount,
      actionCount: input.contextDiagnostics.actionCount,
      totalItems: input.contextDiagnostics.items.length,
      statuses,
      traceLabels,
    },
    memoryOwnership: {
      longTermCount: input.memoryOwnership.longTermCount,
      dailyEntryCount: input.memoryOwnership.dailyEntryCount,
      relationshipInsightCount: input.memoryOwnership.relationshipInsightCount,
      pinnedCount: input.memoryOwnership.pinnedCount,
      recallPausedCount: input.memoryOwnership.recallPausedCount,
      sourceRefCount: input.memoryOwnership.sourceRefCount,
      sourceRefCoverage: input.memoryOwnership.sourceRefCoverage,
      openableSourceRefCount: input.memoryOwnership.openableSourceRefCount,
      qualityIssueCount: input.memoryOwnership.qualityIssueCount,
      checks: input.memoryOwnership.checks,
    },
    proactiveCare: {
      totalEvents: input.proactiveCare.totalEvents,
      totalOccurrences: input.proactiveCare.totalOccurrences,
      coverageWindowHours: input.proactiveCare.coverageWindowHours,
      outcomeCounts: input.proactiveCare.outcomeCounts,
      decisionWindowCounts: input.proactiveCare.decisionWindowCounts,
      keyDecisionWindowCount: input.proactiveCare.keyDecisionWindowCount,
      sourceCounts: input.proactiveCare.sourceCounts,
      sourceRefCount: input.proactiveCare.sourceRefCount,
      openableSourceRefCount: input.proactiveCare.openableSourceRefCount,
      sourceRefCoverage: input.proactiveCare.sourceRefCoverage,
      openableSourceRefCoverage: input.proactiveCare.openableSourceRefCoverage,
      quietHoursSkipCount: input.proactiveCare.quietHoursSkipCount,
      rateLimitSkipCount: input.proactiveCare.rateLimitSkipCount,
      qualityIssueCount: input.proactiveCare.qualityIssueCount,
      checks: input.proactiveCare.checks,
    },
    companionSurface: {
      petModel: input.companionSurface.petModel,
      actionMap: input.companionSurface.actionMap,
      characterProfiles: input.companionSurface.characterProfiles,
      voicePreset: input.companionSurface.voicePreset,
      qualityIssueCount: input.companionSurface.qualityIssueCount,
      checks: input.companionSurface.checks,
    },
    voice: {
      summary: input.voice.summary,
      transitionCount: input.voice.transitions.count,
      latencies: input.voice.latencies,
      tts: sanitizeVoiceTtsEvidence(input.voice.tts),
    },
    ttsEngine: {
      activeProvider: input.ttsEngine.activeProvider,
      targetEngines: input.ttsEngine.targetEngines,
      qualityIssueCount: input.ttsEngine.qualityIssueCount,
      checks: input.ttsEngine.checks,
    },
  }
}
