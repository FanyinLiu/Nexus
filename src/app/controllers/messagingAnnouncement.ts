import type { AppSettings, TranslationKey } from '../../types'

export type MessagingAnnouncementMessage = {
  sourceId: string
  sourceName: string
  targetId: string
  messageId: string
  sender: string
  fallbackTitle: string
  text: string
}

export type MessagingAnnouncementContent = {
  chatContent: string
  bubbleContent: string
  speechContent: string
  dedupeKey: string
}

export type MessagingAnnouncementSettings = {
  announceIncomingEnabled: boolean
  announceMessagePreview: boolean
}

type Translate = (key: TranslationKey, params?: Record<string, string>) => string

const MAX_SENDER_CHARS = 80
const MAX_PREVIEW_CHARS = 90
const FALLBACK_SENDER = 'Unknown'

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function shorten(value: string, maxChars: number): string {
  const normalized = collapseWhitespace(value)
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
}

export function getMessagingAnnouncementSender(message: MessagingAnnouncementMessage): string {
  return shorten(
    message.sender || message.fallbackTitle || message.sourceName || FALLBACK_SENDER,
    MAX_SENDER_CHARS,
  )
}

export function getMessagingAnnouncementPreview(text: string): string {
  return shorten(text, MAX_PREVIEW_CHARS)
}

export function buildMessagingAnnouncementContent(
  message: MessagingAnnouncementMessage,
  settings: MessagingAnnouncementSettings,
  t: Translate,
): MessagingAnnouncementContent | null {
  if (!settings.announceIncomingEnabled) return null

  const source = shorten(message.sourceName || message.sourceId, MAX_SENDER_CHARS)
  const sender = getMessagingAnnouncementSender(message)
  const preview = settings.announceMessagePreview
    ? getMessagingAnnouncementPreview(message.text)
    : ''

  const params = { source, sender, text: preview }
  const hasPreview = Boolean(preview)

  return {
    chatContent: t(
      hasPreview
        ? 'chat.bridge.messaging_announcement_chat_preview'
        : 'chat.bridge.messaging_announcement_chat',
      params,
    ),
    bubbleContent: t(
      hasPreview
        ? 'chat.bridge.messaging_announcement_bubble_preview'
        : 'chat.bridge.messaging_announcement_bubble',
      params,
    ),
    speechContent: t(
      hasPreview
        ? 'chat.bridge.messaging_announcement_speech_preview'
        : 'chat.bridge.messaging_announcement_speech',
      params,
    ),
    dedupeKey: `message:${message.sourceId}:${message.targetId}:${message.messageId}`,
  }
}

export function getTelegramAnnouncementSettings(
  settings: Pick<AppSettings, 'telegramAnnounceIncomingEnabled' | 'telegramAnnounceMessagePreview'>,
): MessagingAnnouncementSettings {
  return {
    announceIncomingEnabled: settings.telegramAnnounceIncomingEnabled,
    announceMessagePreview: settings.telegramAnnounceMessagePreview,
  }
}

export function getDiscordAnnouncementSettings(
  settings: Pick<AppSettings, 'discordAnnounceIncomingEnabled' | 'discordAnnounceMessagePreview'>,
): MessagingAnnouncementSettings {
  return {
    announceIncomingEnabled: settings.discordAnnounceIncomingEnabled,
    announceMessagePreview: settings.discordAnnounceMessagePreview,
  }
}
