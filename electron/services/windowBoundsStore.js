import { app, screen } from 'electron'
import path from 'node:path'

import { getRedactedErrorMessage } from './errorRedaction.js'
import { createSyncJsonFileStore } from './jsonFileStore.js'

const FILE_NAME = 'window-bounds.json'

// Initial load is sync because it runs once at window-creation time before
// any UI has a chance to block, and BrowserWindow constructors expect bounds
// synchronously. All subsequent persists are async (debounced by the store).
const store = createSyncJsonFileStore({
  getStorePath: () => path.join(app.getPath('userData'), FILE_NAME),
  onPersistError: (err) => {
    console.warn('[windowBounds] persist failed:', getRedactedErrorMessage(err))
  },
})

// Drop any saved bounds whose center sits outside every connected display —
// monitor unplugged, resolution changed, etc. Returns the bounds if usable.
function validate(bounds) {
  if (!bounds || typeof bounds !== 'object') return null
  const { x, y, width, height } = bounds
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null
  if (width < 200 || height < 200) return null
  const cx = x + width / 2
  const cy = y + height / 2
  const displays = screen.getAllDisplays()
  const onScreen = displays.some((d) => {
    const a = d.workArea
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height
  })
  return onScreen ? { x, y, width, height } : null
}

export function getSavedBounds(key) {
  const all = store.load()
  return validate(all[key])
}

function saveBounds(key, bounds) {
  if (!bounds) return
  const all = store.load()
  all[key] = bounds
  store.persistDebounced()
}

// Wire up resize/move listeners on a BrowserWindow so its bounds get saved
// under the given key. Skips saves while the window is collapsed/minimized.
export function trackWindow(win, key, opts = {}) {
  if (!win || win.isDestroyed()) return
  const isTrackable = opts.isTrackable ?? (() => true)

  const save = () => {
    if (!isTrackable() || win.isDestroyed() || win.isMinimized()) return
    saveBounds(key, win.getBounds())
  }

  win.on('resize', save)
  win.on('move', save)
}
