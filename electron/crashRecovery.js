/**
 * Decisions for a renderer that disappeared and for how often we may reload it.
 * The dialog text lives in userFacingDialogs.js. This module does not show UI.
 */

const RELOAD_REASONS = new Set([
  'crashed',
  'oom',
  'abnormal-exit',
  'launch-failed',
  'integrity-failure',
])

export const RENDERER_RELOAD_LIMIT = 3
export const RENDERER_RELOAD_WINDOW_MS = 30_000

/**
 * A clean exit or an external kill is not a crash we should paint over.
 * @param {unknown} details
 * @returns {boolean}
 */
export function shouldReloadAfterRendererGone(details) {
  const reason = details && typeof details === 'object'
    ? /** @type {{ reason?: unknown }} */ (details).reason
    : ''
  return RELOAD_REASONS.has(String(reason ?? ''))
}

/**
 * Allow a few reloads, then stop so a crash loop cannot spin the window.
 * @param {{ limit?: number, windowMs?: number, now?: () => number }} [options]
 */
export function createRendererReloadGuard(options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : RENDERER_RELOAD_LIMIT
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : RENDERER_RELOAD_WINDOW_MS
  const now = typeof options.now === 'function' ? options.now : Date.now
  /** @type {Map<unknown, number[]>} */
  const stamps = new Map()

  return {
    /**
     * @param {unknown} id
     * @returns {boolean}
     */
    allow(id) {
      const at = now()
      const recent = (stamps.get(id) ?? []).filter((stamp) => at - stamp < windowMs)
      if (recent.length >= limit) {
        stamps.set(id, recent)
        return false
      }
      recent.push(at)
      stamps.set(id, recent)
      return true
    },
  }
}
