import { readFile, writeFile, mkdir, rename, appendFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { Worker } from 'node:worker_threads'
import { Bm25Index } from './bm25Search.js'

const STORE_FILENAME = 'memory-vectors.json'
// Append-only log filename — same dir as snapshot, NDJSON one mutation per line.
const LOG_FILENAME = 'memory-vectors.log'
// Max entries kept in memory.
const MAX_ENTRIES = 2000
// Compaction threshold for the append-only log. When the log file exceeds
// this size, we rewrite the snapshot and truncate the log. Sized to
// roughly 100 mutations of typical embedding size (~50KB each).
const LOG_COMPACT_THRESHOLD_BYTES = 5 * 1024 * 1024
// Periodic compaction check — every 10 min while the app is up. Cheap
// (just a stat call); only triggers a real rewrite if log > threshold.
const COMPACTION_CHECK_INTERVAL_MS = 10 * 60 * 1000

/** @type {Map<string, { content: string, embedding: number[], layer: string, updatedAt: string }>} */
const _index = new Map()

let _loaded = false
let _loadPromise = null
let _savePromise = null
// Serialised tail-append for the log so concurrent writes don't interleave
// JSON lines. Each mutation .then()'s onto this chain.
let _logAppendChain = Promise.resolve()
let _compactTimer = null

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

// ── Persistence (snapshot + append-only log) ──
//
// The hot path during chat is one upsert per memory, each followed by a
// snapshot rewrite of the full ~60MB JSON file. To avoid that I/O cost
// we split persistence into two files:
//
//   - memory-vectors.json (canonical snapshot, periodic compaction only)
//   - memory-vectors.log  (append-only NDJSON, one mutation per line)
//
// Mutation flow: in-memory Map updated immediately, plus one small
// `appendFile` line. Reads always come from in-memory, so no read amp.
// Compaction (snapshot rewrite + log truncate) runs every 10 min if
// the log exceeds 5MB, plus unconditionally on terminate().
//
// On startup: load snapshot + replay log lines (idempotent ops, last
// write wins). A corrupt log line is skipped with a warning, never
// fatal — ensures a single bad write doesn't trash the whole memory.

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILENAME)
}

function getLogPath() {
  return path.join(app.getPath('userData'), LOG_FILENAME)
}

function applyLogOp(op) {
  if (!op || typeof op !== 'object') return
  if (op.kind === 'upsert' && op.id && Array.isArray(op.entry?.embedding)) {
    _index.delete(op.id)
    _index.set(String(op.id), {
      content: String(op.entry.content ?? ''),
      embedding: op.entry.embedding,
      layer: op.entry.layer ?? 'long_term',
      updatedAt: op.entry.updatedAt ?? new Date().toISOString(),
    })
  } else if (op.kind === 'delete' && op.id) {
    _index.delete(String(op.id))
  } else if (op.kind === 'clearLayer' && op.layer) {
    for (const [id, entry] of _index) {
      if (entry.layer === op.layer) _index.delete(id)
    }
  }
}

async function replayLog() {
  let raw
  try {
    raw = await readFile(getLogPath(), 'utf8')
  } catch {
    return 0 // no log file — nothing to replay
  }
  let applied = 0
  let skipped = 0
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      applyLogOp(JSON.parse(line))
      applied++
    } catch {
      skipped++
    }
  }
  if (skipped) {
    console.warn(`[memoryVectorStore] log replay: skipped ${skipped} corrupt line(s)`)
  }
  return applied
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

      console.info(`[memoryVectorStore] loaded ${_index.size} entries from snapshot`)
    } catch {
      console.info('[memoryVectorStore] no existing snapshot, starting fresh')
    }

    // Replay any pending mutations from the append-only log on top.
    const replayed = await replayLog()
    if (replayed) {
      console.info(`[memoryVectorStore] replayed ${replayed} log entries on top of snapshot`)
    }

    _loaded = true
    _loadPromise = null

    // Schedule periodic compaction once we're loaded. The check itself
    // is cheap (one stat); a real rewrite only fires when log is large.
    if (!_compactTimer) {
      _compactTimer = setInterval(() => {
        void compactIfNeeded().catch((err) => {
          console.warn('[memoryVectorStore] periodic compact failed:', err?.message)
        })
      }, COMPACTION_CHECK_INTERVAL_MS)
      // Don't keep the event loop alive just for this check.
      if (typeof _compactTimer.unref === 'function') _compactTimer.unref()
    }
  })()

  return _loadPromise
}

