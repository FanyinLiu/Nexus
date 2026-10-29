/**
 * Recent composer keystrokes. Proactive delivery reads this so a bubble
 * does not land while the user is still typing. The send path does not
 * consult it: submitting a message is the moment a next-turn note may attach.
 *
 * `noteDesktopTyping` receives only the aggregate start/stop signal the
 * desktop-presence bridge already publishes when the opt-in typing-awareness
 * switch is on. No key identity is ever accepted or stored here.
 */

const TYPING_WINDOW_MS = 2_500
let lastTypingAt = 0
let desktopTypingUntil = 0

export function noteUserTyping(now = Date.now()): void {
  lastTypingAt = now
}

export function isUserTyping(now = Date.now(), windowMs = TYPING_WINDOW_MS): boolean {
  return lastTypingAt > 0 && now - lastTypingAt < windowMs
}

/** Mirror the existing opt-in typing signal; false clears it immediately. */
export function noteDesktopTyping(active: boolean, now = Date.now()): void {
  desktopTypingUntil = active ? now + TYPING_WINDOW_MS : 0
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
