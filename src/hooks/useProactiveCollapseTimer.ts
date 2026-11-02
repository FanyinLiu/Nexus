import { useEffect, useRef } from 'react'
import {
  createProactiveCollapseScheduler,
  type ProactiveCollapseScheduler,
} from '../features/proactive/proactiveCollapse.ts'

/**
 * Host wiring for the proactive-bubble collapse scheduler. The timing policy
 * lives in `createProactiveCollapseScheduler`; this hook only owns the timer
 * instance and its effect lifecycle so the v2 caption and the legacy pet view
 * share one implementation.
 */
export type UseProactiveCollapseTimerOptions = {
  /** True while a proactive bubble is on screen. */
  active: boolean
  /** True while pointer contact (or focus) holds the bubble open. */
  paused: boolean
  /** Bubble identity; a change re-arms a fresh countdown. */
  identity?: string
  /** Fires once when the countdown for the current identity ends. */
  onCollapse: () => void
}

/**
 * @param options Bubble activity, hold state, identity, and collapse handler.
 */
export function useProactiveCollapseTimer({
  active,
  paused,
  identity = '',
  onCollapse,
}: UseProactiveCollapseTimerOptions): void {
  const schedulerRef = useRef<ProactiveCollapseScheduler | null>(null)
  const pausedRef = useRef(paused)
  const onCollapseRef = useRef(onCollapse)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    onCollapseRef.current = onCollapse
  }, [onCollapse])

  useEffect(() => {
    if (!active) return undefined
    const scheduler = createProactiveCollapseScheduler(
      {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (id) => window.clearTimeout(id),
      },
      () => onCollapseRef.current(),
    )
    schedulerRef.current = scheduler
    scheduler.start(pausedRef.current)
    return () => {
      scheduler.cancel()
      if (schedulerRef.current === scheduler) schedulerRef.current = null
    }
  }, [active, identity])

  useEffect(() => {
    schedulerRef.current?.setHovered(paused)
  }, [paused])
}
