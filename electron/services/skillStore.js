/**
 * Persistent store for auto-generated skill documents.
 * Skills are markdown files stored in userData/skills/.
 * Each skill has a trigger phrase and summary for retrieval.
 */

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { tokenize, Bm25Index } from './bm25Search.js'

const SKILLS_DIR = 'skills'
const INDEX_FILE = 'skills-index.json'
const MAX_SKILLS = 200

/**
 * @typedef {{
 *   id: string
 *   title: string
 *   trigger: string
 *   summary: string
 *   createdAt: string
 *   usedCount: number
 *   lastUsedAt: string | null
 * }} SkillIndexEntry
 */

/** @type {SkillIndexEntry[]} */
let _entries = []
let _loaded = false
const _bm25 = new Bm25Index()
let _bm25Dirty = true

function getSkillsDir() {
  return path.join(app.getPath('userData'), SKILLS_DIR)
}

function getIndexPath() {
  return path.join(getSkillsDir(), INDEX_FILE)
}

function getSkillPath(id) {
  return path.join(getSkillsDir(), `${id}.md`)
}

async function ensureLoaded() {
  if (_loaded) return

  const dir = getSkillsDir()
  await mkdir(dir, { recursive: true })

  try {
    const raw = await readFile(getIndexPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.entries)) {
      _entries = parsed.entries
    }
  } catch {
    _entries = []
  }

  _loaded = true
  _bm25Dirty = true
}

async function saveIndex() {
  await mkdir(getSkillsDir(), { recursive: true })
  await writeFile(getIndexPath(), JSON.stringify({ version: 1, entries: _entries }))
}

function ensureBm25() {
  if (!_bm25Dirty) return
  _bm25.build(_entries.map((e) => ({
    id: e.id,
    content: `${e.title} ${e.trigger} ${e.summary}`,
    layer: 'skill',
  })))
  _bm25Dirty = false
}

export async function saveSkill(id, title, trigger, summary, markdownContent) {
  await ensureLoaded()

  const existing = _entries.findIndex((e) => e.id === id)
  const entry = {
    id,
    title,
    trigger,
    summary,
    createdAt: new Date().toISOString(),
    usedCount: 0,
    lastUsedAt: null,
  }

  if (existing >= 0) {
    entry.createdAt = _entries[existing].createdAt
    entry.usedCount = _entries[existing].usedCount
    _entries[existing] = entry
  } else {
    _entries.push(entry)
  }

  // Write file first — eviction must not delete the just-saved entry
  await writeFile(getSkillPath(id), markdownContent)

  // Evict oldest unused skills if over limit
  if (_entries.length > MAX_SKILLS) {
    _entries.sort((a, b) => {
      // Protect the just-saved entry from eviction
      if (a.id === id) return -1
      if (b.id === id) return 1
      if (a.usedCount !== b.usedCount) return b.usedCount - a.usedCount
      return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
    const removed = _entries.splice(MAX_SKILLS)
    for (const r of removed) {
      await unlink(getSkillPath(r.id)).catch(() => {})
    }
  }
  _bm25Dirty = true
  await saveIndex()
  return entry
}

export async function searchSkills(query, limit = 3) {
  await ensureLoaded()
  ensureBm25()

  const results = _bm25.search(query, { limit, threshold: 0.3 })
  const matched = []

  for (const r of results) {
    const entry = _entries.find((e) => e.id === r.id)
    if (!entry) continue

    try {
      const content = await readFile(getSkillPath(entry.id), 'utf8')
      matched.push({ ...entry, content, relevance: r.score })
    } catch {
      // Skill file missing — skip
    }
  }

  return matched
}

export async function markSkillUsed(id) {
  await ensureLoaded()
  const entry = _entries.find((e) => e.id === id)
  if (!entry) return
  entry.usedCount++
  entry.lastUsedAt = new Date().toISOString()
  await saveIndex()
}

export async function listSkills() {
  await ensureLoaded()
  return _entries.map(({ id, title, trigger, summary, createdAt, usedCount }) => ({
    id, title, trigger, summary, createdAt, usedCount,
  }))
}

export async function getSkill(id) {
  await ensureLoaded()
  const entry = _entries.find((e) => e.id === id)
  if (!entry) return null

  try {
    const content = await readFile(getSkillPath(id), 'utf8')
    return { ...entry, content }
  } catch {
    return null
  }
}

export async function removeSkill(id) {
  await ensureLoaded()
  const index = _entries.findIndex((e) => e.id === id)
  if (index < 0) return false

  _entries.splice(index, 1)
  _bm25Dirty = true
  await unlink(getSkillPath(id)).catch(() => {})
  await saveIndex()
  return true
}

export async function getStats() {
  await ensureLoaded()
  return {
    totalSkills: _entries.length,
    maxSkills: MAX_SKILLS,
    skillsDir: getSkillsDir(),
  }
}
