/**
 * Clear every on-disk copy of the user's memories.
 *
 * The vector snapshot, the local-data pages, and Chromium's LevelDB logs
 * are separate files. Updating the live key leaves the previous text in
 * those logs until compaction, so a clear rewrites them in the same call.
 */

import { createLogger } from '../logger.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import { clearMemoryLocalDataContent } from './localDataMemoryStore.js'
import { scrubChromiumStorageResidue } from './chromiumStorageScrub.js'
import { removeMemoryFromUpdateSnapshots } from './updateInstallPrep.js'
import * as memoryVectorStore from './memoryVectorStore.js'

const log = createLogger('memory.userDataClear')

/**
 * @param {{
 *   userDataPath?: string,
 *   needles?: readonly string[],
 *   flushStorage?: () => Promise<unknown> | unknown,
 *   clearProactiveInbox?: () => Promise<unknown> | unknown,
 * }} [options]
 * @returns {Promise<{
 *   ok: true,
 *   removed: number,
 *   localDataCleared: boolean,
 *   storageFilesRewritten: number,
 *   snapshotMemoryFilesRemoved: number,
 *   proactiveInboxCleared: boolean,
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

  // The proactive inbox quotes reminder and letter text, so clear-all must
  // remove it too. The clear function is injected: services must not import
  // the IPC module that owns the store.
  const clearProactiveInbox = options.clearProactiveInbox

  /** @type {{ ok: true, value: Awaited<ReturnType<typeof runClear>> } | { ok: false, error: unknown }} */
  let outcome
  /** @type {unknown} */
  let inboxFailure
  let inboxFailed = false
  try {
    outcome = { ok: true, value: await runClear() }
  } catch (error) {
    outcome = { ok: false, error }
  } finally {
    // Inbox text must not survive a partial clear, so this runs even when the
    // vector or local-data clear threw. Capture an inbox failure here; the
    // original memory-clear error must win when both fail.
    if (typeof clearProactiveInbox === 'function') {
      try {
        await clearProactiveInbox()
      } catch (error) {
        inboxFailure = error
        inboxFailed = true
      }
    }
  }

  if (!outcome.ok) {
    if (inboxFailed) {
      log.warn('proactive inbox clear failed after memory clear error', {
        source: 'proactive-inbox',
      })
    }
    throw outcome.error
  }
  // A successful memory clear still fails when the inbox cannot be emptied:
  // the caller must not report success while proactive text remains on disk.
  if (inboxFailed) throw inboxFailure
  return outcome.value

  /**
   * @returns {Promise<{
   *   ok: true,
   *   removed: number,
   *   localDataCleared: boolean,
   *   storageFilesRewritten: number,
   *   snapshotMemoryFilesRemoved: number,
   *   proactiveInboxCleared: boolean,
   * }>}
   */
  async function runClear() {
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
        const snapshots = await removeMemoryFromUpdateSnapshots(options.userDataPath, {
          needles: options.needles ?? [],
        })
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
      proactiveInboxCleared: typeof clearProactiveInbox === 'function',
    }
  }
}
