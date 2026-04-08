import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getSpeechOutputAdjustmentSupport,
  getSpeechOutputProviderPreset,
  normalizeSpeechOutputApiBaseUrl,
  USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS,
  USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS,
} from '../src/lib/audioProviders.ts'

test('exposes local sensevoice in the visible speech input provider list', () => {
  assert.equal(
    USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS.some((provider) => provider.id === 'local-sensevoice'),
    true,
  )
})

test('exposes Edge TTS and MiniMax in the visible speech output provider list', () => {
  assert.equal(
    USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS.some((p) => p.id === 'edge-tts'),
    true,
  )
  assert.equal(
    USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS.some((p) => p.id === 'minimax-tts'),
    true,
  )
})

test('returns a valid preset for known providers', () => {
  const edge = getSpeechOutputProviderPreset('edge-tts')
  assert.equal(edge.id, 'edge-tts')

  const minimax = getSpeechOutputProviderPreset('minimax-tts')
  assert.equal(minimax.id, 'minimax-tts')
})

test('returns fallback preset for unknown providers', () => {
  const unknown = getSpeechOutputProviderPreset('nonexistent-tts')
  assert.ok(unknown.id, 'fallback should have an id')
})

test('keeps non-local base URLs unchanged', () => {
  assert.equal(
    normalizeSpeechOutputApiBaseUrl('openai-tts', ' https://api.openai.com/v1/ '),
    'https://api.openai.com/v1',
  )
})

test('edge-tts has rate/pitch/volume adjustment support', () => {
  const support = getSpeechOutputAdjustmentSupport('edge-tts')
  assert.equal(typeof support.rate, 'boolean')
  assert.equal(typeof support.pitch, 'boolean')
  assert.equal(typeof support.volume, 'boolean')
})
