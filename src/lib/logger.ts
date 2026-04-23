/**
 * Structured logger with ring-buffer capture for JSONL export.
 *
 * Use this instead of `console.warn('[module]', ...)` sprinkles. Every
 * entry is captured into an in-memory ring (most recent 500 entries) so
 * bug reports can ship a `logs.jsonl` attachment with exact context.
 *
 * The console passthrough stays — developers still see logs live in
 * Chrome DevTools. The structured capture is additive.
 *
 * Usage:
 *   const log = createLogger('voice.vad')
 *   log.info('starting session', { sessionId, wakeword: true })
 *   log.warn('VAD detector unavailable — falling back', { error: err.message })
 *
 * Export:
 *   const jsonl = exportLogs()                 // everything in the ring
 *   const voiceOnly = exportLogs({ module: /^voice/ })
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: string           // ISO timestamp
  level: LogLevel
  module: string       // dotted module name, e.g. 'voice.vad'
  message: string      // short description
  meta?: Record<string, unknown> // optional structured context
}

/** Module-scoped logger; returned by createLogger(). */
export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
  /** Spawn a sub-logger with a sub-module appended to this one's name. */
  child: (subModule: string) => Logger
}

const RING_CAPACITY = 500
const ring: LogEntry[] = []

// Level gate — entries below this are not recorded OR printed. Configurable
// at runtime via setLogLevel() so dev builds can crank to `debug`.
// Default 'info' — debug logs are opt-in.
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
let minLevel: LogLevel = 'info'

/** Set the minimum log level. Lower levels are silently dropped. */
export function setLogLevel(level: LogLevel): void {
  minLevel = level
}

export function getLogLevel(): LogLevel {
  return minLevel
}

// Optional console passthrough. Default on — developers want visibility.
// Tests can disable to keep console output clean.
let consolePassthrough = true

export function setConsolePassthrough(enabled: boolean): void {
  consolePassthrough = enabled
}

function pushEntry(entry: LogEntry): void {
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[minLevel]) return

  ring.push(entry)
  if (ring.length > RING_CAPACITY) {
    ring.shift()
  }

  if (!consolePassthrough) return
  const prefix = `[${entry.module}]`
  // Keep meta rendering cheap — structuredClone on every call bites at
  // scale. Print the object directly; devtools will expand on demand.
  switch (entry.level) {
    case 'debug':
      if (entry.meta) console.debug(prefix, entry.message, entry.meta)
      else console.debug(prefix, entry.message)
      break
    case 'info':
      if (entry.meta) console.info(prefix, entry.message, entry.meta)
      else console.info(prefix, entry.message)
      break
    case 'warn':
      if (entry.meta) console.warn(prefix, entry.message, entry.meta)
      else console.warn(prefix, entry.message)
      break
    case 'error':
      if (entry.meta) console.error(prefix, entry.message, entry.meta)
      else console.error(prefix, entry.message)
      break
  }
}

function makeLogger(module: string): Logger {
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

/** Factory — produce a module-scoped logger. */
export function createLogger(module: string): Logger {
  return makeLogger(module)
}

// ── Buffer access ─────────────────────────────────────────────────────────

/**
 * Filter options for inspecting or exporting the ring buffer. All fields
 * are AND-combined; unset means match any.
 */
export interface LogFilter {
  level?: LogLevel | LogLevel[]
  module?: string | RegExp
  since?: string        // ISO timestamp — only entries at or after this
}

function matches(entry: LogEntry, filter: LogFilter | undefined): boolean {
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

/** Return a snapshot of the ring buffer, oldest first, optionally filtered. */
export function getLogEntries(filter?: LogFilter): LogEntry[] {
  if (!filter) return ring.slice()
  return ring.filter((entry) => matches(entry, filter))
}

/** Clear the ring buffer. Intended for tests or explicit user action. */
export function clearLogs(): void {
  ring.length = 0
}

// ── Export ────────────────────────────────────────────────────────────────

/**
 * Produce a newline-delimited JSON string of all matching entries, oldest
 * first. Paste into a bug report, or write to disk as `nexus-logs.jsonl`.
 */
export function exportLogs(filter?: LogFilter): string {
  return getLogEntries(filter)
    .map((entry) => JSON.stringify(entry))
    .join('\n')
}
