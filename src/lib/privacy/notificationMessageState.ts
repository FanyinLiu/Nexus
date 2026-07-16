import type { NotificationMessage } from '../../types'
import { sanitizeNotificationMessagesForStorage } from './notificationPrivacy.ts'

export const MAX_STORED_NOTIFICATION_MESSAGES = 50

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
