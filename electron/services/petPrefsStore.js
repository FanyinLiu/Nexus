import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

// Small persisted key/value store for desktop-pet UI preferences that are owned
// by the main process (toggled from the native context menu, not the renderer
// settings) — currently just free/fixed mode. Mirrors windowBoundsStore's
// sync-load-once + debounced-write idiom.

const FILE_NAME = 'pet-prefs.json'

let cache = null
let writeTimer = null

function getStorePath() {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function load() {
  if (cache !== null) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(getStorePath(), 'utf8'))
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

export function getSavedPetPref(key) {
  return load()[key]
}

export function savePetPref(key, value) {
  const all = load()
  all[key] = value
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    fsp.writeFile(getStorePath(), JSON.stringify(cache, null, 2), 'utf8')
      .catch((err) => {
        console.warn('[petPrefs] persist failed:', err?.message ?? err)
      })
  }, 400)
}
