// @ts-check
/**
 * Main-process structured logger with ring-buffer capture for JSONL export.
 *
 * Mirrors src/lib/logger.ts so renderer and Electron support bundles share the
 * same entry shape and redaction semantics. Text redaction reuses the
 * canonical main-process chain in services/errorRedaction.js, which wraps
 * shared/redaction.js — the same rules the renderer logger applies.
 *
 * Console passthrough stays on by default so existing terminal output is
 * unchanged; the structured capture is additive. The renderer-only
 * console monkey-patch is intentionally not ported: the main process writes
 * its own diagnostics and must not rewrite global console behaviour.
 */

import { redactSensitiveErrorText } from './services/errorRedaction.js'

/** @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel */

/**
 * @typedef {object} LogEntry
 * @property {string} ts ISO timestamp
 * @property {LogLevel} level
 * @property {string} module dotted module name, e.g. 'voice.vad'
 * @property {string} message short description
 * @property {Record<string, unknown>} [meta] optional structured context
 */

/**
 * @typedef {object} Logger
 * @property {(message: string, meta?: Record<string, unknown>) => void} debug
 * @property {(message: string, meta?: Record<string, unknown>) => void} info
 * @property {(message: string, meta?: Record<string, unknown>) => void} warn
 * @property {(message: string, meta?: Record<string, unknown>) => void} error
 * @property {(subModule: string) => Logger} child
 */

/**
 * @typedef {object} LogFilter
 * @property {LogLevel | LogLevel[]} [level]
 * @property {string | RegExp} [module]
 * @property {string} [since] ISO timestamp — only entries at or after this
 */

const RING_CAPACITY = 500
const LOG_MESSAGE_MAX_LENGTH = 160
const SAFE_STRING_META_KEYS = new Set([
  'blocker',
  'kind',
  'mode',
  'model',
  'phase',
  'provider',
  'source',
  'state',
  'status',
  'triggerMode',
])
const SAFE_SCALAR_META_KEY = /(?:available|bytes|configured|count|duration|enabled|index|length|ms|present|success|total|triggered)$/i

/** @type {LogEntry[]} */
const ring = []

// Level gate — entries below this are neither recorded nor printed.
/** @type {Record<LogLevel, number>} */
const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 }
/** @type {LogLevel} */
let minLevel = 'info'

/**
 * Set the minimum log level. Lower levels are silently dropped.
 * @param {LogLevel} level
 * @returns {void}
 */
export function setLogLevel(level) {
  minLevel = level
}

/** @returns {LogLevel} */
export function getLogLevel() {
  return minLevel
}

// Optional console passthrough. Default on — developers want visibility.
let consolePassthrough = true
/** @type {Record<LogLevel, (...args: unknown[]) => void>} */
let consoleOutput = {
  debug: globalThis.console.debug.bind(globalThis.console),
  info: globalThis.console.info.bind(globalThis.console),
  warn: globalThis.console.warn.bind(globalThis.console),
  error: globalThis.console.error.bind(globalThis.console),
}

/**
 * Enable or disable console output. Capture into the ring is unaffected.
 * @param {boolean} enabled
 * @returns {void}
 */
export function setConsolePassthrough(enabled) {
  consolePassthrough = enabled
}

/**
 * Collapse an arbitrary value to a metadata-only summary.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function summarizePrivateValue(value) {
  if (typeof value === 'string') return { redacted: true, type: 'string', length: value.length }
  if (Array.isArray(value)) return { redacted: true, type: 'array', length: value.length }
  if (value instanceof Error) return { redacted: true, type: 'error', name: value.name }
  if (value && typeof value === 'object') {
    return { redacted: true, type: 'object', keyCount: Object.keys(value).length }
  }
  return { redacted: true, type: typeof value }
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeSafeScalar(value) {
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    return redactSensitiveErrorText(value).replace(/\s+/g, ' ').slice(0, LOG_MESSAGE_MAX_LENGTH)
  }
  return summarizePrivateValue(value)
}

/**
 * Keep only allow-listed operational keys as values; summarize everything else.
 * @param {Record<string, unknown>} [meta]
 * @returns {Record<string, unknown> | undefined}
 */
