/**
 * Notification card decisions shared by the legacy panel and the default
 * companion panel. Cards are the list (reply, read, and a small menu for
 * later / important). The same arrival is not copied into the chat
 * transcript. A stage caption that already names a visible card is hidden.
 */
import type { NotificationMessage, TranslationKey, TranslationParams } from '../../types'
import { buildNotificationReplyDraftText } from '../../lib/privacy/notificationPrivacy.ts'
import type { NotificationCardPrimaryActionId } from './notificationCardActions.ts'

type Translate = (key: TranslationKey, params?: TranslationParams) => string

export const VISIBLE_NOTIFICATION_CARD_LIMIT = 3

/** Snooze delay used by the card's "handle later" action. */
export const NOTIFICATION_CARD_SNOOZE_MINUTES = 30

export type NotificationReplySource = 'telegram' | 'discord'

export type NotificationReplyTarget = {
  source: NotificationReplySource
  conversationId?: string
  messageId?: string
  notificationMessageId: string
}

export type NotificationReplyAvailability = {
  telegram: boolean
  discord: boolean
}

export type NotificationReplyDelivery = 'empty' | 'unsupported' | 'sent' | 'failed'

export type NotificationCardPlan =
  | { type: 'compose'; text: string; reply?: NotificationReplyTarget }
  | { type: 'toggle_important'; messageId: string }
  | { type: 'snooze_and_read'; messageId: string; delayMinutes: number }

const MIN_IDENTITY_CHARS = 2
const MIN_PREVIEW_MATCH_CHARS = 12

function normalized(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Unread cards that are not snoozed, newest first, capped so the companion
 * stage can show actions without covering the whole model.
 */
export function selectVisibleNotificationCards(
  messages: readonly NotificationMessage[],
  limit = VISIBLE_NOTIFICATION_CARD_LIMIT,
): NotificationMessage[] {
  return messages
    .filter((message) => !message.read && !message.snoozedUntil)
    .slice(0, limit)
}

/** Sender-qualified label used on reply prompts and action tooltips. */
export function getNotificationCardSourceLabel(message: NotificationMessage): string {
  if (message.sender) {
    return `${message.sender} · ${message.sourceName || message.channelName || message.title || message.sourceId || ''}`.trim()
  }
  return message.sourceName || message.channelName || message.title || 'Unknown source'
}

/** Telegram and Discord are the only bridges the card can reply through. */
export function getNotificationReplySource(
  message: Pick<NotificationMessage, 'sourceId' | 'sourceName'>,
): NotificationReplySource | null {
  const raw = (message.sourceId || message.sourceName || '').trim().toLowerCase()
  if (raw === 'telegram' || raw === 'tg') return 'telegram'
  if (raw === 'discord') return 'discord'
  return null
}

export function canReplyToNotificationCard(
  message: NotificationMessage,
  availability: NotificationReplyAvailability,
): boolean {
  if (message.kind !== 'message') return false
  const source = getNotificationReplySource(message)
  if (source === 'telegram') return availability.telegram
  if (source === 'discord') return availability.discord
  return false
}

export function createNotificationReplyTarget(
  message: NotificationMessage,
): NotificationReplyTarget | null {
  const source = getNotificationReplySource(message)
  if (!source) return null
  return {
    source,
    conversationId: message.conversationId?.trim() || undefined,
    messageId: message.messageId?.trim() || undefined,
    notificationMessageId: message.id,
  }
}

/**
 * The reply chip already names who the message is for, so the composer
 * starts empty. A drafted reply, when one exists, is typed into that box
 * rather than prefixed with another "replying to" label.
 */
export function buildNotificationReplyComposerText(): string {
  return ''
}

/** Telegram and Discord cards show an app mark; everything else uses a letter. */
export function getNotificationCardBadge(
  message: Pick<NotificationMessage, 'sourceId' | 'sourceName' | 'sender' | 'title' | 'channelName'>,
): { kind: 'telegram' | 'discord' | 'initial'; letter: string } {
  const seed = (message.sender || message.title || message.channelName || message.sourceName || '?').trim()
  const letter = Array.from(seed)[0] || '?'
  const source = getNotificationReplySource(message)
  if (source === 'telegram' || source === 'discord') return { kind: source, letter }
  return { kind: 'initial', letter }
}

/**
 * Each notice already has a card. Writing one chat line per arrival repeats
 * it in the transcript, so the mirror stays off.
 */
export function shouldAppendNotificationChatLine(): boolean {
  return false
}

export function planNotificationPrimaryAction(
  actionId: NotificationCardPrimaryActionId,
  message: NotificationMessage,
  translate: Translate,
): NotificationCardPlan {
  if (actionId === 'draft_reply') {
    return {
      type: 'compose',
      text: buildNotificationReplyDraftText(message, translate),
    }
  }
  if (actionId === 'mark_important') {
    return { type: 'toggle_important', messageId: message.id }
  }
  return {
    type: 'snooze_and_read',
    messageId: message.id,
    delayMinutes: NOTIFICATION_CARD_SNOOZE_MINUTES,
  }
}

export function planNotificationReplyCompose(
  message: NotificationMessage,
): Extract<NotificationCardPlan, { type: 'compose' }> | null {
  const reply = createNotificationReplyTarget(message)
  if (!reply) return null
  return {
    type: 'compose',
    text: buildNotificationReplyComposerText(),
    reply,
  }
}

type NotificationReplySenders = {
  telegram?: (
    text: string,
    conversationId?: string,
    messageId?: string,
  ) => Promise<boolean> | boolean
  discord?: (
    text: string,
    conversationId?: string,
    messageId?: string,
  ) => Promise<boolean> | boolean
}

/**
 * Sends a card reply. Only a real send may mark the card read; a blocked or
 * failed bridge call leaves the card and the draft in place.
 */
export async function deliverNotificationReply(
  target: NotificationReplyTarget,
  text: string,
  senders: NotificationReplySenders,
): Promise<NotificationReplyDelivery> {
  const trimmed = text.trim()
  if (!trimmed) return 'empty'
  const send = target.source === 'telegram' ? senders.telegram : senders.discord
  if (!send) return 'unsupported'
  const sent = await send(trimmed, target.conversationId, target.messageId)
  return sent ? 'sent' : 'failed'
}

/** True only after the bridge accepted the reply. */
export function shouldCompleteNotificationReply(outcome: NotificationReplyDelivery): boolean {
  return outcome === 'sent'
}

function captionMatchesNotification(text: string, message: NotificationMessage): boolean {
  const summary = normalized(message.summary || message.body)
  if (summary && (text === summary || (summary.length >= MIN_PREVIEW_MATCH_CHARS && text.includes(summary)))) {
    return true
  }

  const title = normalized(message.title)
  if (title.length >= MIN_PREVIEW_MATCH_CHARS && text.includes(title)) return true

  const sender = normalized(message.sender)
  const source = normalized(message.sourceName || message.sourceId || message.channelName)
  return sender.length >= MIN_IDENTITY_CHARS
    && source.length >= MIN_IDENTITY_CHARS
    && text.includes(sender)
    && text.includes(source)
}

/**
 * The stage caption is the latest assistant line. Bridge announcements name
 * the same sender and source the card already shows, so the caption is
 * dropped while that card is on screen. The chat sheet still keeps the line.
 */
export function captionRepeatsVisibleNotification(
  caption: string | null | undefined,
  messages: readonly NotificationMessage[],
): boolean {
  const text = normalized(caption ?? undefined)
  if (!text || messages.length === 0) return false
  return messages.some((message) => captionMatchesNotification(text, message))
}
