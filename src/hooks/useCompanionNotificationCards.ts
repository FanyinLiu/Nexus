/**
 * Wires the shared notification-card plans to the bridge and the composer.
 * Decisions live in `notificationCardSession`; this hook only holds the reply
 * target and asks the panel to open the chat sheet.
 */
import { useCallback, useMemo, useState } from 'react'
import type { NotificationCardPrimaryActionId } from '../features/notifications/notificationCardActions.ts'
import {
  canReplyToNotificationCard,
  deliverNotificationReply,
  getNotificationCardSourceLabel,
  planNotificationPrimaryAction,
  planNotificationReplyCompose,
  selectVisibleNotificationCards,
  shouldCompleteNotificationReply,
  type NotificationReplyTarget,
} from '../features/notifications/notificationCardSession.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { NotificationMessage, TranslationKey, TranslationParams, UiLanguage } from '../types'

type ReplySender = (
  text: string,
  conversationId?: string,
  messageId?: string,
) => Promise<boolean> | boolean

type UseCompanionNotificationCardsOptions = {
  uiLanguage: UiLanguage
  messages: readonly NotificationMessage[]
  markAllRead: () => Promise<void> | void
  clearMessages: () => Promise<void> | void
  markRead: (messageId: string) => void
  markImportant: (messageId: string) => void
  snoozeMessage: (messageId: string, delayMinutes: number) => void
  replyToTelegram?: ReplySender
  replyToDiscord?: ReplySender
  setInput: (value: string) => void
  setError: (value: string | null) => void
}

export type CompanionNotificationReplySession = {
  hint: string
  sendLabel: string
  cancelLabel: string
  onCancel: () => void
  onSend: (text: string) => void
}

export type CompanionNotificationSummaryBindings = {
  messages: NotificationMessage[]
  totalMessageCount: number
  canReplyToNotification: (message: NotificationMessage) => boolean
  getNotificationSourceLabel: (message: NotificationMessage) => string
  locale: string
  onClearNotifications: () => void
  onMarkAllRead: () => void
  onMarkNotificationRead: (messageId: string) => void
  onNotificationPrimaryAction: (actionId: NotificationCardPrimaryActionId, message: NotificationMessage) => void
  onReplyToNotification: (message: NotificationMessage) => void
  translate: (key: TranslationKey, params?: TranslationParams) => string
}

export function useCompanionNotificationCards({
  uiLanguage,
  messages,
  markAllRead,
  clearMessages,
  markRead,
  markImportant,
  snoozeMessage,
  replyToTelegram,
  replyToDiscord,
  setInput,
  setError,
}: UseCompanionNotificationCardsOptions) {
  const [activeReply, setActiveReply] = useState<NotificationReplyTarget | null>(null)
  const [composerRequestId, setComposerRequestId] = useState(0)
  const translate = useCallback(
    (key: TranslationKey, params?: TranslationParams) => pickTranslatedUiText(uiLanguage, key, params),
    [uiLanguage],
  )
  const visibleMessages = useMemo(
    () => selectVisibleNotificationCards(messages),
    [messages],
  )
  const availability = useMemo(() => ({
    telegram: Boolean(replyToTelegram),
    discord: Boolean(replyToDiscord),
  }), [replyToDiscord, replyToTelegram])

  let replyTarget = activeReply
  if (
    replyTarget
    && !visibleMessages.some((message) => message.id === replyTarget?.notificationMessageId)
  ) {
    replyTarget = null
    setActiveReply(null)
  }

  const openComposer = useCallback((text: string, reply?: NotificationReplyTarget) => {
    setInput(text)
    if (reply) setActiveReply(reply)
    setComposerRequestId((current) => current + 1)
  }, [setInput])

  const onNotificationPrimaryAction = useCallback((
    actionId: NotificationCardPrimaryActionId,
    message: NotificationMessage,
  ) => {
    const plan = planNotificationPrimaryAction(actionId, message, translate)
    if (plan.type === 'compose') {
      openComposer(plan.text, plan.reply)
      return
    }
    if (plan.type === 'toggle_important') {
      markImportant(plan.messageId)
      return
    }
    snoozeMessage(plan.messageId, plan.delayMinutes)
    markRead(plan.messageId)
  }, [markImportant, markRead, openComposer, snoozeMessage, translate])

  const onReplyToNotification = useCallback((message: NotificationMessage) => {
    const plan = planNotificationReplyCompose(message)
    if (!plan) return
    openComposer(plan.text, plan.reply)
  }, [openComposer])

  const cancelReply = useCallback(() => {
    setActiveReply(null)
  }, [])

  const sendReply = useCallback((text: string) => {
    if (!activeReply) return
    const target = activeReply
    void deliverNotificationReply(target, text, {
      telegram: replyToTelegram
        ? (body, conversationId, messageId) => replyToTelegram(body, conversationId, messageId)
        : undefined,
      discord: replyToDiscord
        ? (body, conversationId, messageId) => replyToDiscord(body, conversationId, messageId)
        : undefined,
    }).then((outcome) => {
      if (outcome === 'empty') return
      if (!shouldCompleteNotificationReply(outcome)) {
        setError(translate(outcome === 'unsupported'
          ? 'panel.notification.reply_not_supported'
          : 'panel.notification.reply_failed'))
        return
      }
      markRead(target.notificationMessageId)
      setActiveReply(null)
      setInput('')
    }).catch(() => {
      setError(translate('panel.notification.reply_failed'))
    })
  }, [activeReply, markRead, replyToDiscord, replyToTelegram, setError, setInput, translate])

  const summary: CompanionNotificationSummaryBindings | null = visibleMessages.length === 0
    ? null
    : {
      messages: visibleMessages,
      totalMessageCount: messages.length,
      canReplyToNotification: (message) => canReplyToNotificationCard(message, availability),
      getNotificationSourceLabel: getNotificationCardSourceLabel,
      locale: uiLanguage,
      onClearNotifications: () => { void clearMessages() },
      onMarkAllRead: () => { void markAllRead() },
      onMarkNotificationRead: markRead,
      onNotificationPrimaryAction,
      onReplyToNotification,
      translate,
    }

  const replyMessage = replyTarget
    ? messages.find((message) => message.id === replyTarget.notificationMessageId)
    : undefined
  const reply: CompanionNotificationReplySession | null = replyTarget
    ? {
      hint: translate('panel.notification.reply_chip', {
        source: replyMessage ? getNotificationCardSourceLabel(replyMessage) : '',
      }),
      sendLabel: translate('panel.notification.send_reply'),
      cancelLabel: translate('common.cancel'),
      onCancel: cancelReply,
      onSend: sendReply,
    }
    : null

  return {
    visibleMessages,
    composerRequestId,
    reply,
    summary,
  }
}
