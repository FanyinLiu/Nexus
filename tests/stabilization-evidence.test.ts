import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  ContextDiagnosticItem,
  ContextDiagnosticItemId,
  ContextDiagnosticStatus,
  ContextDiagnosticsSummary,
} from '../src/features/context/contextDiagnostics.ts'
import {
  buildCompanionSurfaceEvidenceReport,
  type CompanionSurfaceEvidenceSettings,
} from '../src/features/stabilization/companionSurfaceEvidence.ts'
import { buildStabilizationEvidenceReport } from '../src/features/stabilization/stabilizationEvidence.ts'
import { getPetModelPreset } from '../src/features/pet/models.ts'
import { buildTtsEngineReadinessReport } from '../src/features/voice/ttsEngineReadiness.ts'
import { buildVoiceDiagnosticsReport } from '../src/features/voice/voiceDiagnostics.ts'
import type { VoiceTransitionRecord } from '../src/features/voice/voiceTransitionTypes.ts'
import {
  buildMemoryOwnershipEvidenceReport,
  normalizeDailyMemoryStore,
  normalizeMemoryItemsForStorage,
} from '../src/lib/storage/memory.ts'
import {
  buildProactiveCareEvidenceReport,
  normalizeProactiveCareEvents,
} from '../src/lib/storage/proactiveCare.ts'
import type { TranslationKey } from '../src/types/i18n.ts'
import type { VoicePipelineState, VoiceTraceEntry } from '../src/types/voice.ts'

function makeContextItem(
  id: ContextDiagnosticItemId,
  status: ContextDiagnosticStatus = 'ready',
  traces: ContextDiagnosticItem['traces'] = [],
): ContextDiagnosticItem {
  return {
    id,
    labelKey: 'settings.console.context_diagnostics.label.notification_center' as TranslationKey,
    status,
    detailKey: 'settings.console.context_diagnostics.detail.enabled_ready',
    traces,
    actions: [{
      labelKey: 'settings.console.context_diagnostics.action.local_webhook_command',
      command: 'npm run message:validate -- --token "Bearer secret-token"',
    }],
  }
}

function makeContextSummary(
  overrides: Partial<ContextDiagnosticsSummary> = {},
): ContextDiagnosticsSummary {
  const items = [
    makeContextItem('active_window'),
    makeContextItem('clipboard'),
    makeContextItem('screen_ocr'),
    makeContextItem('notification_center'),
    makeContextItem('local_webhook'),
    makeContextItem('telegram', 'ready', [{
      labelKey: 'settings.console.context_diagnostics.trace.last_outbound',
      value: 'text -> private-target · 2026-06-16T10:00:00.000Z',
    }]),
    makeContextItem('discord', 'ready', [{
      labelKey: 'settings.console.context_diagnostics.trace.last_error_at',
      value: 'Discord API 403 for private-channel',
    }]),
  ]

  return {
    actionCount: items.length,
    items,
    readyCount: items.length,
    ...overrides,
  }
}

function makeVoicePipeline(overrides: Partial<VoicePipelineState> = {}): VoicePipelineState {
  return {
    detail: 'ASR finished',
    step: 'recognized',
    transcript: 'private voice transcript should not leave the evidence package',
    updatedAt: '2026-06-16T10:00:00.000Z',
    ...overrides,
  }
}

function makeTrace(overrides: Partial<VoiceTraceEntry> = {}): VoiceTraceEntry {
  return {
    createdAt: '2026-06-16T10:00:00.000Z',
    detail: 'provider returned private diagnostic detail',
    id: 'trace-1',
    title: 'Trace',
    tone: 'info',
    ...overrides,
  }
}

function makeTransition(overrides: Partial<VoiceTransitionRecord>): VoiceTransitionRecord {
  return {
    eventType: 'session:started',
    latencyMs: null,
    meta: null,
    nextPhase: 'listening',
    prevPhase: 'idle',
    provider: null,
    reason: null,
    seq: 1,
    sessionId: 's1',
    ts: 1_000,
    ...overrides,
  }
}

