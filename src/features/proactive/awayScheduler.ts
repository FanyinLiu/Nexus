// Pure decision logic for the "thinking of you" notification fire timing.
// Separated from the React hook so it can be unit-tested without mocking
// timers, IPC, or localStorage.

export type AwayNotificationDecision = {
  shouldFire: boolean
  /** Reason kept for diagnostics; never user-facing. */
  reason:
    | 'fire'
    | 'disabled'
    | 'no_activity_yet'
    | 'below_threshold'
    | 'in_cooldown'
    | 'quiet_hours'
}

export type AwayNotificationDecisionInput = {
  enabled: boolean
  nowMs: number
  /** Timestamp of the user's last sent chat message; null if none in this session. */
  lastUserActivityMs: number | null
  /** Timestamp of the last fired notification; null if never. */
  lastFiredMs: number | null
  thresholdMinutes: number
  /** Minimum gap between two fires; defaults to threshold for symmetry. */
  cooldownMinutes?: number
  /** Local hour at which quiet hours start (inclusive). 0-23. */
  quietHourStart?: number
  /** Local hour at which quiet hours end (exclusive). 0-23. */
  quietHourEnd?: number
}

const DEFAULT_QUIET_START = 23
const DEFAULT_QUIET_END = 8

function isInQuietHours(nowMs: number, start: number, end: number): boolean {
  const hour = new Date(nowMs).getHours()
  // Quiet window wraps midnight when start > end (typical: 23 → 8).
  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

export function decideAwayNotification(
  input: AwayNotificationDecisionInput,
): AwayNotificationDecision {
  if (!input.enabled) return { shouldFire: false, reason: 'disabled' }

  const thresholdMs = Math.max(1, input.thresholdMinutes) * 60_000
  const cooldownMs = Math.max(1, input.cooldownMinutes ?? input.thresholdMinutes) * 60_000

  if (input.lastUserActivityMs == null) {
    return { shouldFire: false, reason: 'no_activity_yet' }
  }

  const idleMs = input.nowMs - input.lastUserActivityMs
  if (idleMs < thresholdMs) return { shouldFire: false, reason: 'below_threshold' }

  if (input.lastFiredMs != null) {
    const sinceFireMs = input.nowMs - input.lastFiredMs
    if (sinceFireMs < cooldownMs) return { shouldFire: false, reason: 'in_cooldown' }
  }

  const quietStart = input.quietHourStart ?? DEFAULT_QUIET_START
  const quietEnd = input.quietHourEnd ?? DEFAULT_QUIET_END
  if (isInQuietHours(input.nowMs, quietStart, quietEnd)) {
    return { shouldFire: false, reason: 'quiet_hours' }
  }

  return { shouldFire: true, reason: 'fire' }
}
