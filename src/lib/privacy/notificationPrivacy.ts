import type { NotificationMessage, TranslationKey } from '../../types'

type Translate = (key: TranslationKey, params?: Record<string, string>) => string

export type NotificationMessageFollowUpInput = {
  conversationKey: string
  sourceLabel: string
  senderLabel: string
}

function normalizeLabel(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

export function getNotificationSourceLabel(message: NotificationMessage): string {
  return normalizeLabel(message.sourceName, message.channelName || 'Notification')
}

export function getNotificationSenderLabel(message: NotificationMessage): string {
  return normalizeLabel(message.sender, message.title || getNotificationSourceLabel(message))
}

export function getNotificationConversationKey(message: NotificationMessage): string {
  return normalizeLabel(
    message.conversationId,
    `${getNotificationSourceLabel(message)}:${getNotificationSenderLabel(message)}`,
  )
}

export function buildNotificationMessageFollowUpInput(
  message: NotificationMessage,
): NotificationMessageFollowUpInput {
  return {
    conversationKey: getNotificationConversationKey(message),
    sourceLabel: getNotificationSourceLabel(message),
    senderLabel: getNotificationSenderLabel(message),
  }
}

export function buildNotificationMessageChatForwardText(
  message: NotificationMessage,
  t: Translate,
): string {
  return t('chat.prefix.desktop_message', {
    source: getNotificationSourceLabel(message),
    sender: getNotificationSenderLabel(message),
  })
}

export function buildNotificationReplyDraftText(
  message: NotificationMessage,
  t: Translate,
): string {
  return t('panel.notification.draft_reply', {
    source: getNotificationSourceLabel(message),
  })
}

export function buildNotificationHistorySafeNoticeContent(
  message: NotificationMessage,
  t: Translate,
) {
  return {
    chatContent: t('chat.prefix.notification_bubble', {
      channel: message.channelName,
      title: message.title,
    }),
    bubbleContent: t('chat.prefix.notification_bubble', {
      channel: message.channelName,
      title: message.title,
    }),
    speechContent: t('chat.prefix.notification_speech', {
      channel: message.channelName,
      title: message.title,
    }),
  }
}

export function sanitizeNotificationMessageForStorage(
  message: NotificationMessage,
): NotificationMessage {
  return {
    ...message,
    body: '',
    summary: undefined,
  }
}

export function sanitizeNotificationMessagesForStorage(
  messages: readonly NotificationMessage[],
): NotificationMessage[] {
  return messages.map(sanitizeNotificationMessageForStorage)
}
