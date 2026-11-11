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

type IdleFlushOptions = {
  /**
   * A session that still reports continuous voice while the assistant is
   * otherwise idle is treated as ended after this long without a voice event.
   */
  stuckTimeoutMs?: number
  /** Force-release predicate: idle voice state, ignoring a stuck flag. */
  canForceRelease?: () => boolean
  /** Force flush used only by the stuck-session fallback. */
  forceFlush?: () => Promise<void>
  /** Called when the stuck fallback accepts a stale session as ended. */
  onStuckFallback?: () => void
  /** False after a successful release lets us clear every timer. */
  hasPending?: () => boolean
}

/** No voice event for this long means a stuck continuous flag is stale. */
export const COMPANION_NOTICE_STUCK_SESSION_MS = 30_000

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
 *
 * The 15 s fallback keeps re-arming while the session is active and releases
 * on its first tick after the session flag clears. A separate 30 s stuck timer
 * only fires when the voice state is idle and a stale continuous flag has seen
 * no voice event for the whole window; any voice event resets it.
 */
export function useCompanionNoticeIdleFlush(
  voiceBus: VoiceBus | undefined,
  flush: () => Promise<void>,
  timers: IdleFlushTimers = {},
  canRelease: () => boolean = () => true,
  options: IdleFlushOptions = {},
): void {
  const idleTimeoutMs = timers.idleTimeoutMs ?? COMPANION_NOTICE_IDLE_FALLBACK_MS
  const stuckTimeoutMs = options.stuckTimeoutMs ?? COMPANION_NOTICE_STUCK_SESSION_MS
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
  const canForceReleaseRef = useRef(options.canForceRelease ?? (() => false))
  useEffect(() => {
    canForceReleaseRef.current = options.canForceRelease ?? (() => false)
  })
  const forceFlushRef = useRef(options.forceFlush ?? flush)
  useEffect(() => {
    forceFlushRef.current = options.forceFlush ?? flush
  })
  const onStuckFallbackRef = useRef(options.onStuckFallback)
  useEffect(() => {
    onStuckFallbackRef.current = options.onStuckFallback
  })
  const hasPendingRef = useRef(options.hasPending)
  useEffect(() => {
    hasPendingRef.current = options.hasPending
  })

  useEffect(() => {
    if (!voiceBus) return

    const schedule = setTimeoutFn ?? ((callback: () => void, delayMs: number) => (
      window.setTimeout(callback, delayMs)
    ))
    const cancel = clearTimeoutFn ?? ((id: number) => { window.clearTimeout(id) })
    let fallbackTimer: number | null = null
    let stuckTimer: number | null = null
    let disposed = false

    const clearFallback = () => {
      if (fallbackTimer === null) return
      cancel(fallbackTimer)
      fallbackTimer = null
    }
    const clearStuck = () => {
      if (stuckTimer === null) return
      cancel(stuckTimer)
      stuckTimer = null
    }
    const clearAllTimers = () => {
      clearFallback()
      clearStuck()
    }
    const hasPending = () => hasPendingRef.current?.() ?? true

    const afterRelease = () => {
      if (disposed) return
      if (!hasPending()) {
        // A completed release leaves no timer behind, so a late event cannot
        // trigger a second flush for the same batch.
        clearAllTimers()
        return
      }
      armFallback()
      armStuck()
    }

    const runFlush = (force: boolean) => {
      const pendingFlush = force ? forceFlushRef.current : flushRef.current
      const pending = pendingFlush()
      // Clear the owning window's stale flag only after the force flush has
      // started (it still needs the own flag to pass its force guard). The
      // synced runtime state then tells the panel to release on its next tick.
      if (force) onStuckFallbackRef.current?.()
      void pending.finally(afterRelease)
    }

    const armFallback = () => {
      if (disposed) return
      clearFallback()
      fallbackTimer = schedule(() => {
        fallbackTimer = null
        if (disposed) return
        // Keep retrying while listening/continuous voice is still active; the
        // session end or listening stop will otherwise arrive as a later event.
        if (!canReleaseRef.current()) {
          armFallback()
          return
        }
        runFlush(false)
      }, idleTimeoutMs)
    }
    const armStuck = () => {
      if (disposed || stuckTimeoutMs <= 0) return
      clearStuck()
      stuckTimer = schedule(() => {
        stuckTimer = null
        if (disposed) return
        if (canReleaseRef.current()) {
          runFlush(false)
          return
        }
        // Only a truly idle voice state with queued work may override a stale
        // continuous flag. An empty queue must never clear the voice session.
        if (!canForceReleaseRef.current() || !hasPending()) {
          armStuck()
          return
        }
        runFlush(true)
      }, stuckTimeoutMs)
    }
    const releaseNow = () => {
      clearAllTimers()
      queueMicrotask(() => {
        if (disposed) return
        // A completion or error event can belong to a continuous-voice turn.
        // Do not flush into the microphone that is about to reopen; wait until
        // the merged continuous flag actually clears. The 30 s stuck timer is
        // the only path allowed to override a stale flag.
        if (!canReleaseRef.current()) {
          armFallback()
          armStuck()
          return
        }
        runFlush(false)
      })
    }

    const unsubscribe = voiceBus.onAny((event) => {
      // Any voice event proves the session is not stuck; restart the window.
      armStuck()
      // The pet voice button ends the turn without a new reply; wait for the
      // fallback window so an interrupted reminder cannot replay immediately.
      if (event.type === 'session:aborted' && event.abortReason === 'user-button') {
        armFallback()
        return
      }
      if (
        event.type === 'vad:no_speech_timeout'
        || event.type === 'stt:error'
        || event.type === 'mic:error'
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

    // Stop-all clears the queue in the chat hook; drop the release timers in
    // the same tick so nothing can flush a stale batch later.
    const unsubscribeStopAll = subscribeSpeechStopAll(clearAllTimers)

    armFallback()
    armStuck()
    return () => {
      disposed = true
      clearAllTimers()
      unsubscribe()
      unsubscribeStopAll()
    }
  }, [voiceBus, idleTimeoutMs, setTimeoutFn, clearTimeoutFn, stuckTimeoutMs])
}
