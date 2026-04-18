/**
 * Lorebook entries are user-authored "world knowledge" snippets that
 * get injected into the system prompt only when one of their keywords
 * shows up in recent user messages. Pattern borrowed from SillyTavern
 * (WorldInfo) — the point is to keep the system prompt lean when the
 * topic isn't relevant, then light up with context when it is.
 *
 * Example: keywords=['妈妈','mom'], content='用户的母亲是上海一名小
 * 学教师，姓张。' When the user says "我妈妈今天…", the content gets
 * pulled into the system prompt for that turn.
 */
export interface LorebookEntry {
  id: string
  label: string
  keywords: string[]
  content: string
  enabled: boolean
  priority: number
  createdAt: string
  updatedAt: string
  /**
   * Precomputed embedding over `label + keywords + content`. Used by the
   * semantic-recall path so an entry can fire even when the user's
   * phrasing doesn't lexically overlap the listed keywords (e.g. keywords
   * ['妈妈','mom'] but the user writes '我娘亲'). Regenerated on every
   * save; absent entries fall back to keyword-only triggering until the
   * next save rebuilds them. The model used to produce this vector is
   * recorded alongside so a model switch invalidates the cache.
   */
  embedding?: number[]
  embeddingModel?: string
}

export const MAX_LOREBOOK_ENTRIES_PER_TURN = 6
export const MAX_LOREBOOK_CONTENT_CHARS = 500
export const LOREBOOK_SCAN_WINDOW_MESSAGES = 4
/** Cosine-similarity floor for the semantic-recall path. Anything above
 *  this joins the keyword-matched hits. Local hash embeddings score lower
 *  than hosted transformers but still cluster correctly around 0.5–0.7
 *  for semantically-close pairs; 0.55 is a conservative default. */
export const LOREBOOK_SEMANTIC_MIN_SIMILARITY = 0.55
