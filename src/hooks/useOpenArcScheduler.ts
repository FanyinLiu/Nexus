import { autoDropExpiredArcs, loadOpenArcs, recordCheckInFired } from '../features/arc/openArcStore.ts'
import { decideNextCheckIn } from '../features/arc/openArcPolicy.ts'
import { buildArcCheckIn } from '../features/arc/openArcDelivery.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { usePollingScheduler } from './usePollingScheduler.ts'
import type { AppSettings } from '../types'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 min — matches bracket / errand / capsule

interface UseOpenArcSchedulerOptions {
  settings: AppSettings
  enabled?: boolean
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
export function useOpenArcScheduler({ settings, enabled = true }: UseOpenArcSchedulerOptions) {
  usePollingScheduler({
    enabled,
    intervalMs: POLL_INTERVAL_MS,
    requireNotificationBridge: true,
    live: { settings },
    tick: async ({ settings: s }, isStopped) => {
      autoDropExpiredArcs()
      const arcs = loadOpenArcs()
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
        if (isStopped()) return
        recordCheckInFired(arc.id)
      } catch (err) {
        console.warn('[open-arc] check-in delivery failed:', getRedactedLogErrorMessage(err))
      }
    },
  })
}
