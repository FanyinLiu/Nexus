/**
 * When to let the companion answer with a tiny "mm-hm" while the user talks.
 *
 * This is deliberately conservative: only during a real pause, only after the
 * user has been speaking for a while, never more than once per ten seconds,
 * and only inside a microphone session the user opened themselves. The policy
 * is pure; turning a fire decision into audio is the caller's job.
 */

import {
  mayOpenInterruptMic,
  type InterruptMicPolicyInput,
} from './autoRestartPolicy.ts'
import type { TurnEndAction } from '../hearing/turnEnd.ts'

export type BackchannelLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

export type BackchannelKind = 'question' | 'narrative' | 'agree'

export type BackchannelTokenSet = {
  question: string
  narrative: string
  agree: string
}

export type BackchannelSkipReason =
  | 'disabled'
  | 'mic-not-voice'
  | 'too-short-speech'
  | 'not-a-pause'
  | 'turn-ended'
  | 'rate-limited'

export type BackchannelDecision =
  | { fire: false; reason: BackchannelSkipReason }
  | {
      fire: true
      token: string
      kind: BackchannelKind
      /** Playback gain relative to her normal reply, so it stays unobtrusive. */
      gain: number
    }

export type BackchannelInput = {
  /** Setting switch; false by default and false during typed turns. */
  enabled: boolean
  /** The same click/wake-word gate the interrupt monitor uses. */
  micPolicy: InterruptMicPolicyInput
  /** Time the user has been speaking in this turn. */
  spokenMs: number
  /** Current uninterrupted silence inside the turn. */
  pauseMs: number
  /** T7's decision for this pause; a finished turn never gets a backchannel. */
  turnEndAction: TurnEndAction
  /** Milliseconds since the previous backchannel, or null if none yet. */
  msSinceLastBackchannel: number | null
  /** Number of backchannels already played in the rolling ten-second window. */
  backchannelsInLast10s: number
  /** Latest streaming partial; empty when the provider has none. */
  partialTranscript: string
  locale: string
}

/** The user must have been talking for this long before we answer at all. */
export const BACKCHANNEL_MIN_SPOKEN_MS = 2_500

/** Only a short gap counts as a pause; longer gaps are a finished turn. */
export const BACKCHANNEL_PAUSE_MIN_MS = 250
export const BACKCHANNEL_PAUSE_MAX_MS = 450

/** At most one backchannel per ten seconds, and never sooner than this gap. */
export const BACKCHANNEL_MIN_GAP_MS = 6_000
export const BACKCHANNEL_WINDOW_MS = 10_000
export const BACKCHANNEL_MAX_PER_WINDOW = 1

/** Quiet enough to sit under the user's voice without competing with it. */
export const BACKCHANNEL_GAIN = 0.32

export const BACKCHANNEL_TOKENS: Record<BackchannelLanguage, BackchannelTokenSet> = {
  'zh-CN': { question: '嗯？', narrative: '嗯', agree: '对' },
  'zh-TW': { question: '嗯？', narrative: '嗯', agree: '對' },
  en: { question: 'mm-hm?', narrative: 'mm-hm', agree: 'right' },
  ja: { question: 'うん？', narrative: 'そうなんだ', agree: 'はい' },
  ko: { question: '응?', narrative: '응', agree: '맞아' },
}

const QUESTION_PATTERNS: Record<BackchannelLanguage, RegExp> = {
  'zh-CN': /(?:吗|呢|什么|怎么|为什么|为啥|谁|哪里|哪个|几点|多少|是不是|对不对|好不好|行不行)/u,
  'zh-TW': /(?:嗎|呢|什麼|怎麼|為什麼|誰|哪裡|哪個|幾點|多少|是不是|對不對|好不好|行不行)/u,
  en: /\b(?:what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|will)\b/iu,
  ja: /(?:何|なに|どう|なぜ|なんで|いつ|どこ|だれ|誰|ですか|ますか|の？)/u,
  ko: /(?:뭐|뭘|왜|어떻게|언제|어디|누구|인가요|나요|까요|니|냐)/u,
}

