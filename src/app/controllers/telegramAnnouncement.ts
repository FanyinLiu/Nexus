import type { AppSettings, TranslationKey } from '../../types'
import {
  buildMessagingAnnouncementContent,
  getMessagingAnnouncementPreview,
  getMessagingAnnouncementSender,
  getTelegramAnnouncementSettings,
  type MessagingAnnouncementContent,
} from './messagingAnnouncement.ts'

export type TelegramAnnouncementMessage = {
  chatId: number
  chatTitle: string
  fromUser: string
  text: string
  media?: string | null
  messageId: number
}

export type TelegramAnnouncementContent = MessagingAnnouncementContent

type TelegramAnnouncementSettings = Pick<
  AppSettings,
  'telegramAnnounceIncomingEnabled' | 'telegramAnnounceMessagePreview'
>

type Translate = (key: TranslationKey, params?: Record<string, string>) => string

export function getTelegramAnnouncementSender(message: TelegramAnnouncementMessage): string {
  return getMessagingAnnouncementSender({
    sourceId: 'telegram',
    sourceName: 'Telegram',
    targetId: String(message.chatId),
    messageId: String(message.messageId),
    sender: message.fromUser,
    fallbackTitle: message.chatTitle,
    text: message.text,
  })
}

export function getTelegramAnnouncementPreview(text: string): string {
  return getMessagingAnnouncementPreview(text)
}

export function buildTelegramAnnouncementContent(
  message: TelegramAnnouncementMessage,
  settings: TelegramAnnouncementSettings,
  t: Translate,
): TelegramAnnouncementContent | null {
  return buildMessagingAnnouncementContent(
    {
      sourceId: 'telegram',
      sourceName: 'Telegram',
      targetId: String(message.chatId),
      messageId: String(message.messageId),
      sender: message.fromUser,
      fallbackTitle: message.chatTitle,
      text: message.text,
      media: message.media,
    },
    getTelegramAnnouncementSettings(settings),
    t,
  )
}
