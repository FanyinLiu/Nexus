export const TYPING_STUCK_KEY_MS: 8000
export const TYPING_IDLE_STOP_MS: 450
export const TYPING_RATE_WINDOW_MS: 1000

export type TypingSignalPhase = 'start' | 'update' | 'stop' | 'idle'

export type PublicTypingSignal = {
  phase: TypingSignalPhase
  keysPerSecond: number
}

export function toPublicTypingSignal(snapshot: {
  phase?: string
  keysPerSecond?: number
}): PublicTypingSignal

export type TypingActivityMachine = {
  keyDown: (token: unknown, now: number) => PublicTypingSignal
  keyUp: (token: unknown, now: number) => PublicTypingSignal
  tick: (now: number) => PublicTypingSignal
  reset: (now: number) => PublicTypingSignal
  pressedCount: () => number
}

export function createTypingActivityMachine(options?: {
  stuckKeyMs?: number
  idleStopMs?: number
  rateWindowMs?: number
}): TypingActivityMachine
