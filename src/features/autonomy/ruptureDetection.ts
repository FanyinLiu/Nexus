/**
 * Gentle rupture detection (M1.7, Phase 1: criticism + contempt only).
 *
 * Looks at a single user message to spot two of John Gottman's "Four
 * Horsemen" of relationship breakdown when directed at the companion:
 *
 *   - Criticism — character attack ("you always", "you never", "you're
 *     so stupid"). Distinct from a complaint about a specific behavior.
 *   - Contempt — mockery, dismissive sneer, name-calling ("dumb bot",
 *     "useless thing", "haha right"). The most corrosive of the four
 *     in Gottman's longitudinal data.
 *
 * Defensiveness and stonewalling need conversation-history or
 * temporal-silence context to detect well; they're explicitly out of
 * scope for this phase.
 *
 * Detection is deliberately conservative — false positives would have
 * the companion responding to "ruptures" the user didn't mean, which
 * is worse than missing real ones. We require the message to carry a
 * clear signal at meaningful magnitude (score ≥ 2). Magnitudes come
 * from regex hits, with stronger patterns weighted higher.
 *
 * The returned kind is consumed by `repairGuidance.ts` to compose a
 * one-turn system-prompt fragment that asks the companion to soften
 * register and avoid counter-arguing — Gottman's "soft start-up"
 * + "accept influence" repair posture.
 */

import type { UiLanguage } from '../../types'

export type RuptureKind = 'criticism' | 'contempt' | null

export interface RuptureDetectionResult {
  kind: RuptureKind
  /** Total magnitude across pattern hits. >= 2 fires; below stays null. */
  score: number
  /** Human-readable trace of which patterns hit. Useful for logging/debug. */
  signals: ReadonlyArray<string>
}

const FIRE_THRESHOLD = 2

interface Pattern {
  regex: RegExp
  weight: number
  signal: string
}

/**
 * Per-locale criticism patterns. Patterns reflect the characteristic
 * "always/never + you" character-attack frame in each locale.
 */
