/**
 * Pure view rules for the pet's inbox overlay.
 *
 * The overlay lists every inbox entry created in the last 30 days, whether or
 * not the red dot counts it. Unread entries come first (high priority first,
 * then newest); read/done entries follow newest first. Snoozed ids are hidden
 * until their timer fires, and rows stay in the DOM so the list can scroll.
 *
 * The visible window is `PROACTIVE_INBOX_OVERLAY_MAX_ROWS` rows tall, but the
 * selection keeps the full (bounded) list. Badge count and badge-worthiness
 * remain a separate, unchanged predicate.
 *
 * Nothing here touches React, the bridge or the clock, so every ordering,
 * windowing and action decision is testable without a window.
 */

import type {
  ProactiveAction,
  ProactiveInboxEntry,
  ProactiveMessage,
  ProactivePriority,
} from '../../../shared/proactiveDelivery.js'

/** Rows visible without scrolling. The list itself keeps the full selection. */
export const PROACTIVE_INBOX_OVERLAY_MAX_ROWS = 5

/** Entries older than this are not part of the overlay. */
export const PROACTIVE_INBOX_OVERLAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Upper safety bound; the main-process inbox store only keeps this many. */
export const PROACTIVE_INBOX_OVERLAY_SAFETY_LIMIT = 100

/** Entries may carry `fullBody` on a later branch; read it defensively. */
export type ProactiveInboxEntryView = ProactiveInboxEntry & { fullBody?: string }

/** Actions a row can render. `reply` reuses the same visible "open" button. */
export type ProactiveInboxRowAction = 'done' | 'snooze' | 'open' | 'reply'

export type ProactiveInboxRow = {
  id: string
  title: string
  body: string
  /** `fullBody` when present, otherwise `body`, exactly as stored. */
  fullText: string
  actions: ProactiveInboxRowAction[]
  priority: ProactivePriority
  createdAt: number
  /** Read/done rows render dimmed and hide their Done/Snooze buttons. */
  read: boolean
}

export type ProactiveInboxSelectionOptions = {
  hiddenIds?: readonly string[]
  /**
   * Reference time for the 30-day window. The controller injects its clock so
   * the boundary is testable; a missing value falls back to the real clock.
   */
  nowMs?: number
  limit?: number
}

/**
 * Whether the red dot counts this entry. This is the same predicate as
 * `countUnread` in the main-process inbox store.
 */
export function isProactiveInboxEntryBadgeWorthy(
  entry: Pick<ProactiveInboxEntry, 'status' | 'actions' | 'priority'>,
): boolean {
  if (entry.status !== 'unread') return false
  return Array.isArray(entry.actions) && entry.actions.length > 0
    ? true
    : entry.priority === 'high'
}

function priorityRank(priority: ProactivePriority): number {
  if (priority === 'high') return 0
  if (priority === 'low') return 2
  return 1
}

/**
 * Pick and order the rows the overlay renders.
 *
 * Every entry inside the 30-day window is listed, not only the ones the badge
 * counts. Unread rows come first with high priority ahead of normal/low, then
 * newest first; read/done rows follow, newest first. `hiddenIds` always wins,
 * including for a snoozed row that is still expanded. Ties on `createdAt` fall
 * back to id so the order is deterministic in tests and in the window.
 */
export function selectProactiveInboxEntries(
  entries: readonly ProactiveInboxEntryView[],
  {
    hiddenIds = [],
    nowMs = Date.now(),
    limit = PROACTIVE_INBOX_OVERLAY_SAFETY_LIMIT,
  }: ProactiveInboxSelectionOptions = {},
): ProactiveInboxEntryView[] {
  const hidden = new Set(hiddenIds)
  const oldestVisible = nowMs - PROACTIVE_INBOX_OVERLAY_WINDOW_MS
  return entries
    .filter((entry) => {
      if (hidden.has(entry.id)) return false
      return entry.createdAt >= oldestVisible
    })
    .slice()
    .sort((left, right) => {
      const leftUnread = left.status === 'unread'
      const rightUnread = right.status === 'unread'
      if (leftUnread !== rightUnread) return leftUnread ? -1 : 1
      if (leftUnread) {
        const rank = priorityRank(left.priority) - priorityRank(right.priority)
        if (rank !== 0) return rank
      }
      return right.createdAt - left.createdAt || left.id.localeCompare(right.id)
    })
    .slice(0, Math.max(0, limit))
}

/** The expanded text an expanded row shows. `fullBody` may be absent on this branch. */
export function proactiveInboxFullText(entry: ProactiveInboxEntryView): string {
  return typeof entry.fullBody === 'string' && entry.fullBody.length > 0
    ? entry.fullBody
    : entry.body
}

/** Escape is the only key that dismisses the popover; every action is a button. */
export function isProactiveInboxDismissKey(key: string): boolean {
  return key === 'Escape'
}

/**
 * The entry's own actions, in the stored order, with `open`/`reply` collapsed
 * to one visible button so a message carrying both cannot render two copies.
 */
export function proactiveInboxRowActions(
  entry: Pick<ProactiveInboxEntry, 'actions'>,
): ProactiveInboxRowAction[] {
  const stored = Array.isArray(entry.actions) ? entry.actions : []
  const seen = new Set<ProactiveInboxRowAction>()
  const result: ProactiveInboxRowAction[] = []
  for (const action of ['done', 'snooze', 'open', 'reply'] as const) {
    if (!stored.includes(action)) continue
    const visible = action === 'reply' ? 'open' : action
    if (seen.has(visible)) continue
    seen.add(visible)
    result.push(action)
  }
  return result
}

/** Turn a stored entry into the immutable shape the popover renders. */
export function toProactiveInboxRow(entry: ProactiveInboxEntryView): ProactiveInboxRow {
  return {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    fullText: proactiveInboxFullText(entry),
    actions: proactiveInboxRowActions(entry),
    priority: entry.priority,
    createdAt: entry.createdAt,
    read: entry.status !== 'unread',
  }
}

/**
 * Buttons a row may show. Read rows keep the conversation opener but cannot be
 * completed or snoozed again.
 */
export function proactiveInboxVisibleRowActions(row: Pick<ProactiveInboxRow, 'actions' | 'read'>): ProactiveInboxRowAction[] {
  if (!row.read) return row.actions
  return row.actions.filter((action) => action === 'open' || action === 'reply')
}

/**
 * Rebuild the router message for a snooze re-delivery.
 *
 * Only `ProactiveMessage` fields cross back through the router: the inbox
 * bookkeeping (`status`, `updatedAt`) and the later `fullBody` field stay in
 * the renderer. Copying the action list keeps the message's own buttons.
 */
export function proactiveMessageFromInboxEntry(entry: ProactiveInboxEntryView): ProactiveMessage {
  return {
    id: entry.id,
    source: entry.source,
    kind: entry.kind,
    priority: entry.priority,
    title: entry.title,
    body: entry.body,
    ...(typeof entry.speech === 'string' && entry.speech ? { speech: entry.speech } : {}),
    actions: Array.isArray(entry.actions)
      ? (entry.actions.filter((action): action is ProactiveAction => (
        action === 'done' || action === 'snooze' || action === 'open' || action === 'reply'
      )))
      : [],
    createdAt: entry.createdAt,
    ...(typeof entry.expiresAt === 'number' ? { expiresAt: entry.expiresAt } : {}),
    ...(entry.origin ? { origin: { ...entry.origin } } : {}),
  }
}
