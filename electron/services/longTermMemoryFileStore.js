// Canonical long-term memory store for the main process.
//
// Long-term memory used to live in Chromium's localStorage. Deleting a key
// there only writes a LevelDB tombstone, so the wording stayed recoverable on
// disk after "clear memory". A JSON file lets the purge delete real bytes.
//
// The renderer cache stays synchronous; this store owns the durable copy.
// load() reports `exists` because the renderer must distinguish "never stored"
// (first migration) from "stored empty" (the user deleted every memory — the
// legacy key must not resurrect rows in that case).
//
// An existing file that cannot be parsed is never reported as empty: it is
// moved aside as a `.corrupt-<timestamp>.json` sibling first, so a later save
// cannot silently replace the user's bytes with an empty array.

import fsp from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteJson } from './localDataStoreCore.js'

const FILE_FORMAT = 'nexus-long-term-memory'
const FILE_VERSION = 1
const MAX_MEMORIES = 5_000
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** Stable codes so the renderer can log failures without parsing prose. */
export const LONG_TERM_MEMORY_ERROR_CODES = Object.freeze({
  INVALID_PAYLOAD: 'NEXUS_ERR_MEMORY_LONG_TERM_INVALID_PAYLOAD',
  TOO_LARGE: 'NEXUS_ERR_MEMORY_LONG_TERM_TOO_LARGE',
})

function memoryError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code)
  error.code = code
  return error
}

/**
 * The file is an envelope, not a bare array, so future metadata can be added
 * without guessing whether a parsed array is a legacy blob or this format.
 * Returns null for anything that is not this envelope; the caller must treat
 * that as corruption rather than as an empty store.
 * @param {string} rawText
 * @returns {unknown[] | null}
 */
function parseEnvelope(rawText) {
  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = /** @type {{ format?: unknown, memories?: unknown }} */ (parsed)
  if (record.format !== FILE_FORMAT || !Array.isArray(record.memories)) return null
  return record.memories
}

/** Filesystem-safe UTC stamp, e.g. `20261022T120000Z`. */
function corruptTimestamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Move an unreadable file aside so the original bytes survive the next save.
 * The backup stays next to the store and is removed by clear().
 * @param {string} resolvedPath
 * @returns {Promise<string | null>} Backup path, or null when the move failed.
 */
async function quarantineCorruptFile(resolvedPath) {
  const directory = path.dirname(resolvedPath)
  const base = path.basename(resolvedPath, path.extname(resolvedPath))
  const stamp = corruptTimestamp()
  let backupPath = path.join(directory, `${base}.corrupt-${stamp}.json`)
  let suffix = 1
  while (await pathExists(backupPath)) {
    backupPath = path.join(directory, `${base}.corrupt-${stamp}-${suffix}.json`)
    suffix += 1
  }
  try {
    await fsp.rename(resolvedPath, backupPath)
    return backupPath
  } catch {
    return null
  }
}

/**
 * Reject payloads the renderer should never send: not an array, non-object
 * rows, too many rows, or a serialized size that would stress atomic writes.
 * @param {unknown} memories
 * @returns {unknown[]}
 */
function validateMemories(memories) {
  if (!Array.isArray(memories)) {
    throw memoryError(LONG_TERM_MEMORY_ERROR_CODES.INVALID_PAYLOAD, 'memories must be an array')
  }
  if (memories.length > MAX_MEMORIES) {
    throw memoryError(LONG_TERM_MEMORY_ERROR_CODES.TOO_LARGE, `memories must contain at most ${MAX_MEMORIES} rows`)
  }
  for (const row of memories) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw memoryError(LONG_TERM_MEMORY_ERROR_CODES.INVALID_PAYLOAD, 'memory rows must be plain objects')
    }
  }
  const serialized = JSON.stringify(memories)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
    throw memoryError(LONG_TERM_MEMORY_ERROR_CODES.TOO_LARGE, 'memories exceed the file size budget')
  }
  return memories
}

/**
 * Build a store bound to one explicit file path. Tests point it at a temp dir;
 * production resolves the path from app.getPath('userData').
 *
 * @param {{ filePath: string, maxBytes?: number }} options
 * @returns {{
 *   load: () => Promise<{ exists: boolean, memories: unknown[], corrupt?: boolean, backupPath?: string | null }>,
 *   save: (memories: unknown[]) => Promise<{ ok: boolean, count: number }>,
 *   clear: () => Promise<{ ok: boolean }>,
 *   filePath: string,
 * }}
 */
export function createLongTermMemoryFileStore({ filePath, maxBytes = MAX_FILE_BYTES }) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('long-term memory store requires a file path')
  }
  const resolvedPath = path.resolve(filePath)

  async function load() {
    // No read cache: `exists` and `memories` must describe the same on-disk
    // state. A cached array would outlive a clear performed through another
    // handle to the same file.
    let rawText
    try {
      rawText = await fsp.readFile(resolvedPath, 'utf8')
    } catch (error) {
      if (/** @type {{ code?: unknown }} */ (error)?.code === 'ENOENT') {
        return { exists: false, memories: [] }
      }
      const backupPath = await quarantineCorruptFile(resolvedPath)
      return { exists: false, corrupt: true, backupPath, memories: [] }
    }
    const memories = parseEnvelope(rawText)
    if (memories === null) {
      const backupPath = await quarantineCorruptFile(resolvedPath)
      return { exists: false, corrupt: true, backupPath, memories: [] }
    }
    return { exists: true, memories }
  }

  async function save(memories) {
    const validated = validateMemories(memories)
    const serializedBytes = Buffer.byteLength(JSON.stringify(validated), 'utf8')
    if (serializedBytes > maxBytes) {
      throw memoryError(LONG_TERM_MEMORY_ERROR_CODES.TOO_LARGE, 'memories exceed the file size budget')
    }
    const payload = { format: FILE_FORMAT, version: FILE_VERSION, memories: [...validated] }
    await atomicWriteJson(resolvedPath, payload, { fileMode: 0o600 })
    return { ok: true, count: validated.length }
  }

  async function clear() {
    await fsp.rm(resolvedPath, { force: true })
    // atomicWriteJson writes `<file>.<pid>.<ts>.tmp` beside the target. A
    // crash can leave one behind, and it still contains the memory wording.
    // Quarantined corrupt files use the same directory and contain the same
    // wording, so they are removed by the same sweep.
    const directory = path.dirname(resolvedPath)
    const base = path.basename(resolvedPath)
    const backupBase = path.basename(resolvedPath, path.extname(resolvedPath))
    let entries
    try {
      entries = await fsp.readdir(directory)
    } catch {
      return { ok: true }
    }
    const siblings = entries.filter((name) => {
      if (name.startsWith(`${base}.`) && (name.endsWith('.tmp') || name.endsWith('.bak'))) return true
      return name.startsWith(`${backupBase}.corrupt-`) && name.endsWith('.json')
    })
    await Promise.all(siblings.map((name) => fsp.rm(path.join(directory, name), { force: true })))
    return { ok: true }
  }

  return { load, save, clear, filePath: resolvedPath }
}

/**
 * Production path under userData. Kept separate so callers do not need to
 * import Electron just to compute it.
 * @param {string} userDataPath
 * @returns {string}
 */
export function resolveLongTermMemoryFilePath(userDataPath) {
  return path.join(userDataPath, 'memory', 'long-term-memory.json')
}
