import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

const STORE_FILENAME = 'memory-vectors.json'
const SAVE_DEBOUNCE_MS = 2_000
const MAX_ENTRIES = 2000

/** @type {Map<string, { content: string, embedding: number[], layer: string, updatedAt: string }>} */
const _index = new Map()

let _loaded = false
let _dirty = false
let _saveTimer = null

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILENAME)
}

async function ensureLoaded() {
  if (_loaded) return

  try {
    const raw = await readFile(getStorePath(), 'utf8')
    const parsed = JSON.parse(raw)

    if (Array.isArray(parsed.entries)) {
      for (const entry of parsed.entries) {
        if (entry?.id && Array.isArray(entry.embedding)) {
          _index.set(entry.id, {
            content: String(entry.content ?? ''),
            embedding: entry.embedding,
            layer: entry.layer ?? 'long_term',
            updatedAt: entry.updatedAt ?? new Date().toISOString(),
          })
        }
      }
    }

    console.info(`[memoryVectorStore] loaded ${_index.size} entries`)
  } catch {
    console.info('[memoryVectorStore] no existing store found, starting fresh')
  }

  _loaded = true
}

function scheduleSave() {
  _dirty = true
  if (_saveTimer) return

  _saveTimer = setTimeout(async () => {
    _saveTimer = null
    if (!_dirty) return
    _dirty = false

    try {
      const entries = [..._index.entries()].map(([id, entry]) => ({
        id,
        ...entry,
      }))

      const dir = path.dirname(getStorePath())
      await mkdir(dir, { recursive: true })
      await writeFile(getStorePath(), JSON.stringify({ version: 1, entries }))
    } catch (err) {
      console.error('[memoryVectorStore] save failed:', err.message)
      _dirty = true
    }
  }, SAVE_DEBOUNCE_MS)
}

function cosineSimilarity(left, right) {
  if (!left?.length || !right?.length || left.length !== right.length) return 0

  let dot = 0
  let magL = 0
  let magR = 0
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i]
    magL += left[i] * left[i]
    magR += right[i] * right[i]
  }
  const denom = Math.sqrt(magL) * Math.sqrt(magR)
  return denom === 0 ? 0 : dot / denom
}

export async function indexMemory(id, content, embedding, layer = 'long_term') {
  await ensureLoaded()

  _index.set(id, {
    content: String(content),
    embedding: Array.from(embedding),
    layer,
    updatedAt: new Date().toISOString(),
  })

  if (_index.size > MAX_ENTRIES) {
    const sorted = [..._index.entries()]
      .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt))
    const excess = _index.size - MAX_ENTRIES
    for (let i = 0; i < excess; i++) {
      _index.delete(sorted[i][0])
    }
  }

  scheduleSave()
}

export async function indexBatch(items) {
  await ensureLoaded()

  for (const item of items) {
    if (item?.id && Array.isArray(item.embedding)) {
      _index.set(item.id, {
        content: String(item.content ?? ''),
        embedding: Array.from(item.embedding),
        layer: item.layer ?? 'long_term',
        updatedAt: new Date().toISOString(),
      })
    }
  }

  if (_index.size > MAX_ENTRIES) {
    const sorted = [..._index.entries()]
      .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt))
    const excess = _index.size - MAX_ENTRIES
    for (let i = 0; i < excess; i++) {
      _index.delete(sorted[i][0])
    }
  }

  scheduleSave()
}

export async function searchSimilar(queryEmbedding, options = {}) {
  await ensureLoaded()

  const { limit = 10, threshold = 0.05, layer = null } = options

  const results = []

  for (const [id, entry] of _index) {
    if (layer && entry.layer !== layer) continue

    const score = cosineSimilarity(queryEmbedding, entry.embedding)
    if (score >= threshold) {
      results.push({ id, content: entry.content, layer: entry.layer, score })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

export async function removeMemory(id) {
  await ensureLoaded()

  const deleted = _index.delete(id)
  if (deleted) scheduleSave()
  return deleted
}

export async function removeMemories(ids) {
  await ensureLoaded()

  let count = 0
  for (const id of ids) {
    if (_index.delete(id)) count++
  }
  if (count) scheduleSave()
  return count
}

export async function clearLayer(layer) {
  await ensureLoaded()

  let count = 0
  for (const [id, entry] of _index) {
    if (entry.layer === layer) {
      _index.delete(id)
      count++
    }
  }
  if (count) scheduleSave()
  return count
}

export async function getStats() {
  await ensureLoaded()

  let longTermCount = 0
  let dailyCount = 0
  for (const entry of _index.values()) {
    if (entry.layer === 'long_term') longTermCount++
    else dailyCount++
  }

  return {
    totalEntries: _index.size,
    longTermCount,
    dailyCount,
    maxEntries: MAX_ENTRIES,
    storePath: getStorePath(),
  }
}

export async function flush() {
  if (!_dirty) return
  if (_saveTimer) {
    clearTimeout(_saveTimer)
    _saveTimer = null
  }
  _dirty = false

  const entries = [..._index.entries()].map(([id, entry]) => ({
    id,
    ...entry,
  }))

  const dir = path.dirname(getStorePath())
  await mkdir(dir, { recursive: true })
  await writeFile(getStorePath(), JSON.stringify({ version: 1, entries }))
}
