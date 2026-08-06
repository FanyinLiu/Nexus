import { useEffect, useRef } from 'react'

type PollingTick<TLive> = (live: TLive, isStopped: () => boolean) => void | Promise<void>

type UsePollingSchedulerOptions<TLive> = {
  /** Master gate: no immediate tick and no interval while false. */
  enabled: boolean
  /**
   * Poll cadence. Omit for a pass that runs once per enable (the weekly
   * guidance self-summarisation).
   */
  intervalMs?: number
  /**
   * When true, the scheduler only starts while the proactive-notification
   * bridge is installed. Checked once per effect run, like the inline
   * checks the callers had before — bridge (dis)appearance alone does
   * not restart the timer.
   */
  requireNotificationBridge?: boolean
  /**
   * Values mirrored into a ref every render and handed to each tick, so
   * the timer never needs rebuilding when settings/messages change.
   */
  live: TLive
  tick: PollingTick<TLive>
}

/**
 * Shared host wiring for the polling background schedulers (bracket,
 * errand, future-capsule, open-arc, away-notification) and the
 * once-per-launch guidance analysis pass.
 *
 * Owns the skeleton each of them repeated: the `enabled` / SSR gate,
 * the optional notification-bridge check, the live-ref mirror, one
 * immediate tick followed by `setInterval`, and cleanup that stops late
 * ticks and clears the interval. All decision logic stays in the
 * features/* pure modules; this hook is only the timer host.
 */
export function usePollingScheduler<TLive>({
  enabled,
  intervalMs,
  requireNotificationBridge = false,
  live,
  tick,
}: UsePollingSchedulerOptions<TLive>) {
  const liveRef = useRef(live)
  useEffect(() => {
    liveRef.current = live
  }, [live])

  // Latest-tick ref: the interval effect must not re-run (and re-fire the
  // immediate tick) just because the caller rebuilt its tick closure.
  const tickRef = useRef(tick)
  useEffect(() => {
    tickRef.current = tick
  }, [tick])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    if (requireNotificationBridge && !window.desktopPet?.showProactiveNotification) return

    let stopped = false
    const isStopped = () => stopped
    const runTick = () => {
      if (stopped) return
      void tickRef.current(liveRef.current, isStopped)
    }

    runTick()
    if (intervalMs === undefined) return
    const id = window.setInterval(runTick, intervalMs)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [enabled, intervalMs, requireNotificationBridge])
}
