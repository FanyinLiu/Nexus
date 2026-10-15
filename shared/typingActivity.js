// Typing-activity state machine. Key identities exist only as map keys so a
// missed keyup can be matched and then forgotten. Every returned object is
// the public aggregate: phase plus keys in the last second. Nothing here
// stores a key name, and callers must not log the token they pass in.

export const TYPING_STUCK_KEY_MS = 8_000
export const TYPING_IDLE_STOP_MS = 450
export const TYPING_RATE_WINDOW_MS = 1_000

/**
 * @param {unknown} token
 * @returns {string}
 */
function normalizeToken(token) {
  if (typeof token === 'number' && Number.isFinite(token)) return `#${token}`
  if (typeof token === 'string' && token.length > 0 && token.length < 64 && !token.includes(' ')) {
    return token
  }
  return 'unknown'
}

/**
 * Why a Linux keyboard hook failed to start. The message is for the settings
 * screen; it never includes a key code. `unknown` is still Linux-specific
 * copy, not the generic missing-module sentence.
 * @param {{
 *   sessionType?: string,
 *   hasWaylandDisplay?: boolean,
 *   hasX11Display?: boolean,
 *   errorMessage?: string,
 * }} input
 * @returns {'wayland' | 'permission' | 'unknown'}
 */
export function classifyLinuxTypingHookFailure(input) {
  const session = String(input?.sessionType || '').toLowerCase()
  const message = String(input?.errorMessage || '').toLowerCase()
  const permission = /eacces|eperm|permission denied|operation not permitted|\/dev\/input|input group/.test(message)
  const mentionsWayland = /wayland|xwayland/.test(message)
  const waylandSession = session === 'wayland'
    || (session !== 'x11' && session !== 'tty' && input?.hasWaylandDisplay === true && input?.hasX11Display !== true)
  if (permission && !mentionsWayland) return 'permission'
  if (waylandSession || mentionsWayland) return 'wayland'
  if (permission) return 'permission'
  return 'unknown'
}

/**
 * @param {{ phase?: string, keysPerSecond?: number }} snapshot
 * @returns {{ phase: 'start' | 'update' | 'stop' | 'idle', keysPerSecond: number }}
 */
export function toPublicTypingSignal(snapshot) {
  const phase = snapshot?.phase === 'start' || snapshot?.phase === 'stop' || snapshot?.phase === 'update'
    ? snapshot.phase
    : 'idle'
  const keysPerSecond = Number(snapshot?.keysPerSecond)
  return {
    phase,
    keysPerSecond: Number.isFinite(keysPerSecond) ? Math.max(0, keysPerSecond) : 0,
  }
}

/**
 * Track key down/up without ever returning which keys they were.
 * A swallowed keyup (focus loss, lock, sleep) is cleared by the per-key
 * stuck timeout while other keys continue, and by the idle timeout that
 * ends the gesture after a short pause. `reset` drops everything.
 * @param {{
 *   stuckKeyMs?: number,
 *   idleStopMs?: number,
 *   rateWindowMs?: number,
 * }} [options]
 */
export function createTypingActivityMachine(options = {}) {
  const stuckKeyMs = Number.isFinite(options.stuckKeyMs) ? options.stuckKeyMs : TYPING_STUCK_KEY_MS
  const idleStopMs = Number.isFinite(options.idleStopMs) ? options.idleStopMs : TYPING_IDLE_STOP_MS
  const rateWindowMs = Number.isFinite(options.rateWindowMs) ? options.rateWindowMs : TYPING_RATE_WINDOW_MS
  const pressed = new Map()
  const downTimes = []
  let active = false
  let lastEventAt = 0

  function pruneRate(now) {
    const cutoff = now - rateWindowMs
    while (downTimes.length > 0 && downTimes[0] < cutoff) downTimes.shift()
  }

  function releaseStuck(now) {
    for (const [token, at] of pressed) {
      if (now - at >= stuckKeyMs) pressed.delete(token)
    }
  }

  function snapshot(now, phase) {
    pruneRate(now)
    return toPublicTypingSignal({ phase, keysPerSecond: downTimes.length })
  }

  return {
    /**
     * @param {unknown} token Opaque down/up identity. Never copied into the result.
     * @param {number} now
     */
    keyDown(token, now) {
      releaseStuck(now)
      pressed.set(normalizeToken(token), now)
      downTimes.push(now)
      lastEventAt = now
      const phase = active ? 'update' : 'start'
      active = true
      return snapshot(now, phase)
    },
    /**
     * @param {unknown} token
     * @param {number} now
     */
    keyUp(token, now) {
      pressed.delete(normalizeToken(token))
      lastEventAt = now
      releaseStuck(now)
      if (!active) return snapshot(now, 'idle')
      return snapshot(now, 'update')
    },
    /**
     * Advance timeouts. Returns `idle` when nothing changed so the caller
     * does not repeat a stop signal.
     * @param {number} now
     */
    tick(now) {
      releaseStuck(now)
      if (!active) return snapshot(now, 'idle')
      // A short quiet stretch ends the gesture. That same quiet stretch is
      // what clears a swallowed keyup: uiohook reports keydown once, so a
      // held key with no keyup is indistinguishable from the user pausing.
      if (now - lastEventAt >= idleStopMs) {
        pressed.clear()
        downTimes.length = 0
        active = false
        return snapshot(now, 'stop')
      }
      return snapshot(now, 'update')
    },
    /**
     * Lock, suspend, and resume all call this. A missed keyup cannot survive it.
     * @param {number} now
     */
    reset(now) {
      const wasActive = active
      pressed.clear()
      downTimes.length = 0
      active = false
      lastEventAt = 0
      return snapshot(now, wasActive ? 'stop' : 'idle')
    },
    /** @returns {number} How many keys are still marked down. Not an identity. */
    pressedCount() {
      return pressed.size
    },
  }
}
