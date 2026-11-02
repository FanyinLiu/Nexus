import { useCallback, useEffect, useRef, useState } from 'react'

import { buildReminderDeliveryContext, buildReminderDeliveryPreferences } from '../features/reminders/proactiveMessage.ts'
import {
  createProactiveInboxOverlayController,
  type ProactiveInboxOverlayController,
  type ProactiveInboxOverlayView,
} from '../features/proactive/proactiveInboxOverlayController.ts'
import type { ProactiveInboxRowAction } from '../features/proactive/proactiveInboxOverlay.ts'
import { createLogger } from '../lib/logger.ts'
import type { AppSettings, FocusState } from '../types/index.ts'
import { readProactiveDesktopContext } from './readProactiveDesktopContext.ts'

const log = createLogger('proactive.inbox.overlay')

const EMPTY_VIEW: ProactiveInboxOverlayView = Object.freeze({
  open: false,
  unreadCount: 0,
  rows: [],
  expandedId: null,
})

export type UseProactiveInboxOverlayOptions = {
  settings: AppSettings
  focusState: FocusState
  /** Existing pet hand-off that opens/focuses the companion chat panel. */
  openConversation: () => void
}

export type UseProactiveInboxOverlayResult = {
  view: ProactiveInboxOverlayView
  /** Open from an external trigger (the pet context menu), not just the badge. */
  open: () => void
  toggle: () => void
  close: () => void
  toggleRow: (id: string) => void
  runAction: (id: string, action: ProactiveInboxRowAction) => void
}

/**
 * Bridge the inbox overlay controller to React.
 *
 * The controller is created inside the effect (never during render) so the
 * render path stays pure. Lifecycle only: initial read, refresh on every
 * `inbox:changed`, and timer cleanup. Opening the overlay, snooze timers and
 * read-rule decisions live in
 * `features/proactive/proactiveInboxOverlayController.ts`.
 */
export function useProactiveInboxOverlay({
  settings,
  focusState,
  openConversation,
}: UseProactiveInboxOverlayOptions): UseProactiveInboxOverlayResult {
  const settingsRef = useRef(settings)
  const focusStateRef = useRef(focusState)
  const openConversationRef = useRef(openConversation)
  const controllerRef = useRef<ProactiveInboxOverlayController | null>(null)
  const [view, setView] = useState<ProactiveInboxOverlayView>(EMPTY_VIEW)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    focusStateRef.current = focusState
  }, [focusState])

  useEffect(() => {
    openConversationRef.current = openConversation
  }, [openConversation])

  useEffect(() => {
    const controller = createProactiveInboxOverlayController({
      bridge: {
        list: async () => {
          const listInbox = window.desktopPet?.listProactiveInbox
          if (!listInbox) return { entries: [], unreadCount: 0, removedIds: [] }
          return listInbox()
        },
        update: async (id, status) => {
          const update = window.desktopPet?.updateProactiveInboxEntry
          if (!update) return { updated: false, unreadCount: 0 }
          return update({ id, status })
        },
        deliver: async (payload) => {
          const deliver = window.desktopPet?.deliverProactiveMessage
          if (!deliver) return null
          // The inbox stores `kind` at the shared boundary; an entry can only
          // have reached it through the router, so the renderer's narrowed
          // ProactiveMessageKind is the same value.
          return deliver(payload as Parameters<typeof deliver>[0])
        },
        openConversation: () => openConversationRef.current(),
      },
      buildDeliveryPayload: async (message) => {
        const currentSettings = settingsRef.current
        const now = Date.now()
        const desktopContext = await readProactiveDesktopContext(currentSettings)
        const context = buildReminderDeliveryContext({
          focusState: focusStateRef.current,
          activeWindowTitle: desktopContext?.activeWindowTitle,
          activeWindowAppName: desktopContext?.activeWindowAppName,
          quietStart: currentSettings.proactiveQuietHoursStart,
          quietEnd: currentSettings.proactiveQuietHoursEnd,
          awayNotificationsEnabled: currentSettings.proactiveAwayNotificationsEnabled,
          now,
        })
        const preferences = buildReminderDeliveryPreferences(currentSettings)
        return { message, context, preferences }
      },
      logger: log,
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    })

    controllerRef.current = controller
    setView(controller.getSnapshot())
    const unsubscribeView = controller.subscribe(() => {
      setView(controller.getSnapshot())
    })
    void controller.refresh()
    const unsubscribeInbox = window.desktopPet?.subscribeProactiveInbox?.(() => {
      void controller.refresh()
    })

    return () => {
      unsubscribeInbox?.()
      unsubscribeView()
      controller.dispose()
      controllerRef.current = null
    }
  }, [])

  const open = useCallback(() => {
    void controllerRef.current?.open()
  }, [])

  return {
    view,
    open,
    toggle: () => {
      void controllerRef.current?.toggle()
    },
    close: () => controllerRef.current?.close(),
    toggleRow: (id) => {
      void controllerRef.current?.toggleRow(id)
    },
    runAction: (id, action) => {
      void controllerRef.current?.runAction(id, action)
    },
  }
}
