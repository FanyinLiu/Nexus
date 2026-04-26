/**
 * "On this day" anniversary callback — pure selection logic.
 *
 * Distinct from the relationship-level anniversary milestones
 * (`features/autonomy/milestones.ts`, which fire at days-30/100/365 of
 * total interaction). This module looks at *individual memory createdAt
 * dates* and finds the ones whose calendar anniversary is today —
 * "exactly one year ago today you talked about X," "a month ago today,"
 * "a week ago today."
 *
 * The emotional pattern is the same one milestones reach for: specific
 * reference, not ceremony. The prompt hint asks the LLM to weave a
 * mention if a moment fits, and gives explicit permission to skip if
 * not. The selection here just picks at most one candidate per call so
 * the prompt stays focused.
 *
 * Pure: caller supplies memories + clock; this returns id + gap kind
 * and never touches storage. Persistence and dedup happen in the
 * consumer hook.
 */

import type { MemoryItem } from '../../types'

export type OnThisDayGap = 'year' | 'half-year' | 'month' | 'week'

export interface OnThisDayCandidate {
  memoryId: string
  /** Snapshot of the memory's text — caller may render this in a prompt hint. */
  content: string
  /** Which calendar anniversary triggered this candidate. */
  gap: OnThisDayGap
  /** ISO date the original memory was created. */
  createdAt: string
}

interface GapWindow {
  gap: OnThisDayGap
  /** How many days back the anniversary lands. */
  daysBack: number
  /** Tolerance in days (±). 0 means exact match. */
  tolerance: number
  /** Weight applied to significance when ranking; year > half-year > month > week. */
  weight: number
}

const WINDOWS: GapWindow[] = [
  { gap: 'year', daysBack: 365, tolerance: 2, weight: 4 },
  { gap: 'half-year', daysBack: 182, tolerance: 1, weight: 2.5 },
  { gap: 'month', daysBack: 30, tolerance: 1, weight: 1.5 },
  { gap: 'week', daysBack: 7, tolerance: 0, weight: 1 },
]

const DAY_MS = 24 * 60 * 60 * 1000

function memoryWeight(memory: MemoryItem): number {
  // Significance is the canonical weight when present (0..1).
  // Importance buckets are coarser — fall back to a sane mapping.
  if (typeof memory.significance === 'number' && Number.isFinite(memory.significance)) {
    return memory.significance
  }
  if (typeof memory.importanceScore === 'number' && Number.isFinite(memory.importanceScore)) {
    return memory.importanceScore
  }
  switch (memory.importance) {
    case 'pinned': return 0.9
    case 'high': return 0.8
    case 'normal': return 0.5
    case 'low': return 0.2
    case 'reflection': return 0  // reflections aren't callbacks; the chat layer handles them
    default: return 0.4
  }
}

/**
 * Find the single best on-this-day candidate from a memory pool, or
 * null if nothing fits any window. Skips memories present in
 * `excludeIds` (e.g. ids that have already been fired in the past).
 */
export function findOnThisDayCandidate(
  memories: ReadonlyArray<MemoryItem>,
  nowMs: number = Date.now(),
  excludeIds: ReadonlySet<string> = new Set(),
): OnThisDayCandidate | null {
  let best: { candidate: OnThisDayCandidate; score: number } | null = null

  for (const memory of memories) {
    if (excludeIds.has(memory.id)) continue
    const createdMs = Date.parse(memory.createdAt)
    if (!Number.isFinite(createdMs)) continue

    const ageMs = nowMs - createdMs
    if (ageMs <= 0) continue

    for (const window of WINDOWS) {
      const targetAgeDays = window.daysBack
      const ageDays = ageMs / DAY_MS
      const drift = Math.abs(ageDays - targetAgeDays)
      if (drift > window.tolerance + 0.5) continue

      const weight = memoryWeight(memory)
      if (weight <= 0) continue

      const score = weight * window.weight - drift * 0.05
      if (!best || score > best.score) {
        best = {
          candidate: {
            memoryId: memory.id,
            content: memory.content,
            gap: window.gap,
            createdAt: memory.createdAt,
          },
          score,
        }
      }
      // First matching window per memory is enough — windows are listed
      // most-prized first, and the day grids barely overlap (year vs
      // half-year share no calendar dates).
      break
    }
  }

  return best?.candidate ?? null
}
