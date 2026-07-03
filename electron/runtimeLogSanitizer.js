import path from 'node:path'
import { redactSensitiveErrorText } from './services/errorRedaction.js'

export const RUNTIME_LOG_MESSAGE_MAX_LENGTH = 2_000
export const RUNTIME_LOG_DISPLAY_PATH = '.dev/runtime.log'
export const RUNTIME_LOG_FLUSH_INTERVAL_MS = 250
export const RUNTIME_LOG_FLUSH_BATCH_SIZE = 32
export const RUNTIME_LOG_MAX_BUFFERED_LINES = 256
export const RUNTIME_LOG_MAX_SESSION_BYTES = 1_048_576

export function sanitizeRuntimeLogMessage(value, maxLength = RUNTIME_LOG_MESSAGE_MAX_LENGTH) {
  const redacted = redactSensitiveErrorText(value)
  const limit = Number.isFinite(maxLength) && maxLength > 0
    ? Math.floor(maxLength)
    : RUNTIME_LOG_MESSAGE_MAX_LENGTH

  if (redacted.length <= limit) {
    return redacted
  }

  return `${redacted.slice(0, limit)}... [truncated ${redacted.length - limit} chars]`
}

export function formatRuntimeLogSource(sourceId, lineNumber) {
  if (!sourceId) return null
  const fileName = path.basename(String(sourceId))
  const line = Number(lineNumber)
  return Number.isFinite(line) && line > 0
    ? `${fileName}:${Math.floor(line)}`
    : fileName
}

export function createRendererRuntimeLogEntry(details, label, now = new Date()) {
  return {
    ts: now.toISOString(),
    win: label,
    level: details.level,
    msg: sanitizeRuntimeLogMessage(details.message),
    src: formatRuntimeLogSource(details.sourceId, details.lineNumber),
  }
}

export function serializeRuntimeLogEntry(entry) {
  return `${JSON.stringify(entry)}\n`
}

export function serializeRuntimeLogDropNotice(droppedLineCount, now = new Date()) {
  const count = Math.max(0, Math.floor(Number(droppedLineCount) || 0))
  return serializeRuntimeLogEntry({
    ts: now.toISOString(),
    win: 'runtime',
    level: 'warning',
    msg: `[runtime-log] dropped ${count} old renderer console ${count === 1 ? 'entry' : 'entries'} due to burst backpressure`,
    src: null,
  })
}

export function serializeRuntimeLogLimitNotice(maxSessionBytes, now = new Date()) {
  const bytes = Math.max(0, Math.floor(Number(maxSessionBytes) || 0))
  return serializeRuntimeLogEntry({
    ts: now.toISOString(),
    win: 'runtime',
    level: 'warning',
    msg: `[runtime-log] session log limit reached at ${bytes} bytes; further renderer console entries were dropped`,
    src: null,
  })
}

export function truncateUtf8StringToBytes(value, maxBytes) {
  const limit = Math.max(0, Math.floor(Number(maxBytes) || 0))
  if (limit === 0) return ''

  let usedBytes = 0
  let output = ''
  for (const char of String(value)) {
    const charBytes = Buffer.byteLength(char)
    if (usedBytes + charBytes > limit) break
    output += char
    usedBytes += charBytes
  }
  return output
}

