/**
 * Public types for the cross-process typing-quiet delivery gate.
 * Declarations mirror the JSDoc in `typingQuietGate.js`; the logic lives only
 * in the `.js` module. The signal is a boolean and nothing else.
 */

export type TypingQuietGate = {
  whenFree: () => Promise<void>
  dispose: () => void
  pending: () => number
  isTyping: () => boolean
}

export function shouldHoldForTypingQuiet(input: {
  settingEnabled?: boolean
  hookRunning?: boolean
  quietUntil?: number
  now?: number
}): boolean

export function createTypingQuietGate(dependencies?: {
  isTyping?: () => boolean
  subscribe?: (listener: (typing: boolean) => void) => () => void
}): TypingQuietGate
