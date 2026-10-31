/**
 * Per-sentence voice emotion for TTS.
 *
 * The old pipeline sampled her emotion once when the stream started and reused
 * that instruction for the whole reply, so a happy opening made a sulky closing
 * line sound happy too. This module resolves the style of EACH sentence from:
 *
 *   1. an inline `[tts:…]` cue (strongest — the model said so),
 *   2. a stage direction that opens the sentence (（生气）/(sighs)),
 *   3. the sentence's own words (a small per-language keyword lexicon),
 *   4. the sentence's shape (？/！/…, laughter, sulky wording),
 *   5. a `[mood:…]` read of the USER, mapped only to a caring delivery,
 *   6. her live emotion snapshot (fallback).
 *
 * A `[mood:…]` tag is never her emotion: if the user is sad she answers
 * gently, she does not answer sad. Provider capability decides the output:
 * natural-language instructions for Qwen3 / OmniVoice / OpenAI-style
 * providers, MiniMax's native emotion field, and rate/pitch nudges for every
 * provider that can carry them. The local Qwen3 stream cannot carry a rate, so
 * it also gets `speechTempo` (see EMOTION_SPEECH_TEMPO) for the pitch-
 * preserving stretcher in the main process. A neutral / idle sentence yields no
 * instruction at all, so she sounds like herself.
 */

import { normalizePersonaSpeechStyle } from '../../../shared/speechStyle.js'
import type { PersonaSpeechStyle } from '../autonomy/v2/personaTypes.ts'
import { emotionToPetMood, type EmotionState } from '../autonomy/emotionModel.ts'
import type { PetMood } from '../../types/pet.ts'
import type { SegmentVoiceStyle, VoiceEmotionCue } from '../../types/voice.ts'

/**
 * Pet moods plus the shades the sentence itself can signal (PetMood has no
 * sad/angry face slots, and sulky/hesitant/whisper are delivery-only).
 */
export type SegmentEmotion = PetMood | 'sad' | 'angry' | 'sulky' | 'hesitant' | 'calm' | 'whisper'

/**
 * Speaking tempo per sentence emotion, for providers that cannot carry a rate
 * themselves (the local Qwen3 C server ignores `rate` on `/v1/tts/stream`, so
 * the rate is applied client-side with a pitch-preserving stretcher).
 *
 * Baseline 1.5 was chosen by ear: at 1.0 the same voice reads too slowly to
 * sound like conversation. The rows are deliberately coarse — six groups, not
 * nineteen — so tuning means nudging one row, not re-auditing every emotion:
 *
 *   neutral / calm                1.5
 *   happy / excited / joy         1.65
 *   coquettish (撒娇) / playful-sulk 1.4
 *   sad / hurt / aggrieved        1.25
 *   angry / annoyed               1.6
 *   shy / hesitant / embarrassed  1.35
 */
export const EMOTION_SPEECH_TEMPO: Record<SegmentEmotion, number> = {
  // neutral / calm / matter-of-fact
  idle: 1.5,
  calm: 1.5,
  thinking: 1.5,
  curious: 1.5,
  proud: 1.5,
  // happy / excited / joy
  happy: 1.65,
  excited: 1.65,
  playful: 1.65,
  surprised: 1.65,
  // coquettish / playful-sulk — drawn-out, wants to be coaxed
  sulky: 1.4,
  affectionate: 1.4,
  // sad / hurt / aggrieved
  sad: 1.25,
  worried: 1.25,
  sleepy: 1.25,
  whisper: 1.25,
  // angry / annoyed
  angry: 1.6,
  // shy / hesitant / embarrassed
  embarrassed: 1.35,
  hesitant: 1.35,
  confused: 1.35,
}

/**
 * Tempo for one sentence emotion; anything outside the table (an unknown cue
 * word, a future mood) falls back to the neutral row.
 */
export function resolveEmotionSpeechTempo(emotion: string | null | undefined): number {
  const key = String(emotion ?? '').trim() as SegmentEmotion
  return EMOTION_SPEECH_TEMPO[key] ?? EMOTION_SPEECH_TEMPO.idle
}

