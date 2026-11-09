import { useEffect } from 'react'
import type { VoiceBus } from '../../features/voice/bus.ts'
import { subscribeSpeechStopAll } from '../../features/voice/speechStopBus.ts'

/** Fallback window when no speech/listening event arrives to settle the queue. */
export const COMPANION_NOTICE_IDLE_FALLBACK_MS = 15_000

type IdleFlushTimers = {
  idleTimeoutMs?: number
  setTimeoutFn?: (callback: () => void, delayMs: number) => number
  clearTimeoutFn?: (id: number) => void
}

/**
 * The Stop button lives in the voice hook while the busy-deferred notice queue
 * lives in the chat hook. This subscription is the renderer-local bridge that
 * clears the queue when the user really stopped everything.
 */
export function useCompanionNoticeStopSubscription(discard: () => number): void {
  useEffect(() => subscribeSpeechStopAll(() => { discard() }), [discard])
}

/**
 * Resume the queue once the interrupted turn has ended and the pet is idle.
 *
 * A completed turn, a speech error, or the end of a listening session all
 * release the queue. A barge-in alone does not: it may be followed by a new
 * reply, so it only arms the fallback timer. The 15 s fallback also releases
 * the queue when no further voice event arrives. The bus transition runs
 * before useVoice syncs its ref, so each release is one microtask late and
 * `flush` re-checks its own busy/speaking guard.
 */
export function useCompanionNoticeIdleFlush(
  voiceBus: VoiceBus | undefined,
  flush: () => Promise<void>,
  timers: IdleFlushTimers = {},
): void {
  const idleTimeoutMs = timers.idleTimeoutMs ?? COMPANION_NOTICE_IDLE_FALLBACK_MS
  const setTimeoutFn = timers.setTimeoutFn
  const clearTimeoutFn = timers.clearTimeoutFn

  useEffect(() => {
    if (!voiceBus) return

    const schedule = setTimeoutFn ?? ((callback: () => void, delayMs: number) => (
      window.setTimeout(callback, delayMs)
    ))
    const cancel = clearTimeoutFn ?? ((id: number) => { window.clearTimeout(id) })
    let timer: number | null = null

    const clearTimer = () => {
      if (timer === null) return
      cancel(timer)
      timer = null
    }
    const armFallback = () => {
      clearTimer()
      timer = schedule(() => {
        timer = null
        void flush()
      }, idleTimeoutMs)
    }
    const releaseNow = () => {
      clearTimer()
      queueMicrotask(() => {
        void flush().finally(armFallback)
      })
    }

    const unsubscribe = voiceBus.onAny((event) => {
      // The pet voice button ends the turn without a new reply; wait for the
      // fallback window so an interrupted reminder cannot replay immediately.
      if (event.type === 'session:aborted' && event.abortReason === 'user-button') {
        armFallback()
        return
      }
      if (
        event.type === 'tts:completed'
        || event.type === 'session:completed'
        || event.type === 'tts:error'
        || event.type === 'session:aborted'
      ) {
        releaseNow()
        return
      }
      armFallback()
    })

    armFallback()
    return () => {
      clearTimer()
      unsubscribe()
    }
  }, [voiceBus, flush, idleTimeoutMs, setTimeoutFn, clearTimeoutFn])
}
