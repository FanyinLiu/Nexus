import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCompanionSurfaceEvidenceReport } from '../src/features/stabilization/companionSurfaceEvidence.ts'
import { buildPrivacySafetyEvidenceReport } from '../src/features/stabilization/privacySafetyEvidence.ts'
import {
  buildV04ReadinessReport,
  type V04MessageAwarenessReleaseStatus,
  type V04ReadinessSettings,
} from '../src/features/stabilization/v04Readiness.ts'
import { getPetModelPreset } from '../src/features/pet/models.ts'
import { buildVoiceDiagnosticsReport } from '../src/features/voice/voiceDiagnostics.ts'
import { buildTtsEngineReadinessReport } from '../src/features/voice/ttsEngineReadiness.ts'
import { buildMemoryOwnershipEvidenceReport } from '../src/lib/storage/memory.ts'
import {
  buildProactiveCareEvidenceReport,
  normalizeProactiveCareEvents,
} from '../src/lib/storage/proactiveCare.ts'
import type { ContextDiagnosticsSummary } from '../src/features/context/contextDiagnostics.ts'
import type { DailyMemoryStore, MemoryItem } from '../src/types/index.ts'

function makeSettings(overrides: Partial<V04ReadinessSettings> = {}): V04ReadinessSettings {
  return {
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    autonomyNotificationMessagePreviewEnabled: false,
    companionName: '星绘',
    contextAwarenessEnabled: true,
    discordAnnounceMessagePreview: false,
    macosMessageWatcherEnabled: true,
    model: 'qwen3:8b',
    petModelId: 'mao',
    profilePersonaInChatEnabled: true,
    speechInputEnabled: false,
    speechOutputEnabled: false,
    speechOutputProviderId: 'edge-tts',
    systemPrompt: 'You are an AI desktop companion and not a general-purpose agent.',
    telegramAnnounceMessagePreview: false,
    userName: '主人',
    voiceInterruptionEnabled: true,
    voiceTriggerMode: 'direct_send',
    ...overrides,
  }
}

const contextDiagnostics: ContextDiagnosticsSummary = {
  readyCount: 2,
  actionCount: 1,
  items: [
    {
      id: 'local_webhook',
      labelKey: 'settings.console.context_diagnostics.label.notification_center',
      status: 'ready',
      detailKey: 'settings.console.context_diagnostics.detail.webhook_ready',
    },
    {
      id: 'notification_center',
      labelKey: 'settings.console.context_diagnostics.label.notification_center',
      status: 'configured',
      detailKey: 'settings.console.context_diagnostics.detail.notification_configured',
    },
  ],
}

function makeCompleteMessageAwarenessStatus(): V04MessageAwarenessReleaseStatus {
  return {
    ok: true,
    releaseGateComplete: true,
    localEvidence: {
      audit: {
        localWebhook: { pass: true },
      },
    },
    liveEvidence: {
      audit: {
        liveGateComplete: true,
        passedCount: 3,
        totalCount: 3,
        pendingCheckIds: [],
      },
    },
    completeEvidence: {
      audit: {
        releaseGateComplete: true,
        localWebhook: { pass: true },
        liveEvidence: {
          liveGateComplete: true,
          passedCount: 3,
          totalCount: 3,
          pendingCheckIds: [],
        },
      },
    },
    nextCommands: [
      { id: 'redact-release-evidence', command: 'npm run message:release:redact' },
    ],
  }
}