export type SegmentVoiceStyleInput = {
  text: string
  providerId: string
  cue?: VoiceEmotionCue | null
  emotion?: EmotionState | null
  speechStyle?: PersonaSpeechStyle | null
}

export type SegmentStyleResolver = (
  text: string,
  cue?: VoiceEmotionCue | null,
) => SegmentVoiceStyle

export type SegmentStyleResolverOptions = {
  providerId: string
  /** Read lazily so every sentence sees the live snapshot, not stream start. */
  getEmotion?: () => EmotionState | undefined
  getSpeechStyle?: () => PersonaSpeechStyle | undefined
}

type InstructionLanguage = 'zh' | 'en' | 'none'

const NEUTRAL_INSTRUCTION = ''

const ZH_INSTRUCTION: Record<Exclude<SegmentEmotion, 'idle'>, string> = {
  thinking: '语气认真，不紧不慢。',
  happy: '音调高一点，语气轻快上扬。',
  sleepy: '语气困倦，慢慢地说。',
  surprised: '语气惊讶，短促一点。',
  confused: '语气困惑，像在琢磨。',
  embarrassed: '语气有点害羞，声音放软。',
  excited: '语气兴奋，声音亮一点。',
  affectionate: '语气温柔亲近，像在耳边说话。',
  proud: '语气带着克制的得意。',
  curious: '语气带着好奇，尾音微微上扬。',
  worried: '语气关切，带着一点担心。',
  playful: '语气俏皮，带点逗趣的坏笑。',
  sad: '语气低落，声音放轻放慢。',
  angry: '语气冲一点，声音大一些，带着不满。',
  sulky: '语气别扭，声音轻一点，嘴硬但其实在意。',
  hesitant: '语气迟疑，尾音轻轻收住。',
  calm: '语气平静，放缓一点，不急着反驳。',
  whisper: '像说悄悄话一样，用气声，声音很轻很小。',
}

const EN_INSTRUCTION: Record<Exclude<SegmentEmotion, 'idle'>, string> = {
  thinking: 'Speak thoughtfully and unhurried.',
  happy: 'Speak with a light, happy lilt.',
  sleepy: 'Speak slowly and drowsily.',
  surprised: 'Speak with a short, surprised brightness.',
  confused: 'Speak hesitantly, as if working it out.',
  embarrassed: 'Speak shyly and softly.',
  excited: 'Sound thrilled and energized, a bit louder and brighter.',
  affectionate: 'Speak warmly and close, as if murmuring.',
  proud: 'Speak with quiet, restrained pride.',
  curious: 'Speak with a curious lift at the end.',
  worried: 'Speak gently, with a note of concern.',
  playful: 'Speak with a playful, teasing smile.',
  sad: 'Speak softly and a little downcast.',
  angry: 'Speak with a raised, forceful, angry voice.',
  sulky: 'Mumble sulkily, lower and quieter, pretending not to care.',
  hesitant: 'Speak hesitantly, letting the ending trail off.',
  calm: 'Stay calm and steady, a little slower, without pushing back.',
  whisper: 'Speak very quietly, almost inaudible, using breath instead of voice.',
}

/** Cue words the model may emit; unknown words fall through to the text/snapshot. */
const CUE_EMOTIONS: Record<string, SegmentEmotion | 'neutral'> = {
  happy: 'happy',
  joy: 'happy',
  cheerful: 'happy',
  excited: 'excited',
  excitedly: 'excited',
  curious: 'curious',
  question: 'curious',
  questioning: 'curious',
  playful: 'playful',
  teasing: 'playful',
  mischievous: 'playful',
  sulky: 'sulky',
  pout: 'sulky',
  pouting: 'sulky',
  hmph: 'sulky',
  tsundere: 'sulky',
  shy: 'embarrassed',
  embarrassed: 'embarrassed',
  bashful: 'embarrassed',
  hesitant: 'hesitant',
  unsure: 'hesitant',
  sad: 'sad',
  down: 'sad',
  melancholy: 'sad',
  angry: 'angry',
  mad: 'angry',
  annoyed: 'angry',
  frustrated: 'angry',
  sleepy: 'sleepy',
  tired: 'sleepy',
  drowsy: 'sleepy',
  soft: 'affectionate',
  gentle: 'affectionate',
  warm: 'affectionate',
  tender: 'affectionate',
  affectionate: 'affectionate',
  worried: 'worried',
  anxious: 'worried',
  concerned: 'worried',
  proud: 'proud',
  surprised: 'surprised',
  shock: 'surprised',
  confused: 'confused',
  thinking: 'thinking',
  serious: 'thinking',
  calm: 'calm',
  whisper: 'whisper',
  neutral: 'neutral',
  idle: 'neutral',
  none: 'neutral',
  flat: 'neutral',
}

