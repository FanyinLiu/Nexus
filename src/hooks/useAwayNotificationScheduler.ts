import { useEffect, useRef } from 'react'
import { decideAwayNotification } from '../features/proactive/awayScheduler'
import { pickAwayNotificationCopy } from '../features/proactive/awayNotificationCopy'
import {
  PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY,
  readJson,
  writeJson,
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
  // Stable refs so the interval handler always sees the latest values without
  // tearing the timer down on every chat-message change.
  const settingsRef = useRef(settings)
  const messagesRef = useRef(messages)
  const panelOpenRef = useRef(panelOpen)

  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { panelOpenRef.current = panelOpen }, [panelOpen])

  useEffect(() => {
    if (!settings.proactiveAwayNotificationsEnabled) return
    if (typeof window === 'undefined') return
    if (!window.desktopPet?.showProactiveNotification) return

    const tick = async () => {
      // Read latest values via refs so the closure isn't stale.
      const s = settingsRef.current
      if (!s.proactiveAwayNotificationsEnabled) return
      if (panelOpenRef.current) return

      const lastUserActivityMs = findLastUserMessageMs(messagesRef.current)
      const lastFiredMs = readJson<number | null>(PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY, null)
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
        writeJson(PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY, Date.now())
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
