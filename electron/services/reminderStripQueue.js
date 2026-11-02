// @ts-check
/**
 * Pure queue and placement rules for the reminder strip.
 *
 * The strip is the small, non-focus-stealing window that shows a due
 * reminder next to the desktop pet. It must stay out of the way: one row,
 * a short queue, and a position that hugs the pet instead of the middle of
 * the screen. Everything here is side-effect free so it can be unit tested
 * without Electron.
 */

export const REMINDER_STRIP_WIDTH = 340
export const REMINDER_STRIP_HEIGHT = 64
export const REMINDER_STRIP_MARGIN_PX = 16
export const REMINDER_STRIP_PET_GAP_PX = 8
export const REMINDER_STRIP_MAX_ITEMS = 5
export const REMINDER_STRIP_SNOOZE_MS = 10 * 60_000

const TITLE_MAX_LENGTH = 80
const BODY_MAX_LENGTH = 160
const LABEL_MAX_LENGTH = 24
const ID_MAX_LENGTH = 128

/**
 * Every action the strip page may send. `expire` is the collapse timer, not an
 * item control, so it is accepted by the session but never offered by an item.
 * @type {ReadonlySet<string>}
 */
export const REMINDER_STRIP_ACTIONS = Object.freeze(
  new Set(['done', 'snooze', 'open', 'reply', 'expire']),
)

/** Actions an item may offer, in the order the payload listed them. */
const REMINDER_STRIP_ITEM_ACTIONS = Object.freeze(new Set(['done', 'snooze', 'open', 'reply']))

/** Legacy payloads without `actions` keep the original three controls. */
const DEFAULT_STRIP_ACTIONS = Object.freeze(['done', 'snooze', 'open'])

/**
 * @typedef {{ done: string, snooze: string, open: string }} ReminderStripLabels
 * @typedef {{ id: string, title: string, body: string, labels: ReminderStripLabels, actions: string[] }} ReminderStripItem
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/** @type {ReminderStripLabels} */
const DEFAULT_LABELS = Object.freeze({ done: 'Done', snooze: 'Later', open: 'Open' })

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return ''
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return `${singleLine.slice(0, maxLength - 1)}…`
}

/**
 * @param {unknown} value
 * @returns {ReminderStripLabels}
 */
function normalizeLabels(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {}
  return {
    done: cleanText(source.done, LABEL_MAX_LENGTH) || DEFAULT_LABELS.done,
    snooze: cleanText(source.snooze, LABEL_MAX_LENGTH) || DEFAULT_LABELS.snooze,
    open: cleanText(source.open, LABEL_MAX_LENGTH) || DEFAULT_LABELS.open,
  }
}

/**
 * Keep only item actions the page can render, in payload order and without
 * duplicates. Only a payload with no `actions` field at all keeps the legacy
 * reminder layout; an explicitly empty or malformed list means "no controls".
 * @param {unknown} value
 * @param {boolean} hasActions
 * @returns {string[]}
 */
function normalizeActions(value, hasActions) {
  if (!hasActions) return [...DEFAULT_STRIP_ACTIONS]
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const actions = []
  for (const action of value) {
    if (typeof action !== 'string') continue
    if (!REMINDER_STRIP_ITEM_ACTIONS.has(action)) continue
    if (seen.has(action)) continue
    seen.add(action)
    actions.push(action)
  }
  return actions
}

/**
 * Turn an untrusted renderer payload into a strip item, or null when it
 * carries nothing worth showing.
 * @param {unknown} payload
 * @returns {ReminderStripItem | null}
 */
export function normalizeReminderStripPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const source = /** @type {Record<string, unknown>} */ (payload)
  const id = cleanText(source.id, ID_MAX_LENGTH)
  const title = cleanText(source.title, TITLE_MAX_LENGTH)
  const body = cleanText(source.body, BODY_MAX_LENGTH)
  if (!id || (!title && !body)) return null
  return {
    id,
    title,
    body,
    labels: normalizeLabels(source.labels),
    actions: normalizeActions(
      source.actions,
      Object.prototype.hasOwnProperty.call(source, 'actions'),
    ),
  }
}

/**
 * Add an item to the end of the queue. A reminder that is already queued
 * moves to the end instead of showing twice; the oldest items fall off once
 * the queue is full.
 * @param {readonly ReminderStripItem[]} items
 * @param {ReminderStripItem} item
 * @returns {ReminderStripItem[]}
 */
export function enqueueReminderStripItem(items, item) {
  const next = items.filter((existing) => existing.id !== item.id)
  next.push(item)
  return next.length > REMINDER_STRIP_MAX_ITEMS
    ? next.slice(next.length - REMINDER_STRIP_MAX_ITEMS)
    : next
}

/**
 * @param {readonly ReminderStripItem[]} items
 * @param {string} id
 * @returns {{ items: ReminderStripItem[], removed: ReminderStripItem | null }}
 */
export function removeReminderStripItem(items, id) {
  const removed = items.find((item) => item.id === id) ?? null
  return { items: items.filter((item) => item.id !== id), removed }
}

/**
 * @param {unknown} payload
 * @returns {{ id: string, action: string } | null}
 */
export function normalizeReminderStripAction(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const source = /** @type {Record<string, unknown>} */ (payload)
  const id = cleanText(source.id, ID_MAX_LENGTH)
  const action = typeof source.action === 'string' ? source.action : ''
  if (!id || !REMINDER_STRIP_ACTIONS.has(action)) return null
  return { id, action }
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * @param {Rect} rect
 * @param {Rect} area
 */
function intersects(rect, area) {
  return rect.x < area.x + area.width
    && rect.x + rect.width > area.x
    && rect.y < area.y + area.height
    && rect.y + rect.height > area.y
}

/**
 * Where the strip goes: right-aligned just above the pet when the pet is on
 * this display, below it when there is no room above, otherwise the
 * bottom-right corner of the work area. Always clamped inside the work area.
 * @param {{ workArea: Rect, anchor?: Rect | null, width?: number, height?: number }} input
 * @returns {{ x: number, y: number }}
 */
export function computeReminderStripPosition({
  workArea,
  anchor = null,
  width = REMINDER_STRIP_WIDTH,
  height = REMINDER_STRIP_HEIGHT,
}) {
  const minX = workArea.x + REMINDER_STRIP_MARGIN_PX
  const maxX = workArea.x + workArea.width - width - REMINDER_STRIP_MARGIN_PX
  const minY = workArea.y + REMINDER_STRIP_MARGIN_PX
  const maxY = workArea.y + workArea.height - height - REMINDER_STRIP_MARGIN_PX

  if (anchor && intersects(anchor, workArea)) {
    const x = anchor.x + anchor.width - width
    const above = anchor.y - height - REMINDER_STRIP_PET_GAP_PX
    const y = above >= minY ? above : anchor.y + anchor.height + REMINDER_STRIP_PET_GAP_PX
    return { x: Math.round(clamp(x, minX, maxX)), y: Math.round(clamp(y, minY, maxY)) }
  }

  return { x: Math.round(maxX), y: Math.round(maxY) }
}
