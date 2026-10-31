/**
 * Speculative full-utterance decode for SenseVoice.
 *
 * SenseVoice has no streaming partial, so a turn used to wait for the silence
 * decision and only then decode the whole buffer. When Smart Turn is already
 * confident the user has finished, the same decode can run during the short
 * remaining silence. A resumed utterance invalidates the result; a confirmed
 * turn with an unchanged speech epoch reuses it instead of decoding twice.
 *
 * Pure: the caller owns audio snapshots, timers, and the recognizer.
 */

import { createLogger } from '../../lib/logger.ts'

const log = createLogger('voice.asr')

/** Probability at or above which a pause is worth a speculative decode. */
export const SPECULATIVE_DECODE_MIN_PROBABILITY = 0.7

export type SpeculativeDecodeSignal = {
  /** Smart Turn p(complete), or null while it is unavailable/loading. */
  probability: number | null | undefined
  /** Uninterrupted silence in the paused turn. */
  silenceMs: number
}

/** True only for a confident, already-started pause. */
export function shouldStartSpeculativeDecode(signal: SpeculativeDecodeSignal): boolean {
  if (typeof signal.probability !== 'number' || !Number.isFinite(signal.probability)) {
    return false
  }
  if (signal.probability < SPECULATIVE_DECODE_MIN_PROBABILITY) return false
  return Number.isFinite(signal.silenceMs) && signal.silenceMs > 0
}

export type SpeculativeDecoder<T> = {
  /**
   * Start one decode for this speech epoch. Returns false when a decode is
   * already pending or a result is already cached for the same epoch.
   */
  maybeStart: (epoch: number, decode: () => Promise<T | null>) => boolean
  /** Discard anything belonging to an earlier epoch (the user resumed). */
  invalidate: (epoch: number) => void
  /** Cached result for this epoch, or null when stale/absent. */
  take: (epoch: number) => T | null
  /** Await an in-flight decode for this epoch, then return its cached result. */
  settle: (epoch: number) => Promise<T | null>
}

/**
 * Create one speculative decoder per user turn. The epoch is an opaque speech
 * counter: the caller bumps it on every speech frame, so a decode started
 * during one pause can never be reused after the user starts talking again.
 */
export function createSpeculativeDecoder<T>(): SpeculativeDecoder<T> {
  let generation = 0
  let result: { epoch: number; value: T } | null = null
  let pending: Promise<T | null> | null = null
  let pendingEpoch: number | null = null
  let attemptedEpoch: number | null = null

  return {
    maybeStart(epoch, decode) {
      if (result?.epoch === epoch) return false
      if (attemptedEpoch === epoch) return false
      if (pending && pendingEpoch === epoch) return false

      const run = ++generation
      attemptedEpoch = epoch
      pendingEpoch = epoch
      pending = decode()
        .then((value) => {
          if (run === generation && value !== null) {
            result = { epoch, value }
          }
          return value
        })
        .catch(() => {
          log.debug('speculative decode failed', { errorPresent: true })
          return null
        })
        .finally(() => {
          if (run === generation) {
            pending = null
            pendingEpoch = null
          }
        })
      return true
    },

    invalidate(epoch) {
      if (result?.epoch !== epoch) result = null
      if (attemptedEpoch !== epoch) attemptedEpoch = null
      if (pendingEpoch !== epoch) {
        // Mark any in-flight decode stale so its late resolution is ignored.
        generation += 1
        pending = null
        pendingEpoch = null
      }
    },

    take(epoch) {
      return result?.epoch === epoch ? result.value : null
    },

    async settle(epoch) {
      if (pending && pendingEpoch === epoch) {
        await pending.catch(() => null) // silent-catch-ok: a pending decode already normalizes failures to null
      }
      return result?.epoch === epoch ? result.value : null
    },
  }
}
