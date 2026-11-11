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
 * First retry delay after a failed takeover build. It matches the normal poll
 * interval so a transient failure still retries on the next scheduled tick.
 */
export const RETIRED_PANEL_TAKEOVER_BACKOFF_BASE_MS = RETIRED_PANEL_TAKEOVER_INTERVAL_MS

/**
 * Ceiling for the exponential retry delay. A renderer that keeps failing is
 * retried at most once every two minutes: frequent enough to recover soon
 * after a transient fault, sparse enough to stop burning CPU and window
 * churn. Delays grow 5s, 10s, 20s, 40s, 80s, then settle at 120s.
 */
export const RETIRED_PANEL_TAKEOVER_BACKOFF_MAX_MS = 120_000

/**
 * @typedef {Object} RetiredPanelTakeoverDeps
 * @property {() => ({ petOnline?: boolean } & Record<string, unknown>)} getSnapshot
 * @property {() => boolean} hasPanelWindow
 * @property {() => Promise<unknown> | unknown} createHiddenPanel Resolves with
 *   the panel only after its renderer is ready, or null when creation failed.
 * @property {(win: unknown) => void} onHiddenPanelReady
 * @property {() => boolean} [isQuitting] Main-process quit latch; a closing
 *   pet window must not be mistaken for an offline companion.
 * @property {(snapshot: Record<string, unknown>) => boolean} [shouldReclaimPanel]
 * @property {() => void} [reclaimPanel]
 * @property {number} [reclaimAfterMs]
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
  isQuitting = () => false,
  shouldReclaimPanel = () => false,
  reclaimPanel = () => {},
  reclaimAfterMs = 60_000,
  now = () => Date.now(),
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
  /** @type {number | null} */
  let petOnlineSince = null
  let lastActionAt = 0
  let consecutiveCreateFailures = 0
  /** @type {number | null} */
  let nextCreateAt = null
  // Invalidates callbacks from a build that was still pending when the driver
  // stopped, so a late failure cannot poison the next run's backoff state.
  let creationEpoch = 0

  const clearCreateBackoff = () => {
    consecutiveCreateFailures = 0
    nextCreateAt = null
  }

  const noteCreateFailure = () => {
    consecutiveCreateFailures += 1
    const delay = Math.min(
      RETIRED_PANEL_TAKEOVER_BACKOFF_BASE_MS * (2 ** (consecutiveCreateFailures - 1)),
      RETIRED_PANEL_TAKEOVER_BACKOFF_MAX_MS,
    )
    nextCreateAt = now() + delay
  }

  const stop = () => {
    if (timer !== null) {
      clearIntervalFn(timer)
      timer = null
    }
    creationEpoch += 1
    creating = false
    lastPetOnline = null
    petOnlineSince = null
    lastActionAt = 0
    clearCreateBackoff()
  }

  const tick = () => {
    if (!armed) return 'idle'
    if (isQuitting()) {
      stop()
      armed = false
      return 'quitting'
    }
    if (hasPanelWindow()) {
      // A build in flight already owns a window (load retries reuse it); it is
      // not a ready panel, so the creating flag and retry schedule stay with
      // the async creation path. Only the ready callback clears the backoff.
      const snapshot = getSnapshot()
      const petOnline = Boolean(snapshot?.petOnline)
      lastPetOnline = petOnline
      if (!petOnline) {
        petOnlineSince = null
        return 'panel_present'
      }
      const nowMs = now()
      if (petOnlineSince === null) petOnlineSince = nowMs
      if (nowMs - petOnlineSince >= reclaimAfterMs && shouldReclaimPanel(snapshot)) {
        // Destroy only the never-shown takeover panel; the first-use latch
        // stays untouched and a later real fall can rebuild it.
        reclaimPanel()
        petOnlineSince = null
        lastActionAt = nowMs
        return 'reclaimed'
      }
      return 'panel_present'
    }

    const snapshot = getSnapshot()
    const petOnline = Boolean(snapshot?.petOnline)
    lastPetOnline = petOnline
    petOnlineSince = null
    if (petOnline) {
      // A recovered pet owns the scheduler again; forget the failed rebuild.
      clearCreateBackoff()
      return 'pet_online'
    }
    if (creating) return 'creating'

    const nowMs = now()
    if (nextCreateAt !== null && nowMs < nextCreateAt) return 'backoff'

    creating = true
    lastActionAt = nowMs
    const epoch = creationEpoch
    let pending
    try {
      pending = createHiddenPanel()
    } catch {
      creating = false
      noteCreateFailure()
      return 'create_failed'
    }
    Promise.resolve(pending)
      .then((win) => {
        if (epoch !== creationEpoch) return
        if (!win) {
          noteCreateFailure()
          return
        }
        // Only a panel that actually became ready clears the backoff.
        clearCreateBackoff()
        onHiddenPanelReady(win)
      })
      .catch(() => {
        if (epoch !== creationEpoch) return
        noteCreateFailure()
      })
      .finally(() => {
        if (epoch === creationEpoch) creating = false
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
    // A test runner or tray-only session must still be able to exit.
    const startedTimer = /** @type {{ unref?: () => void } | null} */ (timer)
    startedTimer?.unref?.()
    tick()
  }

  const resetForTests = () => {
    stop()
    armed = false
    creating = false
    lastPetOnline = null
    petOnlineSince = null
    lastActionAt = 0
    clearCreateBackoff()
  }

  return {
    start,
    stop,
    tick,
    isArmed: () => armed,
    isRunning: () => timer !== null,
    debugState: () => ({
      armed,
      creating,
      lastPetOnline,
      petOnlineSince,
      lastActionAt,
      consecutiveCreateFailures,
      nextCreateAt,
    }),
    resetForTests,
  }
}
