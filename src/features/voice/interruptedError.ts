// A barge-in or Stop is a clean cancellation, not a playback failure.
// Controllers reject their completion promise with this typed error so callers
// can tell "the user chose to stop" apart from a provider/audio fault without
// inspecting prose. The reason also tells a companion notice whether it may
// requeue itself: an interrupt requeues once, Stop never requeues.
export type SpeechInterruptReason = 'interrupt' | 'stop-all'

export class InterruptedError extends Error {
  readonly reason: SpeechInterruptReason

  constructor(
    reason: SpeechInterruptReason = 'interrupt',
    message = 'Speech playback was interrupted by the user.',
  ) {
    super(message)
    this.name = 'InterruptedError'
    this.reason = reason
  }
}

/** True for the typed cancellation rejection, including across bundle boundaries. */
export function isInterruptedError(error: unknown): error is InterruptedError {
  if (error instanceof InterruptedError) return true
  return typeof error === 'object'
    && error !== null
    && (error as { name?: unknown }).name === 'InterruptedError'
}

/**
 * True only for the Stop button's cancellation. A notice that was cleared by
 * Stop must never be requeued, even though it is also an InterruptedError.
 */
export function isStopAllInterrupted(error: unknown): boolean {
  return isInterruptedError(error)
    && (error as { reason?: unknown }).reason === 'stop-all'
}
