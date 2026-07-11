/**
 * File-based persona system.
 * Reads SOUL.md (core identity) and MEMORY.md (persistent companion memory)
 * from userData/persona/ directory. Falls back to settings.systemPrompt
 * if no SOUL.md file exists.
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { loadPersonaProfileFromReader } from './personaProfileLoader.js'

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
 */
export async function saveSoul(content) {
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
export function getPersonaProfileDir(profileId) {
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
  })
}