// Text-shape heuristics. Laughter wins over punctuation (a giggling line is
// playful first), then sulky wording, then the punctuation itself.
const LAUGH_PATTERN = /(?:哈{2,}|嘿{2,}|嘻{2,}|笑死|笑了|笑着|haha+|hehe+|lol|lmao|www|😄|😆|🤣|😊)/iu
const SULKY_PATTERN = /(?:哼|才不是|才没有|不理你|讨厌|随便你|谁稀罕|少来|别想多|口是心非|hmph|whatever)/iu
const QUESTION_PATTERN = /[？?]/u
const EXCITEMENT_PATTERN = /[！!]/u
const ELLIPSIS_PATTERN = /(?:…|\.{3,})/u

// Sentence words that name an emotion outright, per working language. This is
// deliberately tiny: a word that clearly names a feeling beats guessing from
// punctuation ("气死我了！" is angry, not excited). Order is precedence.
const SENTENCE_LEXICON: Array<{ emotion: SegmentEmotion; pattern: RegExp }> = [
  {
    emotion: 'angry',
    pattern: /(?:气死|生气|恼火|发火|火大|烦死|讨厌|不爽|气人|angry|annoyed|irritated|furious|ムカ|むか|怒|腹立|いらいら|화나|화가|짜증|열받)/iu,
  },
  {
    emotion: 'sad',
    pattern: /(?:难过|伤心|委屈|失落|低落|沮丧|想哭|唉|sad|upset|downcast|heartbroken|悲し|つらい|寂し|泣き|슬퍼|슬프|속상|울고|우울)/iu,
  },
  {
    emotion: 'worried',
    pattern: /(?:担心|忧虑|不安|揪心|紧张|worried|anxious|concerned|nervous|心配|不安|걱정|불안|초조)/iu,
  },
  {
    emotion: 'affectionate',
    pattern: /(?:温柔|轻声|柔声|宠溺|撒娇|心疼|gentle|softly|tender|lovingly|優し|甘え|다정|애교|살갑)/iu,
  },
  {
    emotion: 'embarrassed',
    pattern: /(?:害羞|脸红|不好意思|羞涩|难为情|shy|blush|bashful|embarrassed|恥ずかし|照れ|부끄|수줍|창피)/iu,
  },
  {
    emotion: 'whisper',
    pattern: /(?:小声|悄悄|低声|耳语|whisper|囁|속삭|소곤|귓속말)/iu,
  },
]

