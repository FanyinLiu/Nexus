/**
 * Decision self-evaluation and effectiveness tracking.
 *
 * After each proactive speak, records a decision entry.
 * If the user replies within RESPONSE_WINDOW_MS → 'effective'.
 * If no response → 'ignored'.
 * Tracks effective rate over a sliding window to dynamically
 * throttle speak frequency.
 */

const RESPONSE_WINDOW_MS = 30_000
const HISTORY_MAX = 50
const MIN_SPEAK_INTERVAL_TICKS = 3
const MAX_SPEAK_INTERVAL_TICKS = 15

export type DecisionOutcome = 'pending' | 'effective' | 'late_response' | 'ignored'

export interface DecisionEntry {
  id: string
  category: string
  timestamp: number
  outcome: DecisionOutcome
}

export interface DecisionFeedbackState {
  history: DecisionEntry[]
  pendingId: string | null
  pendingTimestamp: number
}

export function createInitialFeedbackState(): DecisionFeedbackState {
  return {
    history: [],
    pendingId: null,
    pendingTimestamp: 0,
  }
}

/** Record a new proactive speak decision. */
export function recordDecision(
  state: DecisionFeedbackState,
  category: string,
): DecisionFeedbackState {
  const id = crypto.randomUUID().slice(0, 8)
  const now = Date.now()

  // If there's a pending decision that wasn't resolved, mark it ignored
  const history = resolvePending(state, now).history

  return {
    history: [...history, { id, category, timestamp: now, outcome: 'pending' as const }].slice(-HISTORY_MAX),
    pendingId: id,
    pendingTimestamp: now,
  }
}

const LATE_RESPONSE_WINDOW_MS = 120_000

/** Called when user sends a message — resolves pending decision as effective if within window. */
export function onUserResponse(state: DecisionFeedbackState): DecisionFeedbackState {
  if (!state.pendingId) return state
  const elapsed = Date.now() - state.pendingTimestamp
  const outcome: DecisionOutcome = elapsed <= RESPONSE_WINDOW_MS
    ? 'effective'
    : elapsed <= LATE_RESPONSE_WINDOW_MS
      ? 'late_response'
      : 'ignored'

  return {
    history: state.history.map((e) =>
      e.id === state.pendingId ? { ...e, outcome } : e,
    ),
    pendingId: null,
    pendingTimestamp: 0,
  }
}

/** Resolve any pending decision that has expired. */
export function resolvePending(state: DecisionFeedbackState, now = Date.now()): DecisionFeedbackState {
  if (!state.pendingId) return state
  if (now - state.pendingTimestamp < RESPONSE_WINDOW_MS) return state

  return {
    history: state.history.map((e) =>
      e.id === state.pendingId ? { ...e, outcome: 'ignored' as const } : e,
    ),
    pendingId: null,
    pendingTimestamp: 0,
  }
}

/** Get the effective rate (0–1) over the last N resolved decisions. late_response counts as 0.5. */
export function getEffectiveRate(state: DecisionFeedbackState): number {
  const resolved = state.history.filter((e) => e.outcome !== 'pending')
  if (resolved.length === 0) return 0.5 // Default: assume 50% before we have data
  let score = 0
  for (const e of resolved) {
    if (e.outcome === 'effective') score += 1
    else if (e.outcome === 'late_response') score += 0.5
  }
  return score / resolved.length
}

/**
 * Compute the recommended speak interval (in ticks) based on effective rate.
 * High effective rate → shorter interval (speak more often).
 * Low effective rate → longer interval (speak less often).
 */
export function getRecommendedSpeakInterval(state: DecisionFeedbackState): number {
  const rate = getEffectiveRate(state)
  // Linear interpolation: rate 1.0 → MIN, rate 0.0 → MAX
  return Math.round(MAX_SPEAK_INTERVAL_TICKS - rate * (MAX_SPEAK_INTERVAL_TICKS - MIN_SPEAK_INTERVAL_TICKS))
}
