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

  // Functional setState + ref read of latest channels avoids the
  // capture-then-await-then-write race where two rapid edits both
  // computed `next` from the same stale `channels` snapshot. The IPC
  // call still receives the post-merge list because it reads from the
  // latest state via the ref.
  const channelsRef = useRef(channels)
  useEffect(() => { channelsRef.current = channels }, [channels])

  const addChannel = useCallback(async (draft: Omit<NotificationChannel, 'id'>) => {
    const newChannel: NotificationChannel = {
      ...draft,
      id: crypto.randomUUID().slice(0, 8),
    }
    const next = [...channelsRef.current, newChannel]
    await window.desktopPet?.setNotificationChannels?.(next)
    setChannels(next)
  }, [])

  const updateChannel = useCallback(async (id: string, patch: Partial<NotificationChannel>) => {
    const next = channelsRef.current.map((ch) => ch.id === id ? { ...ch, ...patch } : ch)
    await window.desktopPet?.setNotificationChannels?.(next)
    setChannels(next)
  }, [])

  const removeChannel = useCallback(async (id: string) => {
    const next = channelsRef.current.filter((ch) => ch.id !== id)
    await window.desktopPet?.setNotificationChannels?.(next)
    setChannels(next)
  }, [])

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
