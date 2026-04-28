/**
 * Yearbook aggregation — pure functions.
 *
 * Slices 12 months of data into one consolidated structure suitable for
 * the renderer. Pulls from three live sources:
 *
 *   - userAffectTimeline: VAD samples → year baseline + monthly buckets
 *   - stateTimeline:      companion emotion → co-regulation trend
 *   - letterStore:        SavedLetter[] → chronological excerpts
 *
 * Pure: takes already-loaded arrays in, returns a YearbookSnapshot out.
 * The UI is responsible for loading data and writing the rendered HTML
 * to disk.
 */

import type { UserAffectSample } from '../autonomy/userAffectTimeline.ts'
import type { EmotionSample } from '../autonomy/stateTimeline.ts'
import type { SavedLetter } from '../letter/letterStore.ts'
import {
  computeAffectSnapshot,
  type AffectSnapshot,
} from '../autonomy/affectDynamics.ts'
import {
  computeCoRegulationSnapshot,
  classifyCoRegulation,
  type CoRegulationKind,
  type CoRegulationSnapshot,
} from '../autonomy/coregulation.ts'
import {
  binSamplesByDay,
  type DailyAffectBin,
} from '../autonomy/moodMapBinning.ts'

const YEAR_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

export interface MonthlyBucket {
  /** YYYY-MM key. */
  monthKey: string
  /** First day of the month, used for chronological ordering. */
  monthStart: string
  /** Daily bins inside this month (may be empty if the user was quiet). */
  bins: ReadonlyArray<DailyAffectBin>
  /** Affect snapshot computed from the month's samples. */
  snapshot: AffectSnapshot
}

export interface YearbookSnapshot {
  /** Window start (oldest sample considered). */
  windowStart: string
  /** Window end ("today" in the caller's clock). */
  windowEnd: string
  /** Summary across the entire 365-day window. */
  yearSnapshot: AffectSnapshot
  /** Co-regulation across the entire window. */
  coregSnapshot: CoRegulationSnapshot
  coregKind: CoRegulationKind
  /** 12 monthly buckets in chronological order (oldest → newest). */
  months: ReadonlyArray<MonthlyBucket>
  /** Letters that fall within the window, chronological (oldest → newest). */
  letters: ReadonlyArray<SavedLetter>
}

function localMonthKey(iso: string): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function monthStartIso(monthKey: string): string {
  // Append "-01T00:00:00Z" so all rendering / sorting uses a stable instant.
  return `${monthKey}-01T00:00:00Z`
}

/**
 * Build the rolling 12-month list of {YYYY-MM} keys ending at `now`,
 * oldest-first. Always returns 12 entries even if a month is empty.
 */
export function buildMonthKeys(now: Date): string[] {
  const keys: string[] = []
  const y = now.getFullYear()
  const m = now.getMonth()
  for (let offset = 11; offset >= 0; offset -= 1) {
    const d = new Date(y, m - offset, 1)
    const yy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    keys.push(`${yy}-${mm}`)
  }
  return keys
}

function filterByYear<T extends { ts?: string; createdAt?: string; letterDate?: string }>(
  items: ReadonlyArray<T>,
  now: Date,
  pickTs: (item: T) => string | undefined,
): T[] {
  const cutoff = now.getTime() - YEAR_DAYS * DAY_MS
  return items.filter((item) => {
    const tsRaw = pickTs(item)
    if (!tsRaw) return false
    const t = Date.parse(tsRaw)
    return Number.isFinite(t) && t >= cutoff && t <= now.getTime()
  })
}

export function aggregateYearbook(
  userSamples: ReadonlyArray<UserAffectSample>,
  companionSamples: ReadonlyArray<EmotionSample>,
  letters: ReadonlyArray<SavedLetter>,
  now: Date = new Date(),
): YearbookSnapshot {
  const yearUser = filterByYear(userSamples, now, (s) => s.ts)
  const yearCompanion = filterByYear(companionSamples, now, (s) => s.ts)
  const yearLetters = filterByYear(letters, now, (l) => l.createdAt)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // Year-wide snapshot + co-regulation
  const yearSnapshot = computeAffectSnapshot(yearUser)
  const coregSnapshot = computeCoRegulationSnapshot(yearUser, yearCompanion)
  const coregKind = classifyCoRegulation(coregSnapshot)

  // Monthly buckets — 12 entries, oldest → newest, even if a month is empty.
  const monthKeys = buildMonthKeys(now)
  const monthlyAccumulator = new Map<string, UserAffectSample[]>()
  for (const key of monthKeys) monthlyAccumulator.set(key, [])
  for (const s of yearUser) {
    const k = localMonthKey(s.ts)
    if (k && monthlyAccumulator.has(k)) {
      monthlyAccumulator.get(k)!.push(s)
    }
  }

  const months: MonthlyBucket[] = monthKeys.map((monthKey) => {
    const samples = monthlyAccumulator.get(monthKey) ?? []
    return {
      monthKey,
      monthStart: monthStartIso(monthKey),
      bins: binSamplesByDay(samples),
      snapshot: computeAffectSnapshot(samples),
    }
  })

  return {
    windowStart: new Date(now.getTime() - YEAR_DAYS * DAY_MS).toISOString(),
    windowEnd: now.toISOString(),
    yearSnapshot,
    coregSnapshot,
    coregKind,
    months,
    letters: yearLetters,
  }
}
