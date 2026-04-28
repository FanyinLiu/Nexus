/**
 * Gentle rupture detection (M1.7).
 *
 * Looks for John Gottman's "Four Horsemen" of relationship breakdown
 * when directed at the companion:
 *
 *   - Criticism — character attack ("you always", "you never", "you're
 *     so stupid"). Distinct from a complaint about a specific behavior.
 *   - Contempt — mockery, dismissive sneer, name-calling ("dumb bot",
 *     "useless thing", "haha right"). The most corrosive of the four
 *     in Gottman's longitudinal data.
 *   - Defensiveness — counter-protest after a real or imagined push.
 *     "I never said that", "you're misunderstanding me", "I'm just…".
 *     A bid to deflect rather than receive.
 *   - Stonewalling — withdrawal signal. The user, after a stretch of
 *     real exchange, drops to one-word or near-empty replies. Quiet
 *     refusal rather than spoken complaint.
 *
 * Phase 1 (criticism + contempt) only needed the latest user message.
 * Phase 2 adds defensiveness (still single-message via regex) and
 * stonewalling (needs prior-message brevity comparison).
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

export type RuptureKind =
  | 'criticism'
  | 'contempt'
  | 'defensiveness'
  | 'stonewalling'
  | null

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
 * Per-locale defensiveness patterns. Bid to deflect rather than receive
 * — "I never said that", "that's not what I meant", "you're
 * misunderstanding". A counter-protest, often signalling that an
 * actually-helpful nudge is about to be lost in self-defence.
 */
