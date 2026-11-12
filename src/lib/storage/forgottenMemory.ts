/**
 * Persistence for memory-delete suppression fingerprints.
 *
 * The delete path writes only a salted hash of the normalized wording; the raw
 * text never reaches these keys. The per-install salt is stored next to the
 * tombstones and is dropped with them by the clear-all reset. Reads are capped
 * and validated so a corrupt blob or a hand-edited list cannot grow without
 * bound.
 */

import {
  addForgottenMemoryFingerprint,
  isValidForgottenMemorySalt,
  parseForgottenMemoryFingerprints,
  removeForgottenMemoryFingerprint,
} from '../../features/memory/forgottenMemories.ts'
import {
  MEMORY_FORGOTTEN_SALT_STORAGE_KEY,
  MEMORY_FORGOTTEN_STORAGE_KEY,
  readJsonValidated,
  writeJson,
} from './core.ts'

function parseSalt(raw: unknown): string | null {
  return isValidForgottenMemorySalt(raw) ? raw : null
}

/**
 * Read the per-install salt. Missing or malformed values return an empty
 * string; matching then treats every tombstone as unusable rather than
 * hashing with a guessed salt.
 */
export function loadForgottenMemorySalt(): string {
  return readJsonValidated(MEMORY_FORGOTTEN_SALT_STORAGE_KEY, '', parseSalt)
}

/**
 * Read the tombstones used to keep a deleted memory from being re-extracted.
 * A list without a readable salt cannot match anything.
 */
export function loadForgottenMemoryFingerprints(): string[] {
  return readJsonValidated(
    MEMORY_FORGOTTEN_STORAGE_KEY,
    [],
    parseForgottenMemoryFingerprints,
  )
}

/** Generate a 128-bit hex salt without pulling in a dependency. */
function createSalt(): string {
  const bytes = new Uint8Array(16)
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
  } else {
    // Renderer builds always expose Web Crypto; this keeps tests and very old
    // engines working without turning a missing API into a crash.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  let salt = ''
  for (const byte of bytes) salt += byte.toString(16).padStart(2, '0')
  return salt
}

function ensureSalt(): string {
  const existing = loadForgottenMemorySalt()
  if (existing) return existing
  const salt = createSalt()
  writeJson(MEMORY_FORGOTTEN_SALT_STORAGE_KEY, salt)
  return salt
}

/** Record a single-memory delete. Only the salted fingerprint is persisted. */
export function rememberForgottenMemory(content: string): void {
  const salt = ensureSalt()
  const current = loadForgottenMemoryFingerprints()
  const next = addForgottenMemoryFingerprint(current, content, salt)
  if (next.length === current.length && next.every((entry, index) => entry === current[index])) return
  writeJson(MEMORY_FORGOTTEN_STORAGE_KEY, next)
}

/** A manual re-add is explicit user intent, so lift the suppression. */
export function forgetMemorySuppression(content: string): void {
  const salt = loadForgottenMemorySalt()
  const current = loadForgottenMemoryFingerprints()
  const next = removeForgottenMemoryFingerprint(current, content, salt)
  if (next.length === current.length) return
  writeJson(MEMORY_FORGOTTEN_STORAGE_KEY, next)
}
