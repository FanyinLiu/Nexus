import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY,
  onStorageChange,
  readJson,
  writeJson,
} from '../lib/storage'
import {
  clearExpiredNotificationSnoozes,
  commitNotificationMessages,
  prependNotificationMessage,
  sanitizeNotificationMessageSnapshot,
} from '../lib/privacy/notificationMessageState'
import type { NotificationChannel, NotificationMessage } from '../types'

export type UseNotificationBridgeOptions = {
  onNotification: (message: NotificationMessage) => void
  /** Pass actual value (not from ref) so effects re-run when toggled. */
  enabled: boolean
  /** Only the background owner may touch the shared main-process bridge. */
  runtimeOwner?: boolean
}

export function useNotificationBridge({
  onNotification,
  enabled,
  runtimeOwner = true,
}: UseNotificationBridgeOptions) {
  const [messages, setMessages] = useState<NotificationMessage[]>(() => {
    const initialMessages = sanitizeNotificationMessageSnapshot(
      readJson<unknown>(AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY, []),
    )
    return clearExpiredNotificationSnoozes(initialMessages, Date.now())
  })
  const messagesRef = useRef(messages)
  const onNotificationRef = useRef(onNotification)

  useEffect(() => {
    onNotificationRef.current = onNotification
  }, [onNotification])

  const applyMessages = useCallback((next: NotificationMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }, [])

  const commitMessages = useCallback((next: readonly NotificationMessage[]) => {
    commitNotificationMessages(
      next,
      (persisted) => writeJson(AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY, persisted),
      applyMessages,
    )
  }, [applyMessages])

  useEffect(() => onStorageChange(
    AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY,
    (value) => applyMessages(sanitizeNotificationMessageSnapshot(value)),
  ), [applyMessages])

  // Clean up expired snoozes so "later" notifications reappear automatically.
  const pruneExpiredSnoozes = useCallback(() => {
    const current = messagesRef.current
    const next = clearExpiredNotificationSnoozes(current, Date.now())
    const changed = next.some((message, index) => message !== current[index])
    if (changed) commitMessages(next)
  }, [commitMessages])

  useEffect(() => {
    if (!runtimeOwner) return
    const intervalId = window.setInterval(pruneExpiredSnoozes, 30_000)
    return () => { window.clearInterval(intervalId) }
  }, [pruneExpiredSnoozes, runtimeOwner])

  // ── Channel management (via IPC to main process) ───────────────────────────

  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(
    () => Boolean(window.desktopPet?.getNotificationChannels),
  )

  // Channel configuration is a settings data query, not a bridge lifecycle
  // operation. Both renderers may read it so Panel settings can display and
  // edit existing channels; only the lifecycle effects below are owner-gated.
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

  const handleIncomingNotification = useCallback((message: NotificationMessage) => {
    const next = prependNotificationMessage(messagesRef.current, message)
    commitMessages(next)
    onNotificationRef.current(message)
  }, [commitMessages])

  // ── Bridge lifecycle ───────────────────────────────────────────────────────

  // Start/stop the bridge based on settings — re-runs when enabled changes
  useEffect(() => {
    if (!runtimeOwner) return
    if (!enabled) return

    void window.desktopPet?.startNotificationBridge?.()

    return () => {
      void window.desktopPet?.stopNotificationBridge?.()
    }
  }, [enabled, runtimeOwner])

  // Subscribe to incoming notifications
  useEffect(() => {
    if (!runtimeOwner) return
    if (!enabled) return

    const unsubscribe = window.desktopPet?.subscribeNotifications?.(handleIncomingNotification)

    return () => {
      unsubscribe?.()
    }
  }, [enabled, handleIncomingNotification, runtimeOwner])

  // ── Message helpers ────────────────────────────────────────────────────────

  const unreadCount = messages.filter((m) => !m.read).length

  const markRead = useCallback((messageId: string) => {
    const current = messagesRef.current
    let changed = false
    const next = current.map((message) => {
      if (message.id !== messageId || message.read) return message
      changed = true
      return { ...message, read: true }
    })
    if (changed) commitMessages(next)
  }, [commitMessages])

  const markAllRead = useCallback(() => {
    const current = messagesRef.current
    let changed = false
    const next = current.map((message) => {
      if (message.read) return message
      changed = true
      return { ...message, read: true }
    })
    if (changed) commitMessages(next)
  }, [commitMessages])

  const markImportant = useCallback((messageId: string) => {
    const current = messagesRef.current
    let changed = false
    const next = current.map((message) => {
      if (message.id !== messageId) return message
      changed = true
      return { ...message, isImportant: !message.isImportant }
    })
    if (changed) commitMessages(next)
  }, [commitMessages])

  const snoozeMessage = useCallback((messageId: string, delayMinutes: number) => {
    const snoozedUntil = new Date(Date.now() + delayMinutes * 60_000).toISOString()
    const current = messagesRef.current
    let changed = false
    const next = current.map((message) => {
      if (message.id !== messageId) return message
      changed = true
      return { ...message, snoozedUntil }
    })
    if (changed) commitMessages(next)
  }, [commitMessages])

  const clearMessages = useCallback(() => {
    if (messagesRef.current.length === 0) return
    commitMessages([])
  }, [commitMessages])

  return {
    // Messages
    messages,
    unreadCount,
    markRead,
    markAllRead,
    markImportant,
    snoozeMessage,
    pruneExpiredSnoozes,
    clearMessages,
    // Channels
    channels,
    channelsLoading,
    addChannel,
    updateChannel,
    removeChannel,
  }
}
