// @ts-nocheck
// Shared skeleton for the small main-process JSON file stores. Two variants:
//   - createSyncJsonFileStore: sync load-once read (window-creation paths
//     need bounds synchronously) plus debounced whole-cache persists.
//   - createAsyncJsonFileStore: async ensureLoaded plus immediate whole-cache
//     saves; callers serialise mutations themselves when they need to.
// All writes go through atomicWriteJson. Debounced persist failures are
// reported through onPersistError and never thrown, matching the stores this
// replaces. flushPending() cancels the debounce and writes immediately so
// an update install cannot quit while a timer is still waiting.

import fs from 'node:fs'
import fsp from 'node:fs/promises'

import { atomicWriteJson } from './localDataStoreCore.js'

const DEFAULT_WRITE_DEBOUNCE_MS = 400

// Parsed JSON must be an object; anything else (or a read/parse failure,
// reported as null) starts the store empty.
function defaultNormalize(parsed) {
  return parsed && typeof parsed === 'object' ? parsed : {}
}

export function createSyncJsonFileStore({
  getStorePath,
  normalize = defaultNormalize,
  debounceMs = DEFAULT_WRITE_DEBOUNCE_MS,
  onPersistError = () => {},
}) {
  let cache = null
  let writeTimer = null
  /** @type {Promise<boolean> | null} */
  let pendingWrite = null

  function load() {
    if (cache !== null) return cache
    try {
      cache = normalize(JSON.parse(fs.readFileSync(getStorePath(), 'utf8')))
    } catch {
      cache = normalize(null)
    }
    return cache
  }

  // Writes the entire cache object (not the value that triggered the
  // persist) after a quiet period, so rapid successive saves coalesce.
  function persistDebounced() {
    if (writeTimer) clearTimeout(writeTimer)
    writeTimer = setTimeout(() => {
      writeTimer = null
      const write = atomicWriteJson(getStorePath(), cache).then(
        () => true,
        (error) => {
          onPersistError(error)
          return false
        },
      )
      pendingWrite = write
      void write.finally(() => {
        if (pendingWrite === write) pendingWrite = null
      })
    }, debounceMs)
  }

  // Install prep awaits this. Failures are reported and returned, not thrown,
  // so the store still matches STORE-1. The caller aborts install on false.
  async function flushPending() {
    const hadTimer = writeTimer !== null
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
    let inFlightOk = true
    if (pendingWrite) {
      inFlightOk = await pendingWrite
      pendingWrite = null
    }
    if (!hadTimer) return inFlightOk
    if (cache === null) return inFlightOk
    try {
      await atomicWriteJson(getStorePath(), cache)
      return true
    } catch (error) {
      onPersistError(error)
      return false
    }
  }

  // Clear-all path: cancel the debounce, let an already-started write finish,
  // then remove the file and reset the cache. Without the cancel a timer that
  // was armed before the clear could recreate the file afterwards. A failed
  // delete keeps the cache untouched so memory still matches what is on disk;
  // the caller must treat false as a failed clear, not as success.
  async function clear() {
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
    if (pendingWrite) {
      await pendingWrite
      pendingWrite = null
    }
    try {
      await fsp.rm(getStorePath(), { force: true })
    } catch (error) {
      // force:true already suppresses ENOENT; an explicit check keeps a
      // missing file a success for callers that observe the raw error.
      if (/** @type {{ code?: string }} */ (error).code === 'ENOENT') {
        cache = null
        return true
      }
      onPersistError(error)
      return false
    }
    cache = null
    return true
  }

  return { load, persistDebounced, flushPending, clear }
}

export function createAsyncJsonFileStore({
  getStorePath,
  normalize = defaultNormalize,
  serialize = (cache) => cache,
  fileMode,
  onPersistError = (error) => {
    console.warn('[jsonFileStore] persist failed:', error)
  },
}) {
  let cache = null

  async function ensureLoaded() {
    if (cache !== null) return cache
    try {
      cache = normalize(JSON.parse(await fsp.readFile(getStorePath(), 'utf8')))
    } catch {
      cache = normalize(null)
    }
    return cache
  }

  async function save() {
    try {
      await atomicWriteJson(getStorePath(), serialize(cache), { fileMode })
    } catch (error) {
      onPersistError(error)
    }
  }

  return { ensureLoaded, save }
}
