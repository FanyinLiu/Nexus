import { useEffect, useRef } from 'react'
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
 *
 * `canRelease` lets the host hold the queue through an active listening turn
 * or continuous-voice session. Events such as tts:completed and
 * session:completed arrive between continuous turns, so releasing on them
 * would replay a reminder into an open microphone.
 */
export function useCompanionNoticeIdleFlush(
  voiceBus: VoiceBus | undefined,
  flush: () => Promise<void>,
  timers: IdleFlushTimers = {},
  canRelease: () => boolean = () => true,
): void {
  const idleTimeoutMs = timers.idleTimeoutMs ?? COMPANION_NOTICE_IDLE_FALLBACK_MS
  const setTimeoutFn = timers.setTimeoutFn
  const clearTimeoutFn = timers.clearTimeoutFn
  // The host gives flush a new identity on every render. Keep the latest in a
  // ref so the subscription below does not restart (and reset the 15 s timer)
  // on every heartbeat-driven render.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  const canReleaseRef = useRef(canRelease)
  useEffect(() => {
    canReleaseRef.current = canRelease
  })

  useEffect(() => {
    if (!voiceBus) return

    const schedule = setTimeoutFn ?? ((callback: () => void, delayMs: number) => (
      window.setTimeout(callback, delayMs)
    ))
    const cancel = clearTimeoutFn ?? ((id: number) => { window.clearTimeout(id) })
    let timer: number | null = null
    let disposed = false

    const clearTimer = () => {
      if (timer === null) return
      cancel(timer)
      timer = null
    }
    const armFallback = () => {
      if (disposed) return
      clearTimer()
      timer = schedule(() => {
        timer = null
        if (disposed) return
        // Keep retrying while listening/continuous voice is still active; the
        // session end or listening stop will otherwise arrive as a later event.
        if (!canReleaseRef.current()) {
          armFallback()
          return
        }
        void flushRef.current()
      }, idleTimeoutMs)
    }
    const releaseNow = () => {
      clearTimer()
      queueMicrotask(() => {
        if (disposed) return
        // A completion event can belong to a continuous-voice turn. Do not
        // flush into the microphone that is about to reopen; wait for idle.
        if (!canReleaseRef.current()) {
          armFallback()
          return
        }
        void flushRef.current().finally(() => {
          if (!disposed) armFallback()
        })
      })
    }

    const unsubscribe = voiceBus.onAny((event) => {
      // The pet voice button ends the turn without a new reply; wait for the
      // fallback window so an interrupted reminder cannot replay immediately.
      if (event.type === 'session:aborted' && event.abortReason === 'user-button') {
        armFallback()
        return
      }
      const noSpeechEnded = event.type === 'vad:no_speech_timeout'
        || (event.type === 'stt:error' && event.code === 'no-speech')
      if (
        noSpeechEnded
        || event.type === 'tts:completed'
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
      disposed = true
      clearTimer()
      unsubscribe()
    }
  }, [voiceBus, idleTimeoutMs, setTimeoutFn, clearTimeoutFn])
}
