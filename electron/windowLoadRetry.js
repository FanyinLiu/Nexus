// @ts-check
/**
 * Bounded main-frame load retry shared by the pet and panel BrowserWindows.
 *
 * Electron emits did-finish-load for its own error page after did-fail-load, so
 * a failed navigation must never be reported ready. ERR_ABORTED (-3) means a
 * navigation was superseded and subframe failures do not break the main
 * document, so neither consumes the retry budget.
 *
 * Only the numeric error code is logged; URLs and page content stay out of the
 * main-process log. Callers own the post-budget policy because the pet must
 * stay recoverable while the panel is rebuilt on its next open. Exhaustion is
 * recorded on the controller so a user-initiated show can grant the pet one
 * fresh retry budget instead of leaving it stuck on the error page.
 */

const ERR_ABORTED = -3
const DEFAULT_RETRY_LIMIT = 2
const DEFAULT_BASE_DELAY_MS = 250

/**
 * @typedef {object} WindowLoadRetryLog
 * @property {(message: string) => void} warn
 * @property {(message: string) => void} error
 */

/**
 * @typedef {object} WindowLoadRetryWindow
 * @property {() => boolean} isDestroyed
 * @property {(url: string) => Promise<unknown>} loadURL
 */

/**
 * @typedef {object} WindowLoadRetryOptions
 * @property {WindowLoadRetryWindow} win
 * @property {() => string} loadUrl
 * @property {WindowLoadRetryLog} log
 * @property {number} [retryLimit]
 * @property {number} [baseDelayMs]
 * @property {() => void} [onNavigationFailed]
 * @property {() => void} [onErrorPageFinish]
 * @property {() => void} [onReady]
 * @property {(errorCode: number) => void} [onExhausted]
 */

/**
 * Create the retry controller for one window's main-frame navigation.
 *
 * The returned handlers are meant to be registered directly on webContents:
 * callers that need extra per-navigation state use the optional callbacks.
 * `retryIfExhausted` is the caller's recovery hook for a user-initiated show.
 *
 * @param {WindowLoadRetryOptions} options
 */
export function createWindowLoadRetry({
  win,
  loadUrl,
  log,
  retryLimit = DEFAULT_RETRY_LIMIT,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  onNavigationFailed,
  onErrorPageFinish,
  onReady,
  onExhausted,
}) {
  let attempts = 0
  let timer = /** @type {ReturnType<typeof setTimeout> | null} */ (null)
  let failedThisNavigation = false
  let exhausted = false
  let disposed = false

  const clearTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  /**
   * @param {unknown} _event
   * @param {number} errorCode
   * @param {string} _errorDescription
   * @param {string} _validatedURL
   * @param {boolean} [isMainFrame]
   */
  const handleDidFailLoad = (
    _event,
    errorCode,
    _errorDescription,
    _validatedURL,
    isMainFrame,
  ) => {
    if (disposed || isMainFrame === false || errorCode === ERR_ABORTED) return
    failedThisNavigation = true
    onNavigationFailed?.()
    if (attempts < retryLimit) {
      const delay = baseDelayMs * (2 ** attempts)
      attempts += 1
      log.warn(`renderer load failed; retrying code=${errorCode}`)
      timer = setTimeout(() => {
        timer = null
        if (disposed || win.isDestroyed()) return
        win.loadURL(loadUrl()).catch(() => undefined)
      }, delay)
      return
    }
    log.error(`renderer load failed after retries code=${errorCode}`)
    exhausted = true
    onExhausted?.(errorCode)
  }

  const handleDidFinishLoad = () => {
    if (disposed) return
    if (failedThisNavigation) {
      // This finish belongs to Electron's error page. Keep it from looking
      // ready; the scheduled retry (if any) is still the real navigation.
      failedThisNavigation = false
      onErrorPageFinish?.()
      return
    }
    clearTimer()
    attempts = 0
    exhausted = false
    onReady?.()
  }

  /**
   * Give the pet one fresh navigation after the user asks to see it again.
   * Only the exhausted state is recoverable here; normal retries own every
   * other navigation. Returns true when a reload was started.
   */
  const retryIfExhausted = () => {
    if (disposed || !exhausted || win.isDestroyed()) return false
    exhausted = false
    attempts = 0
    failedThisNavigation = false
    clearTimer()
    win.loadURL(loadUrl()).catch(() => undefined)
    return true
  }

  const dispose = () => {
    disposed = true
    clearTimer()
    failedThisNavigation = false
  }

  return { handleDidFailLoad, handleDidFinishLoad, retryIfExhausted, dispose }
}
