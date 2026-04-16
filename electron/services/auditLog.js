import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const MAX_LOG_SIZE = 2 * 1024 * 1024 // 2 MB
const MAX_ROTATED_FILES = 3

let logStream = null
let logFilePath = ''

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

function rotateIfNeeded() {
  try {
    const stats = fs.statSync(getLogPath())
    if (stats.size < MAX_LOG_SIZE) return

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
  } catch { /* file may not exist yet */ }
}

/**
 * Write a structured audit entry.
 * @param {string} category  e.g. 'vault', 'plugin', 'workspace'
 * @param {string} action    e.g. 'store', 'approve', 'write'
 * @param {Record<string, unknown>} [details]
 */
export function audit(category, action, details) {
  rotateIfNeeded()
  const entry = {
    ts: new Date().toISOString(),
    cat: category,
    act: action,
    ...details,
  }
  const stream = ensureStream()
  if (stream) stream.write(JSON.stringify(entry) + '\n')
}

export function closeAuditLog() {
  if (logStream) {
    logStream.end()
    logStream = null
  }
}
