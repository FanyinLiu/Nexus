/**
 * Clear every on-disk copy of the user's memories.
 *
 * The vector snapshot, the local-data pages, and Chromium's LevelDB logs
 * are separate files. Updating the live key leaves the previous text in
 * those logs until compaction, so a clear rewrites them in the same call.
 */

import { getRedactedErrorMessage } from './errorRedaction.js'
import { clearMemoryLocalDataContent } from './localDataMemoryStore.js'
import { scrubChromiumStorageResidue } from './chromiumStorageScrub.js'
import { removeMemoryFromUpdateSnapshots } from './updateInstallPrep.js'
import * as memoryVectorStore from './memoryVectorStore.js'

/**
 * @param {{
 *   userDataPath?: string,
 *   needles?: readonly string[],
 *   flushStorage?: () => Promise<unknown> | unknown,
 * }} [options]
 * @returns {Promise<{
 *   ok: true,
 *   removed: number,
 *   localDataCleared: boolean,
 *   storageFilesRewritten: number,
 *   snapshotMemoryFilesRemoved: number,
 * }>}
 */
export async function clearMemoryUserData(options = {}) {
  if (typeof options.flushStorage === 'function') {
    try {
      await options.flushStorage()
    } catch (error) {
      // The log scrub below still removes text that was already flushed.
      console.warn('[memory] storage flush before clear failed:', getRedactedErrorMessage(error))
    }
  }

  const removed = await memoryVectorStore.clearAllEntries()
  const localData = await clearMemoryLocalDataContent(
    options.userDataPath ? { userDataPath: options.userDataPath } : {},
  )
  let storageFilesRewritten = 0
  let snapshotMemoryFilesRemoved = 0
  if (options.userDataPath) {
    try {
      const scrub = await scrubChromiumStorageResidue(options.userDataPath, options.needles ?? [])
      storageFilesRewritten = scrub.filesRewritten
    } catch (error) {
      console.warn('[memory] storage log scrub failed:', getRedactedErrorMessage(error))
    }
    try {
      const snapshots = await removeMemoryFromUpdateSnapshots(options.userDataPath)
      snapshotMemoryFilesRemoved = snapshots.removed.length
    } catch (error) {
      console.warn('[memory] update snapshot memory removal failed:', getRedactedErrorMessage(error))
    }
  }

  return {
    ok: true,
    removed,
    localDataCleared: localData.ok === true,
    storageFilesRewritten,
    snapshotMemoryFilesRemoved,
  }
}
