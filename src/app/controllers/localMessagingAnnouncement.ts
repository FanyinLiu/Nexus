import type { AppSettings, NotificationMessage, TranslationKey } from '../../types'
import {
  buildMessagingAnnouncementContent,
  getMessagingSourceGroup,
  type MessagingAnnouncementContent,
  type MessagingAnnouncementSettings,
} from './messagingAnnouncement.ts'

type Translate = (key: TranslationKey, params?: Record<string, string>) => string

type LocalMessagingAnnouncementSettings = Pick<
  AppSettings,
  'autonomyNotificationMessageAnnouncementsEnabled' | 'autonomyNotificationMessagePreviewEnabled'
>

type LocalNativeBridgeEchoSettings = Pick<
  AppSettings,
  | 'discordBotToken'
  | 'discordIntegrationEnabled'
  | 'telegramBotToken'
  | 'telegramIntegrationEnabled'
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

export function shouldSuppressLocalNativeBridgeEcho(
  message: NotificationMessage,
  settings: LocalNativeBridgeEchoSettings,
): boolean {
  if (message.kind !== 'message') return false

  const sourceGroup = getMessagingSourceGroup({
    sourceId: message.sourceId ?? message.channelId,
    sourceName: message.sourceName ?? message.channelName,
  })

  if (sourceGroup === 'telegram') {
    return settings.telegramIntegrationEnabled && Boolean(settings.telegramBotToken.trim())
  }

  if (sourceGroup === 'discord') {
    return settings.discordIntegrationEnabled && Boolean(settings.discordBotToken.trim())
  }

  return false
}
