// A barge-in is a clean stop, not a playback failure. Controllers reject their
// completion promise with this typed error so callers can tell "the user chose
// to interrupt" apart from a provider/audio fault without inspecting prose.
export class InterruptedError extends Error {
  constructor(message = 'Speech playback was interrupted by the user.') {
    super(message)
    this.name = 'InterruptedError'
  }
}

/** True for the typed barge-in rejection, including across bundle boundaries. */
export function isInterruptedError(error: unknown): error is InterruptedError {
  return error instanceof InterruptedError
    || (typeof error === 'object'
      && error !== null
      && (error as { name?: unknown }).name === 'InterruptedError')
}
