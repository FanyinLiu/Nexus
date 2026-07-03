import { cosineSimilarity, embedMemorySearchText, isLocalHashMemoryModel } from '../memory/vectorSearch.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import type { ChatMessage } from '../../types/chat.ts'
import {
  LOREBOOK_SCAN_WINDOW_MESSAGES,
  MAX_LOREBOOK_CONTENT_CHARS,
  MAX_LOREBOOK_ENTRIES_PER_TURN,
  type LorebookEntry,
} from '../../types/lorebooks.ts'

/**
 * Given a pool of user-authored lorebook entries and the last few user
 * messages, return the entries whose keywords appear in the scanned
 * text. Case-insensitive whole-substring match (no word boundaries, so
 * "妈妈" inside "我妈妈说..." still hits; same for English partials).
 *
 * Selection rules:
 *   - Only `enabled` entries with at least one non-empty keyword and
 *     non-empty content are considered.
 *   - Entries are scored by: priority (desc), longest matched keyword
 *     length (desc), to favour the most specific match first.
 *   - Truncated at MAX_LOREBOOK_ENTRIES_PER_TURN so a user with 50
 *     lorebook entries can't accidentally blow past the system prompt
 *     budget on a single turn.
 */
export function selectTriggeredLorebookEntries(
  entries: LorebookEntry[],
  recentMessages: ChatMessage[],
): LorebookEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return []
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) return []

  const userTexts: string[] = []
  for (let i = recentMessages.length - 1; i >= 0 && userTexts.length < LOREBOOK_SCAN_WINDOW_MESSAGES; i -= 1) {
    const message = recentMessages[i]
    if (message?.role !== 'user') continue
    const text = String(message.content ?? '').trim()
    if (text) userTexts.push(text.toLowerCase())
  }
  if (userTexts.length === 0) return []

  const scanned = userTexts.join('\n')

  const hits: Array<{ entry: LorebookEntry; longestMatch: number }> = []
  for (const entry of entries) {
    if (!entry.enabled) continue
    if (!entry.content?.trim()) continue
    if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) continue

    let longest = 0
    for (const keyword of entry.keywords) {
      const needle = String(keyword ?? '').trim().toLowerCase()
      if (!needle) continue
      if (scanned.includes(needle) && needle.length > longest) {
        longest = needle.length
      }
    }
    if (longest > 0) hits.push({ entry, longestMatch: longest })
  }

  hits.sort((a, b) => {
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority
    return b.longestMatch - a.longestMatch
  })

  return hits.slice(0, MAX_LOREBOOK_ENTRIES_PER_TURN).map(({ entry }) => entry)
}

// Similarity thresholds for the semantic pass. The local-hash embedder
// uses 256-dim hashed 2-3gram features and produces much lower absolute
// cosine scores than learned models — on empirical Chinese samples,
// same-topic pairs come in around 0.13-0.25 while unrelated pairs sit
// at 0.08-0.12. A single global threshold misses either (too strict for
// local hash) or floods (too loose for remote), so we pick per-model.
// Remote embedders (text-embedding-3-small, all-MiniLM etc.) concentrate
// same-topic scores at 0.5-0.85 so 0.55 keeps out noise there.
const DEFAULT_LOCAL_HASH_THRESHOLD = 0.13
const DEFAULT_REMOTE_SEMANTIC_THRESHOLD = 0.55

/** Caller bridge for the LLM rewrite pass. Identical shape to decisionEngine's
 * ChatCaller: deliberately minimal so we don't drag in the autonomy module
 * from chat code. Return `{ content: string }`; exceptions are caught by
 * the rewrite wrapper and treated as "no rewrites available." */
export type LorebookRewriteCaller = (prompt: string) => Promise<string>

const MAX_REWRITE_VARIANTS = 3

