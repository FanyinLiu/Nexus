import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import type { EmotionState } from '../src/features/autonomy/emotionModel.ts'
import {
  isNeutralSegmentStyle,
  resolveSegmentVoiceStyle,
  voiceEmotionCueFromTag,
} from '../src/features/voice/voiceEmotion.ts'
import { createTtsStreamService } from '../electron/ttsStreamService.js'
import { resolveOmniVoiceSeed } from '../electron/services/ttsSeed.js'
import { splitTextIntoSentences } from '../src/hooks/voice/speechTextSegmentation.ts'

const IDLE: EmotionState = { energy: 0.5, warmth: 0.6, curiosity: 0.5, concern: 0.2 }
const HAPPY: EmotionState = { energy: 0.7, warmth: 0.8, curiosity: 0.4, concern: 0.2 }

function sender() {
  return {
    isDestroyed: () => false,
    send: () => undefined,
    once: () => undefined,
    removeListener: () => undefined,
  }
}

test('sentence splitter keeps the terminal punctuation the heuristic reads', () => {
  assert.deepEqual(
    splitTextIntoSentences('你好！今天好吗？我回来啦。'),
    ['你好！', '今天好吗？', '我回来啦。'],
  )
  assert.deepEqual(
    splitTextIntoSentences('她说：“好。”然后走了。'),
    ['她说：“好。”', '然后走了。'],
  )
})

test('inline cue beats the sentence heuristic and the live snapshot', () => {
  const cue = voiceEmotionCueFromTag('tts', 'sulky')
  assert.ok(cue)

  const styled = resolveSegmentVoiceStyle({
    text: '真的吗？！',
    providerId: 'qwen3-tts-local',
    cue,
    emotion: HAPPY,
  })

  assert.match(styled.instruction, /别扭|嘴硬/)
  assert.doesNotMatch(styled.instruction, /兴奋|轻快/)
})

test('a neutral cue silences both heuristic and snapshot', () => {
  const cue = voiceEmotionCueFromTag('tts', 'neutral')
  const styled = resolveSegmentVoiceStyle({
    text: '太好了！',
    providerId: 'qwen3-tts-local',
    cue,
    emotion: HAPPY,
  })

  assert.deepEqual(styled, { instruction: '', rate: 1, pitch: 1 })
})

test('sentence heuristic beats the snapshot', () => {
  const styled = resolveSegmentVoiceStyle({
    text: '真的吗？',
    providerId: 'qwen3-tts-local',
    emotion: HAPPY,
  })

  assert.match(styled.instruction, /好奇/)
  assert.ok(styled.rate > 1)
})

test('the live snapshot is the fallback for a plain sentence', () => {
  const styled = resolveSegmentVoiceStyle({
    text: '今天天气不错。',
    providerId: 'qwen3-tts-local',
    emotion: HAPPY,
  })

  assert.match(styled.instruction, /轻快/)
})

test('idle / unknown emotion yields no instruction and no pace change', () => {
  const styled = resolveSegmentVoiceStyle({
    text: '今天天气不错。',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })

  assert.deepEqual(styled, { instruction: '', rate: 1, pitch: 1 })
  assert.equal(isNeutralSegmentStyle(styled), true)
  assert.equal(isNeutralSegmentStyle(undefined), true)
  assert.equal(isNeutralSegmentStyle({ instruction: '语气轻快。', rate: 1, pitch: 1 }), false)
})

test('provider mapping: Chinese for local voices, English for OpenAI, emotion for MiniMax', () => {
  const input = { text: '太好了！', emotion: IDLE }

  const qwen = resolveSegmentVoiceStyle({ ...input, providerId: 'qwen3-tts-local' })
  assert.match(qwen.instruction, /[\u4e00-\u9fff]/u)
  assert.match(qwen.instruction, /兴奋/)

  const omni = resolveSegmentVoiceStyle({ ...input, providerId: 'omnivoice-tts' })
  assert.match(omni.instruction, /[\u4e00-\u9fff]/u)

  const openai = resolveSegmentVoiceStyle({ ...input, providerId: 'openai-tts' })
  assert.doesNotMatch(openai.instruction, /[\u4e00-\u9fff]/u)
  assert.match(openai.instruction, /bright|bouncy/i)

  const minimax = resolveSegmentVoiceStyle({ ...input, providerId: 'minimax-tts' })
  assert.equal(minimax.instruction, '')
  assert.equal(minimax.emotion, 'happy')

  const edge = resolveSegmentVoiceStyle({ ...input, providerId: 'edge-tts' })
  assert.equal(edge.instruction, '')
  assert.equal(edge.emotion, undefined)
  assert.ok(edge.rate > 1)
  assert.ok(edge.pitch > 1)
})

