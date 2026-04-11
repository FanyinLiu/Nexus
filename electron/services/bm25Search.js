/**
 * Pure-JS BM25 keyword search for memory entries.
 * CJK-aware tokenization: CJK characters are individual tokens,
 * Latin/digits are split on whitespace/punctuation.
 */

const K1 = 1.2
const B = 0.75

// CJK Unified Ideographs + CJK Extension A/B + CJK Compatibility
const CJK_RANGE = /[\u2E80-\u9FFF\uF900-\uFAFF]/u

/**
 * Tokenize text into an array of lowercase tokens.
 * CJK characters become individual tokens; Latin/digit words are split on non-alphanumeric.
 */
export function tokenize(text) {
  if (!text) return []

  const normalized = String(text).toLowerCase()
  const tokens = []
  let buffer = ''

  for (const char of normalized) {
    if (CJK_RANGE.test(char)) {
      if (buffer) {
        tokens.push(buffer)
        buffer = ''
      }
      tokens.push(char)
    } else if (/[\p{L}\p{N}]/u.test(char)) {
      buffer += char
    } else {
      if (buffer) {
        tokens.push(buffer)
        buffer = ''
      }
    }
  }

  if (buffer) tokens.push(buffer)
  return tokens
}

/**
 * Build a term-frequency map from a token array.
 */
function termFrequencies(tokens) {
  const tf = new Map()
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1)
  }
  return tf
}

/**
 * BM25 index built from a set of documents.
 * Call `build()` once, then `search()` as needed.
 */
export class Bm25Index {
  constructor() {
    /** @type {Array<{ id: string, content: string, layer: string, tokens: string[], tf: Map<string, number> }>} */
    this._docs = []
    /** @type {Map<string, number>} term → document frequency */
    this._df = new Map()
    this._avgdl = 0
  }

  /**
   * @param {Array<{ id: string, content: string, layer: string }>} entries
   */
  build(entries) {
    this._docs = []
    this._df = new Map()
    let totalLength = 0

    for (const entry of entries) {
      const tokens = tokenize(entry.content)
      const tf = termFrequencies(tokens)

      this._docs.push({
        id: entry.id,
        content: entry.content,
        layer: entry.layer,
        tokens,
        tf,
      })

      totalLength += tokens.length

      // Count each unique term once per document
      for (const term of tf.keys()) {
        this._df.set(term, (this._df.get(term) ?? 0) + 1)
      }
    }

    this._avgdl = this._docs.length > 0 ? totalLength / this._docs.length : 0
  }

  /**
   * @param {string} query
   * @param {{ limit?: number, threshold?: number, layer?: string | null }} options
   * @returns {Array<{ id: string, content: string, layer: string, score: number }>}
   */
  search(query, options = {}) {
    const { limit = 10, threshold = 0.01, layer = null } = options
    const queryTokens = tokenize(query)

    if (!queryTokens.length || !this._docs.length) return []

    const N = this._docs.length
    const results = []

    for (const doc of this._docs) {
      if (layer && doc.layer !== layer) continue

      let score = 0
      const dl = doc.tokens.length

      for (const qt of queryTokens) {
        const df = this._df.get(qt) ?? 0
        if (df === 0) continue

        const tf = doc.tf.get(qt) ?? 0
        if (tf === 0) continue

        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
        const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * dl / this._avgdl))
        score += idf * tfNorm
      }

      if (score >= threshold) {
        results.push({ id: doc.id, content: doc.content, layer: doc.layer, score })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  }
}
