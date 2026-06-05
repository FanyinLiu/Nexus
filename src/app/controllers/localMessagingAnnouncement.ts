import type { AppSettings, NotificationMessage, TranslationKey } from '../../types'
import {
  buildMessagingAnnouncementContent,
  type MessagingAnnouncementContent,
  type MessagingAnnouncementSettings,
} from './messagingAnnouncement.ts'

type Translate = (key: TranslationKey, params?: Record<string, string>) => string

type LocalMessagingAnnouncementSettings = Pick<
  AppSettings,
  'autonomyNotificationMessageAnnouncementsEnabled' | 'autonomyNotificationMessagePreviewEnabled'
>

function normalizeFallback(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

export function getLocalMessagingAnnouncementSettings(
  settings: LocalMessagingAnnouncementSettings,
): MessagingAnnouncementSettings {
  return {
    announceIncomingEnabled: settings.autonomyNotificationMessageAnnouncementsEnabled,
    announceMessagePreview: settings.autonomyNotificationMessagePreviewEnabled,
  }
}

export function buildLocalMessagingAnnouncementContent(
  message: NotificationMessage,
  settings: LocalMessagingAnnouncementSettings,
  t: Translate,
): MessagingAnnouncementContent | null {
  if (message.kind !== 'message') return null

  const sourceName = normalizeFallback(message.sourceName, message.channelName || 'Webhook')
  const sourceId = normalizeFallback(message.sourceId, sourceName)
  const targetId = normalizeFallback(message.conversationId, message.channelId || message.title || sourceId)
  const messageId = normalizeFallback(message.messageId, message.id)

  return buildMessagingAnnouncementContent(
    {
      sourceId,
      sourceName,
      targetId,
      messageId,
      sender: message.sender ?? '',
      fallbackTitle: message.title || message.channelName || sourceName,
      text: message.body,
    },
    getLocalMessagingAnnouncementSettings(settings),
    t,
  )
}
