/**
 * Sunday letter — week-roll-up aggregator.
 *
 * Pure function that turns the past 7 days of memories + reflections
 * into a structured input for letter rendering. The gate skips the
 * letter rather than fabricate one when the user wasn't active enough
 * this week.
 *
 * v0.4 addition: optionally attaches an `affectShape` summary derived
 * from the affect-dynamics base layer (Russell circumplex valence /
 * Kuppens inertia). When the input window has enough samples, the
 * letter prompt gets a short paragraph the model can reference; when
 * not, the affectShape is omitted and the letter falls back to the
 * memory-only structure.
 */

import type { MemoryItem } from '../../types'
import type { AffectSnapshot, AffectShift } from '../autonomy/affectDynamics'

export interface AggregateLetterInput {
  nowMs: number
  /** Memories created within the trailing 7-day window. Caller filters. */
  recentMemories: readonly MemoryItem[]
  /** Distinct local-date keys on which the user sent at least one chat. */
  activeDayKeys: readonly string[]
  /** Anniversary slugs reached during the week (e.g. ['days-100']). */
  milestonesReached?: readonly string[]
  /**
   * Affect-dynamics snapshot for the trailing 7-day window. Optional —
   * when omitted (no samples yet, opt-out, etc.) the letter falls back
   * to the memory-only shape. The aggregator passes it through after a
   * minimum-samples gate so the letter prompt doesn't reference a
   * statistic computed from too-few points.
   */
  affectThisWeek?: AffectSnapshot
  /**
   * Optional comparison snapshot (e.g. previous 4-week window) so the
   * letter can reference shifts. The shift is computed by the caller
   * via `compareAffectSnapshots(prior, affectThisWeek)`.
   */
  affectShift?: AffectShift
}

export interface MemoryHighlight {
  id: string
  content: string
  significance: number
}

/**
 * Letter-ready summary of the user's emotional shape across the week.
 * Built from the underlying affect-dynamics snapshot so the letter
 * prompt has descriptive numbers (not mood labels) to reference.
 */
export interface AffectShape {
  /** Number of samples that fed the snapshot. */
  n: number
  /** Mean valence over the week (-1..1). */
  baselineValence: number
  /**
   * Variability of valence within the week. Higher = mood bounced
   * around more this week than usual. May be `null` when n < 2.
   */
  variability: number | null
  /** Lag-1 autocorrelation (Kuppens "inertia"); null when n < 3. */
  inertia: number | null
  /** When non-null, comparison vs the prior 4-week window. */
  shiftFromPrior: AffectShift | null
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
  /**
   * Optional descriptive snapshot of the user's affect shape this week.
   * Present only when the affect timeline had enough samples. The
   * letter prompt references it as soft prose — never as a clinical
   * claim.
   */
  affectShape?: AffectShape
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

/**
 * Minimum sample count before we'll attach an affect shape to the
 * letter. Below this the descriptive stats are too noisy — better the
 * letter falls back to memory-only than confidently asserts a baseline
 * computed from two voice utterances.
 */
const AFFECT_SHAPE_MIN_SAMPLES = 6

function buildAffectShape(input: AggregateLetterInput): AffectShape | undefined {
  const snapshot = input.affectThisWeek
  if (!snapshot || snapshot.n < AFFECT_SHAPE_MIN_SAMPLES) return undefined
  if (snapshot.baselineValence == null) return undefined
  return {
    n: snapshot.n,
    baselineValence: snapshot.baselineValence,
    variability: snapshot.variability,
    inertia: snapshot.inertia,
    shiftFromPrior: input.affectShift ?? null,
  }
}

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

  const affectShape = buildAffectShape(input)

  return {
    shouldFire: true,
    themes,
    highlights,
    stressors,
    reflectionLines,
    milestonesNotedThisWeek: [...(input.milestonesReached ?? [])],
    weekDayCount,
    ...(affectShape ? { affectShape } : {}),
  }
}
