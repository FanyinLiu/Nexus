// Quit-time handshake for the debounced long-term memory write.
//
// The renderer buffers memory saves for 250 ms. `beforeunload` cannot await an
// async IPC call, so the main process is the one that blocks quitting: it asks
// every window to flush, then waits for the renderer acks with a timeout.
//
// The gate is deliberately Electron-free so the timeout behavior stays unit
// testable. A missing ack (hung renderer, crashed window) must never block quit
// forever.

/**
 * Count-based ack gate. Call `expect` with the number of windows asked, send
 * the flush request, then await `waitForAck`; every `acknowledge` decrements
 * the remaining count until the wait resolves early.
 * @returns {{
 *   expect: (count: number) => void,
 *   acknowledge: () => void,
 *   waitForAck: (timeoutMs: number) => Promise<boolean>,
 * }}
 */
export function createMemoryFlushAckGate() {
  let expected = 0
  let acknowledged = 0
  let settleWait = null

  function settleIfReady() {
    if (settleWait && acknowledged >= expected) settleWait(true)
  }

  function expect(count) {
    expected = Math.max(0, Math.trunc(count))
    // A later quit starts a new handshake; acks from the previous one must
    // not release it before the renderer has saved again.
    acknowledged = 0
    if (expected === 0) settleIfReady()
  }

  function acknowledge() {
    acknowledged += 1
    settleIfReady()
  }

  function waitForAck(timeoutMs) {
    if (expected === 0 || acknowledged >= expected) return Promise.resolve(true)
    return new Promise((resolve) => {
      let timer = null
      const onReady = (value) => {
        if (timer !== null) clearTimeout(timer)
        if (settleWait === onReady) settleWait = null
        resolve(value)
      }
      settleWait = onReady
      timer = setTimeout(() => {
        if (settleWait === onReady) settleWait = null
        resolve(false)
      }, timeoutMs)
    })
  }

  return { expect, acknowledge, waitForAck }
}

/**
 * Build the `before-quit` handler that blocks the first quit until every
 * window acks its memory flush. An update install owns its own quit and must
 * never be slowed down, so that path returns untouched.
 * @param {{
 *   getWindows: () => Array<{ isDestroyed: () => boolean, webContents: { isDestroyed: () => boolean, send: (channel: string) => void } }>,
 *   gate: { expect: (count: number) => void, acknowledge: () => void, waitForAck: (timeoutMs: number) => Promise<boolean> },
 *   timeoutMs: number,
 *   quit: () => void,
 *   isUpdateInstallQuit: () => boolean,
 * }} deps
 * @returns {(event: { preventDefault: () => void }) => void}
 */
export function createMemoryQuitFlushHandler({
  getWindows,
  gate,
  timeoutMs,
  quit,
  isUpdateInstallQuit,
}) {
  let quitFlushStarted = false
  let quitDispatched = false

  return function handleBeforeQuit(event) {
    if (isUpdateInstallQuit()) return
    if (quitDispatched) {
      // Re-entry from our own quit() after the flush wait. Let it proceed.
      quitDispatched = false
      return
    }
    if (quitFlushStarted) return
    quitFlushStarted = true
    const windows = getWindows().filter((window) => (
      !window.isDestroyed() && !window.webContents.isDestroyed()
    ))
    if (!windows.length) return
    event.preventDefault()
    gate.expect(windows.length)
    for (const window of windows) {
      try {
        window.webContents.send('memory:flush-request')
      } catch {
        gate.acknowledge()
      }
    }
    void gate.waitForAck(timeoutMs).then(() => {
      quitDispatched = true
      quit()
      // If another handler cancelled the quit, no will-quit follows. Clearing
      // on the next turn makes the next quit wait for a fresh memory save.
      setImmediate(() => {
        quitFlushStarted = false
        quitDispatched = false
      })
    })
  }
}
