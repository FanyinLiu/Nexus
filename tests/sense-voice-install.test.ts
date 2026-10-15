import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveMissingSenseVoiceSpeechInput,
  shouldOfferSenseVoiceDownload,
} from '../src/features/voice/senseVoiceInstall.ts'

test('offers a SenseVoice download only while that provider is selected and missing', () => {
  assert.equal(shouldOfferSenseVoiceDownload('local-sensevoice', false), true)
  assert.equal(shouldOfferSenseVoiceDownload('local-sensevoice', true), false)
  assert.equal(shouldOfferSenseVoiceDownload('openai-stt', false), false)
})

test('uses a configured cloud speech provider when SenseVoice is not installed', () => {
  const decision = resolveMissingSenseVoiceSpeechInput({
    speechInputProviderProfiles: {
      'openai-stt': { apiBaseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-transcribe' },
      'grok-stt': { apiBaseUrl: '', apiKey: '', model: '' },
    },
  })
  assert.deepEqual(decision, { action: 'cloud', providerId: 'openai-stt' })
})

test('leaves speech input disabled when no cloud credential is stored', () => {
  const decision = resolveMissingSenseVoiceSpeechInput({
    speechInputProviderProfiles: {
      'local-sensevoice': { apiBaseUrl: '', apiKey: '', model: 'sensevoice-zh-en' },
      'openai-stt': { apiBaseUrl: 'https://api.openai.com/v1', apiKey: '   ', model: 'gpt-transcribe' },
    },
  })
  assert.deepEqual(decision, { action: 'disabled' })
})
