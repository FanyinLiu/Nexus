import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertSpeechOutputCredentials,
  getSpeechOutputCredentialError,
} from '../electron/services/ttsProviders.js'

test('cloud TTS providers fail fast when API key is missing', () => {
  assert.match(getSpeechOutputCredentialError('minimax-tts', ''), /MiniMax/)
  assert.match(getSpeechOutputCredentialError('dashscope-tts', '  '), /百炼/)
  assert.match(getSpeechOutputCredentialError('elevenlabs-tts', ''), /ElevenLabs/)
  assert.match(getSpeechOutputCredentialError('openai-tts', ''), /OpenAI/)
  assert.throws(
    () => assertSpeechOutputCredentials('minimax-tts', ''),
    /MiniMax 语音合成请先填写 API Key/,
  )
})

test('keyless and custom TTS providers can proceed without API key', () => {
  assert.equal(getSpeechOutputCredentialError('edge-tts', ''), '')
  assert.equal(getSpeechOutputCredentialError('omnivoice-tts', ''), '')
  assert.equal(getSpeechOutputCredentialError('custom-openai-tts', ''), '')
})

test('volcengine TTS still requires structured app credentials', () => {
  assert.match(getSpeechOutputCredentialError('volcengine-tts', ''), /APP_ID:ACCESS_TOKEN/)
  assert.match(getSpeechOutputCredentialError('volcengine-tts', 'token-only'), /APP_ID:ACCESS_TOKEN/)
  assert.equal(getSpeechOutputCredentialError('volcengine-tts', 'app-id:access-token'), '')
})