const DEFENSIVENESS_PATTERNS: Record<UiLanguage, Pattern[]> = {
  'en-US': [
    { regex: /\bI (never|didn'?t) (said?|meant)\b/i, weight: 2, signal: 'defensiveness:i-never-said' },
    { regex: /\bthat'?s not what I (said|meant)\b/i, weight: 2, signal: 'defensiveness:not-what-i-meant' },
    { regex: /\byou'?re (mis)?(under)?stand(ing)?\b/i, weight: 2, signal: 'defensiveness:youre-misunderstanding' },
    { regex: /\b(I'?m just|all I (meant|said) was)\b/i, weight: 1, signal: 'defensiveness:im-just' },
  ],
  'zh-CN': [
    { regex: /我(没|又没)(说|那么)/, weight: 2, signal: 'defensiveness:我没说' },
    { regex: /你(误会|搞错|听错|理解错)/, weight: 2, signal: 'defensiveness:你误会' },
    { regex: /(不是|哪是)(我|那个)/, weight: 1, signal: 'defensiveness:不是我' },
    { regex: /我只是(说|想)/, weight: 1, signal: 'defensiveness:我只是' },
  ],
  'zh-TW': [
    { regex: /我(沒|又沒)(說|那麼)/, weight: 2, signal: 'defensiveness:我沒說' },
    { regex: /你(誤會|搞錯|聽錯|理解錯)/, weight: 2, signal: 'defensiveness:你誤會' },
    { regex: /(不是|哪是)(我|那個)/, weight: 1, signal: 'defensiveness:不是我' },
    { regex: /我只是(說|想)/, weight: 1, signal: 'defensiveness:我只是' },
  ],
  'ja': [
    { regex: /そんなこと(言って(い)?ない|意味じゃない)/, weight: 2, signal: 'defensiveness:言ってない' },
    { regex: /(誤解|勘違い)(してる|では)/, weight: 2, signal: 'defensiveness:誤解' },
    { regex: /(私|僕|俺)は(ただ|別に)/, weight: 1, signal: 'defensiveness:ただ' },
  ],
  'ko': [
    { regex: /(그런 뜻|그게|그런 말) 아니/, weight: 2, signal: 'defensiveness:그런-뜻-아니' },
    { regex: /오해(하고|야|예요|입니다)/, weight: 2, signal: 'defensiveness:오해' },
    { regex: /(난|나는|저는) 그냥/, weight: 1, signal: 'defensiveness:그냥' },
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
 * Stonewalling thresholds. A "very short" reply is a hard cap; the
 * "rich prior" check requires the immediately-prior 3 user messages to
 * each clear a much-longer threshold. Keeping the gap wide (10 vs 40)
 * helps avoid firing on legitimate one-word answers ("yes", "ok") that
 * follow short questions — those would almost always have a short
 * prior message somewhere in the window, breaking the gate.
 */
const STONEWALL_VERY_SHORT_LEN = 10
const STONEWALL_RICH_PRIOR_LEN = 40
const STONEWALL_RICH_PRIOR_COUNT = 3

function looksStonewalling(
  text: string,
  priorUserMessages: ReadonlyArray<string>,
): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (trimmed.length > STONEWALL_VERY_SHORT_LEN) return false
  // Need at least N prior messages to establish a "richer baseline".
  if (priorUserMessages.length < STONEWALL_RICH_PRIOR_COUNT) return false
  // Take the most recent N priors. We accept any caller order — sort by
  // assuming caller passes oldest-first OR newest-first, just take last N.
  const window = priorUserMessages.slice(-STONEWALL_RICH_PRIOR_COUNT)
  return window.every((m) => (m?.trim().length ?? 0) >= STONEWALL_RICH_PRIOR_LEN)
}

export interface DetectRuptureOptions {
  /**
   * Recent prior user messages, oldest-first or with a stable order. Used
   * for stonewalling detection (brevity-drop comparison). Pass at least 3
   * for the stonewalling branch to fire.
   */
  priorUserMessages?: ReadonlyArray<string>
}

/**
 * Detect a rupture in a single user message (with optional prior context
 * for stonewalling). Returns the dominant kind when its score crosses
 * the fire threshold.
 *
 * Precedence on tie / multi-fire: contempt > criticism > defensiveness >
 * stonewalling. Contempt wins ties because it's Gottman's most-corrosive
 * horseman. Stonewalling is last because it's the easiest to false-
 * positive on (a legitimate quick "yes" in a chatty thread).
 */
export function detectRupture(
  text: string,
  uiLanguage: UiLanguage,
  options: DetectRuptureOptions = {},
): RuptureDetectionResult {
  if (!text || text.length === 0) {
    return { kind: null, score: 0, signals: [] }
  }
  const criticism = scorePatterns(text, getPatterns(uiLanguage, CRITICISM_PATTERNS))
  const contempt = scorePatterns(text, getPatterns(uiLanguage, CONTEMPT_PATTERNS))
  const defensiveness = scorePatterns(text, getPatterns(uiLanguage, DEFENSIVENESS_PATTERNS))

  const contemptFires = contempt.score >= FIRE_THRESHOLD
  const criticismFires = criticism.score >= FIRE_THRESHOLD
  const defensivenessFires = defensiveness.score >= FIRE_THRESHOLD
  const stonewalling = looksStonewalling(text, options.priorUserMessages ?? [])

  if (!contemptFires && !criticismFires && !defensivenessFires && !stonewalling) {
    return { kind: null, score: 0, signals: [] }
  }

  // Precedence: contempt > criticism > defensiveness > stonewalling.
  // Contempt always wins when it fires — Gottman's most-corrosive horseman
  // warrants the most-conservative repair posture even if a criticism
  // pattern happens to score higher in the same message.
  if (contemptFires) {
    return { kind: 'contempt', score: contempt.score, signals: contempt.signals }
  }
  if (criticismFires) {
    return { kind: 'criticism', score: criticism.score, signals: criticism.signals }
  }
  if (defensivenessFires) {
    return {
      kind: 'defensiveness',
      score: defensiveness.score,
      signals: defensiveness.signals,
    }
  }
  // stonewalling — only branch here when the hard fires didn't trigger.
  return { kind: 'stonewalling', score: 1, signals: ['stonewalling:brevity-drop'] }
}
