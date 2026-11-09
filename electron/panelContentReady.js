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

/** @param {PanelReadyWindow | null | undefined} win */
export function isPanelContentReady(win) {
  if (!win || win.isDestroyed()) return false
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
