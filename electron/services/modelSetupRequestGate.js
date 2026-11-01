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
 * cancel: it is the user saying "do not offer this again". The gate reads
 * that refusal from its own store at startup and stops delivering, including
 * after a restart. Without that latch every later voice action would raise
 * the chat panel again and replay the request. The renderer never supplies
 * the flag — a request payload cannot clear it.
 */

/** Only an explicit true is a refusal or a spent reminder. */
function readDeferralFlag(record, key) {
  return Boolean(record && typeof record === 'object' && record[key] === true)
}

/**
 * @param {{
 *   deliver?: () => void,
 *   schedule?: (task: () => void, delayMs: number) => unknown,
 *   cancelSchedule?: (handle: unknown) => void,
 *   loadDeferral?: () => { declined?: boolean, reminded?: boolean },
 *   saveDeferral?: (state: { declined: boolean, reminded: boolean }) => unknown,
 * }} [dependencies]
 */
export function createModelSetupRequestGate(dependencies = {}) {
  const {
    deliver,
    schedule = (task, delayMs) => setTimeout(task, delayMs),
    cancelSchedule = (handle) => clearTimeout(handle),
    loadDeferral = () => ({ declined: false, reminded: false }),
    saveDeferral = () => {},
  } = dependencies
  // A request that already reached the panel and waits to be claimed.
  let delivered = false
  // A request whose delay has not elapsed yet.
  let timer = null
  // Loaded before any request is accepted. A throw or a non-boolean is
  // "not declined": hiding the installer requires an explicit true.
  let loadedDeferral
  try {
    loadedDeferral = loadDeferral()
  } catch {
    loadedDeferral = null
  }
  // The user answered "maybe later" in the installer.
  let declined = readDeferralFlag(loadedDeferral, 'declined')
  // The single reminder that refusal owes the user.
  let reminded = readDeferralFlag(loadedDeferral, 'reminded')
  // Disk writes run one at a time so an older snapshot cannot land last.
  let persistTail = Promise.resolve()

  const persist = () => {
    const snapshot = { declined, reminded }
    persistTail = persistTail
      .catch(() => undefined) // silent-catch-ok: resets the serialized write chain after a previously handled save failure
      .then(() => saveDeferral(snapshot))
      .then(() => undefined, () => undefined)
    return persistTail
  }

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
     * no later request reaches the panel. The refusal is written to disk.
     */
    decline() {
      declined = true
      clearTimer()
      delivered = false
      void persist()
    },
    /** Whether the user declined the installer, including after a restart. */
    isDeclined() {
      return declined
    },
    /**
     * Whether the refusal still owes its one reminder. Does not spend it.
     * @returns {boolean}
     */
    isReminderOwed() {
      return declined && !reminded
    },
    /**
     * Claims the one reminder the refusal owes. The first claim after a
     * refusal returns true, every later claim returns false: the installer
     * promises a single nudge, not a lecture. The spent flag is written
     * to disk, so a restart cannot show the reminder twice or skip it
     * when it has not been shown yet.
     */
    claimReminder() {
      if (!declined || reminded) return false
      reminded = true
      void persist()
      return true
    },
    /**
     * Resolves when the latest refusal or reminder write has settled.
     * @returns {Promise<void>}
     */
    whenPersisted() {
      return persistTail
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