const AGREE_PATTERNS: Record<BackchannelLanguage, RegExp> = {
  'zh-CN': /^(?:对|对啊|是的|没错|好的|好|行|可以|嗯嗯)(?:[，,。！？!?\s]|$)|(?:对|对啊|是的|没错|好的|好|行|可以|嗯嗯)\s*$/u,
  'zh-TW': /^(?:對|對啊|是的|沒錯|好的|好|行|可以|嗯嗯)(?:[，,。！？!?\s]|$)|(?:對|對啊|是的|沒錯|好的|好|行|可以|嗯嗯)\s*$/u,
  en: /^(?:yes|yeah|yep|right|exactly|sure|okay|ok|correct|true)\b|\b(?:yes|yeah|yep|right|exactly|sure|okay|ok|correct|true)\b\s*[.!]?$/iu,
  ja: /^(?:はい|うん|ええ|そう|そうだね|そうです|いいよ|大丈夫|わかった)|(?:はい|うん|ええ|そう|そうだね|そうです|いいよ|大丈夫|わかった)\s*[。！？!?]?$/u,
  ko: /^(?:네|예|응|맞아|맞아요|좋아|좋아요|그래|알겠어|알겠어요)(?:\s|$)|(?:네|예|응|맞아|맞아요|좋아|좋아요|그래|알겠어|알겠어요)\s*[.!?]?$/u,
}

/**
 * Map a locale tag onto the supported persona registers. Traditional Chinese
 * is checked before generic `zh` so `zh-TW` keeps its own token spelling.
 */
export function normalizeBackchannelLanguage(locale: string): BackchannelLanguage {
  const tag = String(locale ?? '').trim().toLowerCase()
  if (tag.startsWith('zh-tw') || tag.startsWith('zh-hant') || tag.startsWith('zh-hk')) return 'zh-TW'
  if (tag.startsWith('zh')) return 'zh-CN'
  if (tag.startsWith('ja')) return 'ja'
  if (tag.startsWith('ko')) return 'ko'
  return 'en'
}

/** The three short clips a voice session may pre-synthesize for this locale. */
export function getBackchannelTokenSet(locale: string): BackchannelTokenSet {
  return BACKCHANNEL_TOKENS[normalizeBackchannelLanguage(locale)]
}

/**
 * Pick the smallest acknowledgement that fits the partial text.
 * Questions get a rising "huh?", agreement gets a confirming token, and
 * everything else gets the neutral listening sound.
 */
export function selectBackchannelToken(
  partialTranscript: string,
  locale: string,
): { token: string; kind: BackchannelKind } {
  const language = normalizeBackchannelLanguage(locale)
  const text = String(partialTranscript ?? '').trim()
  const tokens = BACKCHANNEL_TOKENS[language]

  if (text && (/\?\s*$/u.test(text) || QUESTION_PATTERNS[language].test(text))) {
    return { token: tokens.question, kind: 'question' }
  }

  if (text && AGREE_PATTERNS[language].test(text)) {
    return { token: tokens.agree, kind: 'agree' }
  }

  return { token: tokens.narrative, kind: 'narrative' }
}

/**
 * Decide whether this pause earns a backchannel. A false result is the normal
 * case; callers should treat the function as a cheap gate, not a scheduler.
 */
export function decideBackchannel(input: BackchannelInput): BackchannelDecision {
  if (!input.enabled) return { fire: false, reason: 'disabled' }
  if (!mayOpenInterruptMic(input.micPolicy)) return { fire: false, reason: 'mic-not-voice' }
  if (!Number.isFinite(input.spokenMs) || input.spokenMs < BACKCHANNEL_MIN_SPOKEN_MS) {
    return { fire: false, reason: 'too-short-speech' }
  }
  if (
    !Number.isFinite(input.pauseMs)
    || input.pauseMs < BACKCHANNEL_PAUSE_MIN_MS
    || input.pauseMs > BACKCHANNEL_PAUSE_MAX_MS
  ) {
    return { fire: false, reason: 'not-a-pause' }
  }
  if (input.turnEndAction === 'end') return { fire: false, reason: 'turn-ended' }
  if (
    input.msSinceLastBackchannel !== null
    && input.msSinceLastBackchannel < BACKCHANNEL_MIN_GAP_MS
  ) {
    return { fire: false, reason: 'rate-limited' }
  }
  if (input.backchannelsInLast10s >= BACKCHANNEL_MAX_PER_WINDOW) {
    return { fire: false, reason: 'rate-limited' }
  }

  const { token, kind } = selectBackchannelToken(input.partialTranscript, input.locale)
  return { fire: true, token, kind, gain: BACKCHANNEL_GAIN }
}
