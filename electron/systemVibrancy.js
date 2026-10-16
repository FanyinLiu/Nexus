/**
 * macOS vibrancy for the system companion look.
 *
 * Real vibrancy is a BrowserWindow API and only exists on darwin.
 * Other platforms return false so the renderer keeps the translucent
 * CSS fallback instead of pretending the desktop blurred.
 */

/**
 * @param {import('electron').BrowserWindow | null | undefined} win
 * @param {boolean} enabled
 * @returns {boolean} whether vibrancy was applied
 */
export function applySystemVibrancy(win, enabled) {
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false
  if (process.platform !== 'darwin' || typeof win.setVibrancy !== 'function') return false
  win.setVibrancy(enabled ? 'under-window' : null)
  return Boolean(enabled)
}
