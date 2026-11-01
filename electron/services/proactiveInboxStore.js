// @ts-check
/**
 * Persistent inbox for proactive messages.
 *
 * The inbox is the durable record behind the pet's red dot: every routed
 * message lands here, including the ones that were only allowed to show a
 * quiet dot. Entries are deduped by message id, kept for 30 days and capped at
 * 100, and pruning runs both on load and on every write so a stale file cannot
 * resurrect an expired reminder.
 *
 * The count that drives the dot deliberately ignores companionship lines
 * (no actions, not high priority) so the dot is not permanently lit.
 */

import {
  PROACTIVE_ACTIONS,
  PROACTIVE_BODY_MAX_LENGTH,
  PROACTIVE_INBOX_STATUSES,
  PROACTIVE_PRIORITIES,
  PROACTIVE_SOURCES,
  PROACTIVE_TITLE_MAX_LENGTH,
} from '../../shared/proactiveDelivery.js'
import { createSyncJsonFileStore } from './jsonFileStore.js'

/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveInboxEntry} ProactiveInboxEntry */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveInboxStatus} ProactiveInboxStatus */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveMessage} ProactiveMessage */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveInboxSnapshot} ProactiveInboxSnapshot */

/** File name under userData. The inbox IPC module is the only reader. */
export const PROACTIVE_INBOX_FILE_NAME = 'proactive-inbox.json'

/** Hard cap; the oldest entries by createdAt are dropped first. */
export const PROACTIVE_INBOX_MAX_ENTRIES = 100

/** Age limit. An entry exactly this old is still kept. */
export const PROACTIVE_INBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * What one mutation changed, so the caller can push a matching renderer event.
 *
 * @typedef {object} InboxMutation
 * @property {boolean} changed
 * @property {ProactiveInboxEntry[]} entries
 * @property {string[]} removedIds
 * @property {number} unreadCount
 */

/** @type {Array<'taskId' | 'letterId' | 'capsuleId' | 'arcId'>} */
const ORIGIN_KEYS = ['taskId', 'letterId', 'capsuleId', 'arcId']

/** @type {Set<string>} */
const VALID_STATUSES = new Set(PROACTIVE_INBOX_STATUSES)
/** @type {Set<string>} */
const VALID_SOURCES = new Set(PROACTIVE_SOURCES)
/** @type {Set<string>} */
const VALID_PRIORITIES = new Set(PROACTIVE_PRIORITIES)
/** @type {Set<string>} */
const VALID_ACTIONS = new Set(PROACTIVE_ACTIONS)

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Keep the four known origin ids and drop everything else. Anything else in a
 * hand-edited file is not a contract the inbox knows how to render.
 * @param {unknown} value
 * @returns {ProactiveInboxEntry['origin'] | undefined}
 */
function normalizeOrigin(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = /** @type {Record<string, unknown>} */ (value)
  /** @type {{ taskId?: string, letterId?: string, capsuleId?: string, arcId?: string }} */
  const origin = {}
  for (const key of ORIGIN_KEYS) {
    const id = record[key]
    if (typeof id === 'string' && id.trim()) origin[key] = id
  }
  return Object.keys(origin).length > 0 ? origin : undefined
}

/**
 * Rebuild one entry from disk. Anything structurally unusable is dropped:
 * a corrupt record must not keep the dot alive or throw on startup.
 *
 * @param {unknown} value
 * @returns {ProactiveInboxEntry | null}
 */
