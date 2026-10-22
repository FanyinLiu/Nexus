// Global pointer query for Linux gaze.
// Electron's cursor query on X11 can stay at the last point delivered to a
// BrowserWindow, so desktop motion never becomes a gaze sample. xdotool reads
// the root pointer without installing an input hook, so it cannot observe the
// keyboard. Wayland and machines without xdotool keep Electron's query.
//
// A failed xdotool call only pauses the query. Non-ENOENT failures retry with
// an exponential backoff (5s doubling to 60s) and reset on success, so a
// repaired X11 setup recovers without a restart. A missing xdotool binary waits
// five minutes between attempts: installing it later still recovers, while a
// run without it keeps the child-process cost negligible.

import { execFile } from 'node:child_process'
import { getRedactedErrorMessage } from './errorRedaction.js'

export const LINUX_POINTER_TIMEOUT_MS = 750
export const LINUX_POINTER_RETRY_MS = 5_000
export const LINUX_POINTER_MAX_RETRY_MS = 60_000
export const LINUX_POINTER_MISSING_RETRY_MS = 5 * 60_000

/**
 * Parse `xdotool getmouselocation --shell` output.
 * The command prints one KEY=value pair per line; coordinates are root-window
 * pixels. Missing or non-numeric coordinates return null so gaze can fall back
 * to Electron instead of following a bogus point.
 * @param {string | Buffer | null | undefined} stdout
 * @returns {{ x: number, y: number } | null}
 */
export function parseXdotoolLocation(stdout) {
  const text = String(stdout ?? '')
  const xMatch = /^X=(-?\d+)$/m.exec(text)
  const yMatch = /^Y=(-?\d+)$/m.exec(text)
  if (!xMatch || !yMatch) return null
  const x = Number(xMatch[1])
  const y = Number(yMatch[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/**
 * Create a cached async query for the X11 root pointer.
 * Failures put the query on a cooldown instead of disabling it for the life of
 * the process. Each failure doubles the wait, capped at one minute, and any
 * successful sample resets the sequence. Wayland never tries: xdotool only
 * sees X11 root coordinates.
 * @param {{
 *   platform?: string,
 *   sessionType?: string,
 *   hasWaylandDisplay?: boolean,
 *   execFileFn?: Function,
 *   command?: string,
 *   timeoutMs?: number,
 *   retryMs?: number,
 *   maxRetryMs?: number,
 *   missingCommandRetryMs?: number,
 *   now?: () => number,
 *   log?: Pick<Console, 'warn'>,
 * }} [options]
 * @returns {() => Promise<{ x: number, y: number } | null>}
 */
export function createLinuxPointerQuery({
  platform = process.platform,
  sessionType = process.env.XDG_SESSION_TYPE,
  hasWaylandDisplay = Boolean(process.env.WAYLAND_DISPLAY),
  execFileFn = execFile,
  command = 'xdotool',
  timeoutMs = LINUX_POINTER_TIMEOUT_MS,
  retryMs = LINUX_POINTER_RETRY_MS,
  maxRetryMs = LINUX_POINTER_MAX_RETRY_MS,
  missingCommandRetryMs = LINUX_POINTER_MISSING_RETRY_MS,
  now = Date.now,
  log = console,
} = {}) {
  const supported = platform === 'linux'
    && sessionType !== 'wayland'
    && !(sessionType !== 'x11' && hasWaylandDisplay)
  let failureCount = 0
  let nextAttemptAt = 0
  let warned = false

  function warnOnce(error) {
    if (warned) return
    warned = true
    log?.warn?.(
      '[desktop-presence] Linux pointer query unavailable; using the Electron cursor:',
      getRedactedErrorMessage(error),
    )
  }

  function scheduleRetry(error) {
    if (error?.code === 'ENOENT') {
      failureCount = 0
      nextAttemptAt = now() + missingCommandRetryMs
      return
    }
    failureCount += 1
    const exponent = Math.min(failureCount - 1, 16)
    const delay = Math.min(retryMs * 2 ** exponent, maxRetryMs)
    nextAttemptAt = now() + delay
  }

  function resetRetry() {
    failureCount = 0
    nextAttemptAt = 0
  }

  return function queryLinuxPointer() {
    if (!supported || now() < nextAttemptAt) return Promise.resolve(null)
    return new Promise((resolve) => {
      let settled = false
      const done = (point) => {
        if (settled) return
        settled = true
        resolve(point)
      }
      const fail = (error) => {
        scheduleRetry(error)
        warnOnce(error)
        done(null)
      }
      try {
        execFileFn(
          command,
          ['getmouselocation', '--shell'],
          { timeout: timeoutMs, windowsHide: true, maxBuffer: 4096 },
          (error, stdout) => {
            if (error) {
              fail(error)
              return
            }
            const point = parseXdotoolLocation(stdout)
            if (!point) {
              fail(new Error('xdotool returned no pointer coordinates'))
              return
            }
            resetRetry()
            done(point)
          },
        )
      } catch (error) {
        fail(error)
      }
    })
  }
}
