import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from '../src/lib/settingsMigrations.ts'
import { getSpeechInputProvider } from '../src/lib/speechProviderCatalog.ts'

type ProfileMap = Record<string, { model: string }>

test('schema 14 moves retired MiniMax ids to MiniMax-M3 and keeps the plan', () => {
  const china = migrateSettings({
    settingsSchemaVersion: 14,
    apiBaseUrl: 'https://api.minimaxi.com/anthropic',
    model: 'MiniMax-M2.7-highspeed',
  }, 14)
  assert.equal(china.apiProviderId, 'minimax')
  assert.equal(china.model, 'MiniMax-M3')
  assert.equal(china.settingsSchemaVersion, CURRENT_SETTINGS_SCHEMA_VERSION)

  const globalPayg = migrateSettings({
    settingsSchemaVersion: 14,
    apiBaseUrl: 'https://api.minimax.io/anthropic',
    model: 'MiniMax-M2.7',
  }, 14)
  assert.equal(globalPayg.apiProviderId, 'minimax-global')
  assert.equal(globalPayg.model, 'MiniMax-M3')

  const coding = migrateSettings({
    settingsSchemaVersion: 14,
    apiProviderId: 'minimax-coding',
    apiBaseUrl: 'https://api.minimaxi.com/anthropic',
    model: 'MiniMax-M2.7-highspeed',
    textProviderProfiles: {
      'minimax-coding-global': { model: 'MiniMax-M2.7' },
      minimax: { model: 'MiniMax-M2.5' },
      'minimax-global': { model: 'MiniMax-M2.7-highspeed' },
    },
  }, 14)
  assert.equal(coding.apiProviderId, 'minimax-coding')
  assert.equal(coding.model, 'MiniMax-M3')
  const profiles = coding.textProviderProfiles as ProfileMap
  assert.equal(profiles['minimax-coding-global']?.model, 'MiniMax-M3')
  assert.equal(profiles.minimax?.model, 'MiniMax-M2.5')
  assert.equal(profiles['minimax-global']?.model, 'MiniMax-M3')

  const again = migrateSettings(coding, CURRENT_SETTINGS_SCHEMA_VERSION)
  assert.equal(again.apiProviderId, 'minimax-coding')
  assert.equal(again.model, 'MiniMax-M3')
  assert.equal((again.textProviderProfiles as ProfileMap).minimax?.model, 'MiniMax-M2.5')
})

test('schema 14 moves only the old custom OpenAI STT default', () => {
  const mixed = migrateSettings({
    settingsSchemaVersion: 14,
    speechInputProviderId: 'custom-openai-stt',
    speechInputModel: 'gpt-4o-mini-transcribe',
    speechInputProviderProfiles: {
      'custom-openai-stt': { model: 'my-proxy-model' },
      'openai-stt': { model: 'gpt-4o-mini-transcribe' },
    },
  }, 14)
  assert.equal(mixed.speechInputModel, 'gpt-transcribe')
  const profiles = mixed.speechInputProviderProfiles as ProfileMap
  assert.equal(profiles['custom-openai-stt']?.model, 'my-proxy-model')
  assert.equal(profiles['openai-stt']?.model, 'gpt-4o-mini-transcribe')

  const storedDefault = migrateSettings({
    settingsSchemaVersion: 14,
    speechInputProviderProfiles: {
      'custom-openai-stt': { model: 'gpt-4o-mini-transcribe' },
    },
  }, 14)
  const stored = storedDefault.speechInputProviderProfiles as ProfileMap
  assert.equal(stored['custom-openai-stt']?.model, 'gpt-transcribe')
  assert.equal(getSpeechInputProvider('custom-openai-stt').defaultModel, 'gpt-transcribe')
})