function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = /** @type {Record<string, unknown>} */ (value)

  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const kind = typeof record.kind === 'string' ? record.kind.trim() : ''
  const title = typeof record.title === 'string' ? record.title : ''
  const body = typeof record.body === 'string' ? record.body : ''
  const createdAt = finiteNumber(record.createdAt)
  const source = typeof record.source === 'string' ? record.source : ''
  if (
    !id
    || !kind
    || !title
    || title.length > PROACTIVE_TITLE_MAX_LENGTH
    || body.length > PROACTIVE_BODY_MAX_LENGTH
    || createdAt === null
    || !VALID_SOURCES.has(source)
  ) {
    return null
  }

  const status = typeof record.status === 'string' ? record.status : ''
  if (!VALID_STATUSES.has(status)) return null

  const priority = typeof record.priority === 'string' && VALID_PRIORITIES.has(record.priority)
    ? /** @type {ProactiveInboxEntry['priority']} */ (record.priority)
    : 'normal'
  const actions = Array.isArray(record.actions)
    ? record.actions.filter((action) => typeof action === 'string' && VALID_ACTIONS.has(action))
    : []
  const speech = typeof record.speech === 'string' && record.speech.trim() ? record.speech : undefined
  const expiresAt = finiteNumber(record.expiresAt)
  const origin = normalizeOrigin(record.origin)

  return {
    id,
    source: /** @type {ProactiveInboxEntry['source']} */ (source),
    kind,
    priority,
    title,
    body,
    ...(speech !== undefined ? { speech } : {}),
    actions: /** @type {ProactiveInboxEntry['actions']} */ (actions),
    createdAt,
    ...(expiresAt !== null ? { expiresAt } : {}),
    ...(origin !== undefined ? { origin } : {}),
    status: /** @type {ProactiveInboxStatus} */ (status),
    updatedAt: finiteNumber(record.updatedAt) ?? createdAt,
  }
}

/**
 * Apply both retention rules. Age is inclusive at the boundary: an entry that
 * is exactly 30 days old is still inside the window.
 *
 * @param {ProactiveInboxEntry[]} entries
 * @param {number} nowMs
 * @returns {{ kept: ProactiveInboxEntry[], removed: ProactiveInboxEntry[] }}
 */
function pruneEntries(entries, nowMs) {
  /** @type {ProactiveInboxEntry[]} */
  const kept = []
  /** @type {ProactiveInboxEntry[]} */
  const removed = []

  for (const entry of entries) {
    const tooOld = nowMs - entry.createdAt > PROACTIVE_INBOX_RETENTION_MS
    const expired = typeof entry.expiresAt === 'number' && entry.expiresAt <= nowMs
    if (tooOld || expired) removed.push(entry)
    else kept.push(entry)
  }

  kept.sort((left, right) => right.createdAt - left.createdAt)
  if (kept.length > PROACTIVE_INBOX_MAX_ENTRIES) {
    removed.push(...kept.splice(PROACTIVE_INBOX_MAX_ENTRIES))
  }

  return { kept, removed }
}

/**
 * @param {unknown} parsed
 * @param {number} nowMs
 * @returns {{ entries: ProactiveInboxEntry[] }}
 */
function normalizeInbox(parsed, nowMs) {
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? /** @type {Record<string, unknown>} */ (parsed)
    : {}
  const rawEntries = Array.isArray(record.entries) ? record.entries : []
  const entries = rawEntries
    .map((entry) => normalizeEntry(entry))
    .filter((entry) => entry !== null)
  return { entries: pruneEntries(entries, nowMs).kept }
}

/**
 * The count the pet's red dot shows. Companionship lines (no actions and not
 * high priority) stay in the inbox but never light the dot.
 *
 * @param {ProactiveInboxEntry[]} entries
 * @returns {number}
 */
function countUnread(entries) {
  return entries.filter((entry) => (
    entry.status === 'unread' && (entry.actions.length > 0 || entry.priority === 'high')
  )).length
}

/**
 * @param {{
 *   getStorePath: () => string,
 *   now?: () => number,
 *   debounceMs?: number,
 *   onPersistError?: () => void,
 * }} dependencies
 */
