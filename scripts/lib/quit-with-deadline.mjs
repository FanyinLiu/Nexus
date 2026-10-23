/**
 * Bounded shutdown for the first-use smoke's Playwright Electron app.
 * A wedged renderer makes `app.quit()` and `application.close()` hang, which
 * used to block the smoke's finally block forever. Each phase is raced against
 * a deadline, and the Electron process is SIGKILLed only after both fail.
 */

const DEFAULT_QUIT_TIMEOUT_MS = 5000
const DEFAULT_CLOSE_TIMEOUT_MS = 5000

/**
 * Race one operation against a hard deadline. A rejection counts as failure so
 * the caller can try the next shutdown phase; a late rejection is swallowed.
 * @param {() => Promise<unknown> | unknown} operation Quit or close action.
 * @param {number} timeoutMs Deadline in milliseconds.
 * @returns {Promise<boolean>} True when the operation resolved before the deadline.
 */
function settlesWithin(operation, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let timer
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    timer = setTimeout(() => finish(false), timeoutMs)
    // A late rejection from the abandoned attempt must not crash the finally block.
    Promise.resolve().then(operation).then(() => finish(true), () => finish(false))
  })
}

/**
 * Quit an Electron application within hard deadlines.
 * @param {{
 *   application: {
 *     waitForEvent: (event: string, options?: { timeout?: number }) => Promise<unknown>,
 *     evaluate: (fn: unknown) => Promise<unknown>,
 *     close: () => Promise<unknown>,
 *     process: () => { kill: (signal: string) => unknown } | null | undefined,
 *   } | null,
 *   timeoutMs?: number,
 *   closeTimeoutMs?: number,
 * }} options Application handle plus per-phase deadlines.
 * @returns {Promise<'quit' | 'close' | 'kill' | 'missing'>} How shutdown ended.
 */
export async function quitWithDeadline({
  application,
  timeoutMs = DEFAULT_QUIT_TIMEOUT_MS,
  closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
}) {
  if (!application) return 'missing'

  const quit = async () => {
    const closed = application.waitForEvent('close', { timeout: timeoutMs })
    await application.evaluate(({ app }) => { app.quit() })
    await closed
  }
  if (await settlesWithin(quit, timeoutMs)) return 'quit'

  const close = async () => { await application.close() }
  if (await settlesWithin(close, closeTimeoutMs)) return 'close'

  try {
    application.process()?.kill('SIGKILL')
  } catch {
    // The process already exited between the deadline and the kill.
  }
  return 'kill'
}
