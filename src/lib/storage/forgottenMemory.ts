/**
 * Persistence for memory-delete suppression fingerprints.
 *
 * The delete path writes only the hash of the normalized wording; the raw
 * text never reaches this key. Reads are capped and validated so a corrupt
 * blob or a hand-edited list cannot grow without bound.
 */

import {
  addForgottenMemoryFingerprint,
  parseForgottenMemoryFingerprints,
  removeForgottenMemoryFingerprint,
} from '../../features/memory/forgottenMemories.ts'
import {
  MEMORY_FORGOTTEN_STORAGE_KEY,
  readJsonValidated,
  writeJson,
} from './core.ts'

/** Read the tombstones used to keep a deleted memory from being re-extracted. */
export function loadForgottenMemoryFingerprints(): string[] {
  return readJsonValidated(
    MEMORY_FORGOTTEN_STORAGE_KEY,
    [],
    parseForgottenMemoryFingerprints,
  )
}

/** Record a single-memory delete. Only the fingerprint is persisted. */
export function rememberForgottenMemory(content: string): void {
  const current = loadForgottenMemoryFingerprints()
  const next = addForgottenMemoryFingerprint(current, content)
  if (next.length === current.length && next.every((entry, index) => entry === current[index])) return
  writeJson(MEMORY_FORGOTTEN_STORAGE_KEY, next)
}

/** A manual re-add is explicit user intent, so lift the suppression. */
export function forgetMemorySuppression(content: string): void {
  const current = loadForgottenMemoryFingerprints()
  const next = removeForgottenMemoryFingerprint(current, content)
  if (next.length === current.length) return
  writeJson(MEMORY_FORGOTTEN_STORAGE_KEY, next)
}