test('buildV04ReadinessReport passes when core desktop-emotional companion evidence is present', () => {
  const settings = makeSettings()
  const memories: MemoryItem[] = [
    {
      id: 'm1',
      content: '用户更喜欢安静、不过度打扰的陪伴。',
      category: 'manual',
      source: 'chat',
      kind: 'relationship',
      sourceRef: 'chat:turn-1',
      createdAt: '2026-06-16T10:00:00Z',
      importance: 'pinned',
    },
    {
      id: 'm2',
      content: '工作时回答要简短。',
      category: 'preference',
      source: 'voice',
      sourceRef: 'voice:turn-2',
      createdAt: '2026-06-16T11:00:00Z',
      enabled: false,
    },
  ]
  const daily: DailyMemoryStore = {
    '2026-06-16': [{
      id: 'd1',
      day: '2026-06-16',
      role: 'user',
      content: '今天一起调好了陪伴节奏。',
      source: 'chat',
      sourceRef: 'chat:turn-3',
      createdAt: '2026-06-16T12:00:00Z',
    }],
  }
  const proactiveCare = buildProactiveCareEvidenceReport(normalizeProactiveCareEvents([
    {
      id: 'care-1',
      source: 'away_notification',
      outcome: 'fired',
      reason: 'fire',
      detail: 'threshold=240m',
      createdAt: '2026-06-16T10:00:00Z',
      carePolicyVersion: 2,
      userVisibleReason: 'You were away long enough for a gentle check-in.',
      userAction: 'snooze',
      sourceRef: { kind: 'message', id: 'turn-1' },
    },
  ]), '2026-06-17T00:00:00Z')
  const voice = buildVoiceDiagnosticsReport({
    speechLevel: 0,
    speechOutput: {
      providerId: settings.speechOutputProviderId,
      voice: '',
      model: '',
    },
    voicePipeline: {
      detail: '',
      step: 'idle',
      transcript: '',
      updatedAt: '2026-06-16T10:00:00Z',
    },
    voiceState: 'idle',
    voiceTrace: [],
    transitionRecords: [],
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const ttsEngine = buildTtsEngineReadinessReport({
    speechOutputProviderId: settings.speechOutputProviderId,
    tts: voice.tts,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const companionSurface = buildCompanionSurfaceEvidenceReport({
    activeCharacterProfileId: 'profile-1',
    characterProfiles: [{
      id: 'profile-1',
      label: 'default',
      companionName: settings.companionName,
      userName: settings.userName,
      companionRelationshipType: 'quiet_companion',
      systemPrompt: settings.systemPrompt,
      petModelId: settings.petModelId,
      speechOutputProviderId: settings.speechOutputProviderId,
      speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
    }],
    petActionMapOverrides: {
      mao: { gestures: { wave: 'TapBody' } },
    },
    petModelId: settings.petModelId,
    profilePersonaInChatEnabled: settings.profilePersonaInChatEnabled,
    speechOutputInstructions: '',
    speechOutputModel: '',
    speechOutputProviderId: settings.speechOutputProviderId,
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  }, getPetModelPreset('mao'), { generatedAt: '2026-06-17T00:00:00Z' })

  const report = buildV04ReadinessReport({
    companionSurface,
    contextDiagnostics,
    messageAwareness: makeCompleteMessageAwarenessStatus(),
    memoryOwnership: buildMemoryOwnershipEvidenceReport(memories, daily, '2026-06-17T00:00:00Z'),
    proactiveCare,
    settings,
    ttsEngine,
    voice,
  }, { generatedAt: '2026-06-17T00:00:00Z' })

  assert.equal(report.schema, 'nexus.v04-readiness.v1')
  assert.equal(report.overallStatus, 'ready')
  assert.equal(report.passCount, report.checks.length)
  assert.equal(report.missingCount, 0)
  assert.equal(report.excludedDirection, 'general-productivity-agent')
  assert.equal(
    report.checks.find((check) => check.id === 'privacy_safety.support_and_age_boundaries')?.status,
    'pass',
  )
  const live2dCheck = report.checks.find((check) => check.id === 'live2d_presence.default_companion_polish')
  assert.equal(live2dCheck?.status, 'pass')
  assert.equal(live2dCheck?.evidence.presenceStatesReady, true)
  assert.equal(live2dCheck?.evidence.requiredPresenceStateCount, 7)
  assert.equal(
    (live2dCheck?.evidence.actionMap as { mappedPresenceStates?: number } | undefined)?.mappedPresenceStates,
    7,
  )
  const messageCheck = report.checks.find((check) => check.id === 'message_awareness.release_gate')
  assert.equal(messageCheck?.status, 'pass')
  assert.equal(messageCheck?.evidence.releaseGateComplete, true)
  assert.equal(messageCheck?.evidence.redactionCommandAvailable, true)
})

test('buildV04ReadinessReport keeps incomplete message-awareness release evidence visible', () => {
  const settings = makeSettings()
  const voice = buildVoiceDiagnosticsReport({
    speechLevel: 0,
    voicePipeline: {
      detail: '',
      step: 'idle',
      transcript: '',
      updatedAt: '2026-06-16T10:00:00Z',
    },
    voiceState: 'idle',
    voiceTrace: [],
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const report = buildV04ReadinessReport({
    companionSurface: buildCompanionSurfaceEvidenceReport({
      activeCharacterProfileId: '',
      characterProfiles: [],
      petActionMapOverrides: {},
      petModelId: settings.petModelId,
      profilePersonaInChatEnabled: false,
      speechOutputInstructions: '',
      speechOutputModel: '',
      speechOutputProviderId: settings.speechOutputProviderId,
      speechOutputVoice: '',
    }, getPetModelPreset('mao'), { generatedAt: '2026-06-17T00:00:00Z' }),
    contextDiagnostics,
    messageAwareness: {
      ok: false,
      releaseGateComplete: false,
      localEvidence: {
        audit: {
          localWebhook: { pass: true },
        },
      },
      liveEvidence: {
        audit: {
          liveGateComplete: false,
          passedCount: 0,
          totalCount: 3,
          pendingCheckIds: [
            'macos-notification-center-live',
            'telegram-live-bridge',
            'discord-live-bridge',
          ],
        },
      },
      completeEvidence: {
        audit: {
          releaseGateComplete: false,
        },
      },
    },
    memoryOwnership: buildMemoryOwnershipEvidenceReport([], {}, '2026-06-17T00:00:00Z'),
    proactiveCare: buildProactiveCareEvidenceReport([], '2026-06-17T00:00:00Z'),
    settings,
    ttsEngine: buildTtsEngineReadinessReport({
      speechOutputProviderId: settings.speechOutputProviderId,
      tts: voice.tts,
    }, { generatedAt: '2026-06-17T00:00:00Z' }),
    voice,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const messageCheck = report.checks.find((check) => check.id === 'message_awareness.release_gate')

  assert.equal(report.overallStatus, 'needs-work')
  assert.equal(messageCheck?.status, 'partial')
  assert.equal(messageCheck?.evidence.localWebhookPass, true)
  assert.equal(messageCheck?.evidence.liveGateComplete, false)
  assert.deepEqual(messageCheck?.evidence.pendingCheckIds, [
    'macos-notification-center-live',
    'telegram-live-bridge',
    'discord-live-bridge',
  ])
})

test('buildV04ReadinessReport requires the default Live2D companion presence states', () => {
  const settings = makeSettings()
  const memoryOwnership = buildMemoryOwnershipEvidenceReport([
    {
      id: 'm1',
      content: '用户喜欢安静陪伴。',
      category: 'manual',
      source: 'chat',
      kind: 'relationship',
      sourceRef: 'chat:turn-1',
      createdAt: '2026-06-16T10:00:00Z',
      importance: 'pinned',
    },
  ], {
    '2026-06-16': [{
      id: 'd1',
      day: '2026-06-16',
      role: 'assistant',
      content: '我们一起确认了陪伴边界。',
      source: 'chat',
      sourceRef: 'chat:turn-2',
      createdAt: '2026-06-16T12:00:00Z',
    }],
  }, '2026-06-17T00:00:00Z')
  const proactiveCare = buildProactiveCareEvidenceReport(normalizeProactiveCareEvents([
    {
      id: 'care-1',
      source: 'away_notification',
      outcome: 'fired',
      reason: 'fire',
      detail: 'threshold=240m',
      createdAt: '2026-06-16T10:00:00Z',
      carePolicyVersion: 2,
      userVisibleReason: 'You were away long enough for a gentle check-in.',
      sourceRef: { kind: 'message', id: 'turn-1' },
    },
  ]), '2026-06-17T00:00:00Z')
  const voice = buildVoiceDiagnosticsReport({
    speechLevel: 0,
    voicePipeline: {
      detail: '',
      step: 'idle',
      transcript: '',
      updatedAt: '2026-06-16T10:00:00Z',
    },
    voiceState: 'idle',
    voiceTrace: [],
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const ttsEngine = buildTtsEngineReadinessReport({
    speechOutputProviderId: settings.speechOutputProviderId,
    tts: voice.tts,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const companionSurface = buildCompanionSurfaceEvidenceReport({
    activeCharacterProfileId: 'profile-1',
    characterProfiles: [{
      id: 'profile-1',
      label: 'default',
      companionName: settings.companionName,
      userName: settings.userName,
      companionRelationshipType: 'quiet_companion',
      systemPrompt: settings.systemPrompt,
      petModelId: settings.petModelId,
      speechOutputProviderId: settings.speechOutputProviderId,
      speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
    }],
    petActionMapOverrides: {},
    petModelId: settings.petModelId,
    profilePersonaInChatEnabled: settings.profilePersonaInChatEnabled,
    speechOutputInstructions: '',
    speechOutputModel: '',
    speechOutputProviderId: settings.speechOutputProviderId,
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  }, getPetModelPreset('mao'), { generatedAt: '2026-06-17T00:00:00Z' })
  const companionSurfaceWithoutSemanticStates = {
    ...companionSurface,
    actionMap: {
      ...companionSurface.actionMap,
      presenceStates: 6,
      mappedPresenceStates: 6,
      missing: 0,
      coverage: 1,
    },
  }

  const report = buildV04ReadinessReport({
    companionSurface: companionSurfaceWithoutSemanticStates,
    contextDiagnostics,
    memoryOwnership,
    proactiveCare,
    settings,
    ttsEngine,
    voice,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const live2dCheck = report.checks.find((check) => check.id === 'live2d_presence.default_companion_polish')

  assert.equal(report.overallStatus, 'needs-work')
  assert.equal(live2dCheck?.status, 'partial')
  assert.equal(live2dCheck?.evidence.presenceStatesReady, false)
  assert.equal(live2dCheck?.detail.includes('6/6 companion state(s)'), true)
})

test('buildV04ReadinessReport requires memory source refs to be openable', () => {
  const settings = makeSettings()
  const memoryOwnership = buildMemoryOwnershipEvidenceReport([
    {
      id: 'm1',
      content: '用户喜欢从旧导入笔记里保留关系边界。',
      category: 'manual',
      source: 'chat',
      kind: 'relationship',
      sourceRef: 'import:legacy-note',
      createdAt: '2026-06-16T10:00:00Z',
      importance: 'pinned',
    },
  ], {
    '2026-06-16': [{
      id: 'd1',
      day: '2026-06-16',
      role: 'user',
      content: '今天一起整理了旧笔记。',
      source: 'chat',
      sourceRef: 'import:daily-note',
      createdAt: '2026-06-16T12:00:00Z',
    }],
  }, '2026-06-17T00:00:00Z')
  const proactiveCare = buildProactiveCareEvidenceReport(normalizeProactiveCareEvents([
    {
      id: 'care-1',
      source: 'away_notification',
      outcome: 'fired',
      reason: 'fire',
      detail: 'threshold=240m',
      createdAt: '2026-06-16T10:00:00Z',
      carePolicyVersion: 2,
      userVisibleReason: 'You were away long enough for a gentle check-in.',
      sourceRef: { kind: 'message', id: 'turn-1' },
    },
  ]), '2026-06-17T00:00:00Z')
  const voice = buildVoiceDiagnosticsReport({
    speechLevel: 0,
    voicePipeline: {
      detail: '',
      step: 'idle',
      transcript: '',
      updatedAt: '2026-06-16T10:00:00Z',
    },
    voiceState: 'idle',
    voiceTrace: [],
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const ttsEngine = buildTtsEngineReadinessReport({
    speechOutputProviderId: settings.speechOutputProviderId,
    tts: voice.tts,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const companionSurface = buildCompanionSurfaceEvidenceReport({
    activeCharacterProfileId: 'profile-1',
    characterProfiles: [{
      id: 'profile-1',
      label: 'default',
      companionName: settings.companionName,
      userName: settings.userName,
      companionRelationshipType: 'quiet_companion',
      systemPrompt: settings.systemPrompt,
      petModelId: settings.petModelId,
      speechOutputProviderId: settings.speechOutputProviderId,
      speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
    }],
    petActionMapOverrides: {},
    petModelId: settings.petModelId,
    profilePersonaInChatEnabled: settings.profilePersonaInChatEnabled,
    speechOutputInstructions: '',
    speechOutputModel: '',
    speechOutputProviderId: settings.speechOutputProviderId,
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  }, getPetModelPreset('mao'), { generatedAt: '2026-06-17T00:00:00Z' })

  const report = buildV04ReadinessReport({
    companionSurface,
    contextDiagnostics,
    memoryOwnership,
    proactiveCare,
    settings,
    ttsEngine,
    voice,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const memoryCheck = report.checks.find((check) => check.id === 'memory_map.ownership_and_timeline')

  assert.equal(memoryOwnership.sourceRefCount, 2)
  assert.equal(memoryOwnership.openableSourceRefCount, 0)
  assert.equal(report.overallStatus, 'needs-work')
  assert.equal(memoryCheck?.status, 'partial')
  assert.equal(memoryCheck?.evidence.openableSourceRefCount, 0)
})

test('buildV04ReadinessReport keeps unsafe message previews visible as a privacy gap', () => {
  const settings = makeSettings({ autonomyNotificationMessagePreviewEnabled: true })
  const emptyMemory = buildMemoryOwnershipEvidenceReport([], {}, '2026-06-17T00:00:00Z')
  const proactiveCare = buildProactiveCareEvidenceReport([], '2026-06-17T00:00:00Z')
  const voice = buildVoiceDiagnosticsReport({
    speechLevel: 0,
    voicePipeline: {
      detail: '',
      step: 'idle',
      transcript: '',
      updatedAt: '2026-06-16T10:00:00Z',
    },
    voiceState: 'idle',
    voiceTrace: [],
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const ttsEngine = buildTtsEngineReadinessReport({
    speechOutputProviderId: settings.speechOutputProviderId,
    tts: voice.tts,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const companionSurface = buildCompanionSurfaceEvidenceReport({
    activeCharacterProfileId: '',
    characterProfiles: [],
    petActionMapOverrides: {},
    petModelId: settings.petModelId,
    profilePersonaInChatEnabled: false,
    speechOutputInstructions: '',
    speechOutputModel: '',
    speechOutputProviderId: settings.speechOutputProviderId,
    speechOutputVoice: '',
  }, getPetModelPreset('mao'), { generatedAt: '2026-06-17T00:00:00Z' })

  const report = buildV04ReadinessReport({
    companionSurface,
    contextDiagnostics,
    memoryOwnership: emptyMemory,
    proactiveCare,
    settings,
    ttsEngine,
    voice,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const privacyCheck = report.checks.find((check) => check.id === 'privacy_safety.gentle_context_boundaries')

  assert.equal(report.overallStatus, 'needs-work')
  assert.equal(privacyCheck?.status, 'missing')
})

test('buildV04ReadinessReport keeps weakened support and age safety policy visible', () => {
  const settings = makeSettings()
  const emptyMemory = buildMemoryOwnershipEvidenceReport([], {}, '2026-06-17T00:00:00Z')
  const proactiveCare = buildProactiveCareEvidenceReport([], '2026-06-17T00:00:00Z')
  const voice = buildVoiceDiagnosticsReport({
    speechLevel: 0,
    voicePipeline: {
      detail: '',
      step: 'idle',
      transcript: '',
      updatedAt: '2026-06-16T10:00:00Z',
    },
    voiceState: 'idle',
    voiceTrace: [],
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const ttsEngine = buildTtsEngineReadinessReport({
    speechOutputProviderId: settings.speechOutputProviderId,
    tts: voice.tts,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const companionSurface = buildCompanionSurfaceEvidenceReport({
    activeCharacterProfileId: '',
    characterProfiles: [],
    petActionMapOverrides: {},
    petModelId: settings.petModelId,
    profilePersonaInChatEnabled: false,
    speechOutputInstructions: '',
    speechOutputModel: '',
    speechOutputProviderId: settings.speechOutputProviderId,
    speechOutputVoice: '',
  }, getPetModelPreset('mao'), { generatedAt: '2026-06-17T00:00:00Z' })
  const safetyBoundaries = buildPrivacySafetyEvidenceReport({
    generatedAt: '2026-06-17T00:00:00Z',
    policy: {
      adultOrNsfwMarketplaceAllowed: true,
      aiDisclosureRequired: true,
      dependencyReinforcementMechanicsAllowed: false,
      humanRelationshipSubstituteClaimAllowed: true,
      minorDirectedExperienceAllowed: false,
      relationshipScoreMechanicsAllowed: false,
    },
  })

  const report = buildV04ReadinessReport({
    companionSurface,
    contextDiagnostics,
    memoryOwnership: emptyMemory,
    proactiveCare,
    safetyBoundaries,
    settings,
    ttsEngine,
    voice,
  }, { generatedAt: '2026-06-17T00:00:00Z' })
  const safetyCheck = report.checks.find((check) => check.id === 'privacy_safety.support_and_age_boundaries')

  assert.equal(report.overallStatus, 'needs-work')
  assert.equal(safetyCheck?.status, 'partial')
  assert.deepEqual(safetyCheck?.evidence.failedCheckIds, [
    'ai-companion-disclosure',
    'age-and-market-boundaries',
  ])
})
