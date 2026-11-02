/**
 * Cross-process proactive signal helpers.
 *
 * The renderer builds a delivery context before it hands a reminder to the
 * main-process router, and main rebuilds the same context when a snoozed strip
 * item comes back. Quiet-hour and fullscreen recognition must therefore live
 * here once: a second copy would let the two decision points drift apart.
 */

/**
 * Quiet hours wrap midnight when start > end. 23→8 covers 23:00 through 07:59.
 * Equal bounds mean the window is off.
 * @param {number} hour
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
export function isQuietHour(hour, start, end) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false
  if (start === end) return false
  if (start > end) return hour >= start || hour < end
  return hour >= start && hour < end
}

/**
 * Title/app text that usually means the foreground app is fullscreen.
 * @param {string | null} [title]
 * @param {string | null} [appName]
 * @returns {boolean}
 */
export function isLikelyFullscreenSurface(title, appName) {
  const text = `${title ?? ''} ${appName ?? ''}`.trim()
  if (!text) return false
  return /fullscreen|full screen|全屏|全螢幕|フルスクリーン|전체\s*화면/iu.test(text)
}
