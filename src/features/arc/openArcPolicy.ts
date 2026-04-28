/**
 * Open-arc check-in policy — pure decision function.
 *
 * Decides whether the scheduler should fire a check-in right now, and
 * which arc to fire for. Pure: takes arcs + a clock + quiet-hours
 * config in, returns a decision out. No IO, no React.
 *
 * Pacing constraints (most → least restrictive):
 *   - Quiet hours: never during sleeping window.
 *   - At most one check-in fires per scheduler tick.
 *   - Each arc gets at most one check-in per check-in-day milestone.
 *   - Prefer the oldest open arc that has a due milestone.
 */

import type { OpenArcRecord } from './openArcStore.ts'

export type CheckInDecisionReason =
  | 'fire'
  | 'no-arcs'
  | 'quiet-hours'
  | 'all-checked-in'
  | 'no-milestone-due'

export interface CheckInDecision {
  shouldFire: boolean
  arcId?: string
  /**
   * Which day-offset milestone this check-in is for (e.g. 3 or 5). Useful
   * downstream for picking copy ("day 3" vs "day 5" prose).
   */
  milestoneDay?: number
  /** Days since the arc started (rounded down). */
  daysSinceStart?: number
  reason: CheckInDecisionReason
}

export interface CheckInPolicyOptions {
  /** Quiet-hours window, 0-23 hour. If start > end, window wraps midnight. */
  quietHoursStart: number
  quietHoursEnd: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function isInsideQuietHours(now: Date, start: number, end: number): boolean {
  const h = now.getHours()
  if (start === end) return false
  if (start < end) return h >= start && h < end
  // wraps midnight, e.g. 22 → 7
  return h >= start || h < end
}

function daysSince(startedAt: string, nowMs: number): number | null {
  const startedMs = Date.parse(startedAt)
  if (!Number.isFinite(startedMs)) return null
  return Math.floor((nowMs - startedMs) / DAY_MS)
}

/**
 * Find the smallest milestone day ≤ daysSinceStart that hasn't been fired
 * yet. Returns null if all milestones up to today have been fired.
 *
 * "Already fired" is counted positionally — if an arc has 2 milestones
 * [3, 5] and `checkInsFired.length === 1`, the day-3 ping is done and we
 * consider day 5 next.
 */
function nextDueMilestone(arc: OpenArcRecord, daysSoFar: number): number | null {
  const fired = arc.checkInsFired.length
  if (fired >= arc.checkInDays.length) return null
  const next = arc.checkInDays[fired]
  if (daysSoFar < next) return null
  return next
}

export function decideNextCheckIn(
  arcs: ReadonlyArray<OpenArcRecord>,
  now: Date,
  options: CheckInPolicyOptions,
): CheckInDecision {
  if (isInsideQuietHours(now, options.quietHoursStart, options.quietHoursEnd)) {
    return { shouldFire: false, reason: 'quiet-hours' }
  }

  const open = arcs.filter((a) => a.status === 'open')
  if (open.length === 0) {
    return { shouldFire: false, reason: 'no-arcs' }
  }

  const sorted = [...open].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const nowMs = now.getTime()

  let sawAnyFireable = false
  for (const arc of sorted) {
    const daysSoFar = daysSince(arc.startedAt, nowMs)
    if (daysSoFar == null) continue
    const milestone = nextDueMilestone(arc, daysSoFar)
    if (milestone == null) continue
    sawAnyFireable = true
    return {
      shouldFire: true,
      arcId: arc.id,
      milestoneDay: milestone,
      daysSinceStart: daysSoFar,
      reason: 'fire',
    }
  }

  // No arc had a due milestone — all open arcs are either pre-day-3 or
  // already caught up on their pings.
  return {
    shouldFire: false,
    reason: sawAnyFireable ? 'no-milestone-due' : 'all-checked-in',
  }
}
