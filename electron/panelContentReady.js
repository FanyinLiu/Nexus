/**
 * One-shot "run after this panel can receive renderer work" helper.
 *
 * A retired panel is destroyed, so the next OS notification click can create a
 * fresh BrowserWindow whose page is still loading. Running the notification
 * hand-off immediately would mutate the inbox before React mounts. This waits
 * for `did-finish-load`, or runs immediately when the page is already loaded.
 */

/**
 * @typedef {Object} PanelReadyWindow
 * @property {() => boolean} isDestroyed
 * @property {{
 *   isLoadingMainFrame?: () => boolean,
 *   once: (event: 'did-finish-load', listener: () => void) => unknown,
 *   removeListener?: (event: 'did-finish-load', listener: () => void) => unknown,
 * }} webContents
 */

// Electron emits did-finish-load for its own error page after did-fail-load.
// Keep that navigation flagged until the retry starts so neither the window
// lifecycle nor a notification click mistakes the error page for ready.
const failedNavigations = new WeakSet()

/** @param {PanelReadyWindow | null | undefined} win */
export function markPanelNavigationFailed(win) {
  if (win) failedNavigations.add(win)
}

/** @param {PanelReadyWindow | null | undefined} win */
export function clearPanelNavigationFailure(win) {
  if (win) failedNavigations.delete(win)
}

/** @param {PanelReadyWindow | null | undefined} win */
export function isPanelNavigationFailed(win) {
  return Boolean(win && failedNavigations.has(win))
}

/** @param {PanelReadyWindow | null | undefined} win */
export function isPanelContentReady(win) {
  if (!win || win.isDestroyed()) return false
  if (isPanelNavigationFailed(win)) return false
  const webContents = win.webContents
  if (!webContents) return false
  if (typeof webContents.isLoadingMainFrame !== 'function') return true
  try {
    return !webContents.isLoadingMainFrame()
  } catch {
    return true
  }
}

/**
 * Run `callback` once the panel's main frame has loaded. Returns a cancel
 * function; callers may ignore it when the callback owns no extra state.
 *
 * @param {PanelReadyWindow | null | undefined} win
 * @param {() => void} callback
 * @returns {() => void}
 */
export function runWhenPanelContentReady(win, callback) {
  if (!win || win.isDestroyed() || !win.webContents) return () => {}
  if (isPanelContentReady(win)) {
    callback()
    return () => {}
  }

  let cancelled = false
  const handler = () => {
    if (cancelled) return
    if (isPanelNavigationFailed(win)) {
      // This finish belongs to the error page; wait for the retried load.
      win.webContents.once('did-finish-load', handler)
      return
    }
    cancelled = true
    callback()
  }
  win.webContents.once('did-finish-load', handler)
  return () => {
    if (cancelled) return
    cancelled = true
    win.webContents.removeListener?.('did-finish-load', handler)
  }
}
