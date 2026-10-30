/**
 * Pick the few voice samples that fit the current moment.
 *
 * examples.md can group samples under `## mood: <word>` and `## proactive`
 * headings. Chat wants reply samples that match how she feels right now;
 * the proactive decision engine wants lines where she opens the conversation.
 * Untagged files keep working: their examples fall back into every mood and
 * the proactive path uses them when no tagged opener exists.
 *
 * The block is prompt-only text. It is never appended as fake chat messages,
 * because those would enter history, memory recall, and compaction.
 */

import { estimateTokensFromText } from '../chat/tokenEstimate.ts'
import type {
  PersonaExampleKind,
  PersonaFewShotExample,
} from '../autonomy/v2/personaTypes.ts'

/** Total budget for the rendered voice-sample block. */
export const PERSONA_EXAMPLE_TOKEN_CAP = 400
/** Mood-matched samples before the random extra. */
export const PERSONA_EXAMPLE_MOOD_LIMIT = 4
/** One extra sample keeps the voice from feeling like a fixed script. */
const PERSONA_EXAMPLE_RANDOM_LIMIT = 1

export interface SelectPersonaExamplesOptions {
  /** Current PetMood, or 'sulky' after she was left on read. */
  mood?: string | null
  /** Sulking outranks the ordinary mood word. */
  sulky?: boolean
  /** 'reply' for chat, 'proactive' for lines where she speaks first. */
  kind?: PersonaExampleKind
  /** Mood-matched samples before the random extra. */
  limit?: number
  /** Estimated-token budget for the selected samples. */
  tokenCap?: number
  /** Injectable RNG so tests are deterministic. */
  random?: () => number
}

type NormalizedExample = PersonaFewShotExample & { kind: PersonaExampleKind }

function normalizeExample(example: PersonaFewShotExample): NormalizedExample {
  return {
    user: typeof example.user === 'string' ? example.user.trim() : '',
    assistant: typeof example.assistant === 'string' ? example.assistant.trim() : '',
    ...(typeof example.mood === 'string' && example.mood.trim()
      ? { mood: example.mood.trim().toLowerCase() }
      : {}),
    kind: example.kind === 'proactive' ? 'proactive' : 'reply',
  }
}

function wantedMood(options: SelectPersonaExamplesOptions): string | undefined {
  if (options.sulky === true) return 'sulky'
  const mood = typeof options.mood === 'string' ? options.mood.trim().toLowerCase() : ''
  return mood || undefined
}

function exampleCost(example: NormalizedExample): number {
  return estimateTokensFromText(example.user)
    + estimateTokensFromText(example.assistant)
    + 4
}

function addWithinBudget(
  target: NormalizedExample[],
  candidate: NormalizedExample,
  budget: { remaining: number },
): boolean {
  if (target.some((item) => item.user === candidate.user && item.assistant === candidate.assistant)) {
    return false
  }
  const cost = exampleCost(candidate)
  if (cost > budget.remaining) return false
  budget.remaining -= cost
  target.push(candidate)
  return true
}

function dedupe(examples: NormalizedExample[]): NormalizedExample[] {
  const seen = new Set<string>()
  const out: NormalizedExample[] = []
  for (const example of examples) {
    if (!example.assistant) continue
    const key = `${example.user}\u0000${example.assistant}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(example)
  }
  return out
}

/**
 * Select 3–4 samples matching the mood (or untagged fallbacks) plus one
 * random sample, stopping before the token budget is spent. A proactive
 * request prefers `## proactive` samples and only falls back to reply
 * samples when a persona has no openers yet.
 */
export function selectPersonaExamples(
  examples: PersonaFewShotExample[],
  options: SelectPersonaExamplesOptions = {},
): PersonaFewShotExample[] {
  const all = dedupe((Array.isArray(examples) ? examples : []).map(normalizeExample))
  if (!all.length) return []

  const kind = options.kind === 'proactive' ? 'proactive' : 'reply'
  const mood = wantedMood(options)
  const limit = Math.max(1, options.limit ?? PERSONA_EXAMPLE_MOOD_LIMIT)
  const budget = { remaining: Math.max(0, options.tokenCap ?? PERSONA_EXAMPLE_TOKEN_CAP) }
  const random = options.random ?? Math.random

  const kindPool = all.filter((example) => example.kind === kind)
  // Old files have no headings; treat their samples as the fallback pool.
  const basePool = kindPool.length ? kindPool : all

  const matched = mood
    ? basePool.filter((example) => example.mood === mood)
    : []
  const untagged = basePool.filter((example) => !example.mood)
  // Proactive prompts may still borrow reply samples when a persona has no
  // openers, but never the other way around: chat must not learn to start
  // unprompted from an opener sample.
  const secondary = kind === 'proactive' && kindPool.length
    ? all.filter((example) => example.kind !== 'proactive')
    : []

  const selected: NormalizedExample[] = []
  for (const candidate of [...matched, ...untagged, ...secondary]) {
    if (selected.length >= limit) break
    addWithinBudget(selected, candidate, budget)
  }

  const randomPool = basePool.filter(
    (example) => !selected.some(
      (item) => item.user === example.user && item.assistant === example.assistant,
    ),
  )
  for (let index = 0; index < PERSONA_EXAMPLE_RANDOM_LIMIT && randomPool.length; index += 1) {
    const pickIndex = Math.min(
      randomPool.length - 1,
      Math.floor(Math.max(0, Math.min(0.999999, random())) * randomPool.length),
    )
    const [pick] = randomPool.splice(pickIndex, 1)
    if (!pick) continue
    addWithinBudget(selected, pick, budget)
  }

  return selected
}

function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim()
}

export interface FormatChatExamplesOptions extends SelectPersonaExamplesOptions {
  /** Localized line that introduces the samples. */
  header: string
}

/**
 * Render the selected samples as one plain-text block. Each sample is a
 * single line (`prompt → reply`) so it cannot be mistaken for the real
 * conversation and cannot be replayed as a chat message.
 */
export function formatPersonaExamplesForChat(
  examples: PersonaFewShotExample[],
  options: FormatChatExamplesOptions,
): string {
  const header = String(options.header ?? '').trim()
  if (!header) return ''
  const headerCost = estimateTokensFromText(header)
  const totalCap = options.tokenCap ?? PERSONA_EXAMPLE_TOKEN_CAP
  const budget = Math.max(0, totalCap - headerCost)
  const picked = selectPersonaExamples(examples, {
    ...options,
    kind: options.kind ?? 'reply',
    tokenCap: budget,
  })
  if (!picked.length) return ''

  const lines = picked.map((example) => {
    const user = oneLine(example.user)
    const assistant = oneLine(example.assistant)
    return user ? `- ${user} → ${assistant}` : `- ${assistant}`
  })
  return [header, ...lines].join('\n')
}
