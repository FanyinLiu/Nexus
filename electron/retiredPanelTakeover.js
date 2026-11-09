/**
 * Main-process takeover for the window that remains after the first-use panel
 * is retired.
 *
 * Retiring the panel removes the only renderer that can schedule reminders.
 * The main process keeps polling pet liveness; when the pet goes offline it
 * rebuilds one hidden panel (never shown, never focused) and hands control to
 * the existing wake driver once that renderer is ready. The rebuilt panel is
 * reused for later manual opens and never arms first-use retirement again.
 */

export const RETIRED_PANEL_TAKEOVER_INTERVAL_MS = 5_000

/**
 * @typedef {Object} RetiredPanelTakeoverDeps
 * @property {() => ({ petOnline?: boolean } & Record<string, unknown>)} getSnapshot
 * @property {() => boolean} hasPanelWindow
 * @property {() => Promise<unknown> | unknown} createHiddenPanel Resolves with
 *   the panel only after its renderer is ready, or null when creation failed.
 * @property {(win: unknown) => void} onHiddenPanelReady
 * @property {() => number} [now]
 * @property {(callback: () => void, ms: number) => unknown} [setIntervalFn]
 * @property {(timer: unknown) => void} [clearIntervalFn]
 * @property {number} [intervalMs]
 */

/**
 * @param {RetiredPanelTakeoverDeps} deps
 */
export function createRetiredPanelTakeover({
  getSnapshot,
  hasPanelWindow,
  createHiddenPanel,
  onHiddenPanelReady,
  now = Date.now,
  setIntervalFn = (callback, ms) => setInterval(callback, ms),
  clearIntervalFn = (timer) => clearInterval(/** @type {any} */ (timer)),
  intervalMs = RETIRED_PANEL_TAKEOVER_INTERVAL_MS,
}) {
  /** @type {unknown} */
  let timer = null
  let armed = false
  let creating = false
  /** @type {boolean | null} */
  let lastPetOnline = null
  let lastActionAt = 0

  const stop = () => {
    if (timer !== null) {
      clearIntervalFn(timer)
      timer = null
    }
    lastPetOnline = null
    lastActionAt = 0
  }

  const tick = () => {
    if (!armed) return 'idle'
    if (hasPanelWindow()) {
      creating = false
      return 'panel_present'
    }

    const snapshot = getSnapshot()
    const petOnline = Boolean(snapshot?.petOnline)
    lastPetOnline = petOnline
    if (petOnline) return 'pet_online'
    if (creating) return 'creating'

    creating = true
    lastActionAt = now()
    let pending
    try {
      pending = createHiddenPanel()
    } catch {
      creating = false
      return 'create_failed'
    }
    Promise.resolve(pending)
      .then((win) => {
        if (win) onHiddenPanelReady(win)
      })
      .catch(() => undefined)
      .finally(() => {
        creating = false
      })
    return 'created'
  }

  const start = () => {
    armed = true
    if (timer !== null) {
      tick()
      return
    }
    timer = setIntervalFn(tick, intervalMs)
    tick()
  }

  return {
    start,
    stop,
    tick,
    isArmed: () => armed,
    isRunning: () => timer !== null,
    debugState: () => ({ armed, creating, lastPetOnline, lastActionAt }),
  }
}
