import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSpeechInputServiceConnectionRequest,
  buildSpeechOutputServiceConnectionRequest,
  getSpeechInputProviderOptions,
  getSpeechOutputProviderOptions,
  isWakeWordSupported,
  resolveSpeechInputSettingsView,
  resolveSpeechOutputSettingsView,
} from '../src/features/voice/providerSettings.ts'

test('visible speech provider options come from the provider catalog', () => {
  assert.equal(
    getSpeechInputProviderOptions().some((provider) => provider.id === 'local-sensevoice'),
    true,
  )
  assert.equal(
    getSpeechOutputProviderOptions().some((provider) => provider.id === 'edge-tts'),
    true,
  )
  assert.equal(
    getSpeechOutputProviderOptions().some((provider) => provider.id === 'minimax-tts'),
    true,
  )
  assert.equal(
    getSpeechOutputProviderOptions().some((provider) => provider.id === 'voxtral-local'),
    true,
  )
  assert.equal(
    getSpeechOutputProviderOptions().some((provider) => provider.id === 'kyutai-local'),
    true,
  )
})

test('wake word support accepts Chinese and English, and rejects symbol-only text', () => {
  assert.equal(isWakeWordSupported('你好 Nexus'), true)
  assert.equal(isWakeWordSupported('Hey Nexus'), true)
  assert.equal(isWakeWordSupported('   '), true)
  assert.equal(isWakeWordSupported('🙂✨'), false)
})

test('speech input settings view describes local SenseVoice without remote fields', () => {
  const view = resolveSpeechInputSettingsView({
    speechInputProviderId: 'local-sensevoice',
  })

  assert.equal(view.provider.id, 'local-sensevoice')
  assert.equal(view.isSenseVoice, true)
  assert.equal(view.isLocal, true)
  assert.equal(view.isVolcengine, false)
  assert.equal(view.showBaseUrl, false)
  assert.equal(view.showCredentials, false)
  assert.equal(view.modelLabelKey, 'settings.speech_input.sense_voice_model')
  assert.equal(view.modelHintKey, 'settings.speech_input.sense_voice_hint')
})

test('speech input settings view describes remote Volcengine credentials', () => {
  const view = resolveSpeechInputSettingsView({
    speechInputProviderId: 'volcengine-stt',
  })

  assert.equal(view.provider.id, 'volcengine-stt')
  assert.equal(view.isLocal, false)
  assert.equal(view.isVolcengine, true)
  assert.equal(view.showBaseUrl, true)
  assert.equal(view.showCredentials, true)
  assert.equal(view.modelLabelKey, 'settings.speech_input.model')
  assert.equal(view.modelOptions.some((option) => option.value === 'bigmodel'), true)
})

test('speech output settings view describes Edge TTS as keyless local output', () => {
  const view = resolveSpeechOutputSettingsView({
    speechOutputProviderId: 'edge-tts',
  })

  assert.equal(view.provider.id, 'edge-tts')
  assert.equal(view.isEdgeTts, true)
  assert.equal(view.isMiniMax, false)
  assert.equal(view.hideCredentials, true)
  assert.equal(view.showEndpoint, false)
  assert.equal(view.showCustomVoiceInput, false)
  assert.equal(view.voiceLabelKey, 'settings.speech_output.voice')
})

test('speech output settings view describes Volcengine cluster and voice labels', () => {
  const view = resolveSpeechOutputSettingsView({
    speechOutputProviderId: 'volcengine-tts',
  })

  assert.equal(view.provider.id, 'volcengine-tts')
  assert.equal(view.isVolcengine, true)
  assert.equal(view.hideCredentials, false)
  assert.equal(view.showEndpoint, true)
  assert.equal(view.modelLabelKey, 'settings.speech_output.cluster')
  assert.equal(view.voiceLabelKey, 'settings.speech_output.voice_type')
  assert.equal(view.adjustmentSupport.pitch, true)
})

test('speech output settings view describes target local TTS engines as keyless endpoints', () => {
  const view = resolveSpeechOutputSettingsView({
    speechOutputProviderId: 'voxtral-local',
  })

  assert.equal(view.provider.id, 'voxtral-local')
  assert.equal(view.provider.baseUrl, 'http://127.0.0.1:7860/v1')
  assert.equal(view.provider.defaultModel, 'voxtral-tts')
  assert.equal(view.hideCredentials, true)
  assert.equal(view.showEndpoint, true)
  assert.equal(view.showCustomVoiceInput, true)
  assert.equal(view.modelOptions.some((option) => option.value === 'voxtral-tts'), true)
})

test('speech service connection request builders keep IPC payloads stable', () => {
  assert.deepEqual(
    buildSpeechInputServiceConnectionRequest({
      speechInputProviderId: 'openai-stt',
      speechInputApiBaseUrl: 'https://api.openai.com/v1',
      speechInputApiKey: 'stt-key',
      speechInputModel: 'whisper-1',
    }),
    {
      capability: 'speech-input',
      providerId: 'openai-stt',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'stt-key',
      model: 'whisper-1',
    },
  )

  assert.deepEqual(
    buildSpeechOutputServiceConnectionRequest({
      speechOutputProviderId: 'openai-tts',
      speechOutputApiBaseUrl: 'https://api.openai.com/v1',
      speechOutputApiKey: 'tts-key',
      speechOutputModel: 'gpt-4o-mini-tts',
      speechOutputVoice: 'alloy',
    }),
    {
      capability: 'speech-output',
      providerId: 'openai-tts',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'tts-key',
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
    },
  )
})
