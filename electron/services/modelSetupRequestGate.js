/**
 * Main-process latch for the post-wake-word model setup request.
 *
 * A pet-side save may arm the request seconds before it should cover the pet,
 * while the panel is also allowed to dismiss a pending request. Keeping the
 * timer here makes the panel's consume call cancel the one timer that matters,
 * instead of leaving a renderer-local timer alive in another window.
 */

/**
 * Schedules `task` and returns a cancellable handle. Injectable for tests.
 * @param {{
 *   deliver?: () => void,
 *   schedule?: (task: () => void, delayMs: number) => unknown,
 *   cancelSchedule?: (handle: unknown) => void,
 * }} [dependencies]
 */
export function createModelSetupRequestGate(dependencies = {}) {
  const {
    deliver,
    schedule = (task, delayMs) => setTimeout(task, delayMs),
    cancelSchedule = (handle) => clearTimeout(handle),
  } = dependencies
  let pending = false
  let timer = null

  const clearTimer = () => {
    if (timer === null) return
    cancelSchedule(timer)
    timer = null
  }

  const deliverNow = () => {
    pending = true
    deliver?.()
  }

  return {
    /**
     * Arms a request now, or after `delayMs` when the caller needs the pet
     * view to stay unobstructed for a moment.
     * @param {{ delayMs?: number }} [options]
     */
    request({ delayMs = 0 } = {}) {
      clearTimer()
      if (delayMs > 0) {
        timer = schedule(() => {
          timer = null
          deliverNow()
        }, delayMs)
        return
      }
      deliverNow()
    },
    /** Retracts a delayed or pending request (wake-word switched off). */
    cancel() {
      clearTimer()
      pending = false
    },
    /** Clears the latch and any timer; the panel reports whether one was pending. */
    consume() {
      const wasPending = pending
      pending = false
      clearTimer()
      return wasPending
    },
    /** Whether a request has already reached the panel. */
    hasPending() {
      return pending
    },
  }
}
