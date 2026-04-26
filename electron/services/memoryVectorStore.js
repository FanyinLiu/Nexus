import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { Worker } from 'node:worker_threads'
import { Bm25Index } from './bm25Search.js'

const STORE_FILENAME = 'memory-vectors.json'
// 30s debounce: with MAX_ENTRIES=2000 the JSON file is up to ~60MB, so
// rewriting on every 2-second tick during an active chat session is real
// SSD wear + I/O contention. 30s is still fast enough for "the user
// closes the app and last chat's memories are persisted" since the
// `before-quit` handler in ipcRegistry.js calls terminate() → flush()
// to drain any pending dirty state before exit. M1 tracker — proper
// fix is incremental writes (append-only log + periodic compaction).
const SAVE_DEBOUNCE_MS = 30_000
const MAX_ENTRIES = 2000

/** @type {Map<string, { content: string, embedding: number[], layer: string, updatedAt: string }>} */
const _index = new Map()

let _loaded = false
let _loadPromise = null
let _dirty = false
let _saveTimer = null
let _savePromise = null

// ── Worker thread for search ──

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
let _worker = null
let _searchRequestId = 0
/** @type {Map<number, { resolve: Function, reject: Function }>} */
const _pendingSearches = new Map()

function getWorker() {
  if (_worker) return _worker

  _worker = new Worker(path.join(__dirname, 'vectorSearchWorker.js'))
  _worker.on('message', (msg) => {
    if (msg.type === 'search-result') {
      const pending = _pendingSearches.get(msg.requestId)
      if (pending) {
        _pendingSearches.delete(msg.requestId)
        pending.resolve(msg.results)
      }
    }
  })
  _worker.on('error', (err) => {
    console.error('[memoryVectorStore] worker error:', err.message)
    for (const pending of _pendingSearches.values()) {
      pending.reject(err)
    }
    _pendingSearches.clear()
    _worker = null
  })
  _worker.unref()
  return _worker
}

// ── Persistence ──

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILENAME)
}

async function ensureLoaded() {
  if (_loaded) return
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
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
    _loadPromise = null
  })()

  return _loadPromise
}

async function doSave() {
  if (_savePromise) return _savePromise

  _savePromise = (async () => {
    try {
      const entries = [..._index.entries()].map(([id, entry]) => ({
        id,
        ...entry,
      }))

      const dir = path.dirname(getStorePath())
      await mkdir(dir, { recursive: true })

      const storePath = getStorePath()
      const tempPath = storePath + '.tmp'
      await writeFile(tempPath, JSON.stringify({ version: 1, entries }))
      await rename(tempPath, storePath)
    } catch (err) {
      console.error('[memoryVectorStore] save failed:', err.message)
      _dirty = true
    } finally {
      _savePromise = null
      // If writes arrived during this save, schedule another save
      if (_dirty) scheduleSave()
    }
  })()

  return _savePromise
}

function scheduleSave() {
  _dirty = true
  if (_saveTimer) return

  _saveTimer = setTimeout(async () => {
    _saveTimer = null
    if (!_dirty) return
    _dirty = false
    await doSave()
  }, SAVE_DEBOUNCE_MS)
}

// ── Eviction ──
// Map maintains insertion order. We re-insert entries on update so the oldest
// (by updatedAt) are always near the front. Eviction is O(excess) instead of
// O(n log n).

function evictExcess() {
  if (_index.size <= MAX_ENTRIES) return

  const excess = _index.size - MAX_ENTRIES
  const iter = _index.keys()
  for (let i = 0; i < excess; i++) {
    const { value: key } = iter.next()
    _index.delete(key)
  }
}

function upsertEntry(id, entry) {
  // Delete first so re-insertion moves the key to the end (most recent).
  _index.delete(id)
  _index.set(id, entry)
  _bm25Dirty = true
  _snapshotDirty = true
}

// ── Public API ──

export async function indexMemory(id, content, embedding, layer = 'long_term') {
  await ensureLoaded()

  upsertEntry(id, {
    content: String(content),
    embedding: Array.from(embedding),
    layer,
    updatedAt: new Date().toISOString(),
  })

  evictExcess()
  scheduleSave()
}

export async function indexBatch(items) {
  await ensureLoaded()

  for (const item of items) {
    if (item?.id && Array.isArray(item.embedding)) {
      upsertEntry(item.id, {
        content: String(item.content ?? ''),
        embedding: Array.from(item.embedding),
        layer: item.layer ?? 'long_term',
        updatedAt: new Date().toISOString(),
      })
    }
  }

  evictExcess()
  scheduleSave()
}

