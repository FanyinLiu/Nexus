/**
 * Guidance self-analysis (M1.4-M1.7 closing the loop).
 *
 * Joins the silent guidance telemetry log against the user-affect
 * timeline to answer: when guidance kind X fired, did the user's
 * valence shift in the 24h that followed, compared to the 24h that
 * preceded? This is the system's own diagnostic — there is no UI
 * surface, no rating widget, no user-facing button. The output sits
 * in localStorage for future threshold tuning to consume.
 *
 * Klein's principle (feedback_nexus_silent_emotion) requires the
 * companion to adapt silently rather than expose dashboards or ask
 * the user for feedback. This module is the silent-inference half of
 * that contract: the data the user generates by talking to her flows
 * back into the system's understanding of which guidance shapes work,
 * without the user ever being aware the loop exists.
 *
 * Pure: takes already-loaded telemetry + affect samples in, returns a
 * GuidanceAnalysisReport out. No IO. The scheduler hook in
 * useGuidanceAnalysisScheduler.ts handles loading + persisting.
 */

import type { GuidanceKind, GuidanceTelemetryEntry } from './guidanceTelemetry.ts'
import type { UserAffectSample } from './userAffectTimeline.ts'

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_WINDOW_HOURS = 24
const DEFAULT_MIN_FIRES = 3

export interface GuidanceKindReport {
  kind: GuidanceKind
  /** How many times this kind fired inside the analysis window. */
  fireCount: number
  /** Mean user valence in the lookback window before each fire. Null if no samples landed there. */
  meanValenceBefore: number | null
  /** Mean user valence in the lookahead window after each fire. */
  meanValenceAfter: number | null
  /**
   * Mean of (after - before) per fire, averaged across fires that had
   * samples on both sides. Positive = users tended to lift after this
   * guidance fired. Null when fewer than 2 fires had usable pairs.
   */
  valenceDelta: number | null
  /** Number of fires that contributed to valenceDelta (had pre + post samples). */
  pairedFires: number
}

export interface GuidanceAnalysisReport {
  /** ISO timestamp of when this analysis was computed. */
  generatedAt: string
  /** How far back the analysis looked, in days. */
  windowDays: number
  /** Lookahead/back per fire, in hours. */
  perFireWindowHours: number
  /** Per-kind breakdown. Always includes every GuidanceKind seen in the window. */
  byKind: ReadonlyArray<GuidanceKindReport>
  /**
   * Highest-positive valenceDelta — the guidance that most often coincides
   * with the user lifting. Null when nothing met the min-fires gate.
   */
  bestPerformingKind: GuidanceKind | null
  /**
   * Lowest valenceDelta — the guidance that least correlates with a lift,
   * or actively coincides with a dip. A signal to revisit the threshold
   * or prose for that kind. Null when nothing met the min-fires gate.
   */
  weakestKind: GuidanceKind | null
}

export interface AnalyzeGuidanceOptions {
  /** Lookback / lookahead per fire in hours. Default 24. */
  perFireWindowHours?: number
  /** Don't compute best/weakest for kinds with fewer paired fires. Default 3. */
  minFires?: number
  /** Cap how far back fires are considered, in days. Default 365. */
  windowDays?: number
}

