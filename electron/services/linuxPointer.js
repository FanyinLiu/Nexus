// Global pointer query for Linux gaze.
// Electron's cursor query on X11 can stay at the last point delivered to a
// BrowserWindow, so desktop motion never becomes a gaze sample. xdotool reads
// the root pointer without installing an input hook, so it cannot observe the
// keyboard. Wayland and machines without xdotool keep Electron's query.

import { execFile } from 'node:child_process'
import { getRedactedErrorMessage } from './errorRedaction.js'

export const LINUX_POINTER_TIMEOUT_MS = 750

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
 * The first failure disables the query for the life of the process so a
 * missing or broken xdotool cannot spawn a process on every gaze frame.
 * Wayland never tries: xdotool only sees X11 root coordinates.
 * @param {{
 *   platform?: string,
 *   sessionType?: string,
 *   hasWaylandDisplay?: boolean,
 *   execFileFn?: Function,
 *   command?: string,
 *   timeoutMs?: number,
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
  log = console,
} = {}) {
  const supported = platform === 'linux'
    && sessionType !== 'wayland'
    && !(sessionType !== 'x11' && hasWaylandDisplay)
  let available = supported
  let warned = false

  function warnOnce(error) {
    if (warned) return
    warned = true
    log?.warn?.(
      '[desktop-presence] Linux pointer query unavailable; using the Electron cursor:',
      getRedactedErrorMessage(error),
    )
  }

  return function queryLinuxPointer() {
    if (!available) return Promise.resolve(null)
    return new Promise((resolve) => {
      let settled = false
      const done = (point) => {
        if (settled) return
        settled = true
        resolve(point)
      }
      try {
        execFileFn(
          command,
          ['getmouselocation', '--shell'],
          { timeout: timeoutMs, windowsHide: true, maxBuffer: 4096 },
          (error, stdout) => {
            if (error) {
              available = false
              warnOnce(error)
              done(null)
              return
            }
            const point = parseXdotoolLocation(stdout)
            if (!point) {
              available = false
              warnOnce(new Error('xdotool returned no pointer coordinates'))
              done(null)
              return
            }
            done(point)
          },
        )
      } catch (error) {
        available = false
        warnOnce(error)
        done(null)
      }
    })
  }
}
