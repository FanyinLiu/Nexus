// Owns the single global input hook in the main process.
// uiohook has no mouse-only start mode: any running hook can receive keyboard
// events. It therefore runs only while typing awareness is on. Linux gaze
// reads the pointer through an X11 query instead of borrowing the hook, so
// gaze alone can never install or keep a keyboard-capable hook alive.
// Preference changes are serialized because uiohook throws when start() races
// another start() or a stop() on the same hook object.

import { getRedactedErrorMessage } from './errorRedaction.js'
import { createLinuxPointerQuery } from './linuxPointer.js'

const POINTER_SAMPLE_THROTTLE_MS = 80

/**
 * @typedef {{ x: number, y: number }} PointerPoint
 * @typedef {{
 *   on: Function,
 *   off?: Function,
 *   start: Function,
 *   stop: Function,
 * }} NativeHook
 * @typedef {{
 *   running: boolean,
 *   unavailable: boolean,
 *   error: unknown,
 *   cancelled?: boolean,
 * }} TypingHookResult
 */

/** @returns {Promise<NativeHook | null>} */
async function defaultLoadHook() {
  try {
    const imported = await import('uiohook-napi')
    const namespace = imported?.uIOhook ? imported : (imported?.default ?? {})
    const candidate = namespace.uIOhook
    if (!candidate || typeof candidate.on !== 'function' || typeof candidate.start !== 'function') {
      return null
    }
    return candidate
  } catch (error) {
    console.warn('[desktop-presence] typing hook unavailable:', getRedactedErrorMessage(error))
    return null
  }
}

/**
 * Create the hook and pointer owner used by desktop presence.
 * Injected dependencies keep the privacy boundary testable without Electron.
 * @param {{
 *   platform?: string,
 *   loadHook?: () => Promise<NativeHook | null>,
 *   pointerQuery?: null | (() => Promise<PointerPoint | null>),
 *   onKeyDown?: (event: unknown) => void,
 *   onKeyUp?: (event: unknown) => void,
 *   now?: () => number,
 *   log?: Pick<Console, 'warn'>,
 * }} [dependencies]
 */
