// @ts-check
/**
 * Durable idempotency ledger for reminder occurrences.
 *
 * A frozen/backgrounded pet renderer can resume with stale in-memory task rows
 * and a not-yet-synced localStorage cache, so a renderer-side "already
 * triggered?" check cannot stop a second delivery across processes. Main is the
 * only shared authority; `proactive:deliver` asks this ledger whether the
 * taskId + occurrence dueAt pair was already accepted.
 *
 * Entries are kept for seven days and capped per task (newest wins), which is
 * plenty for a renderer that was suspended for minutes, not months.
 */

import { createAsyncJsonFileStore } from './jsonFileStore.js'

/** File name under userData. Only the proactive IPC module reads it. */
export const REMINDER_DELIVERY_FILE_NAME = 'reminder-deliveries.json'

/** Age limit for an occurrence key. */
export const REMINDER_DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Newest N occurrence keys kept per task. */
export const REMINDER_DELIVERY_MAX_PER_TASK = 50

/**
 * @typedef {object} ReminderDeliveryEntry
 * @property {string} taskId
 * @property {number} dueAt
 * @property {number} deliveredAt
 */

/**
 * @typedef {object} ReminderDeliveryState
 * @property {1} version
 * @property {Record<string, ReminderDeliveryEntry>} entries
 */

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * @param {string} taskId
 * @param {number} dueAt
 * @returns {string}
 */
function occurrenceKey(taskId, dueAt) {
  return `${taskId}:${dueAt}`
}

/**
 * Rebuild the cache from disk. Malformed rows are dropped rather than repaired:
 * an invalid key must not make a reminder look delivered.
 *
 * @param {unknown} parsed
 * @returns {ReminderDeliveryState}
 */
function normalizeState(parsed) {
  /** @type {ReminderDeliveryState} */
  const state = { version: 1, entries: {} }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return state
  const rawEntries = /** @type {{ entries?: unknown }} */ (parsed).entries
  if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) return state
  for (const value of Object.values(rawEntries)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const record = /** @type {Record<string, unknown>} */ (value)
    const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : ''
    const dueAt = finiteNumber(record.dueAt)
    const deliveredAt = finiteNumber(record.deliveredAt)
    if (!taskId || dueAt === null || dueAt < 0 || deliveredAt === null || deliveredAt < 0) continue
    state.entries[occurrenceKey(taskId, dueAt)] = { taskId, dueAt, deliveredAt }
  }
  return state
}

/**
 * Drop expired rows, then keep only the newest `maxPerTask` rows per task.
 *
 * @param {ReminderDeliveryState} state
 * @param {number} now
 * @param {number} retentionMs
 * @param {number} maxPerTask
 */
function pruneState(state, now, retentionMs, maxPerTask) {
  /** @type {Map<string, ReminderDeliveryEntry[]>} */
  const byTask = new Map()
  for (const [key, entry] of Object.entries(state.entries)) {
    if (now - entry.deliveredAt > retentionMs) {
      delete state.entries[key]
      continue
    }
    const list = byTask.get(entry.taskId) ?? []
    list.push(entry)
    byTask.set(entry.taskId, list)
  }
  for (const entries of byTask.values()) {
    if (entries.length <= maxPerTask) continue
    entries.sort((left, right) => left.deliveredAt - right.deliveredAt)
    for (const entry of entries.slice(0, entries.length - maxPerTask)) {
      delete state.entries[occurrenceKey(entry.taskId, entry.dueAt)]
    }
  }
}

/**
 * @param {{
 *   getStorePath: () => string,
 *   now?: () => number,
 *   retentionMs?: number,
 *   maxPerTask?: number,
 *   onPersistError?: (error: unknown) => void,
 * }} deps
 */
export function createReminderDeliveryLedger({
  getStorePath,
  now = Date.now,
  retentionMs = REMINDER_DELIVERY_RETENTION_MS,
  maxPerTask = REMINDER_DELIVERY_MAX_PER_TASK,
  onPersistError = () => {},
}) {
  const store = createAsyncJsonFileStore({
    getStorePath,
    normalize: normalizeState,
    fileMode: undefined,
    onPersistError,
  })
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()

  /**
   * Serialize ledger reads/writes so concurrent IPC deliveries cannot both
   * observe a missing key.
   *
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function enqueue(task) {
    const run = queue.then(task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  async function loadPruned() {
    // ensureLoaded returns the store's cached (already normalized) object;
    // mutating it is what store.save() serializes.
    const state = /** @type {ReminderDeliveryState} */ (await store.ensureLoaded())
    pruneState(state, now(), retentionMs, maxPerTask)
    return state
  }

  return {
    /**
     * @param {string} taskId
     * @param {number} dueAt
     * @returns {Promise<boolean>}
     */
    has(taskId, dueAt) {
      return enqueue(async () => {
        const state = await loadPruned()
        return Boolean(state.entries[occurrenceKey(taskId, dueAt)])
      })
    },

    /**
     * Record an accepted occurrence. Call this only after the delivery
     * actually ran so a thrown router failure can still be retried.
     *
     * @param {string} taskId
     * @param {number} dueAt
     * @returns {Promise<void>}
     */
    record(taskId, dueAt) {
      return enqueue(async () => {
        const state = await loadPruned()
        state.entries[occurrenceKey(taskId, dueAt)] = {
          taskId,
          dueAt,
          deliveredAt: now(),
        }
        pruneState(state, now(), retentionMs, maxPerTask)
        await store.save()
      })
    },

    /** Test/diagnostic view of the pruned rows. */
    snapshot() {
      return enqueue(async () => {
        const state = await loadPruned()
        return Object.values(state.entries).map((entry) => ({ ...entry }))
      })
    },

    /** Wait for queued ledger work to settle. */
    flush() {
      return queue
    },
  }
}