/** @type {Array<{ id: string, content: string, embedding: number[], layer: string }> | null} */
let _workerSnapshotCache = null
let _snapshotDirty = true

function getWorkerSnapshot() {
  if (_workerSnapshotCache && !_snapshotDirty) return _workerSnapshotCache
  const entries = []
  for (const [id, entry] of _index) {
    entries.push({ id, content: entry.content, embedding: entry.embedding, layer: entry.layer })
  }
  _workerSnapshotCache = entries
  _snapshotDirty = false
  return entries
}

export async function searchSimilar(queryEmbedding, options = {}) {
  await ensureLoaded()

  const { limit = 10, threshold = 0.05, layer = null } = options

  const entries = getWorkerSnapshot()

  const requestId = ++_searchRequestId
  const worker = getWorker()

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      _pendingSearches.delete(requestId)
      reject(new Error('Vector search timed out'))
    }, 10_000)

    _pendingSearches.set(requestId, {
      resolve: (results) => {
        clearTimeout(timeoutId)
        resolve(results)
      },
      reject: (err) => {
        clearTimeout(timeoutId)
        reject(err)
      },
    })

    worker.postMessage({
      type: 'search',
      requestId,
      queryEmbedding: Array.from(queryEmbedding),
      entries,
      limit,
      threshold,
      layer,
    })
  })
}

// ── BM25 keyword search ──

let _bm25 = new Bm25Index()
let _bm25Dirty = true

function ensureBm25() {
  if (!_bm25Dirty) return
  const entries = []
  for (const [id, entry] of _index) {
    entries.push({ id, content: entry.content, layer: entry.layer })
  }
  _bm25.build(entries)
  _bm25Dirty = false
}

export async function searchKeyword(query, options = {}) {
  await ensureLoaded()
  ensureBm25()
  return _bm25.search(query, options)
}

/**
 * Hybrid search: 70% vector cosine + 30% BM25 keyword.
 * Over-fetches 4× from each source before merging.
 */
export async function searchHybrid(queryEmbedding, queryText, options = {}) {
  await ensureLoaded()

  const { limit = 10, threshold = 0.02, layer = null } = options
  const overFetch = limit * 4

  // Run vector + BM25 in parallel
  const [vectorResults, keywordResults] = await Promise.all([
    searchSimilar(queryEmbedding, { limit: overFetch, threshold: 0, layer }),
    (async () => {
      ensureBm25()
      return _bm25.search(queryText, { limit: overFetch, threshold: 0, layer })
    })(),
  ])

  // Normalize scores to [0, 1] within each result set
  const maxVec = vectorResults.length ? vectorResults[0].score : 1
  const maxKw = keywordResults.length ? keywordResults[0].score : 1

  const scoreMap = new Map()

  for (const r of vectorResults) {
    const normVec = maxVec > 0 ? r.score / maxVec : 0
    scoreMap.set(r.id, {
      id: r.id,
      content: r.content,
      layer: r.layer,
      vectorScore: normVec,
      keywordScore: 0,
      score: 0,
    })
  }

  for (const r of keywordResults) {
    const normKw = maxKw > 0 ? r.score / maxKw : 0
    const existing = scoreMap.get(r.id)
    if (existing) {
      existing.keywordScore = normKw
    } else {
      scoreMap.set(r.id, {
        id: r.id,
        content: r.content,
        layer: r.layer,
        vectorScore: 0,
        keywordScore: normKw,
        score: 0,
      })
    }
  }

  const results = []
  for (const entry of scoreMap.values()) {
    entry.score = entry.vectorScore * 0.7 + entry.keywordScore * 0.3
    if (entry.score >= threshold) {
      results.push(entry)
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

export async function removeMemory(id) {
  await ensureLoaded()

  const deleted = _index.delete(id)
  if (deleted) {
    _bm25Dirty = true
    _snapshotDirty = true
    scheduleSave()
  }
  return deleted
}

export async function removeMemories(ids) {
  await ensureLoaded()

  let count = 0
  for (const id of ids) {
    if (_index.delete(id)) count++
  }
  if (count) {
    _bm25Dirty = true
    _snapshotDirty = true
    scheduleSave()
  }
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
  if (count) {
    _bm25Dirty = true
    _snapshotDirty = true
    scheduleSave()
  }
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

  // Use doSave() to avoid racing with a concurrent save
  await doSave()
}

export async function terminate() {
  await flush()
  if (_worker) {
    await _worker.terminate()
    _worker = null
  }
}
