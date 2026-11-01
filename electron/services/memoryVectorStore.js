// @ts-nocheck
import { readFile, writeFile, mkdir, rename, appendFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { Worker } from 'node:worker_threads'
import { Bm25Index } from './bm25Search.js'
import { audit } from './auditLog.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import { MemoryVectorLogAppendBuffer } from './memoryVectorLogBuffer.js'

const STORE_FILENAME = 'memory-vectors.json'
// Append-only log filename — same dir as snapshot, NDJSON one mutation per line.
const LOG_FILENAME = 'memory-vectors.log'
const STORE_DISPLAY_PATH = `app-user-data/${STORE_FILENAME}`
const LOG_DISPLAY_PATH = `app-user-data/${LOG_FILENAME}`
// Max entries kept in memory.
const MAX_ENTRIES = 2000
// Vectors from other embedding models kept per memory (besides the primary).
const MAX_ALT_EMBEDDINGS = 2
// Compaction threshold for the append-only log. When the log file exceeds
// this size, we rewrite the snapshot and truncate the log. Sized to
// roughly 100 mutations of typical embedding size (~50KB each).
const LOG_COMPACT_THRESHOLD_BYTES = 5 * 1024 * 1024
// Periodic compaction check — every 10 min while the app is up. Cheap
// (just a stat call); only triggers a real rewrite if log > threshold.
const COMPACTION_CHECK_INTERVAL_MS = 10 * 60 * 1000

/**
 * One row per memory id. `embedding`/`model` is the vector written last;
 * `altEmbeddings` keeps vectors of the same content from other embedding
 * models (e.g. qwen3 while the session fell back to the local hash), so a
 * model switch back and forth does not throw the expensive vectors away.
 * @type {Map<string, { content: string, embedding: number[], layer: string, updatedAt: string, model?: string, altEmbeddings?: Record<string, number[]> }>}
 */
const _index = new Map()

let _loaded = false
let _loadPromise = null
let _savePromise = null
// Batched tail-append for the log so concurrent writes don't interleave
// JSON lines or create one disk write per mutation. Each mutation updates
// this chain so flush()/compaction can wait for persistence to catch up.
let _logAppendChain = Promise.resolve()
let _logAppendBuffer = null
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
    console.error('[memoryVectorStore] worker error:', getRedactedErrorMessage(err))
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
// Mutation flow: in-memory Map updated immediately, plus one queued NDJSON
// line that is appendFile'd in small batches. Reads always come from
// in-memory, so no read amp.
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

/** Keep only well-formed `{ model: number[] }` pairs from disk. */
function readAltEmbeddings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const alt = {}
  for (const [model, embedding] of Object.entries(value)) {
    if (model && Array.isArray(embedding) && embedding.length) alt[model] = embedding
  }
  return Object.keys(alt).length ? { altEmbeddings: alt } : {}
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
      ...(typeof op.entry.model === 'string' && op.entry.model ? { model: op.entry.model } : {}),
      ...readAltEmbeddings(op.entry.altEmbeddings),
    })
  } else if (op.kind === 'delete' && op.id) {
    _index.delete(String(op.id))
  } else if (op.kind === 'clearLayer' && op.layer) {
    for (const [id, entry] of _index) {
      if (entry.layer === op.layer) _index.delete(id)
    }
  } else if (op.kind === 'clearAll') {
    _index.clear()
  }
}