test('persona dials colour the instruction instead of a generic mood word', () => {
  const cue = voiceEmotionCueFromTag('tts', 'happy')
  assert.ok(cue)

  const plain = resolveSegmentVoiceStyle({
    text: '你回来啦。',
    providerId: 'qwen3-tts-local',
    cue,
    emotion: IDLE,
  })
  assert.doesNotMatch(plain.instruction, /嘴硬/)

  const tsundere = resolveSegmentVoiceStyle({
    text: '你回来啦。',
    providerId: 'qwen3-tts-local',
    cue,
    emotion: IDLE,
    speechStyle: { tsundere: true },
  })
  assert.match(tsundere.instruction, /嘴硬/)
  assert.match(tsundere.instruction, /开心/)

  const aloof = resolveSegmentVoiceStyle({
    text: '你回来啦。',
    providerId: 'qwen3-tts-local',
    cue,
    emotion: IDLE,
    speechStyle: { aloof: 3 },
  })
  assert.match(aloof.instruction, /保持一点距离/)
  assert.doesNotMatch(aloof.instruction, /轻快/)
})

test('mood cue keeps its intensity and rejects non-voice tag kinds', () => {
  assert.deepEqual(
    voiceEmotionCueFromTag('mood', 'Sad-7'),
    { kind: 'mood', value: 'sad', intensity: 7 },
  )
  assert.deepEqual(
    voiceEmotionCueFromTag('tts', 'Sulky'),
    { kind: 'tts', value: 'sulky' },
  )
  assert.equal(voiceEmotionCueFromTag('expr', 'happy'), null)
  assert.equal(voiceEmotionCueFromTag('tts', ''), null)
})

test('per-sentence style reaches the Qwen3 payload and keeps base instructions', async () => {
  const calls: Array<{ payload: Record<string, unknown>; text: string }> = []
  const service = createTtsStreamService({
    synthesizeRemote: async (payload: Record<string, unknown>, text: string) => {
      calls.push({ payload, text })
      const stream = new Readable({ read() {} })
      stream.push(Buffer.alloc(256))
      stream.push(null)
      return { pcmStream: stream, pcmSampleRate: 24000 }
    },
  })

  const target = sender()
  const requestId = 'segment-style-qwen3'
  await service.start(target, {
    requestId,
    providerId: 'qwen3-tts-local',
    voice: 'vivian',
    baseUrl: 'http://127.0.0.1:8002/v1',
    instructions: '整体温柔一点。',
    rate: 1,
  })

  const excited = resolveSegmentVoiceStyle({
    text: '今天真好！',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })
  const sulky = resolveSegmentVoiceStyle({
    text: '才不会呢……',
    providerId: 'qwen3-tts-local',
    cue: voiceEmotionCueFromTag('tts', 'sulky'),
  })

  service.pushText(target, { requestId, text: '今天真好！', style: excited })
  service.pushText(target, { requestId, text: '才不会呢……', style: sulky })
  await service.finish(target, { requestId })

  assert.equal(calls.length, 2)
  // The pinned speaker never changes; only the sentence tone does.
  assert.equal(calls[0]!.payload.voice, 'vivian')
  assert.equal(calls[1]!.payload.voice, 'vivian')
  assert.match(String(calls[0]!.payload.instructions), /^整体温柔一点。/)
  assert.match(String(calls[0]!.payload.instructions), /兴奋/)
  assert.ok(Number(calls[0]!.payload.rate) > 1)
  assert.match(String(calls[1]!.payload.instructions), /别扭/)
  // The second payload does not inherit the first sentence's tone.
  assert.doesNotMatch(String(calls[1]!.payload.instructions), /兴奋/)
})

test('OmniVoice seed is stable per character + voice across replies', () => {
  const first = resolveOmniVoiceSeed('char-a', 'serena')
  const second = resolveOmniVoiceSeed('char-a', 'serena')

  assert.equal(first, second)
  assert.notEqual(first, resolveOmniVoiceSeed('char-a', 'vivian'))
  assert.notEqual(first, resolveOmniVoiceSeed('char-b', 'serena'))
  assert.ok(Number.isInteger(first))
  assert.ok(first > 0)
  assert.ok(first <= 0x7fffffff)
})
