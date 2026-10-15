import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildXaiSttMultipartParts,
  buildXaiTtsRequestBody,
  mapLanguageToXaiStt,
  mapLanguageToXaiTts,
  resolveXaiSttModel,
} from '../electron/services/xaiSpeech.js'
import { getSpeechOutputProviderPreset } from '../src/lib/audioProviders.ts'

test('xAI TTS language mapping pins official codes and otherwise uses auto', () => {
  assert.equal(mapLanguageToXaiTts('zh-CN'), 'zh')
  assert.equal(mapLanguageToXaiTts('ja'), 'ja')
  assert.equal(mapLanguageToXaiTts('en-US'), 'en')
  assert.equal(mapLanguageToXaiTts(''), 'auto')
  assert.equal(mapLanguageToXaiTts('sv'), 'auto')
})

test('xAI STT language mapping omits Chinese because it is not on the official format list', () => {
  assert.equal(mapLanguageToXaiStt('en-US'), 'en')
  assert.equal(mapLanguageToXaiStt('ja'), 'ja')
  assert.equal(mapLanguageToXaiStt('ko'), 'ko')
  assert.equal(mapLanguageToXaiStt('zh-CN'), '')
  assert.equal(mapLanguageToXaiStt('zh-TW'), '')
  assert.equal(mapLanguageToXaiStt(''), '')
})

test('xAI TTS request body uses official field names and clamps speed', () => {
  const body = buildXaiTtsRequestBody(
    { voice: 'ara', language: 'zh-CN', rate: 2 },
    '你好',
    { codec: 'pcm', sampleRate: 24000 },
  )

  assert.deepEqual(body, {
    text: '你好',
    voice_id: 'ara',
    language: 'zh',
    speed: 1.5,
    output_format: { codec: 'pcm', sample_rate: 24000 },
  })
})

test('xAI STT multipart puts option fields before the file', () => {
  const withLanguage = buildXaiSttMultipartParts({
    audioBuffer: Buffer.from('wav'),
    fileName: 'clip.wav',
    mimeType: 'audio/wav',
    language: 'en-US',
  })
  assert.deepEqual(withLanguage.map((part) => part.name), ['model', 'language', 'format', 'file'])
  assert.equal(withLanguage[0]?.value, 'grok-voice-transcribe-2.0')

  const chinese = buildXaiSttMultipartParts({
    audioBuffer: Buffer.from('wav'),
    fileName: 'clip.wav',
    mimeType: 'audio/wav',
    language: 'zh-CN',
  })
  assert.deepEqual(chinese.map((part) => part.name), ['model', 'file'])
  assert.equal(resolveXaiSttModel('grok-stt'), 'grok-voice-transcribe-2.0')
  assert.equal(resolveXaiSttModel(''), 'grok-voice-transcribe-2.0')
  assert.equal(resolveXaiSttModel('custom-stt'), 'custom-stt')
})

test('Grok speech presets point at the official xAI API host', () => {
  const tts = getSpeechOutputProviderPreset('grok-tts')
  assert.equal(tts.baseUrl, 'https://api.x.ai/v1')
  assert.equal(tts.defaultVoice, 'eve')
})
