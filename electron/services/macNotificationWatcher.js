/**
 * In-app macOS Notification Center watcher.
 *
 * This is the "all messages" half of the communication story: instead of a
 * dedicated bot, Nexus reads the system Notification Center history so the
 * companion notices messages from ANY app (WeChat/QQ/DingTalk/mail/...).
 * Previously this only existed as a manual external adapter script — the
 * proven reading/filtering logic is imported from that script unchanged;
 * this service just runs it inside the main process and feeds the shared
 * notification ingest, so no setup beyond a toggle + Full Disk Access.
 *
 * macOS constraint: apps cannot subscribe to other apps' notifications; the
 * only path is reading the Notification Center database, which requires the
 * user to grant Full Disk Access to Nexus. The status surface tells the
 * settings UI when that grant is missing.
 */

import path from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { app } from 'electron'
import {
  classifyMacWatcherError,
  DEFAULT_COMMUNICATION_APP_PATTERN,
  filterNewNotificationMessages,
  queryMacNotificationRows,
  resolveMacNotificationDb,
} from '../../scripts/communication-adapters/macos-notification-center-watch.mjs'
import { ingestNotificationPayload } from './notificationBridge.js'

const POLL_MS = 3_000
const MAX_SEEN_KEYS = 500

/** @type {'stopped'|'running'|'needs-permission'|'unsupported'|'error'} */
let _status = 'stopped'
/** @type {string|null} */
let _lastError = null
/** @type {string|null} */
let _lastEventAt = null
/** @type {string|null} */
let _lastEventSource = null
/** @type {string|null} */
let _lastEventId = null
/** @type {string|null} */
let _lastSkipReason = null
/** @type {string|null} */
let _lastSkipAt = null
/** @type {string|null} */
let _lastErrorAt = null
/** @type {ReturnType<typeof setTimeout>|null} */
let _timer = null
let _running = false
let _appsPattern = ''
/** @type {Set<string>} */
let _seenKeys = new Set()
let _seenLoaded = false
/** @type {((status: ReturnType<typeof getWatcherStatus>) => void)|null} */
let _onStatusChange = null

function stateFilePath() {
  return path.join(app.getPath('userData'), 'mac-notification-watch-state.json')
}

async function loadSeenKeys() {
  if (_seenLoaded) return
  try {
    const parsed = JSON.parse(await readFile(stateFilePath(), 'utf8'))
    if (Array.isArray(parsed?.seen)) {
      _seenKeys = new Set(parsed.seen.map(String).filter(Boolean))
    }
  } catch {
    // First run / unreadable state — start fresh.
  }
  _seenLoaded = true
}

async function saveSeenKeys() {
  try {
    const seen = [..._seenKeys].slice(-MAX_SEEN_KEYS)
    await mkdir(path.dirname(stateFilePath()), { recursive: true })
    await writeFile(stateFilePath(), JSON.stringify({ seen, updatedAt: new Date().toISOString() }))
  } catch (err) {
    console.warn('[mac-notification-watcher] failed to persist state:', err.message)
  }
}

function setStatus(status, errorMessage = null) {
  const changed = status !== _status || errorMessage !== _lastError
  _status = status
  _lastError = errorMessage
  if (errorMessage) _lastErrorAt = new Date().toISOString()
  if (changed) _onStatusChange?.(getWatcherStatus())
}

function recordLastEvent(message) {
  _lastEventAt = new Date().toISOString()
  _lastEventSource = String(message?.source ?? message?.sender ?? 'notification')
  _lastEventId = String(message?.messageId ?? '')
  _onStatusChange?.(getWatcherStatus())
}

function recordLastSkip(reason) {
  _lastSkipReason = String(reason || 'skipped')
  _lastSkipAt = new Date().toISOString()
  _onStatusChange?.(getWatcherStatus())
}



async function pollOnce() {
  const dbPath = await resolveMacNotificationDb({})
  const rows = await queryMacNotificationRows({ dbPath, limit: 60 })
  const pattern = _appsPattern.trim() || DEFAULT_COMMUNICATION_APP_PATTERN
  const messages = filterNewNotificationMessages(rows, { pattern, seenKeys: _seenKeys })
  for (const message of messages) {
    _seenKeys.add(message.messageId)
    const result = ingestNotificationPayload({
      kind: 'message',
      source: message.source,
      sender: message.sender,
      chatTitle: message.chatTitle,
      text: message.text,
      conversationId: message.conversationId,
      messageId: message.messageId,
    }, { ingress: 'macos-notification-center' })
    if (result.ok) {
      recordLastEvent(message)
    } else {
      recordLastSkip(result.error)
    }
  }
  if (messages.length > 0) await saveSeenKeys()
}

async function loop() {
  if (!_running) return
  try {
    await pollOnce()
    setStatus('running')
  } catch (err) {
    const kind = classifyMacWatcherError(err?.message)
    setStatus(kind, err?.message ?? String(err))
  }
  if (_running) {
    _timer = setTimeout(() => { void loop() }, POLL_MS)
  }
}

/**
 * @param {{ appsPattern?: string }} [options]
 */
export async function startWatcher(options = {}) {
  if (process.platform !== 'darwin') {
    setStatus('unsupported')
    return getWatcherStatus()
  }
  _appsPattern = String(options.appsPattern ?? '')
  if (_running) return getWatcherStatus()
  _running = true
  await loadSeenKeys()

  // Fresh state: mark the existing history as seen WITHOUT ingesting it, so
  // enabling the watcher doesn't replay yesterday's notifications.
  if (_seenKeys.size === 0) {
    try {
      const dbPath = await resolveMacNotificationDb({})
      const rows = await queryMacNotificationRows({ dbPath, limit: 200 })
      const backlog = filterNewNotificationMessages(rows, {
        pattern: _appsPattern.trim() || DEFAULT_COMMUNICATION_APP_PATTERN,
        seenKeys: _seenKeys,
      })
      for (const message of backlog) _seenKeys.add(message.messageId)
      if (backlog.length > 0) {
        recordLastSkip(`initial_backlog_marked_seen:${backlog.length}`)
      }
      await saveSeenKeys()
      setStatus('running')
    } catch (err) {
      setStatus(classifyMacWatcherError(err?.message), err?.message ?? String(err))
    }
  }

  _timer = setTimeout(() => { void loop() }, POLL_MS)
  return getWatcherStatus()
}

export function stopWatcher() {
  _running = false
  if (_timer) {
    clearTimeout(_timer)
    _timer = null
  }
  setStatus('stopped')
  return getWatcherStatus()
}

export function getWatcherStatus() {
  return {
    status: _status,
    lastError: _lastError,
    platformSupported: process.platform === 'darwin',
    lastEventAt: _lastEventAt,
    lastEventSource: _lastEventSource,
    lastEventId: _lastEventId,
    lastSkipReason: _lastSkipReason,
    lastSkipAt: _lastSkipAt,
    lastErrorAt: _lastErrorAt,
  }
}

/** @param {((status: ReturnType<typeof getWatcherStatus>) => void)|null} cb */
export function onWatcherStatusChange(cb) {
  _onStatusChange = cb
}
