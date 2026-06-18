import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCompanionHealthSummary,
  type BuildCompanionHealthInput,
  type CompanionHealthItemId,
  type CompanionHealthSettings,
} from '../src/features/onboarding/companionHealth.ts'
import type { PetModelDefinition } from '../src/features/pet/models.ts'

const baseSettings: CompanionHealthSettings = {
  apiBaseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  apiProviderId: 'ollama',
  autonomyNotificationMessagePreviewEnabled: false,
  autonomyNotificationsEnabled: true,
  companionName: 'Nexus',
  contextAwarenessEnabled: true,
  continuousVoiceModeEnabled: false,
  discordAnnounceMessagePreview: false,
  macosMessageWatcherEnabled: true,
  model: 'llama3.1',
  petModelId: 'mao',
  speechInputApiBaseUrl: '',
  speechInputEnabled: true,
  speechInputProviderId: 'local-sensevoice',
  speechOutputApiBaseUrl: '',
  speechOutputEnabled: true,
  speechOutputProviderId: 'edge-tts',
  speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  systemPrompt: 'You are a desktop companion, not a general-purpose agent. 你是一个长期陪伴。',
  telegramAnnounceMessagePreview: false,
  userName: 'Klein',
  voiceTriggerMode: 'manual_confirm',
}

const petModel: PetModelDefinition = {
  id: 'mao',
  label: 'Mao',
  description: 'Default Live2D companion',
  modelPath: '/models/mao.model3.json',
  fallbackImagePath: '/models/mao.png',
  motionGroups: {
    idle: 'Idle',
    listeningStart: 'Tap',
    speakingStart: 'Tap',
  },
  expressionMap: {
    idle: 'F01',
    listening: 'F02',
    speaking: 'F03',
  },
}

function readyInput(patch: Partial<BuildCompanionHealthInput> = {}): BuildCompanionHealthInput {
  return {
    platformProfile: {
      voice: {
        speechInputSupported: true,
        speechInputAvailable: true,
        speechOutputSupported: true,
        speechOutputAvailable: true,
        continuousVoiceSupported: true,
        vadSupported: true,
        wakewordSupported: true,
        dependencyHint: null,
      },
    },
    petModel,
    settings: baseSettings,
    voicePipeline: {
      detail: 'Waiting for the next turn.',
      step: 'idle',
      updatedAt: '2026-06-17T12:00:00.000Z',
    },
    voiceState: 'idle',
    watcherStatus: {
      status: 'running',
      lastError: null,
      platformSupported: true,
    },
    webhookInfo: {
      url: 'http://127.0.0.1:47821/notifications/webhook',
      authHeader: 'Bearer test',
    },
    ...patch,
  }
}

function item(input: BuildCompanionHealthInput, id: CompanionHealthItemId) {
  const found = buildCompanionHealthSummary(input).items.find((candidate) => candidate.id === id)
  assert.ok(found)
  return found
}

test('marks the standard companion path as ready when model, voice, Live2D, context, and privacy are configured', () => {
  const summary = buildCompanionHealthSummary(readyInput())

  assert.equal(summary.status, 'ready')
  assert.equal(summary.readyCount, summary.totalCount)
  assert.equal(item(readyInput(), 'standard_companion').status, 'ready')
  assert.equal(item(readyInput(), 'notification_permission').status, 'ready')
  assert.equal(item(readyInput(), 'privacy_boundary').status, 'ready')
})

test('blocks readiness when the text model launch fields are missing', () => {
  const input = readyInput({
    settings: {
      ...baseSettings,
      apiBaseUrl: '',
    },
  })
  const summary = buildCompanionHealthSummary(input)

  assert.equal(summary.status, 'blocked')
  assert.equal(item(input, 'text_model').status, 'blocked')
  assert.equal(item(input, 'standard_companion').status, 'blocked')
})

test('blocks remote TTS when it is enabled without a required endpoint', () => {
  const input = readyInput({
    settings: {
      ...baseSettings,
      speechOutputProviderId: 'openai-tts',
      speechOutputApiBaseUrl: '',
    },
  })

  assert.equal(item(input, 'tts').status, 'blocked')
})

test('warns when message body previews are enabled', () => {
  const input = readyInput({
    settings: {
      ...baseSettings,
      autonomyNotificationMessagePreviewEnabled: true,
    },
  })

  assert.equal(buildCompanionHealthSummary(input).status, 'warning')
  assert.equal(item(input, 'privacy_boundary').status, 'warning')
})

test('shows a quiet presence state when the current voice pipeline is blocked by policy', () => {
  const input = readyInput({
    focusState: 'away',
    quietReason: 'Wake word is disabled for quiet hours.',
    voicePipeline: {
      detail: 'Wake word is disabled for quiet hours.',
      step: 'blocked_wake_word',
      updatedAt: '2026-06-17T12:05:00.000Z',
    },
  })
  const presence = item(input, 'presence_state')

  assert.equal(presence.status, 'ready')
  assert.equal(presence.evidence.presenceState, 'quiet')
  assert.equal(presence.evidence.quietReason, 'Wake word is disabled for quiet hours.')
  assert.equal(presence.evidence.focusState, 'away')
})

test('shows an away presence state when the user is away and no active voice or quiet reason wins', () => {
  const input = readyInput({
    focusState: 'away',
    voicePipeline: {
      detail: 'Waiting quietly while the user is away.',
      step: 'idle',
      updatedAt: '2026-06-17T12:10:00.000Z',
    },
  })
  const presence = item(input, 'presence_state')

  assert.equal(presence.status, 'ready')
  assert.equal(presence.evidence.presenceState, 'away')
  assert.equal(presence.evidence.focusState, 'away')
})