async function replayLogFile(logPath) {
  let raw
  try {
    raw = await readFile(logPath, 'utf8')
  } catch {
    return { applied: 0, skipped: 0, exists: false }
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
  return { applied, skipped, exists: true }
}

async function replayLog() {
  // Replay any orphaned compaction log first. compactSnapshot() renames
  // the active log to <log>.compacting before writing the new snapshot,
  // so a crash between rename and unlink leaves both files on disk. The
  // .compacting file holds older mutations whose state may or may not
  // have made it into the snapshot — replaying them is idempotent
  // (applyLogOp on the same id is upsert), so we just replay both in
  // chronological order: orphan first, active second.
  const compactingPath = getLogPath() + '.compacting'
  const orphan = await replayLogFile(compactingPath)
  if (orphan.exists) {
    console.info(`[memoryVectorStore] replayed orphan compaction log: ${orphan.applied} ops`)
    audit('memory', 'replay-orphan-log', {
      applied: orphan.applied,
      skipped: orphan.skipped,
    })
    try { await unlink(compactingPath) } catch {}
  }

  const active = await replayLogFile(getLogPath())
  if (active.skipped) {
    console.warn(`[memoryVectorStore] log replay: skipped ${active.skipped} corrupt line(s)`)
    audit('memory', 'replay-corrupt-lines', {
      applied: active.applied,
      skipped: active.skipped,
    })
  }
  return orphan.applied + active.applied
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
              ...(typeof entry.model === 'string' && entry.model ? { model: entry.model } : {}),
              ...readAltEmbeddings(entry.altEmbeddings),
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
          console.warn('[memoryVectorStore] periodic compact failed:', getRedactedErrorMessage(err))
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
function getLogAppendBuffer() {
  if (!_logAppendBuffer) {
    _logAppendBuffer = new MemoryVectorLogAppendBuffer({
      append: async (chunk) => {
        await mkdir(path.dirname(getLogPath()), { recursive: true })
        await appendFile(getLogPath(), chunk, 'utf8')
      },
    })
  }
  return _logAppendBuffer
}

function appendLogOp(op) {
  const line = JSON.stringify(op) + '\n'
  _logAppendChain = getLogAppendBuffer()
    .enqueue(line)
    .catch((err) => {
      console.warn('[memoryVectorStore] log append failed:', getRedactedErrorMessage(err))
    })
  return _logAppendChain
}

async function drainLogAppends() {
  // Flush the buffer directly. Its debounce timer is unref'd, so waiting
  // on the enqueue promise first can stall a delete that needs the bytes
  // rewritten now.
  try { await _logAppendBuffer?.drain() } catch {}
  try { await _logAppendChain } catch {}
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
    // Wait for any in-flight log append to land. Anything queued after
    // the rename below opens a fresh log file at logPath because the
    // old name no longer exists — those new lines are NOT covered by
    // the snapshot we're about to write, but they survive on disk and
    // get replayed on next load.
    await drainLogAppends()

    const logPath = getLogPath()
    const compactingPath = logPath + '.compacting'

    // Atomically take ownership of the current log before snapshotting.
    // Any concurrent appendLogOp that wins the race after this rename
    // creates a fresh logPath file; the .compacting copy represents the
    // exact mutations the snapshot we're about to write reflects, so
    // truncating .compacting after a successful snapshot is safe.
    let logTaken = false
    try {
      await rename(logPath, compactingPath)
      logTaken = true
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.error('[memoryVectorStore] compaction rename failed:', getRedactedErrorMessage(err))
        _savePromise = null
        return
      }
      // No log existed (no mutations since last compact); nothing to take.
    }

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

      // Snapshot is durable; the renamed log copy is now redundant.
      if (logTaken) {
        try { await unlink(compactingPath) } catch {}
      }
    } catch (err) {
      console.error('[memoryVectorStore] compaction failed:', getRedactedErrorMessage(err))
      // Snapshot did not durably land. Put the taken log back so the
      // mutations it captured aren't stranded across a restart — replay
      // on next load reapplies them on top of whatever snapshot was
      // already on disk. Rethrow so update install can abort instead of
      // quitting on a vector store that never reached disk.
      if (logTaken) {
        try { await rename(compactingPath, logPath) } catch {}
      }
      throw err
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
  let size
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
    // Persist the eviction so it isn't undone by replayLog after a restart
    // — the snapshot reflects the current _index, but the log file (which
    // replay reads first if newer) might still hold the eviction's
    // previous upsert and resurrect the entry, breaking the MAX_ENTRIES
    // invariant until the next compaction.
    appendLogOp({ kind: 'delete', id: key })
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

/**
 * A stored vector can only be compared with a query vector from the same
 * embedding space. Entries tagged with a different model, or of a different
 * length (e.g. 256-dim local hash vs 1024-dim qwen3), are incompatible and
 * are skipped rather than scored as 0 similarity.
 */
function isVectorCompatible(entry, queryDimensions, model) {
  const embedding = pickEmbeddingForModel(entry, model)
  return Boolean(embedding) && embedding.length === queryDimensions
}

/**
 * The stored vector to compare with a query from `model`: the primary one
 * when it is from that model (or untagged legacy data), else a kept vector
 * from that model, else null.
 */
function pickEmbeddingForModel(entry, model) {
  if (!entry || !Array.isArray(entry.embedding)) return null
  if (!model || !entry.model || entry.model === model) return entry.embedding
  const alt = entry.altEmbeddings?.[model]
  return Array.isArray(alt) && alt.length ? alt : null
}

/**
 * Build the row for an upsert. When the content is unchanged and the new
 * vector comes from another model, the previous model's vector moves to
 * `altEmbeddings` instead of being dropped. Edited content invalidates
 * every old vector.
 */
function buildEntry(id, { content, embedding, layer, model }) {
  const entry = {
    content: String(content ?? ''),
    embedding: Array.from(embedding),
    layer: layer ?? 'long_term',
    updatedAt: new Date().toISOString(),
    ...(typeof model === 'string' && model ? { model } : {}),
  }
  const previous = _index.get(id)
  if (!previous || previous.content !== entry.content || !entry.model) return entry

  const alt = { ...(previous.altEmbeddings ?? {}) }
  if (previous.model && previous.model !== entry.model && Array.isArray(previous.embedding)) {
    alt[previous.model] = previous.embedding
  }
  delete alt[entry.model]
  const models = Object.keys(alt)
  // Bound the row size: keep the most recently demoted vectors.
  for (const stale of models.slice(0, Math.max(0, models.length - MAX_ALT_EMBEDDINGS))) {
    delete alt[stale]
  }
  return Object.keys(alt).length ? { ...entry, altEmbeddings: alt } : entry
}

// ── Public API ──

export async function indexMemory(id, content, embedding, layer = 'long_term', model = undefined) {
  await ensureLoaded()

  upsertEntry(id, buildEntry(id, { content, embedding, layer, model }))

  evictExcess()
}

export async function indexBatch(items) {
  await ensureLoaded()

  for (const item of items) {
    if (item?.id && Array.isArray(item.embedding)) {
      upsertEntry(item.id, buildEntry(item.id, item))
    }
  }

  evictExcess()
}

/**
 * Worker input per query model: each row carries the vector that matches
 * that model (primary or kept alternate), tagged so the worker's model and
 * dimension checks still skip anything from another space.
 * @type {Map<string, Array<{ id: string, content: string, embedding: number[], layer: string, model?: string }>>}
 */
let _workerSnapshotCache = new Map()
let _snapshotDirty = true

function getWorkerSnapshot(model = null) {
  if (_snapshotDirty) {
    _workerSnapshotCache = new Map()
    _snapshotDirty = false
  }
  const key = model ?? ''
  const cached = _workerSnapshotCache.get(key)
  if (cached) return cached
  const entries = []
  for (const [id, entry] of _index) {
    const alt = model && entry.model && entry.model !== model ? entry.altEmbeddings?.[model] : null
    if (Array.isArray(alt) && alt.length) {
      entries.push({ id, content: entry.content, embedding: alt, layer: entry.layer, model })
    } else {
      entries.push({ id, content: entry.content, embedding: entry.embedding, layer: entry.layer, model: entry.model })
    }
  }
  _workerSnapshotCache.set(key, entries)
  return entries
}

export async function searchSimilar(queryEmbedding, options = {}) {
  await ensureLoaded()

  const { limit = 10, threshold = 0.05, layer = null, model = null } = options

  const entries = getWorkerSnapshot(model)

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
      model,
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

  const { limit = 10, threshold = 0.02, layer = null, model = null } = options
  const overFetch = limit * 4

  // Run vector + BM25 in parallel
  const [vectorResults, keywordResults] = await Promise.all([
    searchSimilar(queryEmbedding, { limit: overFetch, threshold: 0, layer, model }),
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
      // Raw cosine, before the max-normalization above. The renderer uses
      // it for the low-confidence rejection rule and the confidence the
      // model sees: after normalization the top hit is always 1.0, even
      // when nothing in the store is about the query.
      rawVectorScore: r.score,
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
      // A keyword hit whose stored vector came from another embedding model
      // (or has another dimension) has no comparable vector score. Flag it
      // so the renderer re-embeds it instead of trusting vectorScore: 0.
      const stored = _index.get(r.id)
      const vectorStale = !stored || !isVectorCompatible(stored, queryEmbedding.length, model)
      scoreMap.set(r.id, {
        id: r.id,
        content: r.content,
        layer: r.layer,
        vectorScore: 0,
        rawVectorScore: 0,
        keywordScore: normKw,
        score: 0,
        ...(vectorStale ? { vectorStale: true } : {}),
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
    _workerSnapshotCache = new Map()
    appendLogOp({ kind: 'delete', id })
    // Rewrite the snapshot and drop the append log. A delete line alone
    // would leave the old plaintext in memory-vectors.json until the next
    // size-based compaction, and the log would keep the upsert line.
    await flush()
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
    _workerSnapshotCache = new Map()
    await flush()
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

/**
 * Remove every vector row and rewrite the on-disk snapshot and log so
 * memory plaintext from any layer is not left behind.
 * @returns {Promise<number>} how many rows were dropped
 */
export async function clearAllEntries() {
  await ensureLoaded()

  const count = _index.size
  _index.clear()
  _bm25Dirty = true
  _snapshotDirty = true
  _workerSnapshotCache = new Map()
  appendLogOp({ kind: 'clearAll' })
  await flush()
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
    storePath: STORE_DISPLAY_PATH,
    logPath: LOG_DISPLAY_PATH,
  }
}

export async function flush() {
  // Drain any in-flight log appends, then run a snapshot compaction.
  // This collapses the log into the snapshot regardless of size — used
  // before app exit to ensure the next launch needs no replay.
  await drainLogAppends()
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
