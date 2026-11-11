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
 * sentence end for the whole utterance. A punctuation-only item falls back to
 * its trimmed source instead of becoming an empty slot.
 */
function normalizeDeferredReminderText(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const stripped = trimmed.replace(TRAILING_ITEM_PUNCTUATION, '').trim()
  return stripped || trimmed
}

/** Add the locale sentence end unless the fallback item already carries one. */
function appendSentenceEnd(text: string, sentenceEnd: string) {
  if (!text || SENTENCE_ENDING.test(text)) return text
  return `${text}${sentenceEnd}`
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

function channelText(
  items: readonly DeferredReminderItem[],
  channel: 'chatContent' | 'bubbleContent' | 'speechContent',
  copy: DeferredReminderCopy,
) {
  return items
    .map((item) => normalizeDeferredReminderText(item[channel]))
    .filter(Boolean)
    .join(copy.separator)
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
  const selected = deduped.slice(0, maxItems)
  const extraCount = Math.max(0, deduped.length - selected.length)
  const usedPrefix = deduped.some((item) => now - item.enqueuedAt >= prefixThresholdMs)

  const buildChannel = (channel: 'chatContent' | 'bubbleContent' | 'speechContent') => {
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
    chatContent: buildChannel('chatContent'),
    bubbleContent: buildChannel('bubbleContent'),
    speechContent: buildChannel('speechContent'),
  }
}
