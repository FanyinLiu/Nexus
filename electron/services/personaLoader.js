/**
 * File-based persona system.
 * Reads SOUL.md (core identity) and MEMORY.md (persistent companion memory)
 * from userData/persona/ directory. Falls back to settings.systemPrompt
 * if no SOUL.md file exists.
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

const PERSONA_DIR = 'persona'
const SOUL_FILE = 'SOUL.md'
const MEMORY_FILE = 'MEMORY.md'

let _soulCache = { content: '', mtime: 0 }
let _memoryCache = { content: '', mtime: 0 }

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

  return {
    personaDir: dir,
    soulPath: getSoulPath(),
    memoryPath: getMemoryPath(),
  }
}

export function getPersonaPaths() {
  return {
    personaDir: getPersonaDir(),
    soulPath: getSoulPath(),
    memoryPath: getMemoryPath(),
  }
}
