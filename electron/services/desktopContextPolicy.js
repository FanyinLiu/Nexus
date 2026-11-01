// @ts-nocheck
/**
 * Saved desktop-context capture flags.
 *
 * The pet window may call desktop-context:get, and the renderer used to be
 * able to turn clipboard and screenshot capture on by omitting the policy
 * (omitted flags used to default to enabled). Main now stores the flags the
 * panel saved and ignores renderer requests that exceed them. Defaults are
 * off, matching the settings defaults.
 *
 * The JSON file is a main-process copy. A pet window cannot write it: the
 * only writer is the panel-only external-action-policy sync that already
 * runs when settings are saved.
 */

import { createRequire } from 'node:module'
import path from 'node:path'

import { getRedactedErrorMessage } from './errorRedaction.js'
import { createSyncJsonFileStore } from './jsonFileStore.js'

const FILE_NAME = 'desktop-context-flags.json'
const require = createRequire(import.meta.url)

const DEFAULT_FLAGS = Object.freeze({
  activeWindow: false,
  clipboard: false,
  screenshot: false,
})

/** @param {unknown} value */
function flagEnabled(value) {
  return value === true
}

/**
 * Missing or malformed input fails closed. Only an explicit true is on.
 * @param {unknown} flags
 * @returns {{ activeWindow: boolean, clipboard: boolean, screenshot: boolean }}
 */
export function normalizeSavedDesktopContextFlags(flags) {
  const value = flags && typeof flags === 'object' ? flags : {}
  return {
    activeWindow: flagEnabled(value.activeWindow),
    clipboard: flagEnabled(value.clipboard),
    screenshot: flagEnabled(value.screenshot),
  }
}

/**
 * Intersect a renderer policy with the flags the user saved.
 * An omitted renderer policy does not grant anything extra: each flag is on
 * only when the saved copy is on and the renderer did not explicitly set it
 * false. An explicit renderer true cannot raise a flag the user saved as off.
 * @param {unknown} policy
 * @param {unknown} [savedFlags]
 * @returns {{ activeWindow: boolean, clipboard: boolean, screenshot: boolean }}
 */
export function normalizeDesktopContextPolicy(policy, savedFlags) {
  const saved = normalizeSavedDesktopContextFlags(savedFlags)
  const hasPolicy = Boolean(policy) && typeof policy === 'object'
  const allow = (name) => {
    if (!saved[name]) return false
    if (!hasPolicy) return true
    return policy[name] !== false
  }
  return {
    activeWindow: allow('activeWindow'),
    clipboard: allow('clipboard'),
    screenshot: allow('screenshot'),
  }
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
    normalize: (parsed) => normalizeSavedDesktopContextFlags(parsed),
    onPersistError: (error) => {
      console.warn('[desktop-context-flags] persist failed:', getRedactedErrorMessage(error))
    },
  })
  return store
}

/**
 * Test hook for the flag file location. Production uses userData.
 * @param {{ getStorePath?: () => string }} [options]
 */
export function configureDesktopContextFlagStore(options = {}) {
  if (typeof options.getStorePath === 'function') getStorePath = options.getStorePath
  store = null
}

/** @returns {{ activeWindow: boolean, clipboard: boolean, screenshot: boolean }} */
export function getSavedDesktopContextFlags() {
  try {
    return normalizeSavedDesktopContextFlags(getStore().load())
  } catch (error) {
    console.warn('[desktop-context-flags] read failed:', getRedactedErrorMessage(error))
    return { ...DEFAULT_FLAGS }
  }
}

/**
 * Replace the saved flags. Called from the panel settings sync only.
 * @param {unknown} flags
 * @returns {{ activeWindow: boolean, clipboard: boolean, screenshot: boolean }}
 */
export function saveDesktopContextFlags(flags) {
  const next = normalizeSavedDesktopContextFlags(flags)
  const cache = getStore().load()
  cache.activeWindow = next.activeWindow
  cache.clipboard = next.clipboard
  cache.screenshot = next.screenshot
  getStore().persistDebounced()
  return normalizeSavedDesktopContextFlags(cache)
}
