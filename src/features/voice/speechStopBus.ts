// Renderer-local notification for a user-initiated "stop everything" action.
// Speech state lives in the voice hook while the busy-deferred companion
// notice queue lives in the chat hook, so Stop crosses that boundary through
// this small synchronous bus instead of a hook-ordering dependency.

type SpeechStopListener = () => void

const listeners = new Set<SpeechStopListener>()

/** Subscribe to user-initiated stop-all; returns the unsubscribe handle. */
export function subscribeSpeechStopAll(listener: SpeechStopListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Notify listeners that the user stopped all speech playback. */
export function emitSpeechStopAll(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      /* silent-catch-ok: a listener owns its own queue and must not block the stop */
    }
  }
}
