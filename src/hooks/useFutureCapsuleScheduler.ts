import { useEffect, useRef } from 'react'
import {
  findDueCapsule,
  markDelivered,
} from '../features/futureCapsule/futureCapsuleStore'
import { buildFutureCapsuleDelivery } from '../features/futureCapsule/futureCapsuleDelivery'
import type { AppSettings } from '../types'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 min — same cadence as bracket / errand

interface UseFutureCapsuleSchedulerOptions {
  settings: AppSettings
}

/**
 * Future-self capsule scheduler.
 *
 * Polls every 5 minutes. When a pending capsule's `scheduledFor` date
 * has arrived (or passed — late-running app catches up), the scheduler
 * fires an OS notification carrying the past-self message in the
 * companion's voice and marks the capsule delivered.
 *
 * One delivery per tick, so a queue of overdue capsules drips out one
 * day at a time rather than dumping on the user. Manual approval
 * contract is enforced upstream: the runner only delivers entries the
 * user explicitly created.
 */
export function useFutureCapsuleScheduler({ settings }: UseFutureCapsuleSchedulerOptions) {
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
      const due = findDueCapsule()
      if (!due) return

      const { settings: s } = liveRef.current
      const delivery = buildFutureCapsuleDelivery({
        uiLanguage: s.uiLanguage,
        companionName: s.companionName,
        capsule: due,
      })

      try {
        await window.desktopPet?.showProactiveNotification?.(delivery)
        if (stopped) return
        markDelivered(due.id)
      } catch (err) {
        console.warn('[future-capsule] delivery failed:', err)
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
