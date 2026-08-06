import {
  findDueCapsule,
  markDelivered,
} from '../features/futureCapsule/futureCapsuleStore.ts'
import { buildFutureCapsuleDelivery } from '../features/futureCapsule/futureCapsuleDelivery.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { usePollingScheduler } from './usePollingScheduler.ts'
import type { AppSettings } from '../types'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 min — same cadence as bracket / errand

interface UseFutureCapsuleSchedulerOptions {
  settings: AppSettings
  enabled?: boolean
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
export function useFutureCapsuleScheduler({ settings, enabled = true }: UseFutureCapsuleSchedulerOptions) {
  usePollingScheduler({
    enabled,
    intervalMs: POLL_INTERVAL_MS,
    requireNotificationBridge: true,
    live: { settings },
    tick: async ({ settings: s }, isStopped) => {
      const due = findDueCapsule()
      if (!due) return

      const delivery = buildFutureCapsuleDelivery({
        uiLanguage: s.uiLanguage,
        companionName: s.companionName,
        capsule: due,
      })

      try {
        await window.desktopPet?.showProactiveNotification?.(delivery)
        if (isStopped()) return
        markDelivered(due.id)
      } catch (err) {
        console.warn('[future-capsule] delivery failed:', getRedactedLogErrorMessage(err))
      }
    },
  })
}
