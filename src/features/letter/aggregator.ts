/**
 * Sunday letter — week-roll-up aggregator.
 *
 * Pure function that turns the past 7 days of memories + reflections
 * into a structured input for letter rendering. v0.4 sprint 1 #2.
 *
 * Gate borrowed from Life Note (round-4 research): if the user wasn't
 * active enough this week, skip the letter rather than fabricate one.
 * Section structure borrows Reflection.app's 4-field schema (summary
 * → suggestion → intention → experiment) plus Rosebud's themes / wins
 * / stressors / emotional landscape framing.
 *
 * The actual letter prose generation lives elsewhere (LLM-driven, in a
 * follow-up). This module only does the deterministic data slicing so
 * we can unit-test the gate + roll-up without an LLM.
 */

import type { MemoryItem } from '../../types'

export interface AggregateLetterInput {
  nowMs: number
  /** Memories created within the trailing 7-day window. Caller filters. */
  recentMemories: readonly MemoryItem[]
  /** Distinct local-date keys on which the user sent at least one chat. */
  activeDayKeys: readonly string[]
  /** Anniversary slugs reached during the week (e.g. ['days-100']). */
  milestonesReached?: readonly string[]
}

export interface MemoryHighlight {
  id: string
  content: string
  significance: number
}

export interface SundayLetterDataReady {
  shouldFire: true
  /** Distinct memory categories that surfaced this week. */
  themes: string[]
  /** Top significance memories with positive / mixed valence. */
  highlights: MemoryHighlight[]
  /** Top significance memories with negative valence. */
  stressors: MemoryHighlight[]
  /** Verbatim reflection content (importance === 'reflection'), highest confidence first. */
  reflectionLines: string[]
  /** Anniversary slugs surfaced this week (passed through). */
  milestonesNotedThisWeek: string[]
  weekDayCount: number
}

export type SundayLetterData =
  | SundayLetterDataReady
  | {
      shouldFire: false
      reason: 'too_few_active_days' | 'no_significant_memory'
      weekDayCount: number
    }

const ACTIVE_DAY_THRESHOLD = 3
const HIGHLIGHT_LIMIT = 4
const STRESSOR_LIMIT = 3
const REFLECTION_LIMIT = 5
const MIN_SIGNIFICANCE = 0.2

function toHighlight(memory: MemoryItem): MemoryHighlight {
  return {
    id: memory.id,
    content: memory.content,
    significance: memory.significance ?? 0,
  }
}

function bySignificanceDesc(a: MemoryItem, b: MemoryItem): number {
  return (b.significance ?? 0) - (a.significance ?? 0)
}

function byReflectionConfidenceDesc(a: MemoryItem, b: MemoryItem): number {
  return (b.reflectionConfidence ?? 0) - (a.reflectionConfidence ?? 0)
}

export function aggregateSundayLetter(
  input: AggregateLetterInput,
): SundayLetterData {
  const weekDayCount = new Set(input.activeDayKeys).size

  if (weekDayCount < ACTIVE_DAY_THRESHOLD) {
    return { shouldFire: false, reason: 'too_few_active_days', weekDayCount }
  }

  const significantMemories = input.recentMemories.filter(
    (m) => m.importance !== 'reflection' && (m.significance ?? 0) >= MIN_SIGNIFICANCE,
  )

  if (significantMemories.length === 0) {
    return { shouldFire: false, reason: 'no_significant_memory', weekDayCount }
  }

  const sorted = [...significantMemories].sort(bySignificanceDesc)

  const highlights = sorted
    .filter((m) => m.emotionalValence === 'positive' || m.emotionalValence === 'mixed')
    .slice(0, HIGHLIGHT_LIMIT)
    .map(toHighlight)

  const stressors = sorted
    .filter((m) => m.emotionalValence === 'negative')
    .slice(0, STRESSOR_LIMIT)
    .map(toHighlight)

  const themes = [...new Set(sorted.map((m) => m.category))]

  const reflectionLines = input.recentMemories
    .filter((m) => m.importance === 'reflection')
    .sort(byReflectionConfidenceDesc)
    .slice(0, REFLECTION_LIMIT)
    .map((m) => m.content)

  return {
    shouldFire: true,
    themes,
    highlights,
    stressors,
    reflectionLines,
    milestonesNotedThisWeek: [...(input.milestonesReached ?? [])],
    weekDayCount,
  }
}
