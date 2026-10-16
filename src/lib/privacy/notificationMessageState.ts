import type { NotificationMessage } from '../../types'
import { sanitizeNotificationMessagesForStorage } from './notificationPrivacy.ts'

const MAX_STORED_NOTIFICATION_MESSAGES = 50

function isNotificationMessage(value: unknown): value is NotificationMessage {
  if (typeof value !== 'object' || value === null) return false

  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.channelId === 'string'
    && typeof record.channelName === 'string'
    && typeof record.title === 'string'
    && typeof record.body === 'string'
    && typeof record.receivedAt === 'string'
    && typeof record.read === 'boolean'
}

export function sanitizeNotificationMessageSnapshot(value: unknown): NotificationMessage[] {
  if (!Array.isArray(value)) return []

  return sanitizeNotificationMessagesForStorage(
    value
      .filter(isNotificationMessage)
      .slice(0, MAX_STORED_NOTIFICATION_MESSAGES),
  )
}

export type NotificationPreviewMemory = ReadonlyMap<string, { body: string; summary?: string }>

/**
 * A stored snapshot has an empty body. The card can still show one preview
 * line from a body that is only in memory for the same id. Nothing here is
 * written back to storage.
 */
export function retainNotificationPreview(
  snapshot: readonly NotificationMessage[],
  current: readonly NotificationMessage[],
  remembered: NotificationPreviewMemory,
): NotificationMessage[] {
  if (snapshot.length === 0) return [...snapshot]
  const currentById = new Map(current.map((message) => [message.id, message]))
  return snapshot.map((message) => {
    if (message.body.trim() || message.summary?.trim()) return message
    const previous = currentById.get(message.id)
    const memory = remembered.get(message.id)
    const body = previous?.body.trim() || memory?.body || ''
    const summary = previous?.summary?.trim() || memory?.summary
    if (!body && !summary) return message
    return { ...message, body, summary }
  })
}

export function prependNotificationMessage(
  messages: readonly NotificationMessage[],
  message: NotificationMessage,
): NotificationMessage[] {
  return [message, ...messages].slice(0, MAX_STORED_NOTIFICATION_MESSAGES)
}

export function clearExpiredNotificationSnoozes(
  messages: readonly NotificationMessage[],
  now: number,
): NotificationMessage[] {
  return messages.map((message) => {
    if (!message.snoozedUntil) return message

    const expiredAt = Date.parse(message.snoozedUntil)
    if (Number.isNaN(expiredAt) || expiredAt <= now) {
      return { ...message, snoozedUntil: undefined }
    }

    return message
  })
}

export function commitNotificationMessages(
  messages: readonly NotificationMessage[],
  write: (persisted: NotificationMessage[]) => void,
  apply: (next: NotificationMessage[]) => void,
): void {
  const next = [...messages].slice(0, MAX_STORED_NOTIFICATION_MESSAGES)
  write(sanitizeNotificationMessagesForStorage(next))
  apply(next)
}
