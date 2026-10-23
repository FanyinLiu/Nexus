/**
 * Disk latch for the model installer's "maybe later" answer.
 *
 * The main-process request gate reads this on startup. A refusal that
 * lived only in memory would raise the chat panel again after a restart,
 * and the one reminder it owes would either repeat or disappear. Missing
 * and unreadable files normalize to "not declined": an empty default must
 * not hide the installer from someone who never saw it. Only boolean true
 * counts, so a corrupt file cannot invent a refusal.
 */

import { getRedactedErrorMessage } from './errorRedaction.js'
import { createSyncJsonFileStore } from './jsonFileStore.js'

/** File name under userData. The request gate is the only reader. */
export const MODEL_SETUP_DEFERRAL_FILE_NAME = 'model-setup-deferral.json'

function normalize(parsed) {
  const record = parsed && typeof parsed === 'object' ? parsed : {}
  return {
    declined: record.declined === true,
    reminded: record.reminded === true,
  }
}

/**
 * @param {{ getStorePath: () => string }} dependencies
 */
export function createModelSetupDeferralStore({ getStorePath }) {
  const store = createSyncJsonFileStore({
    getStorePath,
    normalize,
    onPersistError: (error) => {
      console.warn('[modelSetupDeferral] persist failed:', getRedactedErrorMessage(error))
    },
  })

  /**
   * The refusal, and whether its single reminder was already shown.
   * @returns {{ declined: boolean, reminded: boolean }}
   */
  function load() {
    const cache = store.load()
    return {
      declined: cache.declined === true,
      reminded: cache.reminded === true,
    }
  }

  /**
   * Writes the latch before the caller continues. The shared store
   * debounces, then flushPending lands this snapshot immediately so a
   * quit in the same turn keeps the refusal.
   * @param {{ declined?: boolean, reminded?: boolean }} state
   * @returns {Promise<boolean>}
   */
  function save(state) {
    const cache = store.load()
    cache.declined = state?.declined === true
    cache.reminded = state?.reminded === true
    store.persistDebounced()
    return store.flushPending()
  }

  return { load, save }
}