// Existing stage directions already carry her intent ("（生气）", "(sighs)"),
// so they colour the sentence that follows. Display and speech stripping stay
// in `features/pet/performance.ts` and `features/voice/text.ts` — this table
// only READS the aside, it never changes what the user sees or hears.
const STAGE_DIRECTION_EMOTIONS: Array<{ emotion: SegmentEmotion; pattern: RegExp }> = [
  {
    emotion: 'whisper',
    pattern: /(?:小声|悄悄|低声|耳语|气声|whisper|whispering|囁|小声で|속삭|소곤|귓속말)/iu,
  },
  {
    emotion: 'affectionate',
    pattern: /(?:温柔|轻声|柔声|宠溺|撒娇|抱|靠|gentle|softly|tender|warm|hug|lean|優し|甘え|抱き|다정|안아|기대|애교)/iu,
  },
  {
    emotion: 'embarrassed',
    pattern: /(?:害羞|脸红|红着脸|不好意思|羞涩|难为情|blush|shy|bashful|embarrassed|恥ずかし|照れ|부끄|수줍|얼굴이 빨개)/iu,
  },
  {
    emotion: 'sad',
    pattern: /(?:难过|伤心|委屈|失落|低落|沮丧|叹气|唉|sad|upset|sigh|downcast|悲し|つら|寂し|ため息|슬퍼|속상|한숨|울먹)/iu,
  },
  {
    emotion: 'angry',
    pattern: /(?:生气|恼火|发火|火大|不满|皱眉|angry|annoyed|irritated|mad|frown|怒|ムカ|腹立|화나|짜증|화가)/iu,
  },
  {
    emotion: 'worried',
    pattern: /(?:担心|忧虑|不安|紧张|揪心|worried|anxious|concerned|nervous|心配|不安|걱정|불안|초조)/iu,
  },
  {
    emotion: 'sulky',
    pattern: /(?:别扭|傲娇|嘴硬|嘟嘴|撇嘴|哼|sulky|pout|tsundere|ツン|すね|삐|새침|투덜)/iu,
  },
  {
    emotion: 'playful',
    pattern: /(?:调皮|坏笑|偷笑|玩笑|playful|teasing|mischievous|grin|いたずら|冗談|장난|짓궂)/iu,
  },
  {
    emotion: 'sleepy',
    pattern: /(?:困|打哈欠|昏昏欲睡|sleepy|yawn|drowsy|眠|あくび|졸|하품)/iu,
  },
  {
    emotion: 'surprised',
    pattern: /(?:吃惊|惊讶|震惊|愣住|surprised|startled|shock|驚|びっくり|놀라|깜짝)/iu,
  },
  {
    emotion: 'confused',
    pattern: /(?:疑惑|困惑|迷茫|不解|confused|puzzled|困惑|迷|의아|혼란)/iu,
  },
  {
    emotion: 'thinking',
    pattern: /(?:思考|沉吟|思索|认真想|thinking|pondering|thoughtful|考え|思案|생각|골똘)/iu,
  },
  {
    emotion: 'proud',
    pattern: /(?:得意|自豪|骄傲|proud|smug|得意|뿌듯|자랑)/iu,
  },
  {
    emotion: 'happy',
    pattern: /(?:开心|高兴|微笑|笑|雀跃|点头|happy|smile|grin|cheer|嬉し|笑顔|기뻐|웃|행복)/iu,
  },
  {
    emotion: 'excited',
    pattern: /(?:兴奋|激动|期待|excited|thrilled|eager|わくわく|興奮|신나|흥분|기대)/iu,
  },
]

// Asides that open a sentence. Full-width brackets are the RP convention the
// model actually uses; ASCII parentheses are accepted for the same phrases so
// "(sighs)" works too.
const LEADING_ASIDE_PATTERN = /(?:（([^（）\n]{1,24})）|【([^【】\n]{1,24})】|\(([^()\n]{1,24})\))/gu

// Same asides, any position: the lexicon reads the words she actually says, so
// a feeling word inside an aside is not a second cue for the sentence.
const ANY_ASIDE_PATTERN = /(?:（[^（）\n]{1,24}）|【[^【】\n]{1,24}】|\([^()\n]{1,24}\))/gu

// A read of the USER's state only ever softens HER delivery. It never becomes
// her emotion (sad user ≠ sad voice) and sits below every sentence-level cue.
const USER_MOOD_DELIVERY: Record<string, SegmentEmotion | undefined> = {
  sad: 'worried',
  anxious: 'worried',
  tired: 'worried',
  angry: 'calm',
  frustrated: 'calm',
}

const WARM_OR_BRIGHT: ReadonlySet<SegmentEmotion> = new Set([
  'happy', 'excited', 'playful', 'affectionate', 'proud', 'embarrassed', 'curious', 'surprised',
])
const TSUNDERE_POSITIVE: ReadonlySet<SegmentEmotion> = new Set([
  'happy', 'excited', 'playful', 'affectionate', 'proud', 'embarrassed',
])

