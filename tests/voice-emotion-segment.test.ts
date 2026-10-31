import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import type { EmotionState } from '../src/features/autonomy/emotionModel.ts'
import {
  isNeutralSegmentStyle,
  resolveSegmentVoiceStyle,
  voiceEmotionCueFromStageDirection,
  voiceEmotionCueFromTag,
} from '../src/features/voice/voiceEmotion.ts'
import { createTtsStreamService } from '../electron/ttsStreamService.js'
import { resolveOmniVoiceSeed } from '../electron/services/ttsSeed.js'
import { buildQwen3TtsSpeechRequestPayload } from '../electron/services/qwen3TtsPayload.js'
import { splitTextIntoSentences } from '../src/hooks/voice/speechTextSegmentation.ts'
import {
  PerformanceTagStreamFilter,
  StageDirectionStreamFilter,
  extractPerformanceTags,
} from '../src/features/pet/performance.ts'
import { prepareTextForTts } from '../src/features/voice/text.ts'
import { zhCNChatPrompts } from '../src/features/chat/prompts/systemPrompt.zh-CN.ts'
import { zhTWChatPrompts } from '../src/features/chat/prompts/systemPrompt.zh-TW.ts'
import { enUSChatPrompts } from '../src/features/chat/prompts/systemPrompt.en-US.ts'
import { jaChatPrompts } from '../src/features/chat/prompts/systemPrompt.ja.ts'
import { koChatPrompts } from '../src/features/chat/prompts/systemPrompt.ko.ts'

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

  assert.match(styled.instruction, /撒娇|委屈/)
  assert.doesNotMatch(styled.instruction, /兴奋|开心/)
})

test('a neutral cue silences both heuristic and snapshot', () => {
  const cue = voiceEmotionCueFromTag('tts', 'neutral')
  const styled = resolveSegmentVoiceStyle({
    text: '太好了！',
    providerId: 'qwen3-tts-local',
    cue,
    emotion: HAPPY,
  })

  // No tone instruction and no pace nudge; the 1.5x baseline tempo is the
  // provider's own default, not a mood effect.
  assert.deepEqual(styled, { instruction: '', rate: 1, pitch: 1, speechTempo: 1.5 })
})

test('sentence heuristic beats the snapshot', () => {
  const styled = resolveSegmentVoiceStyle({
    text: '真的吗？',
    providerId: 'qwen3-tts-local',
    emotion: HAPPY,
  })

  assert.match(styled.instruction, /自然放松|温和/)
  assert.ok(styled.rate > 1)
})

test('the live snapshot is the fallback for a plain sentence', () => {
  const styled = resolveSegmentVoiceStyle({
    text: '今天天气不错。',
    providerId: 'qwen3-tts-local',
    emotion: HAPPY,
  })

  assert.match(styled.instruction, /开心|兴奋/)
})