export function sanitizeLogMeta(meta) {
  if (!meta) return undefined

  /** @type {Record<string, unknown>} */
  const sanitized = {}
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue
    const allowsString = SAFE_STRING_META_KEYS.has(key)
    const allowsScalar = allowsString || SAFE_SCALAR_META_KEY.test(key)
    sanitized[key] = allowsScalar ? sanitizeSafeScalar(value) : summarizePrivateValue(value)
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

/**
 * @param {string} message
 * @returns {string}
 */
function sanitizeLogMessage(message) {
  const normalized = redactSensitiveErrorText(message).replace(/\s+/g, ' ').trim()
  return (normalized || 'diagnostic event').slice(0, LOG_MESSAGE_MAX_LENGTH)
}

/**
 * @param {LogEntry} entry
 * @returns {LogEntry}
 */
function sanitizeLogEntry(entry) {
  const meta = sanitizeLogMeta(entry.meta)
  return {
    ...entry,
    module: entry.module.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unknown',
    message: sanitizeLogMessage(entry.message),
    ...(meta ? { meta } : { meta: undefined }),
  }
}

/**
 * @param {LogEntry} entry
 * @returns {void}
 */
function pushEntry(entry) {
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[minLevel]) return

  const safeEntry = sanitizeLogEntry(entry)
  ring.push(safeEntry)
  if (ring.length > RING_CAPACITY) {
    ring.shift()
  }

  if (!consolePassthrough) return
  const prefix = `[${safeEntry.module}]`
  // Keep meta rendering cheap; print the object directly and let the
  // terminal expand on demand.
  switch (safeEntry.level) {
    case 'debug':
      if (safeEntry.meta) consoleOutput.debug(prefix, safeEntry.message, safeEntry.meta)
      else consoleOutput.debug(prefix, safeEntry.message)
      break
    case 'info':
      if (safeEntry.meta) consoleOutput.info(prefix, safeEntry.message, safeEntry.meta)
      else consoleOutput.info(prefix, safeEntry.message)
      break
    case 'warn':
      if (safeEntry.meta) consoleOutput.warn(prefix, safeEntry.message, safeEntry.meta)
      else consoleOutput.warn(prefix, safeEntry.message)
      break
    case 'error':
      if (safeEntry.meta) consoleOutput.error(prefix, safeEntry.message, safeEntry.meta)
      else consoleOutput.error(prefix, safeEntry.message)
      break
  }
}

/**
 * @param {string} module
 * @returns {Logger}
 */
function makeLogger(module) {
  return {
    debug(message, meta) {
      pushEntry({ ts: new Date().toISOString(), level: 'debug', module, message, meta })
    },
    info(message, meta) {
      pushEntry({ ts: new Date().toISOString(), level: 'info', module, message, meta })
    },
    warn(message, meta) {
      pushEntry({ ts: new Date().toISOString(), level: 'warn', module, message, meta })
    },
    error(message, meta) {
      pushEntry({ ts: new Date().toISOString(), level: 'error', module, message, meta })
    },
    child(subModule) {
      return makeLogger(`${module}.${subModule}`)
    },
  }
}

/**
 * Factory — produce a module-scoped logger.
 * @param {string} module
 * @returns {Logger}
 */
export function createLogger(module) {
  return makeLogger(module)
}

/**
 * @param {LogEntry} entry
 * @param {LogFilter | undefined} filter
 * @returns {boolean}
 */
function matches(entry, filter) {
  if (!filter) return true
  if (filter.level) {
    const levels = Array.isArray(filter.level) ? filter.level : [filter.level]
    if (!levels.includes(entry.level)) return false
  }
  if (filter.module) {
    if (typeof filter.module === 'string') {
      if (!entry.module.startsWith(filter.module)) return false
    } else if (!filter.module.test(entry.module)) {
      return false
    }
  }
  if (filter.since) {
    if (entry.ts < filter.since) return false
  }
  return true
}

/**
 * Return a snapshot of the ring buffer, oldest first, optionally filtered.
 * @param {LogFilter} [filter]
 * @returns {LogEntry[]}
 */
export function getLogEntries(filter) {
  if (!filter) return ring.slice()
  return ring.filter((entry) => matches(entry, filter))
}

/**
 * Clear the ring buffer. Intended for tests or explicit user action.
 * @returns {void}
 */
export function clearLogs() {
  ring.length = 0
}

/**
 * Produce a newline-delimited JSON string of all matching entries, oldest
 * first.
 * @param {LogFilter} [filter]
 * @returns {string}
 */
export function exportLogs(filter) {
  return getLogEntries(filter)
    .map((entry) => JSON.stringify(entry))
    .join('\n')
}
