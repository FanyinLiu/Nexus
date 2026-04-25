/**
 * Repetition guard — pure post-reply analyzer that detects structural
 * sameness in the companion's last few utterances and emits compact
 * "avoid X" hints the next decision prompt can inject for variety.
 *
 * Cheap deterministic checks: no LLM call, no chat history bloat. The
 * hints are appended to the user message in decisionPrompt; the model
 * decides whether to obey, but at least it sees the recent shape it's
 * about to repeat.
 *
 * Layered on top of personaGuardrail (which checks fidelity to the
 * character). This module checks fidelity to *variety* — making sure
 * the companion doesn't open every reply with the same two graphemes.
 */
export interface RepetitionAvoidanceHints {
  /** Two-grapheme prefixes that have appeared in 2+ of the recent replies. */
  avoidOpenings: string[]
  /** Four-grapheme suffixes (post-punctuation) that have repeated. */
  avoidEndings: string[]
  /** True when every recent reply's length is within ±20% of the mean. */
  lengthMonotone: boolean
  /** Punctuation chars overused across recent replies. */
  avoidPunctuation: string[]
}

const MIN_REPLIES_FOR_DETECTION = 3
const REPETITION_THRESHOLD = 2
const LENGTH_VARIANCE_TOLERANCE = 0.2
/** A reply that hits any of these >=2 times counts toward overuse. */
const PUNCTUATION_WATCHLIST = ['!', '！', '?', '？', '…', '~', '～']
const PUNCTUATION_PER_REPLY_THRESHOLD = 2
const PUNCTUATION_OVERUSE_RATIO = 0.5

const TRIM_PUNCT_END = /[\s.!?。！？…~～—-]+$/u
const TRIM_PUNCT_START = /^[\s.!?。！？…~～—-]+/u

function takeFirstGraphemes(text: string, count: number): string {
  return [...text].slice(0, count).join('')
}

function takeLastGraphemes(text: string, count: number): string {
  const arr = [...text]
  return arr.slice(Math.max(0, arr.length - count)).join('')
}

function repeatedItems(items: string[], threshold: number): string[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!item) continue
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .map(([key]) => key)
}

export function analyzeRecentReplies(
  replies: readonly string[],
): RepetitionAvoidanceHints | null {
  const cleaned = replies
    .map((r) => String(r ?? '').trim())
    .filter((r) => r.length > 0)

  if (cleaned.length < MIN_REPLIES_FOR_DETECTION) return null

  const openings = cleaned.map((r) => takeFirstGraphemes(r.replace(TRIM_PUNCT_START, ''), 2))
  const endings = cleaned.map((r) => takeLastGraphemes(r.replace(TRIM_PUNCT_END, ''), 4))

  const avoidOpenings = repeatedItems(openings, REPETITION_THRESHOLD)
  const avoidEndings = repeatedItems(endings, REPETITION_THRESHOLD)

  const lengths = cleaned.map((r) => [...r].length)
  const meanLen = lengths.reduce((a, b) => a + b, 0) / lengths.length
  const lengthMonotone = meanLen > 0
    && lengths.every((len) => Math.abs(len - meanLen) / meanLen <= LENGTH_VARIANCE_TOLERANCE)

  const avoidPunctuation: string[] = []
  for (const punct of PUNCTUATION_WATCHLIST) {
    const overusedCount = cleaned.reduce((acc, reply) => {
      const occurrences = [...reply].filter((ch) => ch === punct).length
      return acc + (occurrences >= PUNCTUATION_PER_REPLY_THRESHOLD ? 1 : 0)
    }, 0)
    if (overusedCount / cleaned.length >= PUNCTUATION_OVERUSE_RATIO) {
      avoidPunctuation.push(punct)
    }
  }

  if (
    avoidOpenings.length === 0
    && avoidEndings.length === 0
    && !lengthMonotone
    && avoidPunctuation.length === 0
  ) {
    return null
  }

  return { avoidOpenings, avoidEndings, lengthMonotone, avoidPunctuation }
}
