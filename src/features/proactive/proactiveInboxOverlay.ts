/**
 * Pure view rules for the pet's notebook (the former inbox overlay).
 *
 * The notebook lists every entry noted in the last 15 days. Rows are grouped
 * so anything that still needs a decision comes first: actionable unhandled
 * lines, other unseen lines, then seen-but-unhandled lines; handled lines sit
 * under the "noted earlier" divider. Groups 0-2 sort high priority first and
 * newest; handled rows sort newest first. Snoozed ids stay hidden, and rows
 * remain in the DOM so the list can scroll.
 *
 * The visible window is `PROACTIVE_INBOX_OVERLAY_MAX_ROWS` rows tall, but the
 * selection keeps the full (bounded) list. "Seen" (`read`/`done`/`dismissed`)
 * and "handled" (`done`/`dismissed`) are separate layers, so a letter can be
 * seen without being opened. There is no red dot in the notebook.
 *
 * Nothing here touches React, the bridge or the clock, so every ordering,
 * windowing and action decision is testable without a window.
 */

import type {
  ProactiveAction,
  ProactiveInboxEntry,
  ProactiveInboxStatus,
  ProactiveMessage,
  ProactivePriority,
} from '../../../shared/proactiveDelivery.js'
import { isProactiveLetterEntry } from '../../../shared/proactiveInboxReadRule.js'
import { isSameLocalDay } from '../../lib/localDate.ts'

/** Rows visible without scrolling. The list itself keeps the full selection. */
export const PROACTIVE_INBOX_OVERLAY_MAX_ROWS = 3

/** Entries older than this are not part of the notebook. */
export const PROACTIVE_INBOX_OVERLAY_WINDOW_MS = 15 * 24 * 60 * 60 * 1000

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
  /** Stored status, so the row can expose it without inventing an unread marker. */
  status: ProactiveInboxStatus
  /** `unread` only: the user has never seen this line. */
  unseen: boolean
  /** Done/dismissed rows render dimmed and hide their Done/Snooze buttons. */
  handled: boolean
  /** Alias of `handled`, kept for callers that predate the seen/handled split. */
  read: boolean
  /** Letter rows speak their fixed line instead of their private title. */
  letter: boolean
}

export type ProactiveInboxSelectionOptions = {
  hiddenIds?: readonly string[]
  /**
   * Reference time for the 15-day window. The controller injects its clock so
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

function hasActions(entry: Pick<ProactiveInboxEntry, 'actions'>): boolean {
  return Array.isArray(entry.actions) && entry.actions.length > 0
}

/**
 * Notebook section for one entry: 0 actionable and unhandled, 1 other unseen,
 * 2 seen but unhandled, 3 handled. Actionable lines lead because they are the
 * things that still wait on the user; a seen line with buttons still needs a
 * decision. The order is the rendering order.
 */
function notebookGroup(
  entry: Pick<ProactiveInboxEntry, 'status' | 'actions'>,
): number {
  if (entry.status === 'done' || entry.status === 'dismissed') return 3
  if (hasActions(entry)) return 0
  return entry.status === 'unread' ? 1 : 2
}

/**
 * Pick and order the rows the notebook renders.
 *
 * Every entry inside the 15-day window is listed. Actionable unhandled lines
 * lead, then other unseen lines, then seen-but-unhandled lines; groups 0-2 put
 * high priority ahead of normal/low and then newest first. Handled rows follow
 * newest first. `hiddenIds` always wins, including for a snoozed row that is
 * still expanded. Ties on `createdAt` fall back to id so the order is
 * deterministic in tests and in the window.
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
      const leftGroup = notebookGroup(left)
      const group = leftGroup - notebookGroup(right)
      if (group !== 0) return group
      if (leftGroup < 3) {
        const rank = priorityRank(left.priority) - priorityRank(right.priority)
        if (rank !== 0) return rank
      }
      return right.createdAt - left.createdAt || left.id.localeCompare(right.id)
    })
    .slice(0, Math.max(0, limit))
}

/**
 * Index where the "noted earlier" divider belongs: the first handled row, but only
 * when at least one unhandled row sits above it. `-1` means no divider, either
 * because everything is still unhandled or because everything is handled (a
 * divider at the very top would label nothing).
 */
export function proactiveNotebookDividerIndex(
  rows: readonly Pick<ProactiveInboxRow, 'handled'>[],
): number {
  const index = rows.findIndex((row) => row.handled)
  return index > 0 ? index : -1
}

/**
 * Notebook timestamp label: local clock time for today, the caller's
 * yesterday word for the previous calendar day, and `M/D` for anything older.
 * Built from `Date` getters so no locale or `Intl` data can change the shape.
 */
export function formatProactiveNotebookTime(
  createdAt: number,
  nowMs: number,
  yesterdayLabel: string,
): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.valueOf())) return ''
  if (isSameLocalDay(createdAt, nowMs)) {
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  }
  const now = new Date(nowMs)
  const yesterdayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  if (isSameLocalDay(createdAt, yesterdayMs)) return yesterdayLabel
  return `${date.getMonth() + 1}/${date.getDate()}`
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

/** Turn a stored entry into the immutable shape the notebook renders. */
export function toProactiveInboxRow(entry: ProactiveInboxEntryView): ProactiveInboxRow {
  const handled = entry.status === 'done' || entry.status === 'dismissed'
  return {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    fullText: proactiveInboxFullText(entry),
    actions: proactiveInboxRowActions(entry),
    priority: entry.priority,
    createdAt: entry.createdAt,
    status: entry.status,
    unseen: entry.status === 'unread',
    // A seen line is not handled: it still shows every button, so it can
    // become done. Only done/dismissed rows are dimmed and lose buttons.
    handled,
    read: handled,
    letter: isProactiveLetterEntry(entry),
  }
}

/**
 * Buttons a row may show. Done/dismissed rows keep the conversation opener but
 * cannot be completed or snoozed again.
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
