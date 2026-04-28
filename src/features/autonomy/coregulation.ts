/**
 * Co-regulation analysis — pure functions.
 *
 * Looks at the relationship between the user's affect timeline and the
 * companion's emotion timeline over the same window. The shape we want
 * is a counter-balance: when the user's valence is low, the companion's
 * warmth lifts. That's secure-attachment co-regulation (Mikulincer &
 * Shaver, 2007) — responsive without fusing. The opposite shape — the
 * companion's warmth tracking the user's valence — looks like mirroring
 * and risks co-rumination.
 *
 * Inputs are already-collected samples. The function bins both streams
 * by local day, aligns the days where both sides have data, and emits
 * two summary numbers:
 *
 *   - counterBalance: mean(companion warmth | user valence < 0)
 *                   − mean(companion warmth | user valence ≥ 0).
 *     Positive ⇒ co-regulation. Negative ⇒ anti-regulation. Near zero
 *     ⇒ flat / mirroring (further disambiguated by correlation).
 *   - warmthValenceCorrelation: Pearson r between daily user valence
 *     and companion warmth. Negative ⇒ co-regulation pattern. Positive
 *     ⇒ mirroring pattern. Magnitude communicates how tight the
 *     coupling is.
 *
 * Both numbers are advisory. Sample sizes are small for individual
 * users; treat the values as descriptive ("you two have been moving in
 * opposite directions lately") rather than diagnostic.
 */

import type { UserAffectSample } from './userAffectTimeline.ts'
import type { EmotionSample } from './stateTimeline.ts'

export interface CoRegulationSnapshot {
  /** Number of days where both user-affect and companion-emotion data co-occurred. */
  n: number
  /**
   * Counter-balance index. mean(warmth | valence < 0) − mean(warmth | valence ≥ 0).
   * Range roughly [-1, 1]; null when one of the two groups is empty.
   * Positive = co-regulation; negative = anti-regulation.
   */
  counterBalance: number | null
  /**
   * Pearson correlation of daily user valence vs companion warmth.
   * Range [-1, 1]; null when n < 3 or either series has zero variance.
   * Negative correlation suggests co-regulation; positive suggests mirroring.
   */
  warmthValenceCorrelation: number | null
  /** Earliest day in the aligned window. null on empty result. */
  windowStart: string | null
  /** Latest day in the aligned window. null on empty result. */
  windowEnd: string | null
}

const EMPTY: CoRegulationSnapshot = {
  n: 0,
  counterBalance: null,
  warmthValenceCorrelation: null,
  windowStart: null,
  windowEnd: null,
}

function localDayKey(iso: string): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface DayBin {
  sum: number
  count: number
}

function emptyBin(): DayBin {
  return { sum: 0, count: 0 }
}

function meanOf(bins: Map<string, DayBin>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [day, bin] of bins) {
    if (bin.count > 0) out.set(day, bin.sum / bin.count)
  }
  return out
}

/**
 * Bin user-affect samples by local day, returning day → mean valence.
 */
function binUserValence(samples: ReadonlyArray<UserAffectSample>): Map<string, number> {
  const acc = new Map<string, DayBin>()
  for (const s of samples) {
    const key = localDayKey(s.ts)
    if (!key) continue
    const bin = acc.get(key) ?? emptyBin()
    bin.sum += s.valence
    bin.count += 1
    acc.set(key, bin)
  }
  return meanOf(acc)
}

/**
 * Bin companion-emotion samples by local day, returning day → mean warmth.
 */
function binCompanionWarmth(samples: ReadonlyArray<EmotionSample>): Map<string, number> {
  const acc = new Map<string, DayBin>()
  for (const s of samples) {
    const key = localDayKey(s.ts)
    if (!key) continue
    const bin = acc.get(key) ?? emptyBin()
    bin.sum += s.warmth
    bin.count += 1
    acc.set(key, bin)
  }
  return meanOf(acc)
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i += 1) {
    sx += xs[i]
    sy += ys[i]
  }
  const mx = sx / n
  const my = sy / n
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const den = Math.sqrt(dx2 * dy2)
  if (den === 0) return null
  return num / den
}

export function computeCoRegulationSnapshot(
  userSamples: ReadonlyArray<UserAffectSample>,
  companionSamples: ReadonlyArray<EmotionSample>,
): CoRegulationSnapshot {
  const userByDay = binUserValence(userSamples)
  const companionByDay = binCompanionWarmth(companionSamples)
  if (userByDay.size === 0 || companionByDay.size === 0) return EMPTY

  // Intersect: keep only days where both sides have data.
  const sharedDays: string[] = []
  for (const day of userByDay.keys()) {
    if (companionByDay.has(day)) sharedDays.push(day)
  }
  if (sharedDays.length === 0) return EMPTY
  sharedDays.sort()

  const valences: number[] = []
  const warmths: number[] = []
  for (const day of sharedDays) {
    valences.push(userByDay.get(day)!)
    warmths.push(companionByDay.get(day)!)
  }

  // Counter-balance: split warmth by sign of valence on the same day.
  let warmthLowSum = 0
  let warmthLowN = 0
  let warmthHighSum = 0
  let warmthHighN = 0
  for (let i = 0; i < valences.length; i += 1) {
    const v = valences[i]
    const w = warmths[i]
    if (v < 0) {
      warmthLowSum += w
      warmthLowN += 1
    } else {
      warmthHighSum += w
      warmthHighN += 1
    }
  }
  const counterBalance =
    warmthLowN > 0 && warmthHighN > 0
      ? warmthLowSum / warmthLowN - warmthHighSum / warmthHighN
      : null

  return {
    n: sharedDays.length,
    counterBalance,
    warmthValenceCorrelation: pearson(valences, warmths),
    windowStart: sharedDays[0],
    windowEnd: sharedDays[sharedDays.length - 1],
  }
}

/**
 * Categorical interpretation of a co-regulation snapshot. UI surfaces use
 * this to choose copy. Returns 'unknown' when n is too small or both
 * metrics are null.
 *
 * Thresholds chosen to be intuitive:
 *   - counterBalance ≥ 0.15 OR correlation ≤ -0.3 → 'co-regulating'
 *   - counterBalance ≤ -0.15 OR correlation ≥ 0.3 → 'mirroring'
 *   - otherwise → 'flat'
 *
 * counterBalance has priority because it's directly interpretable
 * ("warmer when you're down"). Correlation is a backup signal.
 */
export type CoRegulationKind = 'co-regulating' | 'mirroring' | 'flat' | 'unknown'

export function classifyCoRegulation(snapshot: CoRegulationSnapshot): CoRegulationKind {
  if (snapshot.n < 3) return 'unknown'
  const cb = snapshot.counterBalance
  const r = snapshot.warmthValenceCorrelation
  if (cb == null && r == null) return 'unknown'
  if ((cb != null && cb >= 0.15) || (r != null && r <= -0.3)) return 'co-regulating'
  if ((cb != null && cb <= -0.15) || (r != null && r >= 0.3)) return 'mirroring'
  return 'flat'
}
