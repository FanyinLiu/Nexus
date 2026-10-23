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
