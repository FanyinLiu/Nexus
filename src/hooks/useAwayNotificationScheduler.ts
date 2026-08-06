import { decideAwayNotification } from '../features/proactive/awayScheduler.ts'
import { pickAwayNotificationCopy } from '../features/proactive/awayNotificationCopy.ts'
import {
  loadAwayLastFiredMs,
  saveAwayLastFiredMs,
} from '../lib/storage.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import { usePollingScheduler } from './usePollingScheduler.ts'
import type { AppSettings, ChatMessage } from '../types'

const POLL_INTERVAL_MS = 5 * 60_000 // every 5 minutes — coarse enough that startup cost is nil

function findLastUserMessageMs(messages: ChatMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      const t = Date.parse(messages[i].createdAt)
      return Number.isFinite(t) ? t : null
    }
  }
  return null
}

type UseAwayNotificationSchedulerOptions = {
  settings: AppSettings
  messages: ChatMessage[]
  /** Pause scheduling while the panel is open and visible to the user. */
  panelOpen: boolean
  enabled?: boolean
}

/**
 * Polls every 5 min and fires an OS "thinking of you" notification when the
 * user has gone silent past `proactiveAwayNotificationThresholdMinutes` and
 * the cooldown / quiet-hours gates pass. Pauses while the panel window is
 * open (no point notifying someone who's already looking at the companion).
 */
export function useAwayNotificationScheduler({
  settings,
  messages,
  panelOpen,
  enabled = true,
}: UseAwayNotificationSchedulerOptions) {
  // Live values ride the scheduler's ref so the interval handler always
  // sees the latest ones without tearing the timer down on every
  // chat-message change. The immediate tick covers the case where the
  // user re-opens the app after a long absence.
  usePollingScheduler({
    enabled: enabled && settings.proactiveAwayNotificationsEnabled,
    intervalMs: POLL_INTERVAL_MS,
    requireNotificationBridge: true,
    live: { settings, messages, panelOpen },
    tick: async ({ settings: s, messages: msgs, panelOpen: open }) => {
      if (!s.proactiveAwayNotificationsEnabled) return
      if (open) return

      const lastUserActivityMs = findLastUserMessageMs(msgs)
      const lastFiredMs = loadAwayLastFiredMs()
      const decision = decideAwayNotification({
        enabled: true,
        nowMs: Date.now(),
        lastUserActivityMs,
        lastFiredMs,
        thresholdMinutes: s.proactiveAwayNotificationThresholdMinutes,
      })

      if (!decision.shouldFire) return

      const copy = pickAwayNotificationCopy({
        uiLanguage: s.uiLanguage,
        relationshipType: s.companionRelationshipType,
        companionName: s.companionName,
      })

      try {
        await window.desktopPet?.showProactiveNotification?.({
          title: copy.title,
          body: copy.body,
        })
        saveAwayLastFiredMs(Date.now())
      } catch (err) {
        console.warn('[awayNotification] fire failed:', getRedactedLogErrorMessage(err))
      }
    },
  })
}