/**
 * Ask a small LLM to rephrase the user's recent turn into alternative
 * search queries. Borrowed from goodai-ltm — users speak colloquially but
 * lorebook entries are usually written in formal prose, so direct cosine
 * similarity often misses. Rewrites that *fail silently*: any error, empty
 * response, or unparseable text returns [] so the caller falls back to
 * the literal text.
 */
export async function rewriteQueryForLorebook(
  userText: string,
  caller: LorebookRewriteCaller,
): Promise<string[]> {
  const trimmed = userText.trim()
  if (!trimmed) return []

  const prompt = [
    'Rewrite the following user message into 2-3 short alternative search queries',
    'that could retrieve background lore entries written in formal prose. Preserve',
    'the original language. One query per line, no numbering, no explanation, no',
    'quotation marks. If the message is too short or has no retrievable substance,',
    'output nothing.',
    '',
    `Message: ${trimmed}`,
  ].join('\n')

  let raw: string
  try {
    raw = await caller(prompt)
  } catch {
    return []
  }
  if (!raw) return []

  // Strip list markers only: leading whitespace, then either a single
  // bullet symbol (-*•·) or `\d+\.` style numbering, then one whitespace.
  // Matching bare digits would eat content starting with a year or count.
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•·]|\d+\.)\s+/, '').trim())
    .filter((line) => line.length > 0 && line.length < 200)
  if (lines.length === 0) return []

  const deduped: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(line)
    if (deduped.length >= MAX_REWRITE_VARIANTS) break
  }
  return deduped
}

/**
 * Semantic-enriched variant of selectTriggeredLorebookEntries. Runs the
 * cheap keyword pass first (deterministic, catches explicit mentions of
 * user-authored triggers), then for entries that *didn't* land via
 * keywords it computes embedding similarity between the recent user
 * messages and the entry's label+keywords+content text, promoting
 * entries whose similarity crosses `semanticThreshold`.
 *
 * Reuses the memory-module embedding cache (same model id comes from
 * `memoryEmbeddingModel` settings), so a user with the default
 * LOCAL_HASH_MEMORY_MODEL pays no network cost — all semantic matching
 * runs locally with deterministic ngram-hash embeddings. Remote models
 * go through the same async path; failure on any single entry skips it
 * silently so one flaky embedding request can't starve the whole
 * lorebook pool.
 *
 * Returns at most MAX_LOREBOOK_ENTRIES_PER_TURN entries in the same
 * priority-first ordering as the sync keyword function; keyword hits
 * always sort ahead of semantic-only hits at matching priority so
 * explicit triggers win ties.
 */
