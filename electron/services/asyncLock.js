/**
 * Single-slot async mutex. Wraps a closure so concurrent invocations are
 * serialized. Used by services that read-modify-write the same JSON file
 * (keyVault, mcpApprovals) to avoid interleaved writes that lose data.
 *
 * Usage:
 *   const lock = createAsyncLock()
 *   await lock(async () => { ... critical section ... })
 *
 * Each call to the factory returns a fresh independent lock; callers that
 * want a shared lock keep one module-level reference.
 */
/**
 * @returns {<T>(fn: () => T | Promise<T>) => Promise<T>}
 */
export function createAsyncLock() {
  /** @type {Promise<void> | null} */
  let pending = null
  return async function withLock(fn) {
    while (pending) await pending
    /** @type {() => void} */
    let release = () => {}
    pending = new Promise((r) => { release = r })
    try {
      return await fn()
    } finally {
      pending = null
      release()
    }
  }
}
