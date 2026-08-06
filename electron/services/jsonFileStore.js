// Shared skeleton for the small main-process JSON file stores. Two variants:
//   - createSyncJsonFileStore: sync load-once read (window-creation paths
//     need bounds synchronously) plus debounced whole-cache persists.
//   - createAsyncJsonFileStore: async ensureLoaded plus immediate whole-cache
//     saves; callers serialise mutations themselves when they need to.
// All writes go through atomicWriteJson. Debounced persist failures are
// reported through onPersistError and never thrown, matching the stores this
// replaces.

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
      atomicWriteJson(getStorePath(), cache).catch(onPersistError)
    }, debounceMs)
  }

  return { load, persistDebounced }
}

export function createAsyncJsonFileStore({
  getStorePath,
  normalize = defaultNormalize,
  serialize = (cache) => cache,
  fileMode,
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
    await atomicWriteJson(getStorePath(), serialize(cache), { fileMode })
  }

  return { ensureLoaded, save }
}
