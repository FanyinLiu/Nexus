import type { ChatMessage } from '../../types/chat.ts'
import {
  LOREBOOK_SCAN_WINDOW_MESSAGES,
  LOREBOOK_SEMANTIC_MIN_SIMILARITY,
  MAX_LOREBOOK_CONTENT_CHARS,
  MAX_LOREBOOK_ENTRIES_PER_TURN,
  type LorebookEntry,
} from '../../types/lorebooks.ts'
import {
  cosineSimilarity,
  embedMemorySearchText,
} from '../memory/vectorSearch.ts'

/**
 * Given a pool of user-authored lorebook entries and the last few user
 * messages, return the entries that should fire this turn. Two recall
 * paths run side-by-side:
 *
 *   1. **Keyword** — case-insensitive whole-substring match (no word
 *      boundaries, so "妈妈" inside "我妈妈说..." still hits; same for
 *      English partials). Cheap, deterministic, user-authored keywords
 *      so the author controls the trigger surface.
 *
 *   2. **Semantic** — cosine similarity between an embedding of the
 *      scanned user text and the entry's precomputed embedding (stored
 *      on the entry at save time). Catches phrasings the user didn't
 *      anticipate listing as keywords ("我娘亲" hitting a "妈妈" entry).
 *      Gated by LOREBOOK_SEMANTIC_MIN_SIMILARITY so off-topic entries
 *      don't bleed in.
 *
 * Selection rules:
 *   - Only `enabled` entries with non-empty content are considered.
 *     Keyword path additionally requires at least one keyword; semantic
 *     path only requires a cached embedding produced by the current
 *     user-configured embedding model.
 *   - An entry matched by both paths wins — we score by keyword hit
 *     primarily (fixed weight 1.0) plus similarity (0–1) on top, so a
 *     hard keyword hit always ranks above a pure-semantic hit at the
 *     same priority tier.
 *   - Final sort: priority desc, then score desc.
 *   - Truncated at MAX_LOREBOOK_ENTRIES_PER_TURN so 50 entries can't
 *     accidentally blow the prompt budget.
 */
export async function selectTriggeredLorebookEntries(
  entries: LorebookEntry[],
  recentMessages: ChatMessage[],
  embeddingModel?: string,
): Promise<LorebookEntry[]> {
  if (!Array.isArray(entries) || entries.length === 0) return []
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) return []

  const userTexts: string[] = []
  for (let i = recentMessages.length - 1; i >= 0 && userTexts.length < LOREBOOK_SCAN_WINDOW_MESSAGES; i -= 1) {
    const message = recentMessages[i]
    if (message?.role !== 'user') continue
    const text = String(message.content ?? '').trim()
    if (text) userTexts.push(text)
  }
  if (userTexts.length === 0) return []

  const scannedLower = userTexts.join('\n').toLowerCase()
  const scannedRaw = userTexts.join('\n')

  // Hits keyed by entry id so the keyword and semantic paths can merge
  // into the same record without double-counting an entry.
  type Hit = {
    entry: LorebookEntry
    keywordScore: number  // longest matched keyword length; 0 if only semantic
    similarity: number    // cos sim, 0 if only keyword
  }
  const byId = new Map<string, Hit>()

  // Keyword path — cheap, run first so the semantic path can skip entries
  // that already hit (no need to waste cosine on them).
  for (const entry of entries) {
    if (!entry.enabled) continue
    if (!entry.content?.trim()) continue
    if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) continue

    let longest = 0
    for (const keyword of entry.keywords) {
      const needle = String(keyword ?? '').trim().toLowerCase()
      if (!needle) continue
      if (scannedLower.includes(needle) && needle.length > longest) {
        longest = needle.length
      }
    }
    if (longest > 0) {
      byId.set(entry.id, { entry, keywordScore: longest, similarity: 0 })
    }
  }

  // Semantic path — only runs if caller supplied an embedding model AND
  // at least one entry has a cached embedding produced by that same
  // model. If no entries are indexed for the current model, the cost of
  // embedding the user query is wasted; skip the whole path.
  if (embeddingModel) {
    const candidates = entries.filter(
      (entry) => entry.enabled
        && entry.content?.trim()
        && !byId.has(entry.id)
        && entry.embedding
        && entry.embeddingModel === embeddingModel,
    )
    if (candidates.length > 0) {
      try {
        const queryVec = await embedMemorySearchText(scannedRaw, embeddingModel)
        if (queryVec.length > 0) {
          for (const entry of candidates) {
            if (!entry.embedding || entry.embedding.length !== queryVec.length) continue
            const sim = cosineSimilarity(entry.embedding, queryVec)
            if (sim >= LOREBOOK_SEMANTIC_MIN_SIMILARITY) {
              byId.set(entry.id, { entry, keywordScore: 0, similarity: sim })
            }
          }
        }
      } catch (err) {
        // Embedding failures (model load, network on hosted providers)
        // must never break prompt assembly — fall through to keyword-only.
        console.warn('[lorebook] semantic recall failed, keyword-only fallback', err)
      }
    }
  }

  const hits = Array.from(byId.values())

  hits.sort((a, b) => {
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority
    // Score: keyword hit contributes a flat 1.0 on top of its length/100
    // normalization, so a 2-char keyword hit (e.g. '妈妈') outranks a
    // 0.7-similarity semantic hit. Pure semantic hits sort by similarity.
    const aScore = (a.keywordScore > 0 ? 1 + a.keywordScore / 100 : 0) + a.similarity
    const bScore = (b.keywordScore > 0 ? 1 + b.keywordScore / 100 : 0) + b.similarity
    return bScore - aScore
  })

  return hits.slice(0, MAX_LOREBOOK_ENTRIES_PER_TURN).map(({ entry }) => entry)
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
