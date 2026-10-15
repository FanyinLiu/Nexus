// Full-screen gaze math shared by the main-process sampler and the renderer.
// Screen points stay in the main process. What crosses IPC is a position
// relative to one pet window, already clamped to the public sample shape.
// Electron reports both the cursor and window bounds in DIP; the physical
// conversion below is for mixed-DPI monitors where a caller still has
// device pixels.

export const GAZE_SAMPLE_INTERVAL_MS = 40
export const GAZE_MIN_EMIT_INTERVAL_MS = 32
export const GAZE_IDLE_PAUSE_SECONDS = 60
export const GAZE_RESUME_CHECK_MS = 250
export const GAZE_SMOOTH_RATE = 0.55

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/**
 * True when the sampler must not read the cursor.
 * Hidden and minimized are separate: a frameless window can stay "visible"
 * to the OS while minimized, and a hidden window is not minimized.
 * @param {{
 *   enabled?: boolean,
 *   visible?: boolean,
 *   minimized?: boolean,
 *   locked?: boolean,
 *   suspended?: boolean,
 *   idleSeconds?: number,
 * }} input
 * @returns {boolean}
 */
export function gazeSamplingPaused(input) {
  if (!input || input.enabled !== true) return true
  if (input.locked === true || input.suspended === true) return true
  if (input.visible !== true) return true
  if (input.minimized === true) return true
  const idleSeconds = Number(input.idleSeconds)
  if (Number.isFinite(idleSeconds) && idleSeconds >= GAZE_IDLE_PAUSE_SECONDS) return true
  return false
}

/**
 * Drop samples that arrive faster than the cap or repeat the same DIP point.
 * A stationary cursor must not keep the renderer awake.
 * @param {{
 *   lastPoint?: { x: number, y: number, inside?: boolean } | null,
 *   nextPoint?: { x: number, y: number, inside?: boolean } | null,
 *   lastEmitAt?: number,
 *   now: number,
 *   minIntervalMs?: number,
 * }} input
 * @returns {boolean}
 */
export function shouldEmitGazeSample(input) {
  if (!input?.nextPoint) return false
  const minIntervalMs = Number.isFinite(input.minIntervalMs)
    ? input.minIntervalMs
    : GAZE_MIN_EMIT_INTERVAL_MS
  const lastEmitAt = Number.isFinite(input.lastEmitAt) ? input.lastEmitAt : -Infinity
  if (input.now - lastEmitAt < minIntervalMs) return false
  const last = input.lastPoint
  const next = input.nextPoint
  if (
    last
    && Math.round(last.x) === Math.round(next.x)
    && Math.round(last.y) === Math.round(next.y)
    && Boolean(last.inside) === Boolean(next.inside)
  ) {
    return false
  }
  return true
}

/**
 * Convert a physical pixel on one display into that display's DIP space.
 * `nativeOrigin` is the display's top-left in physical pixels. When the
 * caller does not know it, the DIP origin scaled by this display's factor
 * is the fallback — exact for the primary display and for a secondary
 * display whose scale matches the virtual-screen origin.
 * @param {{ x: number, y: number }} physical
 * @param {{
 *   scaleFactor?: number,
 *   bounds?: { x?: number, y?: number },
 *   nativeOrigin?: { x?: number, y?: number },
 * } | null | undefined} display
 * @returns {{ x: number, y: number }}
 */
export function physicalPointToDip(physical, display) {
  const scale = finite(display?.scaleFactor, 1) || 1
  const originX = finite(display?.bounds?.x)
  const originY = finite(display?.bounds?.y)
  const nativeX = display?.nativeOrigin && Number.isFinite(Number(display.nativeOrigin.x))
    ? Number(display.nativeOrigin.x)
    : originX * scale
  const nativeY = display?.nativeOrigin && Number.isFinite(Number(display.nativeOrigin.y))
    ? Number(display.nativeOrigin.y)
    : originY * scale
  return {
    x: originX + (finite(physical?.x) - nativeX) / scale,
    y: originY + (finite(physical?.y) - nativeY) / scale,
  }
}

/**
 * Round-trip a cursor through Electron's DIP helpers when they exist.
 * On mixed-DPI Windows the documented DIP point and the window bounds can
 * disagree until both have passed through the same converter. A missing or
 * throwing helper keeps the original point so gaze degrades instead of
 * throwing.
 * @param {{ x: number, y: number }} cursor
 * @param {{
 *   dipToScreenPoint?: (point: { x: number, y: number }) => { x: number, y: number },
 *   screenToDipPoint?: (point: { x: number, y: number }) => { x: number, y: number },
 * } | null | undefined} converters
 * @returns {{ x: number, y: number }}
 */
