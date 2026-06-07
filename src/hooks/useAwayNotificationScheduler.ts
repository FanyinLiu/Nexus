import { useEffect, useRef } from 'react'
import { decideAwayNotification } from '../features/proactive/awayScheduler.ts'
import { pickAwayNotificationCopy } from '../features/proactive/awayNotificationCopy.ts'
import {
  loadAwayLastFiredMs,
  saveAwayLastFiredMs,
} from '../lib/storage'
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
}: UseAwayNotificationSchedulerOptions) {
  // Stable ref so the interval handler always sees the latest values without
  // tearing the timer down on every chat-message change.
  const liveRef = useRef({ settings, messages, panelOpen })
  useEffect(() => {
    liveRef.current = { settings, messages, panelOpen }
  }, [settings, messages, panelOpen])

  useEffect(() => {
    if (!settings.proactiveAwayNotificationsEnabled) return
    if (typeof window === 'undefined') return
    if (!window.desktopPet?.showProactiveNotification) return

    const tick = async () => {
      // Read latest values via ref so the closure isn't stale.
      const { settings: s, messages: msgs, panelOpen: open } = liveRef.current
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
        console.warn('[awayNotification] fire failed:', err)
      }
    }

    // Run once immediately (covers the case where user re-opens the app
    // after a long absence), then on a coarse interval.
    void tick()
    const id = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [settings.proactiveAwayNotificationsEnabled])
}