/**
 * Append one mutation to the log. Serialised through _logAppendChain so
 * concurrent calls produce well-ordered, never-interleaved JSON lines.
 * Errors are logged and swallowed — a missed log line is recoverable
 * (in-memory state is the source of truth and the next compaction
 * will snapshot everything).
 */
function appendLogOp(op) {
  const line = JSON.stringify(op) + '\n'
  _logAppendChain = _logAppendChain
    .then(() => mkdir(path.dirname(getLogPath()), { recursive: true }))
    .then(() => appendFile(getLogPath(), line, 'utf8'))
    .catch((err) => {
      console.warn('[memoryVectorStore] log append failed:', err?.message)
    })
  return _logAppendChain
}

/**
 * Rewrite the snapshot from the current in-memory state and truncate the
 * append-only log. This is the "compaction" step — turns log+snapshot
 * back into a single canonical snapshot file. Drains pending log appends
 * first so we don't truncate a line that's still being written.
 */
async function compactSnapshot() {
  if (_savePromise) return _savePromise

  _savePromise = (async () => {
    // Wait for any in-flight log append to land before we snapshot —
    // otherwise we'd write a snapshot that doesn't include the line
    // we're about to truncate.
    try { await _logAppendChain } catch {}

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

      // Truncate the log — its content is now reflected in the snapshot.
      try {
        await unlink(getLogPath())
      } catch {
        // Log might not exist (no mutations since last compact); ignore.
      }
    } catch (err) {
      console.error('[memoryVectorStore] compaction failed:', err.message)
    } finally {
      _savePromise = null
    }
  })()

  return _savePromise
}

/**
 * Stat the log; if it exceeds the threshold, run a snapshot compaction.
 * Called periodically and by terminate(). Cheap when no compaction is
 * needed (one fs.stat).
 */
async function compactIfNeeded() {
  let size = 0
  try {
    const s = await stat(getLogPath())
    size = s.size
  } catch {
    return // no log → nothing to compact
  }
  if (size < LOG_COMPACT_THRESHOLD_BYTES) return
  console.info(`[memoryVectorStore] log at ${(size / 1024 / 1024).toFixed(1)}MB — compacting`)
  await compactSnapshot()
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
  // Append the mutation to the log so a crash before next compaction
  // doesn't lose this entry.
  appendLogOp({ kind: 'upsert', id, entry })
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
    appendLogOp({ kind: 'delete', id })
  }
  return deleted
}

export async function removeMemories(ids) {
  await ensureLoaded()

  let count = 0
  for (const id of ids) {
    if (_index.delete(id)) {
      count++
      appendLogOp({ kind: 'delete', id })
    }
  }
  if (count) {
    _bm25Dirty = true
    _snapshotDirty = true
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
    // Single op for the whole layer clear — replay reproduces the same effect.
    appendLogOp({ kind: 'clearLayer', layer })
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
  // Drain any in-flight log appends, then run a snapshot compaction.
  // This collapses the log into the snapshot regardless of size — used
  // before app exit to ensure the next launch needs no replay.
  try { await _logAppendChain } catch {}
  await compactSnapshot()
}

export async function terminate() {
  if (_compactTimer) {
    clearInterval(_compactTimer)
    _compactTimer = null
  }
  await flush()
  if (_worker) {
    await _worker.terminate()
    _worker = null
  }
}
