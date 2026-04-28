import { useEffect, useRef } from 'react'
import { autoDropExpiredArcs, loadOpenArcs, recordCheckInFired } from '../features/arc/openArcStore'
import { decideNextCheckIn } from '../features/arc/openArcPolicy'
import { buildArcCheckIn } from '../features/arc/openArcDelivery'
import type { AppSettings } from '../types'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 min — matches bracket / errand / capsule

interface UseOpenArcSchedulerOptions {
  settings: AppSettings
}

/**
 * Open-arc thread scheduler.
 *
 * Every 5 minutes:
 *   1. Sweep for expired arcs (>7 days open) and auto-drop them.
 *   2. Ask the policy whether any arc has a due check-in milestone right
 *      now and is outside quiet hours. Fire one OS notification per
 *      tick and record it.
 *
 * Manual contract: the runner only follows arcs the user explicitly
 * opened. Same shape as errand and capsule schedulers.
 */
export function useOpenArcScheduler({ settings }: UseOpenArcSchedulerOptions) {
  const liveRef = useRef({ settings })
  useEffect(() => {
    liveRef.current = { settings }
  }, [settings])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.desktopPet?.showProactiveNotification) return

    let stopped = false

    const tick = async () => {
      if (stopped) return
      autoDropExpiredArcs()
      const arcs = loadOpenArcs()
      const { settings: s } = liveRef.current
      const decision = decideNextCheckIn(arcs, new Date(), {
        quietHoursStart: s.autonomyQuietHoursStart,
        quietHoursEnd: s.autonomyQuietHoursEnd,
      })
      if (!decision.shouldFire || !decision.arcId || decision.milestoneDay == null) return

      const arc = arcs.find((a) => a.id === decision.arcId)
      if (!arc) return

      const payload = buildArcCheckIn({
        arc,
        uiLanguage: s.uiLanguage,
        companionName: s.companionName,
        milestoneDay: decision.milestoneDay,
      })

      try {
        await window.desktopPet?.showProactiveNotification?.(payload)
        if (stopped) return
        recordCheckInFired(arc.id)
      } catch (err) {
        console.warn('[open-arc] check-in delivery failed:', err)
      }
    }

    void tick()
    const id = window.setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)

    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [])
}