const EMOTION_NUDGES: Record<Exclude<SegmentEmotion, 'idle'>, { rate: number; pitch: number }> = {
  thinking: { rate: 0.97, pitch: 1 },
  happy: { rate: 1.04, pitch: 1.02 },
  sleepy: { rate: 0.88, pitch: 0.98 },
  surprised: { rate: 1.05, pitch: 1.04 },
  confused: { rate: 0.96, pitch: 1 },
  embarrassed: { rate: 0.96, pitch: 1.01 },
  excited: { rate: 1.08, pitch: 1.04 },
  affectionate: { rate: 0.95, pitch: 1 },
  proud: { rate: 1, pitch: 1.01 },
  curious: { rate: 1.03, pitch: 1.02 },
  worried: { rate: 0.95, pitch: 0.99 },
  playful: { rate: 1.06, pitch: 1.03 },
  sad: { rate: 0.9, pitch: 0.97 },
  angry: { rate: 1.05, pitch: 0.99 },
  sulky: { rate: 0.97, pitch: 0.99 },
  hesitant: { rate: 0.95, pitch: 0.99 },
  calm: { rate: 0.95, pitch: 1 },
  whisper: { rate: 0.9, pitch: 0.97 },
}

/** MiniMax only accepts its own enum; other providers ignore the field. */
const MINIMAX_EMOTION: Partial<Record<SegmentEmotion, string>> = {
  happy: 'happy',
  excited: 'happy',
  playful: 'happy',
  proud: 'happy',
  affectionate: 'happy',
  sad: 'sad',
  sleepy: 'sad',
  angry: 'angry',
  sulky: 'angry',
  worried: 'fearful',
  hesitant: 'fearful',
  surprised: 'surprised',
  curious: 'neutral',
  confused: 'neutral',
  thinking: 'neutral',
  embarrassed: 'neutral',
  calm: 'neutral',
  whisper: 'neutral',
}

function roundNudge(value: number) {
  return Number(value.toFixed(3))
}

function providerInstructionLanguage(providerId: string): InstructionLanguage {
  if (providerId === 'qwen3-tts-local' || providerId === 'omnivoice-tts') return 'zh'
  if (providerId === 'openai-tts' || providerId === 'custom-openai-tts') return 'en'
  return 'none'
}

function colorInstruction(
  emotion: Exclude<SegmentEmotion, 'idle'>,
  style: PersonaSpeechStyle | undefined,
  language: Exclude<InstructionLanguage, 'none'>,
): string {
  const base = language === 'zh' ? ZH_INSTRUCTION[emotion] : EN_INSTRUCTION[emotion]
  const normalized = normalizePersonaSpeechStyle(style)
  if (!normalized) return base

  const aloof = (normalized.aloof ?? 0) >= 2
  const tsundere = normalized.tsundere === true
  const clingy = (normalized.clingy ?? 0) >= 2
  const playful = (normalized.playful ?? 0) >= 2

  if (language === 'zh') {
    if (aloof && WARM_OR_BRIGHT.has(emotion)) {
      return '语气淡淡的，保持一点距离，别显得太热情。'
    }
    let text = base
    if (tsundere && TSUNDERE_POSITIVE.has(emotion)) {
      text = '嘴硬但其实开心，别把心意说得太直白，语气轻快一点。'
    } else if (tsundere && emotion === 'sulky') {
      text = '明明在意，嘴上却不肯承认，语气别扭一点。'
    }
    if (!aloof && clingy) text += '语气软一点，带点撒娇的依赖感。'
    if (!aloof && playful) text += '尾音带点俏皮的坏笑。'
    return text
  }

  if (aloof && WARM_OR_BRIGHT.has(emotion)) {
    return 'Keep it cool and understated, even when pleased.'
  }
  let text = base
  if (tsundere && TSUNDERE_POSITIVE.has(emotion)) {
    text = 'Tsundere: sounds pleased but denies it, flustered and light.'
  } else if (tsundere && emotion === 'sulky') {
    text = 'Sulky and stubborn — clearly cares but will not admit it.'
  }
  if (!aloof && clingy) text += ' Let a soft, coaxing warmth through.'
  if (!aloof && playful) text += ' Let a teasing smile colour the ending.'
  return text
}

