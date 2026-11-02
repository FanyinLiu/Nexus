// @ts-check
/**
 * Queue and snooze-timer state machine for the reminder strip.
 *
 * The strip window itself is wired up in reminderStrip.js. This module owns
 * only the parts that must be testable without Electron: the queue, the fixed
 * ten-minute snooze timers, and the action -> side-effect hand-off. Timers are
 * injected so node:test can drive them with a fake clock.
 *
 * A snoozed item comes back only when `canReshow` allows it at the deadline.
 * The caller re-routes the stored inbox message there, so a fullscreen or
 * quiet-hours decision can drop it from the strip without touching the inbox.
 * Re-delivering the same id before then cancels the pending check; withdrawing
 * an item (done, dismissed, clear-all) cancels it too, even while an async
 * `canReshow` is still in flight.
 */

import {
  enqueueReminderStripItem,
  normalizeReminderStripAction,
  normalizeReminderStripPayload,
  removeReminderStripItem,
} from './reminderStripQueue.js'

/** @typedef {import('./reminderStripQueue.js').ReminderStripItem} ReminderStripItem */

/**
 * @typedef {object} ReminderStripSessionDependencies
 * @property {(callback: () => void, ms: number) => unknown} setTimer
 * @property {(timer: unknown) => void} clearTimer
 * @property {number} snoozeMs
 * @property {(snapshot: { items: ReminderStripItem[] }) => void} onQueueChange
 * @property {(action: string, item: ReminderStripItem) => void} onAction
 * @property {(id: string) => boolean | Promise<boolean>} canReshow
 */

/**
 * @param {ReminderStripItem[]} items
 * @returns {{ items: ReminderStripItem[] }}
 */
function snapshotOf(items) {
  return {
    items: items.map(({ id, title, body, labels, actions }) => ({
      id,
      title,
      body,
      labels,
      actions: [...actions],
    })),
  }
}

/**
 * @param {ReminderStripSessionDependencies} dependencies
 */
export function createReminderStripSession({
  setTimer,
  clearTimer,
  snoozeMs,
  onQueueChange,
  onAction,
  canReshow,
}) {
  /** @type {ReminderStripItem[]} */
  let queue = []
  /** @type {Map<string, unknown>} */
  const snoozeTimers = new Map()
  /**
   * One token per scheduled snooze. The token outlives the timer handle while
   * the async check runs, so withdraw/re-show can invalidate it and a slow
   * decision can never queue the item twice.
   * @type {Map<string, object>}
   */
  const snoozeTokens = new Map()

  function snapshot() {
    return snapshotOf(queue)
  }

  function notify() {
    onQueueChange(snapshot())
  }

  /** @param {string} id */
  function clearSnooze(id) {
    const timer = snoozeTimers.get(id)
    if (timer !== undefined) {
      clearTimer(timer)
      snoozeTimers.delete(id)
    }
    // Always drop the token, even when the timer already fired: that is what
    // invalidates a canReshow promise still waiting to resolve.
    snoozeTokens.delete(id)
  }

  /**
   * @param {ReminderStripItem} item
   */
  function scheduleSnooze(item) {
    clearSnooze(item.id)
    const token = {}
    snoozeTokens.set(item.id, token)
    const timer = setTimer(() => {
      snoozeTimers.delete(item.id)
      if (snoozeTokens.get(item.id) !== token) return
      void (async () => {
        let allowed
        try {
          allowed = await canReshow(item.id)
        } catch {
          // The caller owns logging; a failed re-route simply keeps the item
          // off the strip and leaves the inbox entry untouched.
          allowed = false
        }
        if (!allowed) {
          if (snoozeTokens.get(item.id) === token) snoozeTokens.delete(item.id)
          return
        }
        // Withdrawing or re-showing the same id while the check ran replaced
        // the token; never queue over that newer state.
        if (snoozeTokens.get(item.id) !== token) return
        snoozeTokens.delete(item.id)
        queue = enqueueReminderStripItem(queue, item)
        notify()
      })()
    }, snoozeMs)
    snoozeTimers.set(item.id, timer)
  }

  /**
   * Queue one reminder. A repeated id replaces its old entry and cancels any
   * pending snooze so the same reminder can never be queued twice.
   * @param {unknown} payload
   * @returns {boolean}
   */
  function show(payload) {
    const item = normalizeReminderStripPayload(payload)
    if (!item) return false
    clearSnooze(item.id)
    queue = enqueueReminderStripItem(queue, item)
    notify()
    return true
  }

  /**
   * Apply one click from the strip page.
   * @param {unknown} payload
   * @returns {{ ok: boolean }}
   */
  function handleAction(payload) {
    const request = normalizeReminderStripAction(payload)
    if (!request) return { ok: false }
    const { items, removed } = removeReminderStripItem(queue, request.id)
    if (!removed) return { ok: false }
    // The page renders one control per offered action, but a stale click can
    // still arrive after the item changed. `expire` is the collapse timer and
    // is always allowed; everything else must be listed by the item.
    if (request.action !== 'expire' && !removed.actions.includes(request.action)) {
      return { ok: false }
    }
    queue = items
    if (request.action === 'snooze') scheduleSnooze(removed)
    else clearSnooze(removed.id)
    onAction(request.action, removed)
    notify()
    return { ok: true }
  }

  /**
   * Drop an id without re-queueing it. Used when the inbox says the entry is
   * done or dismissed, or when retention removed it.
   * @param {string} id
   * @returns {boolean}
   */
  function withdraw(id) {
    clearSnooze(id)
    const { items, removed } = removeReminderStripItem(queue, id)
    if (!removed) return false
    queue = items
    notify()
    return true
  }

  /** Drop every item and cancel every pending snooze (inbox clear-all). */
  function withdrawAll() {
    for (const id of new Set([...snoozeTimers.keys(), ...snoozeTokens.keys()])) clearSnooze(id)
    const hadItems = queue.length > 0
    queue = []
    if (hadItems) notify()
  }

  /** Quit path: drop the queue and every timer without touching the inbox. */
  function destroy() {
    for (const timer of snoozeTimers.values()) clearTimer(timer)
    snoozeTimers.clear()
    snoozeTokens.clear()
    queue = []
  }

  return { show, handleAction, withdraw, withdrawAll, destroy, snapshot }
}