export class RuntimeLogWriteBuffer {
  constructor({
    write,
    schedule = setTimeout,
    cancel = clearTimeout,
    intervalMs = RUNTIME_LOG_FLUSH_INTERVAL_MS,
    batchSize = RUNTIME_LOG_FLUSH_BATCH_SIZE,
    maxBufferedLines = RUNTIME_LOG_MAX_BUFFERED_LINES,
    maxSessionBytes = RUNTIME_LOG_MAX_SESSION_BYTES,
    createDropNotice = serializeRuntimeLogDropNotice,
    createLimitNotice = serializeRuntimeLogLimitNotice,
  }) {
    if (typeof write !== 'function') {
      throw new TypeError('RuntimeLogWriteBuffer requires a write function')
    }

    this.write = write
    this.schedule = schedule
    this.cancel = cancel
    this.intervalMs = intervalMs
    this.batchSize = batchSize
    this.maxBufferedLines = maxBufferedLines
    this.maxSessionBytes = maxSessionBytes
    this.createDropNotice = createDropNotice
    this.createLimitNotice = createLimitNotice
    this.lines = []
    this.timer = null
    this.flushing = false
    this.activeFlushPromise = null
    this.droppedLineCount = 0
    this.writtenBytes = 0
    this.sessionLimitReached = false
  }

  enqueue(line) {
    if (this.sessionLimitReached) return

    this.lines.push(String(line))
    this.trimBufferedLines()

    if (this.lines.length >= this.batchSize) {
      void this.flush()
      return
    }

    this.scheduleFlush()
  }

  trimBufferedLines() {
    const limit = Number.isFinite(this.maxBufferedLines) && this.maxBufferedLines > 0
      ? Math.floor(this.maxBufferedLines)
      : RUNTIME_LOG_MAX_BUFFERED_LINES
    const overflow = this.lines.length - limit
    if (overflow > 0) {
      this.lines.splice(0, overflow)
      this.droppedLineCount += overflow
    }
  }

  scheduleFlush() {
    if (this.timer) return
    this.timer = this.schedule(() => {
      this.timer = null
      void this.flush()
    }, this.intervalMs)
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref()
    }
  }

  flush() {
    if (this.timer) {
      this.cancel(this.timer)
      this.timer = null
    }

    if (this.flushing) return this.activeFlushPromise
    if (this.sessionLimitReached) {
      this.lines.splice(0)
      this.droppedLineCount = 0
      return Promise.resolve()
    }

    const batch = this.lines.splice(0)
    const droppedLineCount = this.droppedLineCount
    this.droppedLineCount = 0
    if (!batch.length && droppedLineCount === 0) return Promise.resolve()

    this.flushing = true
    this.activeFlushPromise = (async () => {
      try {
        const dropNotice = droppedLineCount > 0 && this.createDropNotice
          ? this.createDropNotice(droppedLineCount)
          : ''
        const chunk = this.applySessionByteLimit(`${dropNotice}${batch.join('')}`)
        if (chunk) {
          await this.write(chunk)
        }
      } finally {
        this.flushing = false
        this.activeFlushPromise = null
        if (this.lines.length) {
          this.scheduleFlush()
        }
      }
    })()
    return this.activeFlushPromise
  }

  applySessionByteLimit(chunk) {
    const maxBytes = Number.isFinite(this.maxSessionBytes) && this.maxSessionBytes > 0
      ? Math.floor(this.maxSessionBytes)
      : RUNTIME_LOG_MAX_SESSION_BYTES
    const remainingBytes = maxBytes - this.writtenBytes

    if (remainingBytes <= 0) {
      this.sessionLimitReached = true
      return ''
    }

    const chunkBytes = Buffer.byteLength(chunk)
    if (chunkBytes <= remainingBytes) {
      this.writtenBytes += chunkBytes
      return chunk
    }

    const notice = this.createLimitNotice
      ? this.createLimitNotice(maxBytes)
      : ''
    const noticeBytes = Buffer.byteLength(notice)
    if (noticeBytes > remainingBytes) {
      this.sessionLimitReached = true
      return ''
    }

    const dataBudget = remainingBytes - noticeBytes
    const limitedChunk = `${truncateUtf8StringToBytes(chunk, dataBudget)}${notice}`
    this.writtenBytes += Buffer.byteLength(limitedChunk)
    this.sessionLimitReached = true
    return limitedChunk
  }

  async drain() {
    while (this.flushing || this.lines.length) {
      await this.flush()
    }
  }
}
