/**
 * Deferred reminder notice merging.
 *
 * While the assistant is listening or in a continuous conversation, reminders
 * wait in an in-memory queue. When the session ends we speak one merged
 * utterance instead of replaying each reminder separately: sort by due time,
 * deduplicate by reminder id, cap the spoken items, and add the "more" line.
 *
 * This module is pure so the ordering/prefix/cap rules stay testable without
 * React, storage, or the voice bus. The hook owns timestamps and delivery.
 */

export type DeferredReminderItem = {
  reminderId: string
  /** Due instant used for ordering; falls back to enqueue time upstream. */
  dueAt: number
  /** When the item entered the deferred queue. */
  enqueuedAt: number
  chatContent: string
  bubbleContent: string
  speechContent: string
}

export type DeferredReminderCopy = {
  /** Joined between items; includes the locale's trailing space when needed. */
  separator: string
  /** Sentence end appended once after the joined items. */
  sentenceEnd: string
  /** Prefix added once when at least one queued item waited long enough. */
  prefix: (items: string) => string
  /** Prefix text without `{items}`, used as its own chat-record line. */
  prefixLabel: string
  more: (count: number) => string
  moreOne: () => string
  /** Locale-appropriate gap before the "more" sentence. */
  moreJoiner: string
}

export type MergedDeferredReminder = {
  /** Deduplicated items in due-time order, including items beyond the cap. */
  items: DeferredReminderItem[]
  /** Items actually spoken/shown. */
  selected: DeferredReminderItem[]
  extraCount: number
  usedPrefix: boolean
  chatContent: string
  bubbleContent: string
  speechContent: string
}

export const DEFERRED_REMINDER_PREFIX_THRESHOLD_MS = 60_000
export const DEFERRED_REMINDER_MAX_ITEMS = 3

const TRAILING_ITEM_PUNCTUATION = /[。．.！!？?；;、，,\s]+$/u
const SENTENCE_ENDING = /[。．.！!？?]$/u

/**
 * Remove punctuation that belongs to the item itself so the merge can add one
 * sentence end for the whole utterance. Speech/bubble items that become empty
 * are skipped instead of keeping a punctuation-only fallback.
 */
function normalizeDeferredReminderText(value: string) {
  return value.trim().replace(TRAILING_ITEM_PUNCTUATION, '').trim()
}

/** Add the locale sentence end unless the fallback item already carries one. */
function appendSentenceEnd(text: string, sentenceEnd: string) {
  if (!text || SENTENCE_ENDING.test(text)) return text
  return `${text}${sentenceEnd}`
}

/** Speech and bubble use the title line of multi-line reminder copy. */
function firstLine(value: string) {
  return value.split(/\r?\n/u, 1)[0] ?? value
}

function compareDeferredReminders(left: DeferredReminderItem, right: DeferredReminderItem) {
  if (left.dueAt !== right.dueAt) return left.dueAt - right.dueAt
  if (left.enqueuedAt !== right.enqueuedAt) return left.enqueuedAt - right.enqueuedAt
  return left.reminderId.localeCompare(right.reminderId)
}

/** Deduplicate by reminder id, keeping the earliest due occurrence. */
export function dedupeDeferredReminders(
  items: readonly DeferredReminderItem[],
): DeferredReminderItem[] {
  const byId = new Map<string, DeferredReminderItem>()
  for (const item of items) {
    const existing = byId.get(item.reminderId)
    if (!existing || compareDeferredReminders(item, existing) < 0) {
      byId.set(item.reminderId, item)
    }
  }
  return [...byId.values()].sort(compareDeferredReminders)
}

function spokenItemText(
  item: DeferredReminderItem,
  channel: 'bubbleContent' | 'speechContent',
) {
  return normalizeDeferredReminderText(firstLine(item[channel]))
}

/** An item is speakable if either spoken surface survives punctuation stripping. */
function hasSpokenContent(item: DeferredReminderItem) {
  return Boolean(spokenItemText(item, 'speechContent'))
    || Boolean(spokenItemText(item, 'bubbleContent'))
}

function channelText(
  items: readonly DeferredReminderItem[],
  channel: 'bubbleContent' | 'speechContent',
  copy: DeferredReminderCopy,
) {
  return items
    .map((item) => spokenItemText(item, channel))
    .filter(Boolean)
    .join(copy.separator)
}

/**
 * Chat history keeps every selected reminder as its own full-text line, with
 * its original internal line breaks. The prefix and "more" sentence are also
 * separate lines; no separator, punctuation stripping, or final period.
 */
function chatText(
  items: readonly DeferredReminderItem[],
  copy: DeferredReminderCopy,
  usedPrefix: boolean,
  extraCount: number,
) {
  const lines: string[] = []
  if (usedPrefix) lines.push(copy.prefixLabel)
  for (const item of items) {
    const text = item.chatContent.trim()
    if (text) lines.push(text)
  }
  if (extraCount > 0) {
    lines.push(extraCount === 1 ? copy.moreOne() : copy.more(extraCount))
  }
  return lines.join('\n')
}

function appendMoreLine(
  text: string,
  copy: DeferredReminderCopy,
  extraCount: number,
) {
  if (extraCount <= 0) return text
  const moreLine = extraCount === 1 ? copy.moreOne() : copy.more(extraCount)
  return text ? `${text}${copy.moreJoiner}${moreLine}` : moreLine
}

/**
 * Merge queued reminders into one delivery payload.
 *
 * The prefix appears once at the start when ANY deduplicated item waited at
 * least 60 seconds (60 inclusive). Only the first three items are spoken; the
 * remaining count becomes the locale's "more" sentence.
 */
export function mergeDeferredReminders(
  items: readonly DeferredReminderItem[],
  copy: DeferredReminderCopy,
  options: {
    now?: number
    maxItems?: number
    prefixThresholdMs?: number
  } = {},
): MergedDeferredReminder | null {
  const deduped = dedupeDeferredReminders(items)
  if (deduped.length === 0) return null

  const now = options.now ?? Date.now()
  const maxItems = Math.max(1, options.maxItems ?? DEFERRED_REMINDER_MAX_ITEMS)
  const prefixThresholdMs = options.prefixThresholdMs ?? DEFERRED_REMINDER_PREFIX_THRESHOLD_MS
  // Punctuation-only/blank items are not spoken, not capped, and not counted
  // in the "more" line. Their original chat text still appears in due order.
  const speakable = deduped.filter(hasSpokenContent)
  const selected = speakable.slice(0, maxItems)
  const extraCount = Math.max(0, speakable.length - selected.length)
  const usedPrefix = deduped.some((item) => now - item.enqueuedAt >= prefixThresholdMs)
  const selectedSet = new Set(selected)
  const chatItems = deduped.filter((item) => selectedSet.has(item) || !hasSpokenContent(item))

  const buildSpokenChannel = (channel: 'bubbleContent' | 'speechContent') => {
    const joined = channelText(selected, channel, copy)
    const ended = appendSentenceEnd(joined, copy.sentenceEnd)
    const prefixed = usedPrefix ? copy.prefix(ended) : ended
    return appendMoreLine(prefixed, copy, extraCount)
  }

  return {
    items: deduped,
    selected,
    extraCount,
    usedPrefix,
    chatContent: chatText(chatItems, copy, usedPrefix, extraCount),
    bubbleContent: buildSpokenChannel('bubbleContent'),
    speechContent: buildSpokenChannel('speechContent'),
  }
}
