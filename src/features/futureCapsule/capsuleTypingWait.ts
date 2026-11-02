/**
 * Bounded typing-pause gate for future-self capsule delivery.
 *
 * A capsule the user scheduled for today still waits while they are actively
 * typing, so the past-self message does not land mid-sentence. The gate reads
 * only the aggregate typing / not-typing boolean the existing opt-in typing
 * awareness switch publishes: no key identity, key code or rate enters this
 * module, and nothing here is logged.
 *
 * The decision is pure: the caller injects the clock, the sleep and the two
 * signal readers, so tests drive fake time without touching real timers, the
 * presence bridge or the composer state.
 */

import { readTypingStatus } from '../desktopPresence/typingPresence.ts'

export const CAPSULE_TYPING_MAX_WAIT_MS = 5 * 60_000
const CAPSULE_TYPING_POLL_MS = 1_000

export type CapsuleTypingWaitReason =
  | 'signal_off'
  | 'denied'
  | 'not_typing'
  | 'typing_stopped'
  | 'max_wait'
  | 'stopped'

export interface CapsuleTypingWaitResult {
  /** True only when the caller actually paused before delivering. */
  waited: boolean
  reason: CapsuleTypingWaitReason
}

export interface CapsuleTypingWaitInput {
  /** True only when the user opted into typing awareness. */
  enabled: boolean
  /**
   * Raw `getDesktopTypingStatus()` result. Never called when `enabled` is
   * false; a missing, throwing or garbled payload counts as "no permission".
   */
  readPermission: () => unknown | Promise<unknown>
  /** Aggregate typing boolean. Never called without an allowed permission. */
  isTyping: () => boolean
  sleep: (ms: number) => Promise<void>
  now: () => number
  isStopped: () => boolean
  maxWaitMs?: number
  pollMs?: number
}

/**
 * Wait for the user's typing to pause, up to the capsule wait budget.
 *
 * The result carries nothing but the decision: no timing snapshot, no signal
 * value and no permission string ever leaves this helper, so a caller cannot
 * leak typing state into a log or a persisted record later.
 */
export async function waitForCapsuleTypingPause({
  enabled,
  readPermission,
  isTyping,
  sleep,
  now,
  isStopped,
  maxWaitMs = CAPSULE_TYPING_MAX_WAIT_MS,
  pollMs = CAPSULE_TYPING_POLL_MS,
}: CapsuleTypingWaitInput): Promise<CapsuleTypingWaitResult> {
  if (!enabled) return { waited: false, reason: 'signal_off' }
  if (!(await hasTypingPermission(readPermission))) {
    return { waited: false, reason: 'denied' }
  }
  if (isStopped()) return { waited: false, reason: 'stopped' }
  if (!isTyping()) return { waited: false, reason: 'not_typing' }

  const startedAt = now()
  for (;;) {
    if (isStopped()) return { waited: true, reason: 'stopped' }
    const elapsed = now() - startedAt
    if (elapsed >= maxWaitMs) return { waited: true, reason: 'max_wait' }
    // Never sleep past the budget, so a poll size that does not divide it
    // still delivers at (not after) the five-minute mark.
    await sleep(Math.min(pollMs, maxWaitMs - elapsed))
    if (isStopped()) return { waited: true, reason: 'stopped' }
    if (!isTyping()) return { waited: true, reason: 'typing_stopped' }
  }
}

/**
 * Map the bridge status to the only two permissions that justify a wait.
 * A denied, unavailable, missing or garbled status is never retried here.
 */
async function hasTypingPermission(
  readPermission: () => unknown | Promise<unknown>,
): Promise<boolean> {
  try {
    const permission = readTypingStatus(await readPermission()).permission
    return permission === 'granted' || permission === 'not-applicable'
  } catch {
    return false
  }
}
