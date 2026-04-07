import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY,
  readJson,
  writeJson,
} from '../lib/storage'
import type { NotificationChannel, NotificationMessage } from '../types'

const MAX_STORED_MESSAGES = 50

export type UseNotificationBridgeOptions = {
  onNotification: (message: NotificationMessage) => void
  /** Pass actual value (not from ref) so effects re-run when toggled. */
  enabled: boolean
}

export function useNotificationBridge({
  onNotification,
  enabled,
}: UseNotificationBridgeOptions) {
  const [messages, setMessages] = useState<NotificationMessage[]>(
    () => readJson(AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY, []),
  )
  const onNotificationRef = useRef(onNotification)

  useEffect(() => {
    onNotificationRef.current = onNotification
  }, [onNotification])

  // Persist messages
  useEffect(() => {
    writeJson(AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY, messages)
  }, [messages])

  // ── Channel management (via IPC to main process) ───────────────────────────

  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(
    () => Boolean(window.desktopPet?.getNotificationChannels),
  )

  // Load channels on mount (independent of enabled toggle)
  useEffect(() => {
    const getNotificationChannels = window.desktopPet?.getNotificationChannels
    if (!getNotificationChannels) {
      return
    }

    getNotificationChannels()
      .then((chs) => setChannels(chs ?? []))
      .catch(() => {
        setChannels([])
      })
      .finally(() => setChannelsLoading(false))
  }, [])

  const addChannel = useCallback(async (draft: Omit<NotificationChannel, 'id'>) => {
    const newChannel: NotificationChannel = {
      ...draft,
      id: crypto.randomUUID().slice(0, 8),
    }
    const next = [...channels, newChannel]
    await window.desktopPet?.setNotificationChannels?.(next)
    setChannels(next)
  }, [channels])

  const updateChannel = useCallback(async (id: string, patch: Partial<NotificationChannel>) => {
    const next = channels.map((ch) => ch.id === id ? { ...ch, ...patch } : ch)
    await window.desktopPet?.setNotificationChannels?.(next)
    setChannels(next)
  }, [channels])

  const removeChannel = useCallback(async (id: string) => {
    const next = channels.filter((ch) => ch.id !== id)
    await window.desktopPet?.setNotificationChannels?.(next)
    setChannels(next)
  }, [channels])

  // ── Bridge lifecycle ───────────────────────────────────────────────────────

  // Start/stop the bridge based on settings — re-runs when enabled changes
  useEffect(() => {
    if (!enabled) return

    void window.desktopPet?.startNotificationBridge?.()

    return () => {
      void window.desktopPet?.stopNotificationBridge?.()
    }
  }, [enabled])

  // Subscribe to incoming notifications
  useEffect(() => {
    if (!enabled) return

    const unsubscribe = window.desktopPet?.subscribeNotifications?.((message: NotificationMessage) => {
      setMessages((prev) => {
        const next = [message, ...prev].slice(0, MAX_STORED_MESSAGES)
        return next
      })
      onNotificationRef.current(message)
    })

    return () => {
      unsubscribe?.()
    }
  }, [enabled])

  // ── Message helpers ────────────────────────────────────────────────────────

  const unreadCount = messages.filter((m) => !m.read).length

  const markRead = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((m) => m.id === messageId ? { ...m, read: true } : m),
    )
  }, [])

  const markAllRead = useCallback(() => {
    setMessages((prev) => prev.map((m) => ({ ...m, read: true })))
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return {
    // Messages
    messages,
    unreadCount,
    markRead,
    markAllRead,
    clearMessages,
    // Channels
    channels,
    channelsLoading,
    addChannel,
    updateChannel,
    removeChannel,
  }
}
