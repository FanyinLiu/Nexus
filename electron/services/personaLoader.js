/**
 * File-based persona system.
 * Reads SOUL.md (core identity) and MEMORY.md (persistent companion memory)
 * from userData/persona/ directory. Falls back to settings.systemPrompt
 * if no SOUL.md file exists.
 */

import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { loadPersonaProfileFromReader, resolvePersonaProfileSoulPath } from './personaProfileLoader.js'

const PERSONA_DIR = 'persona'
const SOUL_FILE = 'SOUL.md'
const MEMORY_FILE = 'MEMORY.md'
const USER_DATA_DISPLAY_ROOT = 'app-user-data'

let _soulCache = { content: '', mtime: 0 }
let _memoryCache = { content: '', mtime: 0 }

function getDisplayPath(...segments) {
  return [USER_DATA_DISPLAY_ROOT, ...segments]
    .map((segment) => String(segment).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function getPersonaDir() {
  return path.join(app.getPath('userData'), PERSONA_DIR)
}

function getSoulPath() {
  return path.join(getPersonaDir(), SOUL_FILE)
}

function getMemoryPath() {
  return path.join(getPersonaDir(), MEMORY_FILE)
}

async function readFileIfChanged(filePath, cache) {
  try {
    const { mtimeMs } = await stat(filePath)
    if (mtimeMs === cache.mtime) {
      return cache.content
    }
    const content = await readFile(filePath, 'utf8')
    cache.content = content.trim()
    cache.mtime = mtimeMs
    return cache.content
  } catch {
    return ''
  }
}

/**
 * Load the SOUL.md persona file. Returns empty string if not found.
 */
export async function loadSoul() {
  return readFileIfChanged(getSoulPath(), _soulCache)
}

/**
 * Load the companion MEMORY.md file. Returns empty string if not found.
 */
export async function loadPersonaMemory() {
  return readFileIfChanged(getMemoryPath(), _memoryCache)
}

/**
 * Save content to SOUL.md.
 * Empty content clears an override by removing the file. Writing it would
 * create a 0-byte SOUL.md, and a restore must not create MEMORY.md or any
 * other new empty file. A missing file already loads as the fallback.
 */
export async function saveSoul(content) {
  if (content === '') {
    await removeFileIfPresent(getSoulPath())
    _soulCache = { content: '', mtime: 0 }
    return
  }
  const dir = getPersonaDir()
  await mkdir(dir, { recursive: true })
  await writeFile(getSoulPath(), content, 'utf8')
  _soulCache = { content: content.trim(), mtime: Date.now() }
}

/**
 * Save content to companion MEMORY.md.
 */
export async function savePersonaMemory(content) {
  const dir = getPersonaDir()
  await mkdir(dir, { recursive: true })
  await writeFile(getMemoryPath(), content, 'utf8')
  _memoryCache = { content: content.trim(), mtime: Date.now() }
}

/**
 * Initialize persona directory with default SOUL.md if it doesn't exist.
 */
export async function ensurePersonaDir(defaultSoulContent) {
  const dir = getPersonaDir()
  await mkdir(dir, { recursive: true })

  try {
    await readFile(getSoulPath(), 'utf8')
  } catch {
    if (defaultSoulContent) {
      await writeFile(getSoulPath(), defaultSoulContent, 'utf8')
    }
  }

  return getPersonaPaths()
}

export function getPersonaAbsolutePaths() {
  return {
    personaDir: getPersonaDir(),
    soulPath: getSoulPath(),
    memoryPath: getMemoryPath(),
  }
}

export function getPersonaPaths() {
  return {
    personaDir: getDisplayPath(PERSONA_DIR),
    soulPath: getDisplayPath(PERSONA_DIR, SOUL_FILE),
    memoryPath: getDisplayPath(PERSONA_DIR, MEMORY_FILE),
  }
}

/**
 * Replace one profile's soul.md. Returns false when the id could point at a
 * different directory than the loader uses. Other persona files stay put.
 * @param {unknown} profileId
 * @param {string} content
 * @returns {Promise<boolean>}
 */
export async function savePersonaProfileSoul(profileId, content) {
  const filePath = resolvePersonaProfileSoulPath(app.getPath('userData'), profileId)
  if (!filePath) return false
  if (content === '') {
    await removeFileIfPresent(filePath)
    return true
  }
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return true
}

/**
 * Remove a persona file when an empty save clears it.
 * A missing file is already the empty state, so ENOENT is success and no
 * sibling file is created to stand in for it.
 * @param {string} filePath
 */
async function removeFileIfPresent(filePath) {
  try {
    await unlink(filePath)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
}

export async function writePersonaProfile(profileId, files) {
  const dir = getPersonaProfileDir(profileId)
  await mkdir(dir, { recursive: true })
  await Promise.all(
    Object.entries(files).map(([filename, content]) =>
      writeFile(path.join(dir, filename), content, 'utf8'),
    ),
  )
  return { dir: getPersonaProfileDisplayDir(profileId) }
}

// ── v2: per-profile multi-file persona (soul/memory/examples/style/voice/tools)

const V2_PERSONAS_DIR = 'personas'

/**
 * Absolute path of the per-profile persona directory. Profiles are stored
 * flat: userData/personas/<profileId>/. Missing directory is fine — the
 * v2 loader treats every file as optional.
 */
function getPersonaProfileDir(profileId) {
  const safe = String(profileId ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  return path.join(app.getPath('userData'), V2_PERSONAS_DIR, safe || 'default')
}

export function getPersonaProfileDisplayDir(profileId) {
  const safe = String(profileId ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  return getDisplayPath(V2_PERSONAS_DIR, safe || 'default')
}

/**
 * Read one file from a persona profile directory. Returns null when the
 * file doesn't exist (so the v2 loader can distinguish "absent" from
 * "empty string"); other I/O errors surface.
 */
async function readPersonaFile(profileId, relativePath) {
  const abs = path.join(getPersonaProfileDir(profileId), relativePath)
  try {
    return await readFile(abs, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

export async function loadPersonaProfile(profileId) {
  return loadPersonaProfileFromReader({
    id: profileId,
    rootDir: getPersonaProfileDisplayDir(profileId),
    read: (relativePath) => readPersonaFile(profileId, relativePath),
    soulMtime: () => readPersonaSoulMtime(profileId),
  })
}

/**
 * mtime of one profile's soul.md, or null when the file is absent. The
 * renderer uses it to attribute a cached persona; it cannot stat itself.
 * @param {unknown} profileId
 * @returns {Promise<number | null>}
 */
async function readPersonaSoulMtime(profileId) {
  try {
    const { mtimeMs } = await stat(path.join(getPersonaProfileDir(profileId), 'soul.md'))
    return mtimeMs
  } catch {
    return null
  }
}
