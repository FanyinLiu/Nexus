import { app, screen } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { getRedactedErrorMessage } from './errorRedaction.js'

const FILE_NAME = 'window-bounds.json'

let cache = null
let writeTimer = null

function getStorePath() {
  return path.join(app.getPath('userData'), FILE_NAME)
}

// Initial load is sync because it runs once at window-creation time before
// any UI has a chance to block, and BrowserWindow constructors expect bounds
// synchronously. All subsequent persists are async.
function load() {
  if (cache !== null) return cache
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8')
    const parsed = JSON.parse(raw)
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

function persistDebounced() {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    fsp.writeFile(getStorePath(), JSON.stringify(cache, null, 2), 'utf8')
      .catch((err) => {
        console.warn('[windowBounds] persist failed:', getRedactedErrorMessage(err))
      })
  }, 400)
}

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
  const all = load()
  return validate(all[key])
}

export function saveBounds(key, bounds) {
  if (!bounds) return
  const all = load()
  all[key] = bounds
  persistDebounced()
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