function resolveCueEmotion(cue: VoiceEmotionCue): SegmentEmotion | null {
  const alias = CUE_EMOTIONS[cue.value.toLowerCase().trim()]
  if (!alias) return null
  return alias === 'neutral' ? 'idle' : alias
}

/**
 * Map an aside's inner text to the emotion it names, or null when it is just a
 * gesture ("（点头）" is handled by the avatar pipeline, not the voice).
 * Single source for both the leading-aside read below and the streaming
 * speech filter, which strips asides before the chunker ever sees them.
 */
function matchStageDirectionEmotion(inner: string): SegmentEmotion | null {
  const text = inner.trim()
  if (!text) return null
  for (const entry of STAGE_DIRECTION_EMOTIONS) {
    if (entry.pattern.test(text)) return entry.emotion
  }
  return null
}

/**
 * Turn a stage direction (`生气`, `sighs`, `小声`) into a voice cue, so a call
 * site that strips asides from speech can still colour the sentence they open.
 * The returned cue is an inline-tone cue: it outranks the word lexicon.
 */
export function voiceEmotionCueFromStageDirection(stageDirection: string): VoiceEmotionCue | null {
  const emotion = matchStageDirectionEmotion(String(stageDirection ?? ''))
  return emotion ? { kind: 'tts', value: emotion } : null
}

/**
 * Read stage directions that OPEN the sentence (before any spoken words).
 * Only the last leading aside that matches the table wins, so
 * "（小声）（生气）" reads as the nearest instruction. The aside is not
 * removed here — display and speech stripping remain their own concerns.
 */
function resolveStageDirectionEmotion(text: string): SegmentEmotion | null {
  let resolved: SegmentEmotion | null = null
  let cursor = 0

  for (const match of text.matchAll(LEADING_ASIDE_PATTERN)) {
    const index = match.index ?? 0
    // Stop at the first spoken word: an aside mid-sentence is a beat, not the
    // cue for the sentence.
    if (text.slice(cursor, index).replace(/\s/gu, '')) break
    cursor = index + match[0].length
    const emotion = matchStageDirectionEmotion(match[1] ?? match[2] ?? match[3] ?? '')
    if (emotion) resolved = emotion
  }

  return resolved
}

function resolveLexiconEmotion(text: string): SegmentEmotion | null {
  const spoken = text.replace(ANY_ASIDE_PATTERN, ' ')
  for (const entry of SENTENCE_LEXICON) {
    if (entry.pattern.test(spoken)) return entry.emotion
  }
  return null
}

function resolveHeuristicEmotion(text: string): SegmentEmotion | null {
  if (LAUGH_PATTERN.test(text)) return 'playful'
  if (SULKY_PATTERN.test(text)) return 'sulky'
  if (QUESTION_PATTERN.test(text)) return 'curious'
  if (EXCITEMENT_PATTERN.test(text)) return 'excited'
  if (ELLIPSIS_PATTERN.test(text)) return 'hesitant'
  return null
}

function resolveUserMoodDelivery(cue: VoiceEmotionCue | null | undefined): SegmentEmotion | null {
  if (!cue || cue.kind !== 'mood') return null
  return USER_MOOD_DELIVERY[cue.value.toLowerCase().trim()] ?? null
}

function resolveEmotion(input: SegmentVoiceStyleInput): SegmentEmotion {
  if (input.cue && input.cue.kind === 'tts') {
    const fromCue = resolveCueEmotion(input.cue)
    // A neutral cue intentionally silences everything else ("be flat here").
    if (fromCue) return fromCue
  }
  const fromStageDirection = resolveStageDirectionEmotion(input.text)
  if (fromStageDirection) return fromStageDirection
  const fromWords = resolveLexiconEmotion(input.text)
  if (fromWords) return fromWords
  const heuristic = resolveHeuristicEmotion(input.text)
  if (heuristic) return heuristic
  // Her reply is about the user, so their state softens her delivery — but it
  // never overrides what the sentence itself already says.
  const fromMood = resolveUserMoodDelivery(input.cue)
  if (fromMood) return fromMood
  if (input.emotion) return emotionToPetMood(input.emotion)
  return 'idle'
}

