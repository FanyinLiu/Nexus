import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const MAX_LOG_SIZE = 2 * 1024 * 1024 // 2 MB
const MAX_ROTATED_FILES = 3

let logStream = null
let logFilePath = ''
// Tracked-in-memory file size — avoids the per-write statSync that was the
// L4 audit finding. Initialised lazily on first audit() call from a single
// statSync (cost amortised across the rest of process lifetime). Each
// subsequent write increments this counter by the byte length of the
// line we just wrote; rotation resets it to 0.
let trackedSize = -1 // -1 = not yet initialised

function getLogPath() {
  if (!logFilePath) {
    logFilePath = path.join(app.getPath('userData'), 'audit.log')
  }
  return logFilePath
}

function ensureStream() {
  if (logStream) return logStream
  logStream = fs.createWriteStream(getLogPath(), { flags: 'a' })
  logStream.on('error', (err) => {
    console.error('[AuditLog] write error:', err.message)
    logStream = null
  })
  return logStream
}

function initTrackedSize() {
  try {
    const stats = fs.statSync(getLogPath())
    trackedSize = stats.size
  } catch {
    trackedSize = 0 // file doesn't exist yet
  }
}

function rotateNow() {
  // destroy() synchronously releases the fd, unlike end() which is async
  if (logStream) {
    logStream.destroy()
    logStream = null
  }

  // Prune the oldest rotated file before shifting
  const oldest = `${getLogPath()}.${MAX_ROTATED_FILES}`
  try { fs.unlinkSync(oldest) } catch { /* ok */ }

  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const from = `${getLogPath()}.${i}`
    const to = `${getLogPath()}.${i + 1}`
    try { fs.renameSync(from, to) } catch { /* ok */ }
  }
  try { fs.renameSync(getLogPath(), `${getLogPath()}.1`) } catch { /* ok */ }

  trackedSize = 0
}

/**
 * Write a structured audit entry.
 * @param {string} category  e.g. 'vault', 'plugin', 'workspace'
 * @param {string} action    e.g. 'store', 'approve', 'write'
 * @param {Record<string, unknown>} [details]
 */
export function audit(category, action, details) {
  if (trackedSize < 0) initTrackedSize()

  const entry = {
    ts: new Date().toISOString(),
    cat: category,
    act: action,
    ...details,
  }
  const line = JSON.stringify(entry) + '\n'
  const lineBytes = Buffer.byteLength(line, 'utf8')

  // Rotate before write if this entry would push us over the threshold,
  // so the new line lands in the fresh empty file. Avoids per-write stat.
  if (trackedSize + lineBytes >= MAX_LOG_SIZE) {
    rotateNow()
  }

  const stream = ensureStream()
  if (stream) {
    stream.write(line)
    trackedSize += lineBytes
  }
}

export function closeAuditLog() {
  if (logStream) {
    logStream.end()
    logStream = null
  }
}