test('idle / unknown emotion yields no instruction and no pace change', () => {
  const styled = resolveSegmentVoiceStyle({
    text: '今天天气不错。',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })

  assert.deepEqual(styled, { instruction: '', rate: 1, pitch: 1, speechTempo: 1.5 })
  // The 1.5x baseline IS a change, so a local Qwen3 style always crosses IPC;
  // a provider that carries no tempo still has a truly neutral style.
  assert.equal(isNeutralSegmentStyle(styled), false)
  assert.equal(isNeutralSegmentStyle({ instruction: '', rate: 1, pitch: 1 }), true)
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
    characterId: 'char-a',
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
  assert.match(String(calls[1]!.payload.instructions), /撒娇|委屈/)
  // The second payload does not inherit the first sentence's tone.
  assert.doesNotMatch(String(calls[1]!.payload.instructions), /兴奋/)
  // The identity used to derive the stable seed survives the per-sentence copy.
  assert.equal(calls[0]!.payload.characterId, 'char-a')
  assert.equal(calls[1]!.payload.characterId, 'char-a')
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

// ── Sentence wording beats punctuation ─────────────────────────────────────

const ANGRY_REPLIES = [
  '你怎么又忘了吃饭，真是气死我了！',
  'I am so annoyed with you right now!',
  'もう、ムカつく！',
  '지금 정말 화나!',
]
const SAD_REPLIES = [
  '唉，我有点难过，你都不怎么理我了……',
  'I feel sad and a little lost today...',
  '悲しくて泣きたい……',
  '너무 슬퍼서 울고 싶어……',
]

test('angry words beat the exclamation mark in every working language', () => {
  for (const text of ANGRY_REPLIES) {
    const styled = resolveSegmentVoiceStyle({
      text,
      providerId: 'qwen3-tts-local',
      emotion: IDLE,
    })
    // Angry instruction, not the punctuation-derived excited one.
    assert.match(styled.instruction, /不满/u, text)
    assert.doesNotMatch(styled.instruction, /兴奋/u, text)
  }
})

test('sad words beat the ellipsis in every working language', () => {
  for (const text of SAD_REPLIES) {
    const styled = resolveSegmentVoiceStyle({
      text,
      providerId: 'qwen3-tts-local',
      emotion: IDLE,
    })
    assert.match(styled.instruction, /低落/u, text)
    assert.doesNotMatch(styled.instruction, /迟疑/u, text)
  }
})

test('an ellipsis with no feeling word stays hesitant', () => {
  const styled = resolveSegmentVoiceStyle({
    text: '嗯……让我再想想。',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })
  assert.match(styled.instruction, /害羞|犹豫/u)
})

// ── Stage directions colour the sentence they open ─────────────────────────

test('a leading stage direction becomes that sentence\'s cue', () => {
  const angry = resolveSegmentVoiceStyle({
    text: '（生气）你怎么又这样？',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })
  // Beats the question mark (curious) and the punctuation-driven excited.
  assert.match(angry.instruction, /不满/u)
  assert.doesNotMatch(angry.instruction, /好奇/u)

  const sad = resolveSegmentVoiceStyle({
    text: '（委屈）你都不理我……',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })
  assert.match(sad.instruction, /低落/u)

  const whisper = resolveSegmentVoiceStyle({
    text: '（小声）我跟你说个秘密。',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })
  assert.match(whisper.instruction, /气声|悄悄/u)

  const english = resolveSegmentVoiceStyle({
    text: '(sighs) I guess it is fine.',
    providerId: 'openai-tts',
    emotion: IDLE,
  })
  assert.match(english.instruction, /downcast|softly/u)

  // Nearest leading aside wins when several stack up.
  const stacked = resolveSegmentVoiceStyle({
    text: '（小声）（生气）我告诉你。',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })
  assert.match(stacked.instruction, /不满/u)
})

test('a stage direction beats a feeling word, and an inline cue beats both', () => {
  const fromStage = resolveSegmentVoiceStyle({
    text: '（委屈）真是气死我了！',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })
  assert.match(fromStage.instruction, /低落/u)
  assert.doesNotMatch(fromStage.instruction, /不满/u)

  const cue = voiceEmotionCueFromTag('tts', 'sad')
  assert.ok(cue)
  const fromCue = resolveSegmentVoiceStyle({
    text: '（生气）真是气死我了！',
    providerId: 'qwen3-tts-local',
    cue,
    emotion: HAPPY,
  })
  assert.match(fromCue.instruction, /低落/u)
  assert.doesNotMatch(fromCue.instruction, /不满|轻快/u)
})

test('a stage direction in the middle of a sentence is not a cue', () => {
  const styled = resolveSegmentVoiceStyle({
    text: '我今天真的没事（生气）。',
    providerId: 'qwen3-tts-local',
    emotion: IDLE,
  })
  assert.deepEqual(styled, { instruction: '', rate: 1, pitch: 1, speechTempo: 1.5 })
})

test('the speech filter reports the aside it strips so the sentence keeps its tone', () => {
  const seen: string[] = []
  const filter = new StageDirectionStreamFilter((inner) => seen.push(inner))
  const spoken = filter.push('（生气）你怎么又这样？') + filter.flush()

  assert.equal(spoken, '你怎么又这样？')
  assert.deepEqual(seen, ['生气'])

  const cue = voiceEmotionCueFromStageDirection('生气')
  assert.deepEqual(cue, { kind: 'tts', value: 'angry' })
  const styled = resolveSegmentVoiceStyle({
    text: '你怎么又这样？',
    providerId: 'qwen3-tts-local',
    cue,
    emotion: IDLE,
  })
  assert.match(styled.instruction, /不满/u)
  assert.doesNotMatch(styled.instruction, /好奇/u)
})

test('stage-direction words map across all five working languages', () => {
  const cases: Array<[string, string]> = [
    // Chinese
    ['生气', 'angry'],
    ['委屈', 'sad'],
    ['小声', 'whisper'],
    ['不好意思', 'embarrassed'],
    ['担心', 'worried'],
    // English
    ['sighs', 'sad'],
    ['whispering', 'whisper'],
    ['blush', 'embarrassed'],
    ['worried', 'worried'],
    ['angry', 'angry'],
    // Chinese-traditional shares the phrases; Japanese
    ['怒', 'angry'],
    ['悲し', 'sad'],
    ['心配', 'worried'],
    ['恥ずかし', 'embarrassed'],
    ['囁', 'whisper'],
    // Korean
    ['화나', 'angry'],
    ['슬퍼', 'sad'],
    ['걱정', 'worried'],
    ['부끄', 'embarrassed'],
    ['속삭', 'whisper'],
  ]

  for (const [aside, expected] of cases) {
    assert.equal(
      voiceEmotionCueFromStageDirection(aside)?.value,
      expected,
      `${aside} should map to ${expected}`,
    )
  }

  // A pure gesture is not a voice cue.
  assert.equal(voiceEmotionCueFromStageDirection('歪头'), null)
  assert.equal(voiceEmotionCueFromStageDirection(''), null)
})

// ── The user's [mood:] read is not her emotion ─────────────────────────────

test('a sad user read becomes a caring delivery, never a sad one', () => {
  const mood = voiceEmotionCueFromTag('mood', 'sad-7')
  assert.ok(mood)

  const styled = resolveSegmentVoiceStyle({
    text: '今天天气不错。',
    providerId: 'qwen3-tts-local',
    cue: mood,
    // Her own snapshot would say happy; the read of the user still softens it.
    emotion: HAPPY,
  })
  assert.match(styled.instruction, /关切|担心/u)
  assert.doesNotMatch(styled.instruction, /难过|低落|开心|兴奋/u)
})

test('an angry user read gets the calm direction, never an angry one', () => {
  const mood = voiceEmotionCueFromTag('mood', 'frustrated-8')
  assert.ok(mood)

  const styled = resolveSegmentVoiceStyle({
    text: '今天天气不错。',
    providerId: 'qwen3-tts-local',
    cue: mood,
    emotion: IDLE,
  })
  assert.match(styled.instruction, /自然放松|温和/u)
  assert.doesNotMatch(styled.instruction, /不满/u)
})

test('the sentence itself still outranks the user read', () => {
  const mood = voiceEmotionCueFromTag('mood', 'sad-7')
  assert.ok(mood)

  const styled = resolveSegmentVoiceStyle({
    text: '我有点难过……',
    providerId: 'qwen3-tts-local',
    cue: mood,
    emotion: IDLE,
  })
  assert.match(styled.instruction, /低落/u)
})

// ── Invisible markers stay invisible ───────────────────────────────────────

test('[tts:] markers are stripped from the bubble and from speech', () => {
  const display = extractPerformanceTags('[tts:whisper]我只跟你说。')
  assert.equal(display.content, '我只跟你说。')
  assert.equal(display.ttsCues[0]?.mode, 'whisper')

  const spoken = prepareTextForTts('[tts:whisper]我只跟你说。')
  assert.equal(spoken, '我只跟你说。')

  const seen: string[] = []
  const filter = new PerformanceTagStreamFilter((kind, value) => {
    seen.push(`${kind}:${value}`)
  })
  const visible = filter.push('好呀。[tts:sad]') + filter.flush()
  assert.equal(visible, '好呀。')
  assert.deepEqual(seen, ['tts:sad'])
})

test('every locale prompt teaches the [tts:] tone marker', () => {
  const prompts: Array<[string, string]> = [
    ['zh-CN', zhCNChatPrompts.expressionGuide],
    ['zh-TW', zhTWChatPrompts.expressionGuide],
    ['en-US', enUSChatPrompts.expressionGuide],
    ['ja', jaChatPrompts.expressionGuide],
    ['ko', koChatPrompts.expressionGuide],
  ]

  for (const [locale, guide] of prompts) {
    assert.match(guide, /\[tts:/u, `${locale} must document the [tts:] marker`)
    assert.match(guide, /affectionate/u, `${locale} must list the cue vocabulary`)
    assert.match(guide, /calm/u, `${locale} must list the cue vocabulary`)
  }
})

test('Qwen3 payload carries a seed that is stable per character + voice', () => {
  const first = buildQwen3TtsSpeechRequestPayload(
    { characterId: 'char-a', voice: 'vivian' },
    '你好呀。',
  )
  const second = buildQwen3TtsSpeechRequestPayload(
    { characterId: 'char-a', voice: 'vivian' },
    '今天也好。',
  )
  const otherVoice = buildQwen3TtsSpeechRequestPayload(
    { characterId: 'char-a', voice: 'serena' },
    '你好呀。',
  )

  assert.equal(first.seed, second.seed)
  assert.notEqual(first.seed, otherVoice.seed)
  assert.ok(Number.isInteger(first.seed))
  assert.ok(first.seed > 0)
  assert.ok(first.seed <= 0x7fffffff)
  // The seed never changes the speaker or the streamed format.
  assert.equal(first.voice, 'vivian')
  assert.equal(first.response_format, 'pcm')
})

test('the local Qwen3 path uses the stronger six-group directions', () => {
  // The owner-approved stronger level, one line per delivery group. Pinned so
  // a later "milden it again" edit has to be explicit.
  const cases: Array<[string, string]> = [
    ['calm', '自然放松地说话，像跟熟人平常聊天，语气温和。'],
    ['happy', '非常开心、兴奋，笑着说话，声音明亮上扬，带着雀跃的笑意。'],
    ['affectionate', '撒娇的语气，声音软软的、黏黏的，尾音拖长上扬，有点委屈又想被哄。'],
    ['sad', '难过、低落，声音轻而低沉，说话无力，带着一点哽咽和叹气。'],
    ['angry', '很生气，语气冲、带着不满和责备，声音有力，咬字重。'],
    ['hesitant', '很害羞，声音小、轻柔，说话有点结巴和犹豫，带着不好意思的笑。'],
  ]
  for (const [value, expected] of cases) {
    const cue = voiceEmotionCueFromTag('tts', value)
    assert.ok(cue, value)
    const styled = resolveSegmentVoiceStyle({
      text: '你回来啦。',
      providerId: 'qwen3-tts-local',
      cue,
      emotion: IDLE,
    })
    assert.equal(styled.instruction, expected, value)
  }

  // Every other Chinese provider keeps the old mild clause.
  const omnivoice = resolveSegmentVoiceStyle({
    text: '你回来啦。',
    providerId: 'omnivoice-tts',
    cue: voiceEmotionCueFromTag('tts', 'happy'),
    emotion: IDLE,
  })
  assert.equal(omnivoice.instruction, '音调高一点，语气轻快上扬。')
})
