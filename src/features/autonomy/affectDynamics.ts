/**
 * Affect dynamics — derived statistics over user affect time-series.
 *
 * Pure functions: take a sample window in, return a snapshot out. No
 * IO, no clock, no React. Calling code (Sunday letter aggregator,
 * monthly mood map, annual yearbook, weekly recap panel) decides which
 * window to feed and how to render the result.
 *
 * Grounded in:
 *   - **Russell (1980)** circumplex — valence × arousal as the primary
 *     dimensions; we emit them as the canonical aggregates.
 *     https://pdodds.w3.uvm.edu/research/papers/others/1980/russell1980a.pdf
 *   - **Kuppens et al. (2015)** affect dynamics — `inertia` (lag-1
 *     autocorrelation) and `variability` (within-window stddev) are
 *     the two diagnostic axes shown to predict wellbeing. High inertia
 *     = stuck moods; extreme variability = volatility. Mid is healthy.
 *     https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.01997/full
 *
 * The numbers we emit are advisory — descriptive statistics meant to
 * surface in narrative artifacts ("your baseline lifted slightly this
 * month"), not diagnostic claims about the user's mental health.
 */

import type { UserAffectSample } from './userAffectTimeline.ts'

export interface AffectSnapshot {
  /** Number of samples in the window. */
  n: number
  /** Mean valence; null when n === 0. */
  baselineValence: number | null
  /** Mean arousal; null when n === 0. */
  baselineArousal: number | null
  /**
   * Within-window standard deviation of valence. Higher = more volatile
   * mood across the window. Null when n < 2.
   */
  variability: number | null
  /**
   * Lag-1 autocorrelation of valence — Kuppens' "inertia." Positive
   * means moods stick (today's mood predicts tomorrow's). Higher values
   * (>0.4) associate with depression risk in the literature; values
   * around 0.0-0.3 are healthy. Null when n < 3.
   */
  inertia: number | null
  /** Earliest sample's ISO timestamp; null on empty window. */
  windowStart: string | null
  /** Latest sample's ISO timestamp; null on empty window. */
  windowEnd: string | null
}

const EMPTY_SNAPSHOT: AffectSnapshot = {
  n: 0,
  baselineValence: null,
  baselineArousal: null,
  variability: null,
  inertia: null,
  windowStart: null,
  windowEnd: null,
}

/**
 * Compute descriptive statistics over a window of samples.
 */
export function computeAffectSnapshot(samples: ReadonlyArray<UserAffectSample>): AffectSnapshot {
  if (samples.length === 0) return EMPTY_SNAPSHOT

  const valences = samples.map((s) => s.valence)
  const arousals = samples.map((s) => s.arousal)

  const baselineValence = mean(valences)
  const baselineArousal = mean(arousals)
  const variability = samples.length >= 2 ? stddev(valences, baselineValence) : null
  const inertia = samples.length >= 3 ? lag1AutoCorr(valences, baselineValence) : null

  return {
    n: samples.length,
    baselineValence,
    baselineArousal,
    variability,
    inertia,
    windowStart: samples[0].ts,
    windowEnd: samples[samples.length - 1].ts,
  }
}

/**
 * Compare two non-overlapping snapshots and produce a small "what
 * changed" summary suitable for prose generation. `null` values are
 * passed through; callers prose-format around them.
 */
export interface AffectShift {
  baselineValenceDelta: number | null
  baselineArousalDelta: number | null
  /** True when |valenceDelta| ≥ 0.1 — large enough to mention. */
  valenceShiftIsNotable: boolean
  /** True when later.variability > 1.5× earlier.variability. */
  variabilityRoseSharply: boolean
  /** True when later.inertia ≥ 0.4 (Kuppens flag). */
  inertiaIsHigh: boolean
}

export function compareAffectSnapshots(
  earlier: AffectSnapshot,
  later: AffectSnapshot,
): AffectShift {
  const baselineValenceDelta =
    earlier.baselineValence != null && later.baselineValence != null
      ? round(later.baselineValence - earlier.baselineValence)
      : null
  const baselineArousalDelta =
    earlier.baselineArousal != null && later.baselineArousal != null
      ? round(later.baselineArousal - earlier.baselineArousal)
      : null
  const valenceShiftIsNotable =
    baselineValenceDelta != null && Math.abs(baselineValenceDelta) >= 0.1
  const variabilityRoseSharply =
    earlier.variability != null
    && later.variability != null
    && earlier.variability > 0
    && later.variability > earlier.variability * 1.5
  const inertiaIsHigh = later.inertia != null && later.inertia >= 0.4

  return {
    baselineValenceDelta,
    baselineArousalDelta,
    valenceShiftIsNotable,
    variabilityRoseSharply,
    inertiaIsHigh,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

function stddev(xs: number[], precomputedMean?: number): number {
  const m = precomputedMean ?? mean(xs)
  let sumSq = 0
  for (const x of xs) {
    const d = x - m
    sumSq += d * d
  }
  return Math.sqrt(sumSq / xs.length)
}

/**
 * Lag-1 autocorrelation. Returns 0 when the series is constant (avoids
 * division-by-zero); falls back to `null`-equivalent behavior at the
 * call site.
 */
function lag1AutoCorr(xs: number[], precomputedMean?: number): number {
  const m = precomputedMean ?? mean(xs)
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i += 1) {
    const dev = xs[i] - m
    den += dev * dev
    if (i + 1 < xs.length) {
      num += dev * (xs[i + 1] - m)
    }
  }
  if (den === 0) return 0
  return num / den
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000
}
