// Remove long-term memory bytes from Chromium's localStorage without taking
// settings, chat, onboarding, or any other key with them.
//
// `localStorage.removeItem` only writes a LevelDB tombstone, so the old text
// stays on disk. The main process can clear the origin's localStorage store,
// but that wipes everything on the shared origin. This procedure therefore:
//   1. flushes debounced writes,
//   2. snapshots every key that must survive,
//   3. asks the main process to clear the storage backend,
//   4. writes the snapshot back byte-for-byte.
// If the bridge call fails the snapshot is still restored and the memory keys
// are still removed, so a failed reset can never lose non-memory data.

import {
  flushPendingStorageWrites,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  MEMORY_V1_BACKUP_STORAGE_KEY,
} from './core.ts'
import { getRedactedLogErrorMessage } from '../logRedaction.ts'

/** Keys that must never survive the memory reset. */
export const MEMORY_LOCAL_STORAGE_DROP_KEYS: readonly string[] = Object.freeze([
  MEMORY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_V1_BACKUP_STORAGE_KEY,
])

/** Minimal slice of window.desktopPet the reset needs (fakeable in tests). */
export interface LocalStorageResetBridge {
  memoryResetLocalStorage?: () => Promise<unknown>
}

export interface ResetLocalStorageOptions {
  dropKeys?: readonly string[]
  storage?: Storage | null
  bridge?: LocalStorageResetBridge | null
  flush?: () => boolean
}

export interface ResetLocalStorageResult {
  ok: boolean
  /** True when the main-process clear actually ran. */
  resetCalled: boolean
  keptKeys: number
  removedKeys: number
}

interface StorageEntry {
  key: string
  value: string
}

function resolveStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

function resolveBridge(): LocalStorageResetBridge | null {
  if (typeof window === 'undefined') return null
  return window.desktopPet ?? null
}

/**
 * Read every key/value pair before the clear. Returns null when the Storage
 * implementation cannot enumerate; the caller must then avoid the destructive
 * clear rather than risk dropping keys it could not snapshot.
 */
function snapshotStorage(storage: Storage): StorageEntry[] | null {
  if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return null
  const entries: StorageEntry[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (typeof key !== 'string') continue
    const value = storage.getItem(key)
    if (value !== null) entries.push({ key, value })
  }
  return entries
}

/**
 * Reset Chromium's localStorage while preserving every key outside the drop
 * list. Never throws: a failed bridge still restores the snapshot and removes
 * the dropped keys.
 */
export async function resetLocalStorage(
  options: ResetLocalStorageOptions = {},
): Promise<ResetLocalStorageResult> {
  const storage = options.storage === undefined ? resolveStorage() : options.storage
  const dropKeys = new Set(options.dropKeys ?? MEMORY_LOCAL_STORAGE_DROP_KEYS)
  if (!storage) {
    return { ok: true, resetCalled: false, keptKeys: 0, removedKeys: 0 }
  }

  const flush = options.flush ?? flushPendingStorageWrites
  try {
    flush()
  } catch {
    // A failed flush must not abort the reset; the pending value stays pending
    // and the in-memory snapshot below still reflects what is on disk.
  }

  const snapshot = snapshotStorage(storage)
  if (snapshot === null) {
    // Enumeration is a precondition for keeping data. Only remove the drop
    // list and leave the backend untouched.
    let removedKeys = 0
    for (const key of dropKeys) {
      try {
        storage.removeItem(key)
        removedKeys += 1
      } catch {
        // Best effort; storage may be unavailable.
      }
    }
    return { ok: false, resetCalled: false, keptKeys: 0, removedKeys }
  }

  const kept = snapshot.filter((entry) => !dropKeys.has(entry.key))
  const bridge = options.bridge === undefined ? resolveBridge() : options.bridge
  let ok = true
  let resetCalled = false

  if (typeof bridge?.memoryResetLocalStorage === 'function') {
    try {
      await bridge.memoryResetLocalStorage()
      resetCalled = true
    } catch (error) {
      ok = false
      // The text being restored is user data; never log keys or values here.
      console.warn('[memory] localStorage reset bridge failed:', getRedactedLogErrorMessage(error))
    }
  }

  let keptKeys = 0
  for (const { key, value } of kept) {
    try {
      storage.setItem(key, value)
      keptKeys += 1
    } catch (error) {
      ok = false
      console.warn('[memory] failed to restore a storage key:', getRedactedLogErrorMessage(error))
    }
  }

  let removedKeys = 0
  for (const key of dropKeys) {
    try {
      storage.removeItem(key)
      removedKeys += 1
    } catch {
      // A missing key is already the desired state.
    }
  }

  return { ok, resetCalled, keptKeys, removedKeys }
}
