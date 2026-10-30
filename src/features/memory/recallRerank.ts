/**
 * Second-stage recall re-ranking.
 *
 * The first stage (hybrid vector + keyword) is cheap and scores every active
 * memory. It still loses paraphrases whose wording sits between two
 * neighbours. This stage re-scores only the head of that list with one extra
 * embedding pass and fuses both orders, so a hard miss can be promoted
 * without paying a second full-store search.
 *
 * The fusion is reciprocal-rank based: absolute cosine ranges differ per
 * model, so only each stage's order is trusted. `MEMORY_RERANK_RRF_WEIGHT`
 * was picked on the tuning split (it matches a plain "trust the second stage"
 * order there and on the held-out split, while still keeping the first stage
 * as a tie-break). No candidate outside the head is moved.
 */

import { cosineSimilarity } from './vectorSearch.ts'

/**
 * BGE-M3 is a strong multilingual retriever good enough to re-rank Chinese
 * memories and, unlike a dedicated cross-encoder, is already part of the
 * local Ollama catalog. Any machine without it falls back to the first-stage
 * order unchanged.
 */
export const MEMORY_RERANK_MODEL_ID = 'ollama:bge-m3:latest'
export const MEMORY_RERANK_TOP_K = 8
export const MEMORY_RERANK_RRF_WEIGHT = 8
/** Bounded so a slow local model never holds a chat turn open. */
export const MEMORY_RERANK_TIMEOUT_MS = 1500
const RRF_RANK_OFFSET = 60

/**
 * Fuse a first-stage order with second-stage similarity scores. Only the
 * head (first `topK` items) is reordered; the tail keeps its order after it.
 * Items without a finite second-stage score keep their first-stage rank.
 *
 * Returns a new array; the input is never mutated.
 */
export function fuseRecallRerank<T extends { id: string }>(
  ranked: readonly T[],
  rerankScores: ReadonlyMap<string, number>,
  topK: number = MEMORY_RERANK_TOP_K,
): T[] {
  const headSize = Math.min(ranked.length, Math.max(1, Math.floor(topK)))
  if (headSize < 2 || rerankScores.size === 0) return [...ranked]

  const head = ranked.slice(0, headSize)
  const tail = ranked.slice(headSize)
  const baseRank = new Map(head.map((item, index) => [item.id, index]))
  const scored = head
    .map((item) => ({ id: item.id, score: rerankScores.get(item.id) }))
    .filter((entry): entry is { id: string; score: number } => Number.isFinite(entry.score))
    .sort((left, right) => (
      right.score - left.score
      || (baseRank.get(left.id) ?? 0) - (baseRank.get(right.id) ?? 0)
    ))
  if (scored.length < 2) return [...ranked]

  const rerankRank = new Map(scored.map((entry, index) => [entry.id, index]))
  const fused = head
    .map((item) => {
      const base = baseRank.get(item.id) ?? 0
      const second = rerankRank.get(item.id)
      return {
        item,
        // Only items with a second-stage score earn its contribution; the
        // rest fall back to their first-stage position alone.
        score: 1 / (RRF_RANK_OFFSET + base + 1)
          + (second === undefined ? 0 : MEMORY_RERANK_RRF_WEIGHT / (RRF_RANK_OFFSET + second + 1)),
      }
    })
    .sort((left, right) => (
      right.score - left.score
      || (baseRank.get(left.item.id) ?? 0) - (baseRank.get(right.item.id) ?? 0)
    ))
    .map((entry) => entry.item)

  return [...fused, ...tail]
}

/**
 * Cosine between the query vector and each candidate vector, paired by id.
 * Candidates whose vector length does not match the query are skipped rather
 * than scored as zero, so a stale vector cannot demote a real match.
 */
export function scoreRerankCandidates(
  queryEmbedding: readonly number[],
  candidates: ReadonlyArray<{ id: string; embedding: readonly number[] }>,
): Map<string, number> {
  const scores = new Map<string, number>()
  if (!queryEmbedding.length) return scores
  for (const candidate of candidates) {
    if (candidate.embedding.length !== queryEmbedding.length) continue
    scores.set(candidate.id, cosineSimilarity([...queryEmbedding], [...candidate.embedding]))
  }
  return scores
}
