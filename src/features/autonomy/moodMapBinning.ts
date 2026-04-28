/**
 * Day-binning helpers for the mood map UI.
 *
 * Pure functions — no IO, no clock. The panel feeds in a window of
 * UserAffectSample values and gets back one bin per local day, suitable
 * for plotting as a sparse line chart.
 */

import type { UserAffectSample } from './userAffectTimeline.ts'

export interface DailyAffectBin {
  /** Local-date YYYY-MM-DD key the bin represents. */
  day: string
  /** Mean valence for this day (-1..+1). */
  valence: number
  /** Mean arousal for this day (0..1). */
  arousal: number
  /** How many samples landed in this bin. */
  count: number
}

/**
 * Return the local-date YYYY-MM-DD for a given ISO timestamp, or null
 * if the timestamp is not parseable.
 */
export function localDayKey(iso: string): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Bin samples by local day. Empty days are skipped (no zero-fill) — so
 * a sparse history shows up as gaps in the chart rather than a flat
 * misleading floor at 0. Output is sorted ascending by day.
 */
export function binSamplesByDay(samples: ReadonlyArray<UserAffectSample>): DailyAffectBin[] {
  const buckets = new Map<string, { vSum: number; aSum: number; n: number }>()
  for (const s of samples) {
    const key = localDayKey(s.ts)
    if (!key) continue
    const existing = buckets.get(key)
    if (existing) {
      existing.vSum += s.valence
      existing.aSum += s.arousal
      existing.n += 1
    } else {
      buckets.set(key, { vSum: s.valence, aSum: s.arousal, n: 1 })
    }
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => ({
      day,
      valence: b.vSum / b.n,
      arousal: b.aSum / b.n,
      count: b.n,
    }))
}
