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
  separator: string,
) {
  return items
    .map((item) => item[channel].trim())
    .filter(Boolean)
    .join(separator)
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
    const joined = channelText(selected, channel, copy.separator)
    const prefixed = usedPrefix ? copy.prefix(joined) : joined
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
