import { useEffect, useRef, useState } from 'react'

import type { DeliveryContext } from '../../shared/proactiveDelivery.js'
import { buildReminderDeliveryContext } from '../features/reminders/proactiveMessage.ts'
import type { AppSettings, FocusState } from '../types/index.ts'
import { readProactiveDesktopContext } from './readProactiveDesktopContext.ts'

/** Fullscreen/quiet-hours signals are cheap to refresh, but not every frame. */
export const PROACTIVE_NOTE_CONTEXT_REFRESH_MS = 60_000

export type UseProactiveNoteContextOptions = {
  settings: AppSettings
  focusState: FocusState
  /** Only sample desktop context while the notebook can use it. */
  active: boolean
}

/**
 * Delivery context for the notebook's speech and arrival rules.
 *
 * The snapshot is rebuilt on every activation/focus change and then once a
 * minute while active, through the same privacy gate as reminder delivery.
 * It deliberately reads no typing signal, and an inactive note returns null so
 * the host cannot act on stale environmental state.
 */
export function useProactiveNoteContext({
  settings,
  focusState,
  active,
}: UseProactiveNoteContextOptions): DeliveryContext | null {
  const settingsRef = useRef(settings)
  const [context, setContext] = useState<DeliveryContext | null>(null)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!active) {
      // Deferred so deactivation does not cascade a render synchronously; the
      // return value below already hides stale context from the host.
      const handle = window.setTimeout(() => setContext(null), 0)
      return () => window.clearTimeout(handle)
    }

    let cancelled = false
    let inFlight = false

    async function rebuild(): Promise<void> {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const currentSettings = settingsRef.current
        const desktopContext = await readProactiveDesktopContext(currentSettings)
        if (cancelled) return
        setContext(buildReminderDeliveryContext({
          focusState,
          activeWindowTitle: desktopContext?.activeWindowTitle,
          activeWindowAppName: desktopContext?.activeWindowAppName,
          quietStart: currentSettings.proactiveQuietHoursStart,
          quietEnd: currentSettings.proactiveQuietHoursEnd,
          awayNotificationsEnabled: currentSettings.proactiveAwayNotificationsEnabled,
          now: Date.now(),
        }))
      } finally {
        inFlight = false
      }
    }

    void rebuild()
    const timer = window.setInterval(() => {
      void rebuild()
    }, PROACTIVE_NOTE_CONTEXT_REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active, focusState])

  return active ? context : null
}
