// Persisted state for the AI-disclosure compliance layer.
//
// Roadmap: docs/ROADMAP.md → Tier 1.1 chunk E. CA SB 243 + NY
// companion-AI laws + EU AI Act all require both an initial,
// "clear and conspicuous" disclosure and periodic reminders during
// extended use sessions.
//
// We treat all users as minor-protection-applies for simplicity (no
// age verification): the periodic reminder fires every 3 hours of
// wall-clock time AND every 30 user messages — both conditions must
// hold. This avoids over-firing inside short bursts of dialogue and
// also avoids letting a user idle past the 3h threshold without
// triggering.

import { readJson, writeJson } from '../../lib/storage/core.ts'

const STORAGE_KEY = 'nexus:safety:disclosure'

const REMINDER_MIN_HOURS = 3
const REMINDER_MIN_MESSAGES = 30
const HOUR_MS = 60 * 60 * 1000

interface DisclosureState {
  /** ISO timestamp when the user first acknowledged the onboarding disclosure. */
  acknowledgedAt: string | null
  /** ISO timestamp of the most recent in-chat periodic reminder. */
  lastReminderAt: string | null
  /** User-message counter since the last reminder (or since ack). Reset on fire. */
  userMessagesSinceReminder: number
}

const DEFAULT_STATE: DisclosureState = {
  acknowledgedAt: null,
  lastReminderAt: null,
  userMessagesSinceReminder: 0,
}

function loadState(): DisclosureState {
  return readJson<DisclosureState>(STORAGE_KEY, DEFAULT_STATE)
}

function saveState(state: DisclosureState): void {
  writeJson(STORAGE_KEY, state)
}

/**
 * Record that the user acknowledged the onboarding disclosure step.
 * Idempotent — re-acking does not reset the timestamp (we keep the
 * earliest, which is the legally relevant one).
 */
export function recordDisclosureAck(now: Date = new Date()): void {
  const state = loadState()
  if (state.acknowledgedAt) return
  saveState({ ...state, acknowledgedAt: now.toISOString() })
}

/**
 * True if the user has ever clicked through the onboarding disclosure
 * step. Used to decide whether the in-chat periodic reminder should
 * even start counting.
 */
export function hasAcknowledgedDisclosure(): boolean {
  return loadState().acknowledgedAt !== null
}

/**
 * Note that another user message just landed. Returns true when the
 * caller should append a periodic in-chat AI-disclosure reminder
 * after this message. Side-effects on true: counter resets,
 * lastReminderAt updates. Side-effects on false: counter increments.
 *
 * Always returns false until the user has acknowledged the onboarding
 * disclosure — the in-chat reminder is the *follow-up* layer, not a
 * substitute for the initial consent.
 */
export function noteUserMessageAndCheckReminder(now: Date = new Date()): boolean {
  const state = loadState()
  if (!state.acknowledgedAt) return false

  const nextCount = state.userMessagesSinceReminder + 1

  // Anchor the time check off the more-recent of (acknowledged, lastReminder)
  // so the very first reminder fires 3h after the first ack, not 3h after
  // some null timestamp.
  const lastFiredAtIso = state.lastReminderAt ?? state.acknowledgedAt
  const lastFiredAtMs = Date.parse(lastFiredAtIso)
  const elapsedMs = now.getTime() - lastFiredAtMs
  const meetsTime = elapsedMs >= REMINDER_MIN_HOURS * HOUR_MS
  const meetsCount = nextCount >= REMINDER_MIN_MESSAGES

  if (meetsTime && meetsCount) {
    saveState({
      ...state,
      lastReminderAt: now.toISOString(),
      userMessagesSinceReminder: 0,
    })
    return true
  }

  saveState({ ...state, userMessagesSinceReminder: nextCount })
  return false
}

/**
 * Reset everything. Used by the onboarding-redo flow as the hidden
 * escape hatch for self-tune misconfiguration (Tier 2.1) — and
 * incidentally clears disclosure state so the user re-consents on
 * the next onboarding completion.
 */
export function resetDisclosureState(): void {
  saveState(DEFAULT_STATE)
}

// ── Test-only helpers ─────────────────────────────────────────────
// Exported with the `__test_` prefix so production callers don't
// accidentally bind to internal state. Used by the unit suite to
// drive the counter directly without 30 round-trips through
// noteUserMessageAndCheckReminder.

export function __test_setState(state: Partial<DisclosureState>): void {
  saveState({ ...loadState(), ...state })
}

export function __test_getState(): DisclosureState {
  return loadState()
}

export function __test_clear(): void {
  saveState(DEFAULT_STATE)
}
