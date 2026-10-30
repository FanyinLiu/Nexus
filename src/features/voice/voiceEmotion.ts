/**
 * Per-sentence voice emotion for TTS.
 *
 * The old pipeline sampled her emotion once when the stream started and reused
 * that instruction for the whole reply, so a happy opening made a sulky closing
 * line sound happy too. This module resolves the style of EACH sentence from:
 *
 *   1. an inline `[tts:…]` / `[mood:…]` cue (strongest — the model said so),
 *   2. the sentence's own shape (？/！/…, laughter, sulky wording),
 *   3. her live emotion snapshot (fallback).
 *
 * Provider capability decides the output: natural-language instructions for
 * Qwen3 / OmniVoice / OpenAI-style providers, MiniMax's native emotion field,
 * and rate/pitch nudges for every provider that can carry them. A neutral /
 * idle sentence yields no instruction at all, so she sounds like herself.
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
export type SegmentEmotion = PetMood | 'sad' | 'angry' | 'sulky' | 'hesitant' | 'whisper'

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
  happy: '语气轻快，带点笑意。',
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
  angry: '语气有点冲，带着不满。',
  sulky: '语气别扭，嘴硬但其实在意。',
  hesitant: '语气迟疑，尾音轻轻收住。',
  whisper: '压低声音，像悄悄话。',
}

const EN_INSTRUCTION: Record<Exclude<SegmentEmotion, 'idle'>, string> = {
  thinking: 'Speak thoughtfully and unhurried.',
  happy: 'Speak with a light, happy lilt.',
  sleepy: 'Speak slowly and drowsily.',
  surprised: 'Speak with a short, surprised brightness.',
  confused: 'Speak hesitantly, as if working it out.',
  embarrassed: 'Speak shyly and softly.',
  excited: 'Speak brightly and with bouncy energy.',
  affectionate: 'Speak warmly and close, as if murmuring.',
  proud: 'Speak with quiet, restrained pride.',
  curious: 'Speak with a curious lift at the end.',
  worried: 'Speak gently, with a note of concern.',
  playful: 'Speak with a playful, teasing smile.',
  sad: 'Speak softly and a little downcast.',
  angry: 'Speak with a sharp, annoyed edge.',
  sulky: 'Sound sulky and stubborn, pretending not to care.',
  hesitant: 'Speak hesitantly, letting the ending trail off.',
  whisper: 'Speak in a lowered, confiding whisper.',
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
  calm: 'thinking',
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
const WHISPER_PATTERN = /(?:小声|悄悄|低声|耳语|偷偷说|whisper)/iu
const QUESTION_PATTERN = /[？?]/u
const EXCITEMENT_PATTERN = /[！!]/u
const ELLIPSIS_PATTERN = /(?:…|\.{3,})/u

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

function resolveHeuristicEmotion(text: string): SegmentEmotion | null {
  if (LAUGH_PATTERN.test(text)) return 'playful'
  if (SULKY_PATTERN.test(text)) return 'sulky'
  if (WHISPER_PATTERN.test(text)) return 'whisper'
  if (QUESTION_PATTERN.test(text)) return 'curious'
  if (EXCITEMENT_PATTERN.test(text)) return 'excited'
  if (ELLIPSIS_PATTERN.test(text)) return 'hesitant'
  return null
}

function resolveEmotion(input: SegmentVoiceStyleInput): SegmentEmotion {
  if (input.cue) {
    const fromCue = resolveCueEmotion(input.cue)
    // A neutral cue intentionally silences the snapshot ("be flat here").
    if (fromCue) return fromCue
  }
  const heuristic = resolveHeuristicEmotion(input.text)
  if (heuristic) return heuristic
  if (input.emotion) return emotionToPetMood(input.emotion)
  return 'idle'
}

/**
 * Resolve one sentence's provider-native voice style. Precedence is
 * cue → sentence heuristic → live snapshot; idle/neutral returns an empty
 * instruction with no pace change.
 */
export function resolveSegmentVoiceStyle(input: SegmentVoiceStyleInput): SegmentVoiceStyle {
  const emotion = resolveEmotion(input)
  if (emotion === 'idle') {
    return { instruction: NEUTRAL_INSTRUCTION, rate: 1, pitch: 1 }
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

/** True when a style would change nothing, so it need not cross IPC. */
export function isNeutralSegmentStyle(style: SegmentVoiceStyle | null | undefined): boolean {
  if (!style) return true
  return !style.instruction.trim()
    && style.rate === 1
    && style.pitch === 1
    && !style.emotion
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
