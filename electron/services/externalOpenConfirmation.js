// @ts-nocheck
/**
 * Panel-saved choice for opening a link the window did not already trust.
 * Missing or unreadable state asks before opening. The pet window cannot
 * write this file: the only writer is the panel settings sync.
 */

import { createRequire } from 'node:module'
import path from 'node:path'

import { normalizeDialogLocale } from '../userFacingDialogs.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import { createSyncJsonFileStore } from './jsonFileStore.js'

const FILE_NAME = 'external-open-confirmation.json'
const require = createRequire(import.meta.url)

/**
 * @param {unknown} value
 * @returns {{ requiresConfirmation: boolean, uiLanguage: string | null }}
 */
export function normalizeExternalOpenConfirmation(value) {
  const input = value && typeof value === 'object' ? value : {}
  const language = typeof input.uiLanguage === 'string' ? input.uiLanguage.trim() : ''
  return {
    requiresConfirmation: input.requiresConfirmation !== false,
    uiLanguage: language ? normalizeDialogLocale(language) : null,
  }
}

/**
 * Apply a partial save without resetting fields the payload left out.
 * @param {unknown} current
 * @param {unknown} patch
 * @returns {{ requiresConfirmation: boolean, uiLanguage: string | null }}
 */
export function mergeExternalOpenConfirmation(current, patch) {
  const base = normalizeExternalOpenConfirmation(current)
  const update = patch && typeof patch === 'object' ? patch : {}
  const next = { ...base }
  if (typeof update.requiresConfirmation === 'boolean') {
    next.requiresConfirmation = update.requiresConfirmation
  }
  if (typeof update.uiLanguage === 'string' && update.uiLanguage.trim()) {
    next.uiLanguage = normalizeDialogLocale(update.uiLanguage)
  }
  return next
}

let getStorePath = () => {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), FILE_NAME)
}

let store = null

function getStore() {
  if (store) return store
  store = createSyncJsonFileStore({
    getStorePath: () => getStorePath(),
    normalize: (parsed) => normalizeExternalOpenConfirmation(parsed),
    onPersistError: (error) => {
      console.warn('[external-open] persist failed:', getRedactedErrorMessage(error))
    },
  })
  return store
}

/**
 * Test hook for the preference file location. Production uses userData.
 * @param {{ getStorePath?: () => string }} [options]
 */
export function configureExternalOpenConfirmationStore(options = {}) {
  if (typeof options.getStorePath === 'function') getStorePath = options.getStorePath
  store = null
}

/**
 * @returns {{ requiresConfirmation: boolean, uiLanguage: string | null }}
 */
export function getExternalOpenConfirmation() {
  try {
    return normalizeExternalOpenConfirmation(getStore().load())
  } catch (error) {
    console.warn('[external-open] read failed:', getRedactedErrorMessage(error))
    return { requiresConfirmation: true, uiLanguage: null }
  }
}

/**
 * Replace the saved choice. Called from the panel settings sync only.
 * @param {unknown} patch
 * @returns {{ requiresConfirmation: boolean, uiLanguage: string | null }}
 */
export function saveExternalOpenConfirmation(patch) {
  const cache = getStore().load()
  const next = mergeExternalOpenConfirmation(cache, patch)
  cache.requiresConfirmation = next.requiresConfirmation
  cache.uiLanguage = next.uiLanguage
  getStore().persistDebounced()
  return { ...next }
}