export async function selectTriggeredLorebookEntriesWithSemantic(
  entries: LorebookEntry[],
  recentMessages: ChatMessage[],
  options: {
    embeddingModel: string
    semanticThreshold?: number
    /** Optional rewrite bridge. When set and the first semantic pass
     * returns zero hits, the caller is asked to rephrase the user text
     * into alternative queries, and the search is retried over those
     * rephrasings. Opt-in — not every deployment wants the extra LLM
     * call per turn. */
    rewriteQuery?: LorebookRewriteCaller
  },
): Promise<LorebookEntry[]> {
  const keywordHits = selectTriggeredLorebookEntries(entries, recentMessages)

  const scanTexts: string[] = []
  for (let i = recentMessages.length - 1; i >= 0 && scanTexts.length < LOREBOOK_SCAN_WINDOW_MESSAGES; i -= 1) {
    const message = recentMessages[i]
    if (message?.role !== 'user') continue
    const text = String(message.content ?? '').trim()
    if (text) scanTexts.push(text)
  }
  if (scanTexts.length === 0) return keywordHits

  const keywordHitIds = new Set(keywordHits.map((entry) => entry.id))
  const remainingCandidates = entries.filter((entry) => {
    if (!entry.enabled) return false
    if (!entry.content?.trim()) return false
    if (keywordHitIds.has(entry.id)) return false
    return true
  })
  if (remainingCandidates.length === 0) return keywordHits

  const threshold = options.semanticThreshold
    ?? (isLocalHashMemoryModel(options.embeddingModel)
      ? DEFAULT_LOCAL_HASH_THRESHOLD
      : DEFAULT_REMOTE_SEMANTIC_THRESHOLD)
  const queryText = scanTexts.join('\n')

  // Pre-embed each remaining candidate once — we may reuse it across the
  // literal query and (optionally) the rewritten queries, so hoisting the
  // work outside the scoring loop amortises rewrite cost.
  const candidateEmbeddings = new Map<string, number[]>()
  for (const entry of remainingCandidates) {
    const haystack = [
      entry.label,
      ...entry.keywords,
      entry.content.slice(0, MAX_LOREBOOK_CONTENT_CHARS),
    ].filter(Boolean).join(' ')
    if (!haystack) continue
    try {
      const embedding = await embedMemorySearchText(haystack, options.embeddingModel)
      if (embedding.length) candidateEmbeddings.set(entry.id, embedding)
    } catch {
      // One bad entry shouldn't poison the rest — skip and continue.
      continue
    }
  }

  const scoreAgainstQuery = async (query: string): Promise<Map<string, number>> => {
    const results = new Map<string, number>()
    let queryEmbedding: number[]
    try {
      queryEmbedding = await embedMemorySearchText(query, options.embeddingModel)
    } catch (err) {
      console.warn('[lorebook] semantic query embedding failed; keyword-only:', getRedactedLogErrorMessage(err))
      return results
    }
    if (!queryEmbedding.length) return results
    for (const [id, entryEmbedding] of candidateEmbeddings) {
      const score = cosineSimilarity(queryEmbedding, entryEmbedding)
      if (score >= threshold) results.set(id, score)
    }
    return results
  }

  const bestScoreById = new Map<string, number>()
  const mergeScores = (next: Map<string, number>) => {
    for (const [id, score] of next) {
      const prev = bestScoreById.get(id) ?? -Infinity
      if (score > prev) bestScoreById.set(id, score)
    }
  }

  mergeScores(await scoreAgainstQuery(queryText))

  // Rewrite retry — only when the literal pass found nothing AND the
  // caller opted in. Rephrasings run ONE rewrite call and each produced
  // query reuses the pre-computed candidate embeddings.
  if (bestScoreById.size === 0 && options.rewriteQuery) {
    const rewrites = await rewriteQueryForLorebook(scanTexts[0] ?? queryText, options.rewriteQuery)
    for (const rewrite of rewrites) {
      mergeScores(await scoreAgainstQuery(rewrite))
    }
  }

  const semanticHits: Array<{ entry: LorebookEntry; score: number }> = []
  for (const entry of remainingCandidates) {
    const score = bestScoreById.get(entry.id)
    if (score != null) semanticHits.push({ entry, score })
  }

  semanticHits.sort((a, b) => {
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority
    return b.score - a.score
  })

  const combined = [...keywordHits, ...semanticHits.map(({ entry }) => entry)]
  return combined.slice(0, MAX_LOREBOOK_ENTRIES_PER_TURN)
}

/**
 * Format the selected entries into a system-prompt section. Returns
 * empty string if nothing was triggered so the caller can skip the
 * section entirely without extra whitespace.
 */
export function buildLorebookSection(entries: LorebookEntry[]): string {
  if (!entries.length) return ''

  const lines: string[] = ['以下是本轮对话触发的背景设定（Lorebook）：']
  entries.forEach((entry, index) => {
    const truncated = entry.content.length > MAX_LOREBOOK_CONTENT_CHARS
      ? `${entry.content.slice(0, MAX_LOREBOOK_CONTENT_CHARS)}…`
      : entry.content
    const header = entry.label ? `${index + 1}. 【${entry.label}】` : `${index + 1}.`
    lines.push(`${header} ${truncated}`)
  })

  return lines.join('\n')
}
