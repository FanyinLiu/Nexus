// Pure proximity reaction for "she notices the cursor coming closer".
//
// The input is the window-relative cursor sample the main process already
// publishes and the drawn Live2D model rectangle inside that window. This
// module only decides the far -> near edge, hysteresis, cooldown and the
// glance shape; it never reads a DOM, a timer or a setting by itself.
//
// Quiet is a hard gate. A near edge that arrives during a quiet state is
// consumed, not queued, so a reaction can never fire later just because the
// user stopped typing or finished a call.
//
// Fullscreen cannot be known synchronously, so it is deliberately absent from
// MouseNearQuiet: the edge only plans a one-shot active-window probe, and
// `resolveMouseNearReaction` drops the glance when that probe reports a
// fullscreen surface. The edge still consumes the cooldown, so a fullscreen app
// cannot buy a read on every approach.

import { isLikelyFullscreenSurface } from '../../../shared/proactiveSignals.js'

export const MOUSE_NEAR_RADIUS_DIP = 120
export const MOUSE_NEAR_COOLDOWN_MS = 45_000
export const MOUSE_NEAR_REARM_DIP = 48
export const MOUSE_NEAR_GLANCE_MS = 800

export type MouseNearPoint = { x: number; y: number }

export type MouseNearRect = {
  x: number
  y: number
  width: number
  height: number
}

export type MouseNearDirection = 'left' | 'right'

export type MouseNearQuiet = {
  gazeFollowEnabled: boolean
  typingQuiet: boolean
  busy: boolean
  hidden: boolean
  /** null means the platform cannot report it; treated as not muted. */
  systemDnd: boolean | null | undefined
  quietHours: boolean
  /** The model is in its sleepy / nap idle state. */
  ambientSleep: boolean
}

export type MouseNearState = {
  /** Whether the cursor was inside the radius on the previous step. */
  previousNear: boolean
  /** False after a reaction until the cursor leaves the hysteresis band. */
  armed: boolean
  /**
   * Cooldown anchor. A reaction whose fullscreen probe suppresses the glance
   * still advances this, so a fullscreen app cannot cause a read per approach.
   */
  lastReactAt: number
}

/** The active-window fields the fullscreen check needs; null is unreadable. */
export type MouseNearContextSnapshot = {
  activeWindowTitle?: string | null
  activeWindowAppName?: string | null
} | null | undefined

export type MouseNearInput = {
  point: MouseNearPoint | null | undefined
  modelBounds: MouseNearRect | null | undefined
  now: number
  quiet: MouseNearQuiet
  radius?: number
  rearmMargin?: number
  cooldownMs?: number
}

export type MouseNearStep = {
  state: MouseNearState
  react: boolean
  direction: MouseNearDirection | null
}

/** What an edge step asks the caller to do before showing the glance. */
export type MouseNearProbe = {
  /** Perform exactly one active-window read; never read without this. */
  read: boolean
  direction: MouseNearDirection | null
}

/** The glance decision after the on-demand fullscreen read resolves. */
export type MouseNearReaction = {
  glance: boolean
  direction: MouseNearDirection | null
}

export type MouseNearGlance = {
  direction: MouseNearDirection
  startedAt: number
}

export type MouseNearGlanceOffset = {
  gazeX: number
  gazeY: number
  angleZ: number
  bodyAngleX: number
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function validRect(rect: MouseNearRect | null | undefined): rect is MouseNearRect {
  return Boolean(
    rect
    && Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0,
  )
}

/** Fresh state: the first far -> near edge is allowed to react. */
export function createMouseNearState(): MouseNearState {
  return {
    previousNear: false,
    armed: true,
    lastReactAt: Number.NEGATIVE_INFINITY,
  }
}

/**
 * Shortest distance from a point to a rectangle. Zero inside, including the
 * edge. An unusable point or rectangle reports Infinity so it can never look
 * like a confident "near" reading.
 */
export function distanceToRect(
  point: MouseNearPoint | null | undefined,
  rect: MouseNearRect | null | undefined,
): number {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !validRect(rect)) {
    return Number.POSITIVE_INFINITY
  }
  const left = rect.x
  const right = rect.x + rect.width
  const top = rect.y
  const bottom = rect.y + rect.height
  const dx = Math.max(left - point.x, 0, point.x - right)
  const dy = Math.max(top - point.y, 0, point.y - bottom)
  if (dx <= 0 && dy <= 0) return 0
  return Math.hypot(dx, dy)
}

/** True when the cursor is within `radius` DIP of the model rectangle. */
export function isCursorNear(
  point: MouseNearPoint | null | undefined,
  modelBounds: MouseNearRect | null | undefined,
  radius = MOUSE_NEAR_RADIUS_DIP,
): boolean {
  const limit = Number.isFinite(radius) ? Math.max(0, radius) : MOUSE_NEAR_RADIUS_DIP
  return distanceToRect(point, modelBounds) <= limit
}

/** Any quiet signal stops the reaction; unknown DND stays permissive. */
export function isMouseNearQuiet(quiet: MouseNearQuiet | null | undefined): boolean {
  if (!quiet) return true
  if (quiet.gazeFollowEnabled !== true) return true
  if (quiet.typingQuiet === true) return true
  if (quiet.busy === true) return true
  if (quiet.hidden === true) return true
  if (quiet.systemDnd === true) return true
  if (quiet.quietHours === true) return true
  if (quiet.ambientSleep === true) return true
  return false
}