function makeCompanionSettings(
  overrides: Partial<CompanionSurfaceEvidenceSettings> = {},
): CompanionSurfaceEvidenceSettings {
  return {
    activeCharacterProfileId: '',
    characterProfiles: [],
    petActionMapOverrides: {},
    petModelId: 'mao',
    profilePersonaInChatEnabled: false,
    speechOutputInstructions: '',
    speechOutputModel: '',
    speechOutputProviderId: 'edge-tts',
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
    ...overrides,
  }
}

test('stabilization evidence report summarizes P1/P2 proof without private command or trace payloads', () => {
  const memoryOwnership = buildMemoryOwnershipEvidenceReport(
    normalizeMemoryItemsForStorage([
      {
        id: 'private-memory-1',
        content: 'private memory content',
        category: 'preference',
        source: 'chat',
        createdAt: '2026-06-16T09:00:00Z',
        importance: 'pinned',
        sourceRef: 'chat:private-memory-message',
      },
      {
        id: 'private-reflection-1',
        content: 'private reflection content',
        category: 'feedback',
        source: 'dream',
        createdAt: '2026-06-16T09:30:00Z',
        enabled: false,
        importance: 'reflection',
        sourceRef: 'arc:private-memory-arc',
      },
    ]),
    normalizeDailyMemoryStore({
      '2026-06-16': [
        {
          id: 'private-daily-1',
          role: 'user',
          content: 'private daily content',
          source: 'voice',
          sourceRef: 'voice:private-daily-message',
          createdAt: '2026-06-16T10:00:00Z',
        },
      ],
    }),
    '2026-06-16T14:00:00Z',
  )
  const proactiveCare = buildProactiveCareEvidenceReport(normalizeProactiveCareEvents([
    {
      id: 'fire-away',
      source: 'away_notification',
      outcome: 'fired',
      reason: 'fire',
      detail: 'message id private-msg-1',
      createdAt: '2026-06-16T10:00:00Z',
      sourceRef: { kind: 'message', id: 'private-msg-1' },
    },
    {
      id: 'quiet-arc',
      source: 'open_arc',
      outcome: 'skipped',
      reason: 'quiet-hours',
      detail: 'arc id private-arc-1',
      createdAt: '2026-06-16T11:00:00Z',
      sourceRef: { kind: 'arc', id: 'private-arc-1' },
    },
    {
      id: 'cooldown-bracket',
      source: 'daily_bracket',
      outcome: 'skipped',
      reason: 'morning_already_fired_today',
      detail: 'bracket already fired',
      createdAt: '2026-06-16T12:00:00Z',
    },
    {
      id: 'capsule-error',
      source: 'future_capsule',
      outcome: 'error',
      reason: 'notification_failed',
      detail: 'native notification failed',
      createdAt: '2026-06-16T13:00:00Z',
      sourceRef: { kind: 'capsule', id: 'private-capsule-1' },
    },
  ]), '2026-06-16T14:00:00Z')
  const voice = buildVoiceDiagnosticsReport({
    speechOutput: {
      model: 'private-tts-model',
      providerId: 'local-tts',
      voice: 'private-tts-voice',
    },
    speechLevel: 0.5,
    transitionRecords: [
      makeTransition({ seq: 1, eventType: 'mic:acquired', latencyMs: 80 }),
      makeTransition({ seq: 2, eventType: 'stt:final', latencyMs: 220 }),
      makeTransition({ seq: 3, eventType: 'tts:first_audio', latencyMs: 430 }),
    ],
    voicePipeline: makeVoicePipeline(),
    voiceState: 'processing',
    voiceTrace: [makeTrace()],
  }, { generatedAt: '2026-06-16T14:01:00Z' })
  const companionSurface = buildCompanionSurfaceEvidenceReport(makeCompanionSettings({
    activeCharacterProfileId: 'private-profile-1',
    characterProfiles: [{
      id: 'private-profile-1',
      label: 'private role label',
      companionName: 'private companion name',
      systemPrompt: 'private role instructions',
      petModelId: 'mao',
      speechOutputProviderId: 'local-tts',
      speechOutputVoice: 'private-voice-id',
      speechOutputModel: 'private-voice-model',
      speechOutputInstructions: 'private voice instructions',
    }],
    petActionMapOverrides: {
      mao: {
        expressions: {
          happy: 'private-exp-happy',
        },
      },
    },
    profilePersonaInChatEnabled: true,
    speechOutputProviderId: 'volcengine-tts',
    speechOutputVoice: 'fallback-private-voice',
  }), getPetModelPreset('mao'), { generatedAt: '2026-06-16T14:01:30Z' })
  const ttsEngine = buildTtsEngineReadinessReport({
    speechOutputProviderId: 'local-tts',
    tts: voice.tts,
  }, { generatedAt: '2026-06-16T14:01:45Z' })

  const report = buildStabilizationEvidenceReport({
    contextDiagnostics: makeContextSummary(),
    memoryOwnership,
    proactiveCare,
    companionSurface,
    voice,
    ttsEngine,
  }, { generatedAt: '2026-06-16T14:02:00Z' })
  const json = JSON.stringify(report)

  assert.equal(report.schema, 'nexus.stabilization-evidence.v1')
  assert.equal(report.generatedAt, '2026-06-16T14:02:00.000Z')
  assert.equal(report.overallStatus, 'needs-evidence')
  assert.equal(report.passCount, report.totalChecks - 1)
  assert.equal(report.contextDiagnostics.traceLabels.telegram?.[0], 'settings.console.context_diagnostics.trace.last_outbound')
  assert.equal(report.memoryOwnership.longTermCount, 2)
  assert.equal(report.memoryOwnership.dailyEntryCount, 1)
  assert.equal(report.memoryOwnership.openableSourceRefCount, 3)
  assert.equal(report.proactiveCare.totalEvents, 4)
  assert.deepEqual(report.proactiveCare.decisionWindowCounts, {
    due_item: 1,
    error: 1,
    quiet_hours: 1,
    rate_limited: 1,
  })
  assert.equal(report.proactiveCare.keyDecisionWindowCount, 3)
  assert.equal(report.proactiveCare.sourceRefCoverage, 0.75)
  assert.equal(report.proactiveCare.openableSourceRefCount, 3)
  assert.equal(report.proactiveCare.openableSourceRefCoverage, 0.75)
  assert.equal(report.proactiveCare.sourceCounts.away_notification.decisionWindowCounts.due_item, 1)
  assert.equal(report.proactiveCare.sourceCounts.open_arc.openableSourceRefCoverage, 1)
  assert.equal(report.proactiveCare.qualityIssueCount > 0, true)
  assert.equal(report.companionSurface.petModel.kind, 'live2d')
  assert.equal(report.companionSurface.actionMap.coverage, 1)
  assert.equal(report.companionSurface.characterProfiles.total, 1)
  assert.equal(report.companionSurface.voicePreset.activeUsesKeylessOrLocalProvider, true)
  assert.equal(report.voice.transitionCount, 3)
  assert.equal(report.voice.tts?.firstAudioLatencyStatus, 'pass')
  assert.equal(report.voice.tts?.modelConfigured, true)
  assert.equal(report.voice.tts?.voiceConfigured, true)
  assert.equal(report.ttsEngine.activeProvider.legacyLocalEngine, true)
  assert.equal(report.ttsEngine.targetEngines.registeredCount, 2)
  assert.deepEqual(report.ttsEngine.targetEngines.missingProviderIds, [])
  assert.equal(report.checks.find((check) => check.id === 'p2.local_tts_engine_readiness')?.status, 'partial')
  assert.equal(json.includes('Bearer secret-token'), false)
  assert.equal(json.includes('private-target'), false)
  assert.equal(json.includes('private-channel'), false)
  assert.equal(json.includes('private voice transcript'), false)
  assert.equal(json.includes('provider returned private diagnostic detail'), false)
  assert.equal(json.includes('private-msg-1'), false)
  assert.equal(json.includes('private memory content'), false)
  assert.equal(json.includes('private-memory-message'), false)
  assert.equal(json.includes('private-daily-message'), false)
  assert.equal(json.includes('private role label'), false)
  assert.equal(json.includes('private role instructions'), false)
  assert.equal(json.includes('private companion name'), false)
  assert.equal(json.includes('private-voice-id'), false)
  assert.equal(json.includes('private voice instructions'), false)
  assert.equal(json.includes('private-exp-happy'), false)
  assert.equal(json.includes('private-tts-model'), false)
  assert.equal(json.includes('private-tts-voice'), false)
})

