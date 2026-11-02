/**
 * Pure view rules for the pet's inbox overlay.
 *
 * The overlay shows the same entries the red dot counts (status `unread` and
 * either actions or high priority), high priority first and then newest first.
 * A row that was expanded and marked read by the read rule is kept visible by
 * the controller through `keepIds`; hidden ids are snoozed rows that must not
 * reappear before their timer fires.
 *
 * Nothing here touches React, the bridge or the clock, so every ordering,
 * clipping and action decision is testable without a window.
 */

import type {
  ProactiveAction,
  ProactiveInboxEntry,
  ProactiveMessage,
  ProactivePriority,
} from '../../../shared/proactiveDelivery.js'

/** Maximum rows in one overlay. A pinned expanded row still counts. */
export const PROACTIVE_INBOX_OVERLAY_MAX_ROWS = 5

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
}

export type ProactiveInboxSelectionOptions = {
  hiddenIds?: readonly string[]
  /** Expanded entries stay visible even after the read rule marks them done. */
  keepIds?: readonly string[]
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
 * `hiddenIds` wins over `keepIds`: a snoozed row is hidden even if a stale
 * expansion still names it. Ties on `createdAt` fall back to id so the order
 * is deterministic in tests and in the window.
 */
export function selectProactiveInboxEntries(
  entries: readonly ProactiveInboxEntryView[],
  {
    hiddenIds = [],
    keepIds = [],
    limit = PROACTIVE_INBOX_OVERLAY_MAX_ROWS,
  }: ProactiveInboxSelectionOptions = {},
): ProactiveInboxEntryView[] {
  const hidden = new Set(hiddenIds)
  const keep = new Set(keepIds)
  return entries
    .filter((entry) => {
      if (hidden.has(entry.id)) return false
      return keep.has(entry.id) || isProactiveInboxEntryBadgeWorthy(entry)
    })
    .slice()
    .sort((left, right) => (
      priorityRank(left.priority) - priorityRank(right.priority)
      || right.createdAt - left.createdAt
      || left.id.localeCompare(right.id)
    ))
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
  }
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
