import { app } from 'electron'
import path from 'node:path'

import { getRedactedErrorMessage } from './errorRedaction.js'
import { createSyncJsonFileStore } from './jsonFileStore.js'

// Small persisted key/value store for desktop-pet UI preferences that are owned
// by the main process (toggled from the native context menu, not the renderer
// settings) — currently just free/fixed mode. Built on the shared sync
// load-once + debounced-write JSON store skeleton.

const FILE_NAME = 'pet-prefs.json'

const store = createSyncJsonFileStore({
  getStorePath: () => path.join(app.getPath('userData'), FILE_NAME),
  onPersistError: (err) => {
    console.warn('[petPrefs] persist failed:', getRedactedErrorMessage(err))
  },
})

export function getSavedPetPref(key) {
  return store.load()[key]
}

export function savePetPref(key, value) {
  const all = store.load()
  all[key] = value
  store.persistDebounced()
}
