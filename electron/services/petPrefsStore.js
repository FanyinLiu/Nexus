// @ts-nocheck
// Small persisted key/value store for desktop-pet UI preferences that are owned
// by the main process. Writes are debounced and flushed before an update
// install; the retired free-mode toggle is dropped on load so an old
// pet-prefs.json cannot leak the legacy key back into a later write.
import { app } from 'electron'
import path from 'node:path'

import { getRedactedErrorMessage } from './errorRedaction.js'
import { createSyncJsonFileStore } from './jsonFileStore.js'

const FILE_NAME = 'pet-prefs.json'

/**
 * Keep parsed pet preferences as a flat map, dropping the retired `freeMode`
 * key. Non-object JSON fails to an empty map, matching every other store.
 * @param {unknown} parsed
 * @returns {Record<string, unknown>}
 */
export function normalizePetPrefs(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const prefs = { .../** @type {Record<string, unknown>} */ (parsed) }
  delete prefs.freeMode
  return prefs
}

const store = createSyncJsonFileStore({
  getStorePath: () => path.join(app.getPath('userData'), FILE_NAME),
  normalize: normalizePetPrefs,
  onPersistError: (err) => {
    console.warn('[petPrefs] persist failed:', getRedactedErrorMessage(err))
  },
})

/**
 * Persist any debounced pet preferences before an update install.
 * False means the write failed and install must abort.
 */
export function flushPetPrefsStore() {
  return store.flushPending()
}
