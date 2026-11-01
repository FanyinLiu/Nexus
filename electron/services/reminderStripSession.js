// @ts-check
/**
 * Queue and snooze-timer state machine for the reminder strip.
 *
 * The strip window itself is wired up in reminderStrip.js. This module owns
 * only the parts that must be testable without Electron: the queue, the fixed
 * ten-minute snooze timers, and the action -> side-effect hand-off. Timers are
 * injected so node:test can drive them with a fake clock.
 *
 * A snoozed item comes back only when the inbox entry is still `unread` at
 * the deadline. Re-delivering the same id before then cancels the pending
 * timer; withdrawing an item (done, dismissed, clear-all) cancels it too.
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
 * @property {(id: string) => boolean} isPending
 */

/**
 * @param {ReminderStripItem[]} items
 * @returns {{ items: ReminderStripItem[] }}
 */
function snapshotOf(items) {
  return { items: items.map(({ id, title, body, labels }) => ({ id, title, body, labels })) }
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
  isPending,
}) {
  /** @type {ReminderStripItem[]} */
  let queue = []
  /** @type {Map<string, unknown>} */
  const snoozeTimers = new Map()

  function snapshot() {
    return snapshotOf(queue)
  }

  function notify() {
    onQueueChange(snapshot())
  }

  /** @param {string} id */
  function clearSnooze(id) {
    const timer = snoozeTimers.get(id)
    if (timer === undefined) return
    clearTimer(timer)
    snoozeTimers.delete(id)
  }

  /**
   * @param {ReminderStripItem} item
   */
  function scheduleSnooze(item) {
    clearSnooze(item.id)
    const timer = setTimer(() => {
      snoozeTimers.delete(item.id)
      // The inbox is the source of truth: a reminder handled elsewhere must
      // not pop back up when the snooze deadline arrives.
      if (!isPending(item.id)) return
      queue = enqueueReminderStripItem(queue, item)
      notify()
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
    for (const id of [...snoozeTimers.keys()]) clearSnooze(id)
    const hadItems = queue.length > 0
    queue = []
    if (hadItems) notify()
  }

  /** Quit path: drop the queue and every timer without touching the inbox. */
  function destroy() {
    for (const timer of snoozeTimers.values()) clearTimer(timer)
    snoozeTimers.clear()
    queue = []
  }

  return { show, handleAction, withdraw, withdrawAll, destroy, snapshot }
}
