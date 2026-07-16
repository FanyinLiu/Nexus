import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getLocalServiceConnectionRoute } from '../electron/services/serviceConnectionRouting.js'

test('local TTS bypasses the generic HTTP base URL gate', () => {
  assert.equal(getLocalServiceConnectionRoute({
    capability: 'speech-output',
    providerId: 'local-tts',
    baseUrl: '',
  }), 'local-speech-output')
})

test('non-HTTP speech input providers report unsupported tests instead of missing URL', () => {
  for (const providerId of ['local-paraformer', 'tencent-asr']) {
    assert.equal(getLocalServiceConnectionRoute({
      capability: 'speech-input',
      providerId,
      baseUrl: '',
    }), 'unsupported-speech-input-test')
  }
})

test('remote providers continue through normal URL validation', () => {
  assert.equal(getLocalServiceConnectionRoute({
    capability: 'speech-input',
    providerId: 'openai-stt',
    baseUrl: 'https://api.openai.com/v1',
  }), null)
})
