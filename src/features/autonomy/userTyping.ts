/**
 * Recent composer keystrokes. Proactive delivery reads this so a bubble
 * does not land while the user is still typing. The send path does not
 * consult it: submitting a message is the moment a next-turn note may attach.
 */

const TYPING_WINDOW_MS = 2_500
let lastTypingAt = 0

export function noteUserTyping(now = Date.now()): void {
  lastTypingAt = now
}

export function isUserTyping(now = Date.now(), windowMs = TYPING_WINDOW_MS): boolean {
  return lastTypingAt > 0 && now - lastTypingAt < windowMs
}
