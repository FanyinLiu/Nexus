import type { FocusState } from '../../types'

export type FocusThresholds = {
  /** Seconds of inactivity before transitioning from active → idle. */
  idleSeconds: number
  /** Seconds of inactivity before transitioning from idle → away. */
  awaySeconds: number
}

const DEFAULT_THRESHOLDS: FocusThresholds = {
  idleSeconds: 300,   // 5 minutes
  awaySeconds: 1_800, // 30 minutes
}

/**
 * Classify the user's focus state from the system idle time (seconds).
 * The `locked` state is set externally via power events, not idle time.
 */
export function classifyFocusState(
  idleSeconds: number,
  thresholds: FocusThresholds = DEFAULT_THRESHOLDS,
): FocusState {
  if (idleSeconds >= thresholds.awaySeconds) return 'away'
  if (idleSeconds >= thresholds.idleSeconds) return 'idle'
  return 'active'
}

export type FocusTransition = {
  changed: boolean
  from: FocusState
  to: FocusState
}

export function detectFocusTransition(
  prev: FocusState,
  next: FocusState,
): FocusTransition {
  return { changed: prev !== next, from: prev, to: next }
}

/**
 * Returns true when the companion should NOT produce proactive output.
 * Suppression applies during quiet hours and when the user is away/locked.
 */
export function shouldSuppressAutonomy(
  focusState: FocusState,
  currentHour: number,
  quietHours: { start: number; end: number },
): boolean {
  if (focusState === 'locked') return true

  // Quiet hours: e.g. 23:00 → 07:00
  if (quietHours.start > quietHours.end) {
    // Wraps midnight
    if (currentHour >= quietHours.start || currentHour < quietHours.end) return true
  } else if (quietHours.start < quietHours.end) {
    if (currentHour >= quietHours.start && currentHour < quietHours.end) return true
  }

  return false
}
