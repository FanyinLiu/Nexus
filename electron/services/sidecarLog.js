// @ts-nocheck
/**
 * Size-capped rotating stderr log for local voice sidecars.
 *
 * Python sidecars are long-lived and write their own diagnostics to stderr.
 * The log is capped so a chatty or crash-looping server cannot fill the user's
 * data directory, and old contents are shifted to numbered backups instead of
 * being discarded on every rotation. The cap is enforced both when the writer
 * opens and on every later write, because a single run can outlive its startup
 * rotation. No audio or transcript is written here — this is only the child
 * process's own stderr.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Default cap per sidecar log file. */
export const SIDECAR_LOG_MAX_BYTES = 1_000_000

/** Number of rotated backups kept next to the live log. */
export const SIDECAR_LOG_BACKUPS = 2

function rotate(logPath, backups, fsImpl) {
  try {
    fsImpl.unlinkSync(`${logPath}.${backups}`)
  } catch {
    // The oldest backup may not exist yet.
  }
  for (let index = backups - 1; index >= 1; index -= 1) {
    try {
      fsImpl.renameSync(`${logPath}.${index}`, `${logPath}.${index + 1}`)
    } catch {
      // A missing intermediate backup needs no shift.
    }
  }
  try {
    fsImpl.renameSync(logPath, `${logPath}.1`)
  } catch {
    // If the live file cannot be renamed, append to it rather than losing
    // the child's diagnostics.
  }
}

/**
 * Open a sidecar stderr log and return a capped writer.
 *
 * The writer rotates the live file (same numbered backups as at open time)
 * whenever the next chunk would push it past `maxBytes`, so a single
 * long-running child cannot grow the log without bound. Any filesystem failure
 * is swallowed so voice still starts when logging is unavailable.
 *
 * @param {{
 *   logPath: string,
 *   maxBytes?: number,
 *   backups?: number,
 *   fsImpl?: typeof fs,
 * }} options
 * @returns {{ write: (chunk: string | Uint8Array) => void, close: () => void } | null}
 */
export function openSidecarLog({ logPath, maxBytes = SIDECAR_LOG_MAX_BYTES, backups = SIDECAR_LOG_BACKUPS, fsImpl = fs }) {
  if (!logPath) return null
  try {
    fsImpl.mkdirSync(path.dirname(logPath), { recursive: true })

    let fd = null
    let size = 0
    let closed = false
    const keep = Math.max(1, backups)

    function closeFd() {
      if (fd == null) return
      try {
        fsImpl.closeSync(fd)
      } catch {
        // The child may already be gone; the descriptor is not reusable.
      }
      fd = null
    }

    function openFresh() {
      closeFd()
      try {
        size = fsImpl.statSync(logPath).size
      } catch {
        size = 0
      }
      if (size >= maxBytes) {
        rotate(logPath, keep, fsImpl)
        size = 0
      }
      fd = fsImpl.openSync(logPath, 'a')
    }

    openFresh()

    return {
      write(chunk) {
        if (closed) return
        try {
          const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          if (!bytes || bytes.length === 0) return
          if (fd == null) openFresh()
          if (size > 0 && size + bytes.length > maxBytes) {
            closeFd()
            rotate(logPath, keep, fsImpl)
            fd = fsImpl.openSync(logPath, 'a')
            size = 0
          }
          fsImpl.writeSync(fd, bytes)
          size += bytes.length
        } catch {
          // Logging must never break voice: drop the chunk and keep the child.
          closeFd()
        }
      },
      close() {
        closed = true
        closeFd()
      },
    }
  } catch {
    return null
  }
}
