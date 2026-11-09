/**
 * Main-process wake driver for the panel reminder fallback.
 *
 * Chromium throttles hidden renderer timers to roughly one tick per minute, so
 * a hidden panel cannot notice that the pet went offline or run due reminders
 * on time. The main process knows pet liveness first and its timers are never
 * throttled, so it pushes a wake on every pet online/offline transition and
 * once per interval while the pet is offline. The panel still owns delivery;
 * this module only supplies timing.
 */

export const REMINDER_PANEL_WAKE_INTERVAL_MS = 5_000

/**
 * @typedef {Object} PanelWakeWindow
 * @property {() => boolean} isDestroyed
 * @property {{ send: (channel: string, payload: unknown) => void }} webContents
 */

/**
 * @typedef {Object} ReminderPanelWakeDeps
 * @property {() => PanelWakeWindow | null} getPanelWindow
 * @property {() => ({ petOnline?: boolean } & Record<string, unknown>)} getSnapshot
 * @property {(win: PanelWakeWindow, snapshot: Record<string, unknown>) => void} deliverWake
 * @property {() => number} [now]
 * @property {(callback: () => void, ms: number) => unknown} [setIntervalFn]
 * @property {(timer: unknown) => void} [clearIntervalFn]
 * @property {number} [intervalMs]
 */

/**
 * Create the monitor that pushes panel wake events.
 *
 * @param {ReminderPanelWakeDeps} deps
 */
export function createReminderPanelWakeMonitor({
  getPanelWindow,
  getSnapshot,
  deliverWake,
  now = Date.now,
  setIntervalFn = (callback, ms) => setInterval(callback, ms),
  clearIntervalFn = (timer) => clearInterval(/** @type {any} */ (timer)),
  intervalMs = REMINDER_PANEL_WAKE_INTERVAL_MS,
}) {
  /** @type {unknown} */
  let timer = null
  /** @type {boolean | null} */
  let lastPetOnline = null
  let lastWakeAt = 0

  const stop = () => {
    if (timer !== null) {
      clearIntervalFn(timer)
      timer = null
    }
    lastPetOnline = null
    lastWakeAt = 0
  }

  const tick = () => {
    const win = getPanelWindow()
    if (!win || win.isDestroyed()) {
      stop()
      return 0
    }

    const snapshot = getSnapshot()
    const petOnline = Boolean(snapshot?.petOnline)
    const transitioned = lastPetOnline !== null && lastPetOnline !== petOnline
    const nowMs = now()
    // Wake on every transition, once on the first offline observation, and
    // then keep the panel's due checks alive at the configured cadence.
    const shouldWake = petOnline
      ? transitioned
      : lastPetOnline === null || transitioned || nowMs - lastWakeAt >= intervalMs
    lastPetOnline = petOnline
    if (!shouldWake) return 0

    lastWakeAt = nowMs
    deliverWake(win, snapshot)
    return 1
  }

  const start = () => {
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
    isRunning: () => timer !== null,
  }
}
