/**
 * Cross-process "wait until the user is not typing" gate for proactive
 * delivery.
 *
 * The main process only ever reads a boolean here: true means typo awareness
 * is enabled, the native hook is running, and the quiet grace has not run out.
 * No key identity, rate or event object is accepted or returned.
 *
 * `whenFree` is a hint, not a lock. The caller must serialise its deliveries;
 * the proactive router does that with a promise chain, so the next message
 * re-checks the boolean after the previous one finished. That is what makes a
 * typing flag that flips repeatedly hold only the messages that are still
 * waiting, while an already-started delivery completes exactly once.
 */

/**
 * Pure opt-in gate for the main-process quiet boolean.
 *
 * Quiet requires all three: the user turned typing awareness on, the native
 * hook is actually running, and the grace deadline has not passed. A denied,
 * unavailable or never-started hook therefore reads as "not typing", which is
 * the fail-closed path the router needs.
 */
export function shouldHoldForTypingQuiet(input) {
  if (!input) return false
  if (input.settingEnabled !== true) return false
  if (input.hookRunning !== true) return false
  const until = Number(input.quietUntil)
  const now = Number(input.now)
  if (!Number.isFinite(until) || !Number.isFinite(now)) return false
  return until > now
}

export function createTypingQuietGate(dependencies = {}) {
  const read = typeof dependencies.isTyping === 'function'
    ? dependencies.isTyping
    : () => false
  const subscribe = typeof dependencies.subscribe === 'function'
    ? dependencies.subscribe
    : null
  const waiters = []
  let unsubscribe = null

  function isTyping() {
    try {
      return read() === true
    } catch {
      // An unreadable signal must never keep the user's messages forever.
      return false
    }
  }

  function detach() {
    if (!unsubscribe) return
    const current = unsubscribe
    unsubscribe = null
    try {
      current()
    } catch {
      // A failed unsubscribe only leaves an idle listener behind.
    }
  }

  function drain() {
    if (waiters.length === 0) {
      detach()
      return
    }
    if (isTyping()) return
    const pending = waiters.splice(0)
    for (const resolve of pending) resolve()
    detach()
  }

  function ensureSubscribed() {
    if (unsubscribe || !subscribe) return
    try {
      unsubscribe = subscribe(() => {
        drain()
      })
    } catch {
      unsubscribe = null
    }
  }

  /** Resolves when the caller may try to deliver. Re-check before dispatch. */
  function whenFree() {
    if (!isTyping()) return Promise.resolve()
    ensureSubscribed()
    return new Promise((resolve) => {
      waiters.push(resolve)
    })
  }

  /** Drop every waiter; used on shutdown so no test or quit path hangs. */
  function dispose() {
    detach()
    const pending = waiters.splice(0)
    for (const resolve of pending) resolve()
  }

  return {
    whenFree,
    dispose,
    pending: () => waiters.length,
    isTyping,
  }
}
