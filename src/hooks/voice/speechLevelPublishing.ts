import { useSyncExternalStore } from 'react'
import { clamp } from '../../lib/common.ts'
import type { SpeechLevelSource } from '../../types/voice.ts'

export const SPEECH_LEVEL_REACT_INTERVAL_MS = 50
export const SPEECH_LEVEL_QUANTIZATION_STEP = 0.05

export type SpeechLevelPublisher = {
  source: SpeechLevelSource
  publish: (level: number, now?: number) => void
  reset: (now?: number) => void
  dispose: () => void
}

function quantizeSpeechLevel(level: number) {
  const quantized = Math.round(level / SPEECH_LEVEL_QUANTIZATION_STEP) * SPEECH_LEVEL_QUANTIZATION_STEP
  return Number(Math.max(0, Math.min(1, quantized)).toFixed(2))
}

/**
 * Creates the private speech-level channel owned by one useVoice instance.
 *
 * Normal frame publications are rate limited as one stream, including
 * ordinary zero crossings. `reset` is the explicit stop/error boundary and
 * may publish zero immediately; repeated zero resets remain deduplicated.
 */
export function createSpeechLevelPublisher(options?: {
  now?: () => number
}): SpeechLevelPublisher {
  let raw = 0
  let snapshot = 0
  let lastNotifiedAt = Number.NEGATIVE_INFINITY
  let allowImmediateNonZero = true
  let disposed = false
  const listeners = new Set<() => void>()
  const now = options?.now ?? (() => performance.now())

  const source: SpeechLevelSource = {
    get current() {
      return raw
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        listeners.delete(listener)
      }
    },
  }

  const notify = (at: number) => {
    lastNotifiedAt = at
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A broken visual subscriber must not stop the audio sampling loop or
        // prevent healthy leaves from receiving the same snapshot.
        console.error('[Voice] Speech-level subscriber failed')
      }
    }
  }

  const publish = (level: number, suppliedNow?: number) => {
    if (disposed) return
    raw = Number.isFinite(level) ? clamp(level, 0, 1) : 0
    const nextSnapshot = quantizeSpeechLevel(raw)
    if (nextSnapshot === snapshot) return

    const at = suppliedNow ?? now()
    const firstNonZero = snapshot === 0 && nextSnapshot > 0 && allowImmediateNonZero
    const intervalElapsed = at - lastNotifiedAt >= SPEECH_LEVEL_REACT_INTERVAL_MS
    if (!firstNonZero && !intervalElapsed) return

    // External-store listeners must observe the new snapshot synchronously.
    snapshot = nextSnapshot
    allowImmediateNonZero = false
    notify(at)
  }

  const reset = (suppliedNow?: number) => {
    if (disposed) return
    raw = 0
    if (snapshot === 0) {
      allowImmediateNonZero = true
      return
    }
    snapshot = 0
    allowImmediateNonZero = true
    notify(suppliedNow ?? now())
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    raw = 0
    snapshot = 0
    listeners.clear()
  }

  return { source, publish, reset, dispose }
}

/** Subscribe a visual leaf to the throttled snapshot, never the raw stream. */
export function useSpeechLevelSnapshot(source: SpeechLevelSource) {
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
}