test('stabilization evidence report keeps missing P1/P2 evidence explicit', () => {
  const voice = buildVoiceDiagnosticsReport({
    speechLevel: 0,
    transitionRecords: [],
    voicePipeline: makeVoicePipeline({ detail: '', step: 'idle', transcript: '', updatedAt: '' }),
    voiceState: 'idle',
    voiceTrace: [],
  }, { generatedAt: '2026-06-16T14:01:00Z' })
  const report = buildStabilizationEvidenceReport({
    contextDiagnostics: makeContextSummary({
      actionCount: 0,
      items: [makeContextItem('local_webhook', 'disabled')],
      readyCount: 0,
    }),
    memoryOwnership: buildMemoryOwnershipEvidenceReport([], {}, '2026-06-16T14:00:00Z'),
    proactiveCare: buildProactiveCareEvidenceReport([], '2026-06-16T14:00:00Z'),
    companionSurface: buildCompanionSurfaceEvidenceReport(
      makeCompanionSettings({
        petModelId: '',
        speechOutputProviderId: '',
        speechOutputVoice: '',
      }),
      undefined,
      { generatedAt: '2026-06-16T14:00:30Z' },
    ),
    voice,
    ttsEngine: buildTtsEngineReadinessReport({
      speechOutputProviderId: '',
      tts: voice.tts,
    }, { generatedAt: '2026-06-16T14:00:45Z' }),
  }, { generatedAt: 'bad-date' })

  assert.equal(report.overallStatus, 'needs-evidence')
  assert.equal(report.passCount, 0)
  assert.equal(report.totalChecks, 12)
  assert.equal(Number.isFinite(Date.parse(report.generatedAt)), true)
  assert.equal(report.checks.find((check) => check.id === 'p1.context_diagnostics_visible')?.status, 'missing')
  assert.equal(report.checks.find((check) => check.id === 'p1.context_diagnostics_actions')?.status, 'partial')
  assert.equal(report.checks.find((check) => check.id === 'p1.memory_ownership')?.status, 'missing')
  assert.equal(report.checks.find((check) => check.id === 'p1.memory_source_traceability')?.status, 'missing')
  assert.equal(report.checks.find((check) => check.id === 'p1.proactive_care_observability')?.status, 'missing')
  assert.equal(report.checks.find((check) => check.id === 'p1.proactive_care_source_refs')?.status, 'missing')
  assert.equal(report.checks.find((check) => check.id === 'p2.companion_action_map')?.status, 'missing')
  assert.equal(report.checks.find((check) => check.id === 'p2.character_role_package')?.status, 'missing')
  assert.equal(report.checks.find((check) => check.id === 'p2.voice_diagnostics_visible')?.status, 'partial')
  assert.equal(report.checks.find((check) => check.id === 'p2.voice_tts_latency')?.status, 'missing')
  assert.equal(report.checks.find((check) => check.id === 'p2.local_tts_engine_readiness')?.status, 'missing')
})
