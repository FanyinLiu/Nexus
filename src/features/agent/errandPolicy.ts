/**
 * Pure decision logic for the overnight errand runner.
 *
 * The runner is gated by:
 *   - Time window — only run between START_HOUR and END_HOUR (local).
 *     Default 22:00 → 06:00 ("late evening through dawn"). Anything
 *     queued during the day stays queued until the window opens.
 *   - Inter-run cooldown — leave a gap between errand runs so a long
 *     night doesn't burn through a queue in a single hour.
 *   - Per-night budget — cap how many errands run in one calendar night
 *     so a runaway queue can't drain unbounded tokens.
 *
 * Pure function: caller supplies clock + state, this returns the
 * decision. No timers, no side effects.
 */

export interface ErrandRunnerState {
  /** ISO timestamp of the last time the runner moved an errand from queued → running. */
  lastRunAt?: string
  /** ISO timestamp of midnight on the night the most recent runs counted toward. */
  nightStartedAt?: string
  /** Number of errands started since the current night's nightStartedAt. */
  ranThisNight?: number
}

export interface ErrandWindow {
  startHour: number  // inclusive (local hour 0..23)
  endHour: number    // exclusive (local hour 0..23). Wraps when endHour <= startHour.
}

export const DEFAULT_ERRAND_WINDOW: ErrandWindow = {
  startHour: 22,
  endHour: 6,
}

/** Wait this long between successive errand runs even when the queue is full. */
export const DEFAULT_RUN_COOLDOWN_MS = 15 * 60 * 1000  // 15 min

/** Cap on how many errands can run in a single overnight window. */
export const DEFAULT_PER_NIGHT_BUDGET = 4

/**
 * Is the given local hour inside `[start, end)`, accounting for windows
 * that wrap past midnight (e.g. 22 → 6)?
 */
export function isInWindow(hour: number, window: ErrandWindow): boolean {
  if (window.startHour === window.endHour) return false
  if (window.startHour < window.endHour) {
    return hour >= window.startHour && hour < window.endHour
  }
  // Wraps: e.g. start 22, end 6 → in window if hour ≥ 22 OR hour < 6
  return hour >= window.startHour || hour < window.endHour
}

/**
 * Compute "what night does `nowMs` belong to" — used to bucket per-night
 * budgets. A timestamp at 23:00 Mon and 03:00 Tue both live in the same
 * "night" for budgeting purposes; we anchor on the most recent local
 * midnight at-or-before `startHour`.
 */
export function nightAnchorIso(nowMs: number, window: ErrandWindow = DEFAULT_ERRAND_WINDOW): string {
  const d = new Date(nowMs)
  const hour = d.getHours()
  // If we're before startHour today, this run still belongs to last night's
  // window — anchor on yesterday's startHour.
  if (window.startHour < window.endHour || hour >= window.startHour) {
    d.setHours(window.startHour, 0, 0, 0)
  } else {
    d.setDate(d.getDate() - 1)
    d.setHours(window.startHour, 0, 0, 0)
  }
  return d.toISOString()
}

export type ErrandRunDecision =
  | { shouldRun: true; nightAnchor: string }
  | { shouldRun: false; reason: string }

export interface DecideErrandRunInput {
  nowMs: number
  hasQueuedErrand: boolean
  state: ErrandRunnerState
  window?: ErrandWindow
  cooldownMs?: number
  perNightBudget?: number
}

export function decideErrandRun(input: DecideErrandRunInput): ErrandRunDecision {
  const window = input.window ?? DEFAULT_ERRAND_WINDOW
  const cooldownMs = input.cooldownMs ?? DEFAULT_RUN_COOLDOWN_MS
  const budget = input.perNightBudget ?? DEFAULT_PER_NIGHT_BUDGET
  const now = new Date(input.nowMs)

  if (!input.hasQueuedErrand) {
    return { shouldRun: false, reason: 'no_queued_errand' }
  }
  if (!isInWindow(now.getHours(), window)) {
    return { shouldRun: false, reason: 'outside_window' }
  }
  if (input.state.lastRunAt) {
    const last = Date.parse(input.state.lastRunAt)
    if (Number.isFinite(last) && input.nowMs - last < cooldownMs) {
      return { shouldRun: false, reason: 'cooldown' }
    }
  }
  const anchor = nightAnchorIso(input.nowMs, window)
  if (input.state.nightStartedAt === anchor) {
    if ((input.state.ranThisNight ?? 0) >= budget) {
      return { shouldRun: false, reason: 'night_budget_exhausted' }
    }
  }
  return { shouldRun: true, nightAnchor: anchor }
}

export function recordRun(
  state: ErrandRunnerState,
  nightAnchor: string,
  nowIso: string,
): ErrandRunnerState {
  if (state.nightStartedAt === nightAnchor) {
    return {
      ...state,
      lastRunAt: nowIso,
      ranThisNight: (state.ranThisNight ?? 0) + 1,
    }
  }
  return {
    nightStartedAt: nightAnchor,
    lastRunAt: nowIso,
    ranThisNight: 1,
  }
}
