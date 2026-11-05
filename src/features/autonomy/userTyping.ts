/**
 * Recent composer keystrokes and the opt-in desktop typing quiet. Proactive
 * delivery reads this so a bubble does not land while the user is still
 * typing. The send path does not consult it: submitting a message is the
 * moment a next-turn note may attach.
 *
 * `noteDesktopTyping` receives only the aggregate start/stop signal the
 * desktop-presence bridge already publishes when the opt-in typing-awareness
 * switch is on. No key identity is ever accepted or stored here.
 *
 * A natural stop keeps quiet for `TYPING_QUIET_RESUME_MS` after the last
 * activity. `clearDesktopTyping` is the fail-closed path: switching the
 * setting off, a stopped hook, or a denied/unavailable status clears the hold
 * immediately instead of letting it expire on its own.
 */

import { TYPING_QUIET_RESUME_MS } from '../../../shared/typingActivity.js'

const TYPING_WINDOW_MS = 2_500
let lastTypingAt = 0
let desktopTypingUntil = 0
let desktopTypingActive = false

export function noteUserTyping(now = Date.now()): void {
  lastTypingAt = now
}

export function isUserTyping(now = Date.now(), windowMs = TYPING_WINDOW_MS): boolean {
  return lastTypingAt > 0 && now - lastTypingAt < windowMs
}

/**
 * Mirror the existing opt-in typing signal.
 *
 * The start edge and the first stop edge each refresh the deadline, so the
 * full grace runs from when typing actually ended. Repeated stop signals do
 * nothing: without that guard a caller polling the same "not typing" state
 * would keep extending quiet forever.
 */
export function noteDesktopTyping(active: boolean, now = Date.now()): void {
  if (active === true) {
    desktopTypingActive = true
    desktopTypingUntil = now + TYPING_QUIET_RESUME_MS
    return
  }
  if (desktopTypingActive) {
    desktopTypingActive = false
    desktopTypingUntil = now + TYPING_QUIET_RESUME_MS
  }
}

/** Fail-closed clear for setting off, hook stop, or a non-running status. */
export function clearDesktopTyping(): void {
  desktopTypingActive = false
  desktopTypingUntil = 0
}

export function isDesktopTyping(now = Date.now()): boolean {
  return desktopTypingUntil > now
}

/** Composer typing, plus the desktop signal only when its setting is on. */
export function isUserTypingAnywhere(
  settings: { typingAwarenessEnabled?: boolean } | null | undefined,
  now = Date.now(),
): boolean {
  if (isUserTyping(now)) return true
  return settings?.typingAwarenessEnabled === true && isDesktopTyping(now)
}