export function normalizeCursorToDip(cursor, converters) {
  const point = { x: finite(cursor?.x), y: finite(cursor?.y) }
  const toPhysical = converters?.dipToScreenPoint
  const toDip = converters?.screenToDipPoint
  if (typeof toPhysical !== 'function' || typeof toDip !== 'function') return point
  try {
    const physical = toPhysical(point)
    const dip = toDip(physical)
    if (!dip || !Number.isFinite(dip.x) || !Number.isFinite(dip.y)) return point
    return { x: dip.x, y: dip.y }
  } catch {
    return point
  }
}

/**
 * Cursor position relative to a window's DIP content origin.
 * Pass `cursorIsPhysical` only when the cursor is still in device pixels;
 * Electron's `getCursorScreenPoint` is already DIP.
 * @param {{
 *   cursor: { x: number, y: number },
 *   windowBounds: { x: number, y: number, width: number, height: number },
 *   cursorIsPhysical?: boolean,
 *   cursorDisplay?: {
 *     scaleFactor?: number,
 *     bounds?: { x?: number, y?: number },
 *     nativeOrigin?: { x?: number, y?: number },
 *   } | null,
 * }} input
 * @returns {{ x: number, y: number, width: number, height: number, inside: boolean }}
 */
export function cursorRelativeToWindow(input) {
  const bounds = input?.windowBounds ?? { x: 0, y: 0, width: 0, height: 0 }
  const cursor = input?.cursorIsPhysical
    ? physicalPointToDip(input.cursor, input.cursorDisplay)
    : { x: finite(input?.cursor?.x), y: finite(input?.cursor?.y) }
  const x = cursor.x - finite(bounds.x)
  const y = cursor.y - finite(bounds.y)
  const width = Math.max(0, finite(bounds.width))
  const height = Math.max(0, finite(bounds.height))
  const inside = width > 0 && height > 0 && x >= 0 && y >= 0 && x <= width && y <= height
  return { x, y, width, height, inside }
}

/**
 * IPC payload. Absolute screen coordinates are intentionally absent.
 * @param {{ x?: number, y?: number, width?: number, height?: number, inside?: boolean } | null | undefined} relative
 * @param {boolean} [paused]
 * @returns {{ paused: boolean, x: number, y: number, width: number, height: number, inside: boolean }}
 */
export function toPublicGazeSample(relative, paused = false) {
  if (paused) {
    return { paused: true, x: 0, y: 0, width: 0, height: 0, inside: false }
  }
  return {
    paused: false,
    x: finite(relative?.x),
    y: finite(relative?.y),
    width: Math.max(0, finite(relative?.width)),
    height: Math.max(0, finite(relative?.height)),
    inside: relative?.inside === true,
  }
}

/**
 * Map a window-relative cursor to the same normalized gaze the pet uses
 * while the pointer is inside the character. The 0.42 / 0.28 / 0.24
 * divisors match the in-window pointer handler so the handoff does not jump.
 * @param {{ x: number, y: number, width: number, height: number }} relative
 * @returns {{ x: number, y: number }}
 */
export function mapRelativeCursorToGaze(relative) {
  const width = Math.max(1, finite(relative?.width, 1))
  const height = Math.max(1, finite(relative?.height, 1))
  const centerX = width / 2
  const centerY = height * 0.42
  return {
    x: clamp((finite(relative?.x) - centerX) / (width * 0.28), -1, 1),
    y: clamp((centerY - finite(relative?.y)) / (height * 0.24), -1, 1),
  }
}

/**
 * Ease the published gaze target. Live2D applies a second ease on top;
 * this rate stays high so the two stages do not stack into a lag.
 * @param {{ x: number, y: number }} current
 * @param {{ x: number, y: number }} target
 * @param {number} [rate]
 * @returns {{ x: number, y: number }}
 */
export function stepGazeTarget(current, target, rate = GAZE_SMOOTH_RATE) {
  const step = clamp(finite(rate, GAZE_SMOOTH_RATE), 0, 1)
  return {
    x: clamp(finite(current?.x) + (finite(target?.x) - finite(current?.x)) * step, -1, 1),
    y: clamp(finite(current?.y) + (finite(target?.y) - finite(current?.y)) * step, -1, 1),
  }
}

/**
 * Renderer-side throttle so a 25 Hz sample stream does not re-render the
 * whole pet tree for sub-threshold eye motion.
 * @param {{ x: number, y: number }} previous
 * @param {{ x: number, y: number }} next
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function shouldPublishGaze(previous, next, epsilon = 0.03) {
  const limit = Number.isFinite(epsilon) ? epsilon : 0.03
  return Math.abs(finite(previous?.x) - finite(next?.x)) >= limit
    || Math.abs(finite(previous?.y) - finite(next?.y)) >= limit
}