/**
 * Advance one cursor sample.
 *
 * Reacting needs all of: a far -> near edge, the hysteresis re-arm, an
 * elapsed cooldown, and a non-quiet moment. A near edge during quiet is
 * swallowed (previousNear becomes true), so nothing is left pending when the
 * quiet state ends. Fullscreen is resolved afterwards by the caller; the
 * cooldown is still consumed here before that read happens.
 */
export function stepMouseNear(state: MouseNearState, input: MouseNearInput): MouseNearStep {
  const current = state ?? createMouseNearState()
  const now = finite(input?.now)
  const inputRadius = input?.radius
  const inputRearm = input?.rearmMargin
  const inputCooldown = input?.cooldownMs
  const radius = Number.isFinite(inputRadius) ? Math.max(0, inputRadius as number) : MOUSE_NEAR_RADIUS_DIP
  const rearmMargin = Number.isFinite(inputRearm)
    ? Math.max(0, inputRearm as number)
    : MOUSE_NEAR_REARM_DIP
  const cooldownMs = Number.isFinite(inputCooldown)
    ? Math.max(0, inputCooldown as number)
    : MOUSE_NEAR_COOLDOWN_MS
  const distance = distanceToRect(input?.point, input?.modelBounds)
  const near = distance <= radius
  const outsideBand = distance > radius + rearmMargin

  let armed = current.armed === true
  if (!near && outsideBand) armed = true

  let lastReactAt = finite(current.lastReactAt, Number.NEGATIVE_INFINITY)
  let react = false
  let direction: MouseNearDirection | null = null

  const edge = current.previousNear !== true && near
  const cooldownElapsed = now - lastReactAt >= cooldownMs
  if (edge && armed && cooldownElapsed && !isMouseNearQuiet(input?.quiet)) {
    react = true
    armed = false
    lastReactAt = now
    direction = input.point && input.modelBounds
      && input.point.x < input.modelBounds.x + input.modelBounds.width / 2
      ? 'left'
      : 'right'
  }

  return {
    state: {
      previousNear: near,
      armed,
      lastReactAt,
    },
    react,
    direction,
  }
}

/**
 * Translate a step into the one-shot fullscreen probe it requests.
 *
 * Only a `react` step reads: the far -> near edge, re-arm, cooldown and every
 * synchronous quiet check already passed inside `stepMouseNear`. No edge, no
 * read.
 */
export function planMouseNearProbe(
  step: MouseNearStep | null | undefined,
): MouseNearProbe {
  if (!step || step.react !== true) return { read: false, direction: null }
  const direction = step.direction === 'left' || step.direction === 'right'
    ? step.direction
    : null
  return { read: direction !== null, direction }
}

/**
 * Decide the glance after the active-window read completes.
 *
 * The quiet snapshot is deliberately re-evaluated here: typing, a call, a
 * drag or the window losing visibility during the read all suppress the
 * glance. A null or unreadable context counts as "not fullscreen", matching
 * the proactive router, so an unavailable bridge still lets the glance run.
 */
export function resolveMouseNearReaction(input: {
  direction: MouseNearDirection | null | undefined
  context: MouseNearContextSnapshot
  quiet: MouseNearQuiet | null | undefined
}): MouseNearReaction {
  const direction = input?.direction === 'left' || input?.direction === 'right'
    ? input.direction
    : null
  if (!direction) return { glance: false, direction: null }
  if (isMouseNearQuiet(input?.quiet)) return { glance: false, direction: null }
  if (isLikelyFullscreenSurface(
    input?.context?.activeWindowTitle,
    input?.context?.activeWindowAppName,
  )) {
    return { glance: false, direction: null }
  }
  return { glance: true, direction }
}

/**
 * Small eye + head nudge toward the cursor side. The sine envelope starts and
 * ends at zero and peaks in the middle, so the glance settles back without a
 * separate cleanup step or a latched expression.
 */
export function mouseNearGlanceOffset(
  glance: MouseNearGlance | null | undefined,
  now: number,
  durationMs = MOUSE_NEAR_GLANCE_MS,
): MouseNearGlanceOffset {
  const zero: MouseNearGlanceOffset = { gazeX: 0, gazeY: 0, angleZ: 0, bodyAngleX: 0 }
  if (!glance || (glance.direction !== 'left' && glance.direction !== 'right')) return zero
  if (!Number.isFinite(glance.startedAt) || !Number.isFinite(now)) return zero
  const duration = Number.isFinite(durationMs) ? Math.max(1, durationMs) : MOUSE_NEAR_GLANCE_MS
  const elapsed = now - glance.startedAt
  if (elapsed < 0 || elapsed >= duration) return zero
  const envelope = Math.sin((elapsed / duration) * Math.PI)
  if (envelope <= 0) return zero
  const side = glance.direction === 'left' ? -1 : 1
  return {
    gazeX: side * 0.22 * envelope,
    gazeY: -0.05 * envelope,
    angleZ: side * 1.6 * envelope,
    bodyAngleX: side * 1.2 * envelope,
  }
}