/**
 * Resolve one sentence's provider-native voice style. Precedence is
 * `[tts:]` cue → leading stage direction → keyword lexicon → sentence shape →
 * user-mood caring fallback → live snapshot; idle/neutral returns an empty
 * instruction with no pace change.
 */
export function resolveSegmentVoiceStyle(input: SegmentVoiceStyleInput): SegmentVoiceStyle {
  const emotion = resolveEmotion(input)
  // Only the local Qwen3 path applies tempo client-side; every other provider
  // takes its own rate/pitch fields or nothing at all.
  const speechTempo = input.providerId === 'qwen3-tts-local'
    ? resolveEmotionSpeechTempo(emotion)
    : undefined
  const tempoField = speechTempo === undefined ? {} : { speechTempo }

  if (emotion === 'idle') {
    return { instruction: NEUTRAL_INSTRUCTION, rate: 1, pitch: 1, ...tempoField }
  }

  const language = providerInstructionLanguage(input.providerId)
  const instruction = language === 'none'
    ? NEUTRAL_INSTRUCTION
    : colorInstruction(emotion, input.speechStyle ?? undefined, language)
  const nudge = EMOTION_NUDGES[emotion]
  const style: SegmentVoiceStyle = {
    instruction,
    rate: roundNudge(nudge.rate),
    pitch: roundNudge(nudge.pitch),
    ...tempoField,
  }

  if (input.providerId === 'minimax-tts') {
    const minimaxEmotion = MINIMAX_EMOTION[emotion]
    if (minimaxEmotion) style.emotion = minimaxEmotion
  }

  return style
}

/**
 * Build a resolver that reads the live emotion / persona on every sentence.
 * Wiring (hooks) owns the getters; wording and precedence stay here.
 */
export function createSegmentStyleResolver(
  options: SegmentStyleResolverOptions,
): SegmentStyleResolver {
  return (text, cue) => resolveSegmentVoiceStyle({
    text,
    providerId: options.providerId,
    cue,
    emotion: options.getEmotion?.(),
    speechStyle: options.getSpeechStyle?.(),
  })
}

/**
 * True when a style would change nothing, so it need not cross IPC. A tempo
 * counts as a change: the neutral reply is 1.5x, not 1.0x, and main is the
 * side that applies it.
 */
export function isNeutralSegmentStyle(style: SegmentVoiceStyle | null | undefined): boolean {
  if (!style) return true
  return !style.instruction.trim()
    && style.rate === 1
    && style.pitch === 1
    && !style.emotion
    && (style.speechTempo === undefined || style.speechTempo === 1)
}

/**
 * Turn a performance-tag callback (`kind`, raw value) into a voice cue.
 * `[mood:sad-7]` keeps the intensity; other kinds return null.
 */
export function voiceEmotionCueFromTag(kind: string, rawValue: string): VoiceEmotionCue | null {
  const normalizedKind = String(kind ?? '').toLowerCase().trim()
  if (normalizedKind !== 'tts' && normalizedKind !== 'mood') return null

  const raw = String(rawValue ?? '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()

  if (normalizedKind === 'mood') {
    const dash = lower.lastIndexOf('-')
    const maybeIntensity = dash >= 0 ? Number(lower.slice(dash + 1)) : Number.NaN
    const hasIntensity = dash >= 0
      && Number.isInteger(maybeIntensity)
      && maybeIntensity >= 0
      && maybeIntensity <= 9
    return {
      kind: 'mood',
      value: hasIntensity ? lower.slice(0, dash) : lower,
      ...(hasIntensity ? { intensity: maybeIntensity } : {}),
    }
  }

  return { kind: 'tts', value: lower }
}