const CRITICISM_PATTERNS: Record<UiLanguage, Pattern[]> = {
  'en-US': [
    { regex: /\byou (always|never) /i, weight: 2, signal: 'criticism:you-always-never' },
    { regex: /\byou'?re (so |such (a |an ))?(stupid|useless|dumb|pathetic|worthless)/i, weight: 3, signal: 'criticism:you-are-X' },
    { regex: /\b(why are you so |what'?s wrong with you)/i, weight: 2, signal: 'criticism:why-are-you' },
  ],
  'zh-CN': [
    { regex: /你(总是|老是|从来不|从不)/, weight: 2, signal: 'criticism:总是/老是' },
    { regex: /你(真|太|这么|那么)(笨|蠢|傻|没用|废)/, weight: 3, signal: 'criticism:你真X' },
    { regex: /你(怎么这么|怎么那么|有什么毛病)/, weight: 2, signal: 'criticism:你怎么这么' },
  ],
  'zh-TW': [
    { regex: /你(總是|老是|從來不|從不)/, weight: 2, signal: 'criticism:總是/老是' },
    { regex: /你(真|太|這麼|那麼)(笨|蠢|傻|沒用|廢)/, weight: 3, signal: 'criticism:你真X' },
    { regex: /你(怎麼這麼|怎麼那麼|有什麼毛病)/, weight: 2, signal: 'criticism:你怎麼這麼' },
  ],
  'ja': [
    { regex: /あなた(は|って)(いつも|絶対|絶対に|全然)/, weight: 2, signal: 'criticism:いつも/絶対' },
    { regex: /あなた(は)?(本当に|ほんとに)(バカ|馬鹿|ばか|無能|役立たず|ダメ)/, weight: 3, signal: 'criticism:あなたは本当に' },
    { regex: /あんた(は)?(本当に|ほんとに)?(バカ|馬鹿|ばか)/, weight: 3, signal: 'criticism:あんたバカ' },
  ],
  'ko': [
    { regex: /(넌|너는|니가|네가)\s?(항상|맨날|늘|절대)/, weight: 2, signal: 'criticism:항상/늘' },
    { regex: /(넌|너는|니가)\s?(진짜|정말|되게)?\s?(바보|멍청|쓸모없|한심|무능)/, weight: 3, signal: 'criticism:넌 바보' },
    { regex: /왜\s?(이렇게|그렇게|항상)\s?(못|안)/, weight: 2, signal: 'criticism:왜 이렇게' },
  ],
}

/**
 * Per-locale contempt patterns. Mockery, sneering dismissal, name-calling
 * in a contemptuous register.
 */
const CONTEMPT_PATTERNS: Record<UiLanguage, Pattern[]> = {
  'en-US': [
    { regex: /\b(haha|hah|lol|lmao)\s*[,.\s]*\s*(right|sure|ok+|whatever)/i, weight: 3, signal: 'contempt:haha-right' },
    { regex: /\bdumb (bot|ai|thing|machine)/i, weight: 3, signal: 'contempt:dumb-bot' },
    { regex: /\b(useless|pathetic|worthless) (bot|ai|thing|piece)/i, weight: 3, signal: 'contempt:useless-bot' },
    { regex: /\b(what a |such a )(joke|loser|disappointment)/i, weight: 2, signal: 'contempt:what-a-joke' },
    { regex: /\boh (sure|right|please)\b.*\?$/im, weight: 2, signal: 'contempt:oh-sure' },
  ],
  'zh-CN': [
    { regex: /(呵|呵呵|哈)+[，,]?\s?(行|好|是|就你)/, weight: 2, signal: 'contempt:呵呵行' },
    { regex: /(蠢|笨|傻|废物)?(机器|AI|ai|破玩意儿|破东西)/, weight: 3, signal: 'contempt:破机器' },
    { regex: /(没用的|废物|垃圾)(机器|AI|ai|玩意|东西)/, weight: 3, signal: 'contempt:废物AI' },
    { regex: /(就这|就这点|就你这|不过如此)/, weight: 2, signal: 'contempt:就这' },
  ],
  'zh-TW': [
    { regex: /(呵|呵呵|哈)+[，,]?\s?(行|好|是|就你)/, weight: 2, signal: 'contempt:呵呵行' },
    { regex: /(蠢|笨|傻|廢物)?(機器|AI|ai|破玩意兒|破東西)/, weight: 3, signal: 'contempt:破機器' },
    { regex: /(沒用的|廢物|垃圾)(機器|AI|ai|玩意|東西)/, weight: 3, signal: 'contempt:廢物AI' },
    { regex: /(就這|就這點|就你這|不過如此)/, weight: 2, signal: 'contempt:就這' },
  ],
  'ja': [
    { regex: /(はは|笑|w+)、?\s?(そう|ね|です)/, weight: 2, signal: 'contempt:はは-そう' },
    { regex: /(バカ|馬鹿|ばか|無能|役立たず)(AI|ai|ボット|機械)/, weight: 3, signal: 'contempt:バカAI' },
    { regex: /(つまらない|くだらない|しょうもない)(AI|ai|ボット|機械|やつ)/, weight: 2, signal: 'contempt:つまらないAI' },
  ],
  'ko': [
    { regex: /(ㅋ+|ㅎ+|허)\s?(그래|어|네|예)/, weight: 2, signal: 'contempt:ㅋㅋ그래' },
    { regex: /(멍청한|바보|쓸모없는|한심한)\s?(AI|ai|봇|기계)/, weight: 3, signal: 'contempt:멍청한AI' },
    { regex: /(이런|그런)\s?(쓰레기|쓸모없는|허접한)/, weight: 2, signal: 'contempt:쓰레기' },
  ],
}

/**
 * Pattern set for a locale, with English fallback as a backstop so a
 * mixed-language message still gets some coverage.
 */
function getPatterns(uiLanguage: UiLanguage, table: Record<UiLanguage, Pattern[]>): Pattern[] {
  const localePatterns = table[uiLanguage] ?? []
  const englishFallback = uiLanguage === 'en-US' ? [] : table['en-US']
  return [...localePatterns, ...englishFallback]
}

function scorePatterns(text: string, patterns: Pattern[]): { score: number; signals: string[] } {
  let score = 0
  const signals: string[] = []
  for (const p of patterns) {
    if (p.regex.test(text)) {
      score += p.weight
      signals.push(p.signal)
    }
  }
  return { score, signals }
}

/**
 * Detect a rupture in a single user message. Returns the dominant kind
 * when its score crosses the fire threshold; ties favour contempt
 * (Gottman's most-corrosive horseman).
 */
export function detectRupture(
  text: string,
  uiLanguage: UiLanguage,
): RuptureDetectionResult {
  if (!text || text.length === 0) {
    return { kind: null, score: 0, signals: [] }
  }
  const criticism = scorePatterns(text, getPatterns(uiLanguage, CRITICISM_PATTERNS))
  const contempt = scorePatterns(text, getPatterns(uiLanguage, CONTEMPT_PATTERNS))

  const contemptFires = contempt.score >= FIRE_THRESHOLD
  const criticismFires = criticism.score >= FIRE_THRESHOLD

  if (!contemptFires && !criticismFires) {
    return { kind: null, score: 0, signals: [] }
  }

  // Contempt wins ties (Gottman's "most corrosive" — also worth more
  // careful repair).
  if (contemptFires && contempt.score >= criticism.score) {
    return { kind: 'contempt', score: contempt.score, signals: contempt.signals }
  }
  return { kind: 'criticism', score: criticism.score, signals: criticism.signals }
}