export function createPresenceInput(dependencies = {}) {
  const platform = dependencies.platform ?? process.platform
  const loadHook = dependencies.loadHook ?? defaultLoadHook
  const onKeyDown = dependencies.onKeyDown ?? (() => {})
  const onKeyUp = dependencies.onKeyUp ?? (() => {})
  const now = dependencies.now ?? Date.now
  const log = dependencies.log ?? console
  const pointerQuery = dependencies.pointerQuery === undefined
    ? createLinuxPointerQuery({ platform, log })
    : dependencies.pointerQuery

  let typingEnabled = false
  let gazeEnabled = false
  let operation = Promise.resolve()
  let hook = null
  let hookRunning = false
  let keyDownListener = null
  let keyUpListener = null
  let pointer = null
  let pointerGeneration = 0
  let pointerStartedAt = Number.NEGATIVE_INFINITY
  let pointerInFlight = null

  /**
   * Keep hook lifecycle changes in order. A preference change that arrives
   * while start() is pending must not start a second hook or lose its stop().
   * @template T
   * @param {() => Promise<T> | T} task
   * @returns {Promise<T>}
   */
  function serialize(task) {
    const result = operation.then(task, task)
    operation = result.then(() => {}, () => {})
    return result
  }

  function detachKeyListeners(target) {
    if (target) {
      if (keyDownListener) {
        try { target.off?.('keydown', keyDownListener) } catch { /* already detached */ }
      }
      if (keyUpListener) {
        try { target.off?.('keyup', keyUpListener) } catch { /* already detached */ }
      }
    }
    keyDownListener = null
    keyUpListener = null
  }

  function stopHook() {
    const current = hook
    hook = null
    hookRunning = false
    detachKeyListeners(current)
    if (!current) return
    try {
      current.stop()
    } catch {
      // stop() throws when start() never succeeded. That is the fail-safe path.
    }
  }

  function attachKeyListeners(target) {
    detachKeyListeners(target)
    keyDownListener = (event) => onKeyDown(event)
    keyUpListener = (event) => onKeyUp(event)
    target.on('keydown', keyDownListener)
    target.on('keyup', keyUpListener)
  }

  /** @returns {Promise<TypingHookResult>} */
  async function reconcileTyping() {
    if (!typingEnabled) {
      const wasRunning = hookRunning
      stopHook()
      return { running: false, unavailable: false, error: null, cancelled: wasRunning }
    }
    if (hookRunning && hook && keyDownListener && keyUpListener) {
      return { running: true, unavailable: false, error: null }
    }
    const loaded = await loadHook()
    if (!typingEnabled) {
      stopHook()
      return { running: false, unavailable: false, error: null, cancelled: true }
    }
    if (!loaded) {
      stopHook()
      return { running: false, unavailable: true, error: null }
    }
    if (hook && hook !== loaded) stopHook()
    hook = loaded
    try {
      attachKeyListeners(loaded)
      if (!hookRunning) {
        loaded.start()
        hookRunning = true
      }
      if (!typingEnabled) {
        stopHook()
        return { running: false, unavailable: false, error: null, cancelled: true }
      }
      return { running: true, unavailable: false, error: null }
    } catch (error) {
      stopHook()
      return { running: false, unavailable: false, error }
    }
  }

  /**
   * Apply both preferences. The returned result describes the typing hook
   * after this call; gaze never starts the hook.
   * @param {{ gazeFollowEnabled?: boolean, typingAwarenessEnabled?: boolean }} next
   * @returns {Promise<TypingHookResult>}
   */
  function applyPreferences(next) {
    typingEnabled = next?.typingAwarenessEnabled === true
    gazeEnabled = next?.gazeFollowEnabled === true
    pointerGeneration += 1
    pointerInFlight = null
    if (!gazeEnabled) {
      pointer = null
      pointerStartedAt = Number.NEGATIVE_INFINITY
    }
    return serialize(reconcileTyping)
  }

  /**
   * Refresh the cached Linux pointer without blocking the gaze tick.
   * Throttled because xdotool is a short-lived child process.
   * @returns {Promise<PointerPoint | null>}
   */
  function pollCursor() {
    if (platform !== 'linux' || !gazeEnabled || typeof pointerQuery !== 'function') {
      return Promise.resolve(null)
    }
    if (pointerInFlight) return pointerInFlight
    const current = now()
    if (current - pointerStartedAt < POINTER_SAMPLE_THROTTLE_MS) {
      return Promise.resolve(pointer)
    }
    pointerStartedAt = current
    const generation = pointerGeneration
    let inFlight = null
    inFlight = Promise.resolve()
      .then(() => pointerQuery())
      .then((point) => {
        if (generation !== pointerGeneration || !gazeEnabled) return null
        const x = Number(point?.x)
        const y = Number(point?.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          // Drop the cached point so gaze falls back to Electron during the
          // xdotool cooldown instead of following a stale position.
          pointer = null
          return null
        }
        pointer = { x, y }
        return pointer
      })
      .catch((error) => {
        if (generation === pointerGeneration) {
          pointer = null
          log?.warn?.(
            '[desktop-presence] Linux pointer sample failed:',
            getRedactedErrorMessage(error),
          )
        }
        return null
      })
      .finally(() => {
        if (pointerInFlight === inFlight) pointerInFlight = null
      })
    pointerInFlight = inFlight
    return pointerInFlight
  }

  /** @returns {PointerPoint | null} */
  function readCursor() {
    return pointer ? { x: pointer.x, y: pointer.y } : null
  }

  /** @returns {boolean} */
  function isTypingRunning() {
    return hookRunning === true && hook !== null
  }

  /**
   * Stop the hook and drop the cached pointer. Safe to call at quit.
   * @returns {Promise<void>}
   */
  function stop() {
    typingEnabled = false
    gazeEnabled = false
    pointer = null
    pointerGeneration += 1
    pointerInFlight = null
    pointerStartedAt = Number.NEGATIVE_INFINITY
    return serialize(() => {
      stopHook()
    })
  }

  return {
    applyPreferences,
    pollCursor,
    readCursor,
    isTypingRunning,
    stop,
  }
}
