/**
 * Main-process latch for the post-wake-word model setup request.
 *
 * The surface that armed the request may be hidden or reloaded before the
 * delay elapses, so the timer lives here: when it fires, the main process
 * raises the panel itself and hands the request over. A request therefore
 * survives a panel reload, and only an explicit cancel (wake word switched
 * off, installer dismissed) takes it back.
 *
 * The installer also has a "maybe later" answer. A decline is stronger than a
 * cancel: it is the user saying "do not offer this again", so the gate stops
 * delivering for the rest of the session. Without that latch every later voice
 * action would raise the chat panel again and replay the request.
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
  // A request that already reached the panel and waits to be claimed.
  let delivered = false
  // A request whose delay has not elapsed yet.
  let timer = null
  // The user answered "maybe later" in the installer.
  let declined = false

  const clearTimer = () => {
    if (timer === null) return
    cancelSchedule(timer)
    timer = null
  }

  const deliverNow = () => {
    delivered = true
    deliver?.()
  }

  return {
    /**
     * Arms a request now, or after `delayMs` when the caller needs the pet
     * view to stay unobstructed for a moment. A declined installer is never
     * offered again, so the request is dropped instead of delivered.
     * @param {{ delayMs?: number }} [options]
     * @returns {boolean} whether the request was armed
     */
    request({ delayMs = 0 } = {}) {
      if (declined) return false
      clearTimer()
      if (delayMs > 0) {
        timer = schedule(() => {
          timer = null
          deliverNow()
        }, delayMs)
        return true
      }
      deliverNow()
      return true
    },
    /**
     * Records the "maybe later" answer: the pending request is retracted and
     * no later request reaches the panel.
     */
    decline() {
      declined = true
      clearTimer()
      delivered = false
    },
    /** Whether the user declined the installer in this session. */
    isDeclined() {
      return declined
    },
    /** Retracts a delayed or delivered request (wake-word switched off). */
    cancel() {
      clearTimer()
      delivered = false
    },
    /**
     * Claims a request that already reached the panel. A request that is
     * still counting down stays armed: the panel may mount again before the
     * delay elapses, and the main process raises it either way.
     */
    consume() {
      if (!delivered) return false
      delivered = false
      return true
    },
    /** Whether a request already reached the panel and waits to be claimed. */
    hasPending() {
      return delivered
    },
    /** Whether a request is still counting down towards its delay. */
    isScheduled() {
      return timer !== null
    },
  }
}
