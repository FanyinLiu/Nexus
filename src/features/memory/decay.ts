/**
 * Memory importance decay and recall feedback.
 *
 * Each memory has a continuous importanceScore that:
 *   - Decays daily: score *= DECAY_FACTOR  (half-life ~23 days)
 *   - Gets boosted on recall: score += RECALL_BOOST
 *   - Is initialized from the discrete importance level on first use
 *
 * This lets frequently-relevant memories stay prominent while
 * stale ones naturally fade — without explicit manual cleanup.
 */

import type { MemoryImportance, MemoryItem } from '../../types'

const DECAY_FACTOR = 0.97
const RECALL_BOOST = 0.15
const MS_PER_DAY = 86_400_000

const IMPORTANCE_SEED: Record<MemoryImportance, number> = {
  pinned: 1.0,
  high: 0.8,
  normal: 0.5,
  low: 0.25,
}

/** Get the effective importance score, applying time-based decay. */
export function getDecayedScore(memory: MemoryItem, now = Date.now()): number {
  const base = memory.importanceScore ?? IMPORTANCE_SEED[memory.importance ?? 'normal']

  const referenceTime = memory.lastRecalledAt ?? memory.createdAt
  const elapsedMs = Math.max(0, now - Date.parse(referenceTime))
  const elapsedDays = elapsedMs / MS_PER_DAY

  // Pinned memories don't decay
  if (memory.importance === 'pinned') return base

  return base * (DECAY_FACTOR ** elapsedDays)
}

/**
 * Apply decay to all memories, returning a new array with updated scores.
 * Call this periodically (e.g. during dream cycles) to persist decayed values.
 */
export function applyDecayBatch(memories: MemoryItem[], now = Date.now()): MemoryItem[] {
  return memories.map((m) => ({
    ...m,
    importanceScore: getDecayedScore(m, now),
  }))
}

/**
 * Mark memories as recalled — bump recallCount and lastRecalledAt,
 * and boost the importance score.
 */
export function markRecalled(memories: MemoryItem[], recalledIds: Set<string>): MemoryItem[] {
  if (recalledIds.size === 0) return memories
  const now = new Date().toISOString()
  return memories.map((m) => {
    if (!recalledIds.has(m.id)) return m
    const currentScore = m.importanceScore ?? IMPORTANCE_SEED[m.importance ?? 'normal']
    return {
      ...m,
      importanceScore: Math.min(currentScore + RECALL_BOOST, 1.5),
      recallCount: (m.recallCount ?? 0) + 1,
      lastRecalledAt: now,
    }
  })
}
