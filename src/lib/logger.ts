/**
 * Structured logger with ring-buffer capture for JSONL export.
 *
 * Use this instead of `console.warn('[module]', ...)` sprinkles. Every
 * entry is captured into an in-memory ring (most recent 500 entries) so
 * bug reports can ship a `logs.jsonl` attachment without private bodies.
 *
 * The console passthrough stays — developers still see logs live in
 * Chrome DevTools. The structured capture is additive.
 *
 * Usage:
 *   const log = createLogger('voice.vad')
 *   log.info('starting session', { triggerMode: 'wake_word' })
 *   log.warn('VAD detector unavailable', { errorPresent: true })
 *
 * Export:
 *   const jsonl = exportLogs()                 // everything in the ring
 *   const voiceOnly = exportLogs({ module: /^voice/ })
 */

import { redactSensitiveLogText } from './logRedaction.ts'

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
let consoleOutput = {
  debug: globalThis.console.debug.bind(globalThis.console),
  info: globalThis.console.info.bind(globalThis.console),
  warn: globalThis.console.warn.bind(globalThis.console),
  error: globalThis.console.error.bind(globalThis.console),
}

export function setConsolePassthrough(enabled: boolean): void {
  consolePassthrough = enabled
}

function summarizePrivateValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { redacted: true, type: 'string', length: value.length }
  if (Array.isArray(value)) return { redacted: true, type: 'array', length: value.length }
  if (value instanceof Error) return { redacted: true, type: 'error', name: value.name }
  if (value && typeof value === 'object') {
    return { redacted: true, type: 'object', keyCount: Object.keys(value).length }
  }
  return { redacted: true, type: typeof value }
}

function sanitizeSafeScalar(value: unknown): unknown {
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    return redactSensitiveLogText(value).replace(/\s+/g, ' ').slice(0, LOG_MESSAGE_MAX_LENGTH)
  }
  return summarizePrivateValue(value)
}

export function sanitizeLogMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue
    const allowsString = SAFE_STRING_META_KEYS.has(key)
    const allowsScalar = allowsString || SAFE_SCALAR_META_KEY.test(key)
    sanitized[key] = allowsScalar ? sanitizeSafeScalar(value) : summarizePrivateValue(value)
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function sanitizeLogMessage(message: string): string {
  const normalized = redactSensitiveLogText(message).replace(/\s+/g, ' ').trim()
  return (normalized || 'diagnostic event').slice(0, LOG_MESSAGE_MAX_LENGTH)
}

function sanitizeLogEntry(entry: LogEntry): LogEntry {
  const meta = sanitizeLogMeta(entry.meta)
  return {
    ...entry,
    module: entry.module.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unknown',
    message: sanitizeLogMessage(entry.message),
    ...(meta ? { meta } : { meta: undefined }),
  }
}

function pushEntry(entry: LogEntry): void {
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[minLevel]) return

  const safeEntry = sanitizeLogEntry(entry)
  ring.push(safeEntry)
  if (ring.length > RING_CAPACITY) {
    ring.shift()
  }

  if (!consolePassthrough) return
  const prefix = `[${safeEntry.module}]`
  // Keep meta rendering cheap — structuredClone on every call bites at
  // scale. Print the object directly; devtools will expand on demand.
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

// ── Console capture ───────────────────────────────────────────────────────
//
// Every voice / TTS / chat lifecycle site in the codebase still uses
// `console.info('[module] ...')` directly instead of going through this
// logger, so the ring buffer would otherwise stay empty for the most
// useful diagnostic signals. installConsoleCapture() monkey-patches
// console.* once at app boot so those calls also land in the ring; the
// DiagnosticsPanel "Copy to clipboard" button then surfaces them for bug
// reports without anyone needing DevTools.

let consoleCaptureInstalled = false

function detectModuleFromArgs(args: unknown[]): string {
  const first = args[0]
  if (typeof first === 'string') {
    // `[Chat] something happened` / `[TTS] controller settled` patterns.
    const bracketed = /^\[([^\]]+)\]/.exec(first)
    if (bracketed) return bracketed[1].toLowerCase().replace(/\s+/g, '_')
  }
  return 'console'
}

export function summarizeConsoleArguments(args: unknown[]): Record<string, unknown> {
  return {
    argumentCount: args.length,
    stringCount: args.filter((value) => typeof value === 'string').length,
    errorCount: args.filter((value) => value instanceof Error).length,
    objectCount: args.filter((value) => value !== null && typeof value === 'object').length,
  }
}

/**
 * Patch the global `console` object so calls to `.log`/`.info`/`.warn`/
 * `.error` also push a structured entry into the ring buffer. Idempotent —
 * safe to call from multiple entry points; only installs once.
 *
 * Renderer console values may contain chat, transcript, path, or provider
 * payloads. Capture and print metadata only; structured loggers retain their
 * safe event label and sanitized fields through the original console methods.
 */
export function installConsoleCapture(): void {
  if (consoleCaptureInstalled) return
  if (typeof globalThis.console === 'undefined') return
  consoleCaptureInstalled = true

  const original = {
    log: globalThis.console.log.bind(globalThis.console),
    info: globalThis.console.info.bind(globalThis.console),
    warn: globalThis.console.warn.bind(globalThis.console),
    error: globalThis.console.error.bind(globalThis.console),
    debug: globalThis.console.debug.bind(globalThis.console),
  }
  consoleOutput = original

  function capture(level: LogLevel, args: unknown[]): void {
    const module = detectModuleFromArgs(args)
    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return
    ring.push({
      ts: new Date().toISOString(),
      level,
      module,
      message: `console ${level} event`,
      meta: summarizeConsoleArguments(args),
    })
    if (ring.length > RING_CAPACITY) ring.shift()
  }

  function captureAndPrint(level: LogLevel, args: unknown[]): void {
    capture(level, args)
    original[level](`[${detectModuleFromArgs(args)}]`, `console ${level} event`, summarizeConsoleArguments(args))
  }

  globalThis.console.log = (...args) => captureAndPrint('info', args)
  globalThis.console.info = (...args) => captureAndPrint('info', args)
  globalThis.console.warn = (...args) => captureAndPrint('warn', args)
  globalThis.console.error = (...args) => captureAndPrint('error', args)
  globalThis.console.debug = (...args) => captureAndPrint('debug', args)
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
