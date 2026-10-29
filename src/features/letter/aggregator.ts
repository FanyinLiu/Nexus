/**
 * Sunday letter — week-roll-up aggregator.
 *
 * Pure function that turns the past week of memories, diary entries, and
 * active chat days into a structured input for letter rendering. The gate is
 * deliberately low: a week with two active days, a handful of messages on one
 * day, or any remembered event/diary entry is enough for a short letter.
 * Only a week with no interaction and nothing remembered is skipped.
 *
 * Privacy: disabled, migrated, archived/superseded, and sensitive-looking
 * rows never reach the letter prompt, even if an older memory store still
 * contains them.
 *
 * v0.4 addition: optionally attaches an `affectShape` summary derived
 * from the affect-dynamics base layer (Russell circumplex valence /
 * Kuppens inertia). When the input window has enough samples, the
 * letter prompt gets a short paragraph the model can reference; when
 * not, the affectShape is omitted and the letter falls back to the
 * memory-only structure.
 */

import type { DailyMemoryEntry, MemoryItem } from '../../types/index.ts'
import { isSensitiveMemoryText } from '../memory/memoryRules.ts'
import type { AffectSnapshot, AffectShift } from '../autonomy/affectDynamics.ts'

export interface AggregateLetterInput {
  nowMs: number
  /** Memories created within the trailing 7-day window. Caller filters. */
  recentMemories: readonly MemoryItem[]
  /** Diary entries created within the same window. Caller filters. */
  recentDiaryEntries?: readonly DailyMemoryEntry[]
  /** Distinct local-date keys on which the user sent at least one chat. */
  activeDayKeys: readonly string[]
  /** Number of user messages in the window; a busy single day still counts. */
  userMessageCount?: number
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

interface MemoryHighlight {
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
  /** Concrete moments the letter should reference, most important first. */
  highlights: MemoryHighlight[]
  /** Stressful memories with negative valence. */
  stressors: MemoryHighlight[]
  /** Verbatim reflection content (importance === 'reflection'), highest confidence first. */
  reflectionLines: string[]
  /** Short diary excerpts from the week, newest first. */
  diaryLines: string[]
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
      reason: 'empty_week'
      weekDayCount: number
    }

const MIN_ACTIVE_DAYS = 2
const MIN_MESSAGES_ON_ONE_DAY = 3
const HIGHLIGHT_LIMIT = 4
const STRESSOR_LIMIT = 3
const DIARY_LINE_LIMIT = 3
const REFLECTION_LIMIT = 5

/**
 * Minimum sample count before we'll attach an affect shape to the
 * letter. Below this the descriptive stats are too noisy — better the
 * letter falls back to memory-only than confidently asserts a baseline
 * computed from two voice utterances.
 */
const AFFECT_SHAPE_MIN_SAMPLES = 6

const IMPORTANCE_WEIGHT: Record<string, number> = {
  pinned: 1,
  high: 0.8,
  normal: 0.4,
  low: 0.1,
}

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

function memoryWeight(memory: MemoryItem): number {
  const importance = memory.importance ? (IMPORTANCE_WEIGHT[memory.importance] ?? 0) : 0
  return Math.max(memory.significance ?? 0, memory.importanceScore ?? 0, importance)
}

function isEligibleMemory(memory: MemoryItem): boolean {
  if (memory.migrated === true) return false
  if (memory.enabled === false) return false
  if (memory.status === 'archived' || memory.status === 'superseded') return false
  return !isSensitiveMemoryText(memory.content)
}

function isEligibleDiaryEntry(entry: DailyMemoryEntry): boolean {
  return entry.content.trim().length > 0 && !isSensitiveMemoryText(entry.content)
}

function toHighlight(memory: MemoryItem): MemoryHighlight {
  return {
    id: memory.id,
    content: memory.content,
    significance: memoryWeight(memory),
  }
}

function byWeightDesc(a: MemoryItem, b: MemoryItem): number {
  return memoryWeight(b) - memoryWeight(a)
}

function byReflectionConfidenceDesc(a: MemoryItem, b: MemoryItem): number {
  return (b.reflectionConfidence ?? 0) - (a.reflectionConfidence ?? 0)
}

function byCreatedAtDesc(a: DailyMemoryEntry, b: DailyMemoryEntry): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt)
}

export function aggregateSundayLetter(
  input: AggregateLetterInput,
): SundayLetterData {
  const weekDayCount = new Set(input.activeDayKeys.filter(Boolean)).size
  const userMessageCount = input.userMessageCount ?? 0
  const memories = input.recentMemories.filter(isEligibleMemory)
  const diaryEntries = (input.recentDiaryEntries ?? []).filter(isEligibleDiaryEntry)
  const hasInteraction = weekDayCount >= MIN_ACTIVE_DAYS
    || userMessageCount >= MIN_MESSAGES_ON_ONE_DAY
    || memories.length > 0
    || diaryEntries.length > 0

  if (!hasInteraction) {
    return { shouldFire: false, reason: 'empty_week', weekDayCount }
  }

  const letterMemories = memories
    .filter((m) => m.importance !== 'reflection')
    .sort(byWeightDesc)

  const highlights = letterMemories
    .filter((m) => m.emotionalValence === 'positive' || m.emotionalValence === 'mixed')
    .slice(0, HIGHLIGHT_LIMIT)
    .map(toHighlight)

  // A neutral week should still mention concrete things. Fill from the most
  // important remaining rows instead of rendering a letter with no specifics.
  if (highlights.length === 0) {
    highlights.push(...letterMemories.slice(0, Math.min(3, HIGHLIGHT_LIMIT)).map(toHighlight))
  }

  const stressors = letterMemories
    .filter((m) => m.emotionalValence === 'negative')
    .slice(0, STRESSOR_LIMIT)
    .map(toHighlight)

  const themes = [...new Set(letterMemories.map((m) => m.category))]
  const reflectionLines = memories
    .filter((m) => m.importance === 'reflection')
    .sort(byReflectionConfidenceDesc)
    .slice(0, REFLECTION_LIMIT)
    .map((m) => m.content)
  const diaryLines = [...diaryEntries]
    .sort(byCreatedAtDesc)
    .slice(0, DIARY_LINE_LIMIT)
    .map((entry) => entry.content.trim())

  const affectShape = buildAffectShape(input)

  return {
    shouldFire: true,
    themes,
    highlights,
    stressors,
    reflectionLines,
    diaryLines,
    milestonesNotedThisWeek: [...(input.milestonesReached ?? [])],
    weekDayCount,
    ...(affectShape ? { affectShape } : {}),
  }
}