export function createProactiveInboxStore({
  getStorePath,
  now = () => Date.now(),
  debounceMs,
  onPersistError,
}) {
  const store = createSyncJsonFileStore({
    getStorePath,
    normalize: (/** @type {unknown} */ parsed) => normalizeInbox(parsed, now()),
    ...(debounceMs !== undefined ? { debounceMs } : {}),
    ...(onPersistError !== undefined ? { onPersistError } : {}),
  })

  /** @returns {{ entries: ProactiveInboxEntry[] }} */
  function loadCache() {
    return /** @type {{ entries: ProactiveInboxEntry[] }} */ (store.load())
  }

  /**
   * Whole inbox, newest first. Read-time pruning keeps the count honest even
   * when nothing has been written since the last entry expired; the pruned
   * state reaches disk with the next write. `removedIds` lets the caller push
   * a matching `inbox:changed` so a badge updated only by pushes cannot stay
   * stale after entries age out.
   * @returns {ProactiveInboxSnapshot}
   */
  function list() {
    const cache = loadCache()
    const { kept, removed } = pruneEntries(cache.entries, now())
    if (removed.length > 0) {
      cache.entries = kept
    }
    return {
      entries: kept.map((entry) => ({ ...entry })),
      unreadCount: countUnread(kept),
      removedIds: removed.map((entry) => entry.id),
    }
  }

  /**
   * Apply the retention rules for the periodic main-process sweep. Removals
   * are persisted and reported with the same mutation shape as an upsert, so
   * the caller can publish one `inbox:changed` either way.
   * @returns {InboxMutation}
   */
  function prune() {
    const cache = loadCache()
    const { kept, removed } = pruneEntries(cache.entries, now())
    if (removed.length > 0) {
      cache.entries = kept
      store.persistDebounced()
    }
    return {
      changed: removed.length > 0,
      entries: [],
      removedIds: removed.map((entry) => entry.id),
      unreadCount: countUnread(kept),
    }
  }

  /**
   * Insert or update one message. Re-delivery keeps the existing status: the
   * id is the dedupe key, and resurrecting an entry the user already handled
   * would defeat it.
   * @param {ProactiveMessage} message
   * @returns {InboxMutation}
   */
  function upsert(message) {
    const nowMs = now()
    const cache = loadCache()
    const existing = cache.entries.find((entry) => entry.id === message.id)
    /** @type {ProactiveInboxEntry} */
    const next = {
      ...message,
      status: existing?.status ?? 'unread',
      updatedAt: nowMs,
    }
    const others = cache.entries.filter((entry) => entry.id !== message.id)
    const { kept, removed } = pruneEntries([next, ...others], nowMs)
    cache.entries = kept
    store.persistDebounced()

    const entries = kept.filter((entry) => entry.id === next.id)
    return {
      changed: entries.length > 0 || removed.length > 0,
      entries,
      removedIds: removed.map((entry) => entry.id),
      unreadCount: countUnread(kept),
    }
  }

  /**
   * @param {string} id
   * @param {ProactiveInboxStatus} status
   * @returns {InboxMutation}
   */
  function setStatus(id, status) {
    const nowMs = now()
    const cache = loadCache()
    if (!cache.entries.some((entry) => entry.id === id)) {
      return { changed: false, entries: [], removedIds: [], unreadCount: countUnread(cache.entries) }
    }

    const updated = cache.entries.map((entry) => (
      entry.id === id ? { ...entry, status, updatedAt: nowMs } : entry
    ))
    const { kept, removed } = pruneEntries(updated, nowMs)
    cache.entries = kept
    store.persistDebounced()

    return {
      changed: true,
      entries: kept.filter((entry) => entry.id === id),
      removedIds: removed.map((entry) => entry.id),
      unreadCount: countUnread(kept),
    }
  }

  /** Land any debounced write now; used before quit and by tests. */
  function flush() {
    return store.flushPending()
  }

  /**
   * Delete the persisted inbox and reset the cache. Clear-all routes through
   * this so a stale file cannot bring the badge back after a restart; the
   * jsonFileStore cancels any pending debounced write first.
   * @returns {Promise<boolean>}
   */
  function clear() {
    return store.clear()
  }

  return { list, prune, upsert, setStatus, flush, clear }
}
