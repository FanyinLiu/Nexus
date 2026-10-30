/**
 * Rule-based end-of-turn detection for streaming ASR.
 *
 * The VAD only knows silence. Streaming recognizers also know the latest
 * partial text, so this module decides how much silence that text deserves:
 * a finished sentence is worth ending quickly, a trailing connector or filler
 * means the user is probably still thinking. Providers without partial text
 * keep their plain silence window; callers pass that window as the preset.
 *
 * Pure: no timers, no audio, no storage. The caller owns the silence clock.
 */

export type TurnEndAction = 'end' | 'wait'

export type TurnEndReason = 'empty' | 'complete' | 'trailing' | 'default'

export type TurnEndLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

export type TurnEndInput = {
  /** Latest streaming partial; empty when the provider has no partial text yet. */
  partialTranscript: string
  /** Milliseconds of silence since the last speech frame. */
  silenceMs: number
  /** Recognition / UI locale; unknown tags fall back to English rules. */
  locale: string
  /**
   * The provider's usual silence window. Ordinary text keeps this value;
   * complete text may shorten it and a trailing connector may extend it.
   */
  presetSilenceMs: number
}

export type TurnEndDecision = {
  action: TurnEndAction
  /** Silence the caller should wait for before finishing this turn. */
  thresholdMs: number
  reason: TurnEndReason
}

/** How long to wait after text that already looks finished. */
export const TURN_END_COMPLETE_SILENCE_MS = 600

/** How long to wait after a trailing connector or filler. */
export const TURN_END_TRAILING_SILENCE_MS = 1_600

const FALLBACK_PRESET_SILENCE_MS = 900

const TERMINAL_PUNCTUATION_PATTERN = /[。！？!?….]\s*$/u

const TRAILING_TOKENS: Record<TurnEndLanguage, readonly string[]> = {
  'zh-CN': ['然后那个', '就是说', '然后', '就是', '那个', '因为', '所以', '还有', '但是', '而且', '嗯', '呃'],
  'zh-TW': ['然後那個', '就是說', '然後', '就是', '那個', '因為', '所以', '還有', '但是', '而且', '嗯', '呃'],
  en: ['and', 'but', 'so', 'because', 'like', 'um', 'uh'],
  ja: ['えっと', 'あの', 'それで', 'でも', 'から'],
  ko: ['그리고', '그래서', '근데', '음', '어'],
}

const SHORT_COMPLETE_PATTERNS: Record<TurnEndLanguage, RegExp> = {
  'zh-CN': /^(?:好|好的|好吧|行|可以|对|对的|是|是的|知道了|明白了|懂了|谢谢|没事|没关系|不用了|继续|开始|停|等一下|稍等)[。！？!?，,~～…\s]*$/u,
  'zh-TW': /^(?:好|好的|好吧|行|可以|對|對的|是|是的|知道了|明白了|懂了|謝謝|沒事|沒關係|不用了|繼續|開始|停|等一下|稍等)[。！？!?，,~～…\s]*$/u,
  en: /^(?:ok|okay|yes|yeah|yep|no|nope|sure|right|got it|thanks|thank you|please|continue|go on|stop|wait)[.!?,~]*$/i,
  ja: /^(?:はい|うん|ええ|いいよ|大丈夫|お願い|ありがとう|どうぞ|続けて|わかった|了解|待って)[。！？!?、~～…\s]*$/u,
  ko: /^(?:응|어|네|예|좋아|좋아요|알겠어|알겠어요|고마워|고마워요|계속해|계속해요|잠깐|멈춰)[.!?,~]*$/u,
}

/**
 * Map a BCP-47-ish locale tag onto the four rule sets we maintain.
 * Traditional Chinese is checked before generic `zh`.
 */
export function normalizeTurnEndLanguage(locale: string): TurnEndLanguage {
  const tag = String(locale ?? '').trim().toLowerCase()
  if (tag.startsWith('zh-tw') || tag.startsWith('zh-hant') || tag.startsWith('zh-hk')) return 'zh-TW'
  if (tag.startsWith('zh')) return 'zh-CN'
  if (tag.startsWith('ja')) return 'ja'
  if (tag.startsWith('ko')) return 'ko'
  return 'en'
}

function normalizeText(value: string) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function stripTrailingSoftPunctuation(text: string) {
  return text.replace(/[\s,，、~～…]+$/u, '')
}

function endsWithTrailingToken(text: string, language: TurnEndLanguage) {
  const stripped = stripTrailingSoftPunctuation(text).toLocaleLowerCase()
  if (!stripped) return false

  if (language === 'en') {
    return TRAILING_TOKENS.en.some((token) => (
      new RegExp(`(?:^|[^a-z])${token}$`, 'u').test(stripped)
    ))
  }

  return TRAILING_TOKENS[language].some((token) => stripped.endsWith(token.toLocaleLowerCase()))
}

function looksComplete(text: string, language: TurnEndLanguage) {
  if (TERMINAL_PUNCTUATION_PATTERN.test(text)) return true
  return SHORT_COMPLETE_PATTERNS[language].test(text)
}

/**
 * The widest silence window a caller must allow so the trailing-connector
 * decision can actually take effect. Providers pass their existing preset;
 * the VAD is configured with this ceiling and `decideTurnEnd` does the rest.
 */
export function turnEndMaxSilenceMs(presetSilenceMs: number): number {
  const preset = Number.isFinite(presetSilenceMs) && presetSilenceMs > 0
    ? Math.round(presetSilenceMs)
    : FALLBACK_PRESET_SILENCE_MS
  return Math.max(preset, TURN_END_TRAILING_SILENCE_MS)
}

function normalizedPreset(presetSilenceMs: number) {
  return Number.isFinite(presetSilenceMs) && presetSilenceMs > 0
    ? Math.round(presetSilenceMs)
    : FALLBACK_PRESET_SILENCE_MS
}

/**
 * Decide whether the current silence should finish the user's turn.
 *
 * Order matters: terminal punctuation wins even if the last token could be a
 * connector ("然后？" is a complete question), a trailing connector beats the
 * short-answer list ("嗯" is a filler, not a finished reply), and anything
 * else keeps the provider's preset.
 */
export function decideTurnEnd(input: TurnEndInput): TurnEndDecision {
  const text = normalizeText(input.partialTranscript)
  const preset = normalizedPreset(input.presetSilenceMs)
  const silenceMs = Number.isFinite(input.silenceMs) ? Math.max(0, input.silenceMs) : 0
  const language = normalizeTurnEndLanguage(input.locale)

  let thresholdMs = preset
  let reason: TurnEndReason = 'empty'

  if (text) {
    if (looksComplete(text, language)) {
      thresholdMs = Math.min(TURN_END_COMPLETE_SILENCE_MS, preset)
      reason = 'complete'
    } else if (endsWithTrailingToken(text, language)) {
      thresholdMs = Math.max(TURN_END_TRAILING_SILENCE_MS, preset)
      reason = 'trailing'
    } else {
      reason = 'default'
    }
  }

  return {
    action: silenceMs >= thresholdMs ? 'end' : 'wait',
    thresholdMs,
    reason,
  }
}