function meanOrNull(xs: number[]): number | null {
  if (xs.length === 0) return null
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

interface ParsedSample {
  ms: number
  valence: number
}

/**
 * Find the index of the first ParsedSample with `ms >= target` in a
 * sorted array. Standard lower-bound binary search.
 */
function lowerBoundMs(sorted: ReadonlyArray<ParsedSample>, target: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid].ms < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Pull all valences from samples whose timestamps fall in the half-open
 * window. Uses binary-search bracketing of the sorted ParsedSample
 * array, so cost per fire is O(log n + window-size) rather than O(n).
 * The center sample (timestamps within ±5s of fire) is excluded.
 */
const PROXIMITY_MS = 5_000

function valencesInWindow(
  sorted: ReadonlyArray<ParsedSample>,
  centerMs: number,
  windowMs: number,
  side: 'before' | 'after',
): number[] {
  const lo = side === 'before' ? centerMs - windowMs : centerMs + 1
  const hi = side === 'before' ? centerMs : centerMs + windowMs + 1
  const startIdx = lowerBoundMs(sorted, lo)
  const endIdx = lowerBoundMs(sorted, hi)
  const result: number[] = []
  for (let i = startIdx; i < endIdx; i += 1) {
    const s = sorted[i]
    if (Math.abs(s.ms - centerMs) <= PROXIMITY_MS) continue
    if (side === 'before' && s.ms >= centerMs) continue
    if (side === 'after' && s.ms <= centerMs) continue
    result.push(s.valence)
  }
  return result
}

export function analyzeGuidance(
  telemetry: ReadonlyArray<GuidanceTelemetryEntry>,
  affectSamples: ReadonlyArray<UserAffectSample>,
  now: Date = new Date(),
  options: AnalyzeGuidanceOptions = {},
): GuidanceAnalysisReport {
  const perFireWindowHours = options.perFireWindowHours ?? DEFAULT_WINDOW_HOURS
  const minFires = options.minFires ?? DEFAULT_MIN_FIRES
  const windowDays = options.windowDays ?? 365
  const cutoffMs = now.getTime() - windowDays * 24 * HOUR_MS
  const perFireMs = perFireWindowHours * HOUR_MS

  // Filter telemetry to the analysis window.
  const inWindow = telemetry.filter((t) => {
    const ts = Date.parse(t.ts)
    return Number.isFinite(ts) && ts >= cutoffMs && ts <= now.getTime()
  })

  // Pre-parse and sort affect samples once. Each fire then binary-searches
  // its before/after windows in O(log n) instead of repeating Date.parse +
  // full-array scan O(n) per fire.
  const sorted: ParsedSample[] = []
  for (const s of affectSamples) {
    const t = Date.parse(s.ts)
    if (Number.isFinite(t)) sorted.push({ ms: t, valence: s.valence })
  }
  sorted.sort((a, b) => a.ms - b.ms)

  const byKindAcc = new Map<GuidanceKind, {
    fireCount: number
    beforeMeans: number[]
    afterMeans: number[]
    deltas: number[]
  }>()

  for (const fire of inWindow) {
    const fireMs = Date.parse(fire.ts)
    if (!Number.isFinite(fireMs)) continue
    const beforeValences = valencesInWindow(sorted, fireMs, perFireMs, 'before')
    const afterValences = valencesInWindow(sorted, fireMs, perFireMs, 'after')

    const before = meanOrNull(beforeValences)
    const after = meanOrNull(afterValences)

    const acc = byKindAcc.get(fire.kind) ?? {
      fireCount: 0,
      beforeMeans: [] as number[],
      afterMeans: [] as number[],
      deltas: [] as number[],
    }
    acc.fireCount += 1
    if (before != null) acc.beforeMeans.push(before)
    if (after != null) acc.afterMeans.push(after)
    if (before != null && after != null) acc.deltas.push(after - before)
    byKindAcc.set(fire.kind, acc)
  }

  const byKind: GuidanceKindReport[] = []
  for (const [kind, acc] of byKindAcc) {
    byKind.push({
      kind,
      fireCount: acc.fireCount,
      meanValenceBefore: meanOrNull(acc.beforeMeans),
      meanValenceAfter: meanOrNull(acc.afterMeans),
      valenceDelta: acc.deltas.length >= 2 ? meanOrNull(acc.deltas) : null,
      pairedFires: acc.deltas.length,
    })
  }
  byKind.sort((a, b) => a.kind.localeCompare(b.kind))

  // Best / weakest only among kinds with enough paired fires to have a delta.
  const eligible = byKind.filter(
    (r) => r.valenceDelta != null && r.pairedFires >= minFires,
  )
  let bestPerformingKind: GuidanceKind | null = null
  let weakestKind: GuidanceKind | null = null
  if (eligible.length > 0) {
    const sorted = [...eligible].sort(
      (a, b) => (b.valenceDelta ?? 0) - (a.valenceDelta ?? 0),
    )
    bestPerformingKind = sorted[0].kind
    weakestKind = sorted[sorted.length - 1].kind
    if (bestPerformingKind === weakestKind) weakestKind = null
  }

  return {
    generatedAt: now.toISOString(),
    windowDays,
    perFireWindowHours,
    byKind,
    bestPerformingKind,
    weakestKind,
  }
}
