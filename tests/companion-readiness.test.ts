import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCompanionReadiness,
  type CompanionReadinessItemId,
  type CompanionReadinessInput,
} from '../src/features/onboarding/companionReadiness.ts'

const baseInput: CompanionReadinessInput = {
  userName: 'Klein',
  companionName: 'Nexus',
  apiBaseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'llama3.1',
  textProviderRequiresApiKey: false,
  petModelAvailable: true,
  speechInputEnabled: false,
  speechInputProviderId: '',
  speechInputApiBaseUrl: '',
  speechInputUsesLocalRuntime: false,
  speechOutputEnabled: false,
  speechOutputProviderId: '',
  speechOutputApiBaseUrl: '',
  speechOutputRequiresApiBaseUrl: true,
  continuousVoiceModeEnabled: false,
  autonomyNotificationsEnabled: true,
  macosMessageWatcherEnabled: true,
  autonomyNotificationMessagePreviewEnabled: false,
  telegramAnnounceMessagePreview: false,
  discordAnnounceMessagePreview: false,
}

function itemStatus(input: CompanionReadinessInput, id: CompanionReadinessItemId) {
  const item = buildCompanionReadiness(input).items.find((candidate) => candidate.id === id)
  assert.ok(item)
  return item.status
}

test('marks a text-only companion as ready when the core identity and text model are configured', () => {
  const readiness = buildCompanionReadiness(baseInput)

  assert.equal(readiness.status, 'ready')
  assert.deepEqual(
    readiness.items.map((item) => [item.id, item.status]),
    [
      ['identity', 'ready'],
      ['text', 'ready'],
      ['pet', 'ready'],
      ['message_context', 'ready'],
      ['privacy', 'ready'],
    ],
  )
})

test('blocks readiness when the text model is missing required launch fields', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    apiBaseUrl: '',
  })

  assert.equal(readiness.status, 'blocked')
  assert.equal(itemStatus({ ...baseInput, apiBaseUrl: '' }, 'text'), 'blocked')
})

test('warns when a keyed text provider has no api key yet', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    textProviderRequiresApiKey: true,
  })

  assert.equal(readiness.status, 'warning')
  assert.equal(itemStatus({ ...baseInput, textProviderRequiresApiKey: true }, 'text'), 'warning')
})

test('allows local speech input and keyless speech output without api base urls', () => {
  const input = readinessInputWithLocalVoice()
  const readiness = buildCompanionReadiness(input)

  assert.equal(readiness.status, 'ready')
  assert.equal(itemStatus(input, 'voice'), 'ready')
})

test('blocks remote speech output when it requires an api base url', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    speechOutputEnabled: true,
    speechOutputProviderId: 'openai-tts',
    speechOutputRequiresApiBaseUrl: true,
  })

  assert.equal(readiness.status, 'blocked')
  assert.equal(itemStatus({
    ...baseInput,
    speechOutputEnabled: true,
    speechOutputProviderId: 'openai-tts',
    speechOutputRequiresApiBaseUrl: true,
  }, 'voice'), 'blocked')
})

test('warns when continuous voice is enabled without both sides of speech', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    continuousVoiceModeEnabled: true,
    speechInputEnabled: true,
    speechInputProviderId: 'local-sensevoice',
    speechInputUsesLocalRuntime: true,
  })

  assert.equal(readiness.status, 'warning')
  assert.equal(readiness.items.find((item) => item.id === 'voice')?.messageKey, 'onboarding.readiness.voice.warning_continuous')
})

test('surfaces message context readiness on first-run checklist', () => {
  const bridgeOff = buildCompanionReadiness({
    ...baseInput,
    autonomyNotificationsEnabled: false,
  })
  const watcherOff = buildCompanionReadiness({
    ...baseInput,
    macosMessageWatcherEnabled: false,
  })

  assert.equal(bridgeOff.status, 'warning')
  assert.equal(bridgeOff.items.find((item) => item.id === 'message_context')?.messageKey, 'onboarding.readiness.message_context.warning_off')
  assert.equal(watcherOff.status, 'warning')
  assert.equal(watcherOff.items.find((item) => item.id === 'message_context')?.messageKey, 'onboarding.readiness.message_context.warning_watcher')
})

test('surfaces message preview privacy boundary on first-run checklist', () => {
  const readiness = buildCompanionReadiness({
    ...baseInput,
    telegramAnnounceMessagePreview: true,
  })

  assert.equal(readiness.status, 'warning')
  assert.equal(itemStatus({ ...baseInput, telegramAnnounceMessagePreview: true }, 'privacy'), 'warning')
  assert.equal(readiness.items.find((item) => item.id === 'privacy')?.messageKey, 'onboarding.readiness.privacy.warning_preview')
})

function readinessInputWithLocalVoice(): CompanionReadinessInput {
  return {
    ...baseInput,
    speechInputEnabled: true,
    speechInputProviderId: 'local-sensevoice',
    speechInputUsesLocalRuntime: true,
    speechOutputEnabled: true,
    speechOutputProviderId: 'edge-tts',
    speechOutputRequiresApiBaseUrl: false,
    continuousVoiceModeEnabled: true,
  }
}
