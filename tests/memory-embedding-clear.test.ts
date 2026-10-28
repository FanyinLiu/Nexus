import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { after, beforeEach, test } from 'node:test'

register(new URL('./helpers/memory-vector-electron-hooks.mjs', import.meta.url))

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-embed-clear-'))
;(globalThis as Record<string, unknown>).__nexusMemoryVectorUserData = userData

const batches: Array<Array<{ id: string }>> = []
const windowShim: Record<string, unknown> = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  desktopPet: {
    memoryVectorClear: async () => ({ ok: true }),
    memoryVectorIndexBatch: async (batch: Array<{ id: string }>) => {
      batches.push(batch)
      return { ok: true }
    },
  },
}
;(globalThis as Record<string, unknown>).window = windowShim
// The storage layer opens a BroadcastChannel when `window` exists, and Node's
// instance keeps the event loop alive. The renderer owns that channel; tests
// do not need it.
;(globalThis as Record<string, unknown>).BroadcastChannel = undefined

const {
  QWEN3_MEMORY_EMBEDDING_MODEL_ID,
  getMemoryEmbeddingBackendStatus,
  resetOllamaEmbeddingState,
  setOllamaEmbedBaseUrl,
  setOllamaEmbedTransport,
} = await import('../src/features/memory/ollamaEmbedding.ts')
const {
  clearMemoryEmbeddingCache,
  clearMemoryEmbeddingCacheForText,
  embedMemorySearchTextWithModel,
} = await import('../src/features/memory/vectorSearch.ts')
const {
  reindexMemoriesForEmbeddingModel,
  resetMemoryRecallIndexLedger,
} = await import('../src/features/memory/recall.ts')
const {
  purgeClearedMemories,
} = await import('../src/lib/storage/purgeMemoryStores.ts')
const { LOCAL_HASH_MEMORY_MODEL_ID } = await import('../src/features/memory/constants.ts')
const store = await import('../electron/services/memoryVectorStore.js')

const BASE = 'http://127.0.0.1:11434'
const AT = '2026-06-19T10:00:00.000Z'
let requests: string[] = []

function fakeVector(text: string) {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return [1 + (hash % 7), 2 + (hash % 5), 3 + (hash % 3), 4]
}

beforeEach(() => {
  requests = []
  batches.length = 0
  resetOllamaEmbeddingState()
  resetMemoryRecallIndexLedger()
  clearMemoryEmbeddingCache()
  setOllamaEmbedBaseUrl(BASE)
  setOllamaEmbedTransport(async (request) => {
    requests.push(request.input[0] ?? '')
    return { ok: true, embeddings: request.input.map(fakeVector) }
  })
})

after(async () => {
  await store.terminate()
  await fs.rm(userData, { recursive: true, force: true })
})

test('clear-all drops cached vectors, the session ledger, and the Ollama status', async () => {
  const text = 'CLEAR-CACHE-MARKER 我养了一只猫'
  await embedMemorySearchTextWithModel(text, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  await embedMemorySearchTextWithModel(text, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(requests.length, 1, 'the second read is served from the cache')
  assert.equal(getMemoryEmbeddingBackendStatus().state, 'ready')

  await reindexMemoriesForEmbeddingModel(
    [{ id: 'ledger-1', content: 'LEDGER-CLEAR-MARKER 住在杭州' }],
    QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    'long_term',
  )
  assert.equal(batches.length, 1)
  await reindexMemoriesForEmbeddingModel(
    [{ id: 'ledger-1', content: 'LEDGER-CLEAR-MARKER 住在杭州' }],
    QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    'long_term',
  )
  assert.equal(batches.length, 1, 'the per-model ledger skips a second send')

  await purgeClearedMemories([], {}, AT)

  assert.equal(getMemoryEmbeddingBackendStatus().state, 'idle')

  // Cache was emptied: the same text goes to Ollama again.
  await embedMemorySearchTextWithModel(text, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(requests.length >= 2, true)

  // Ledger was emptied: the same memory is indexed again.
  await reindexMemoriesForEmbeddingModel(
    [{ id: 'ledger-1', content: 'LEDGER-CLEAR-MARKER 住在杭州' }],
    QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    'long_term',
  )
  assert.equal(batches.length, 2)
})

test('deleting one memory drops only that text from the renderer cache', async () => {
  const deleted = 'DELETE-CACHE-ONE 我对花生过敏'
  const kept = 'DELETE-CACHE-KEEP 我喜欢冰美式'
  await embedMemorySearchTextWithModel(deleted, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  await embedMemorySearchTextWithModel(kept, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(requests.length, 2)

  clearMemoryEmbeddingCacheForText(deleted)

  await embedMemorySearchTextWithModel(kept, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(requests.length, 2, 'the kept text still comes from the cache')
  await embedMemorySearchTextWithModel(deleted, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(requests.length, 3, 'the deleted text is recomputed, not reused')
})

test('single delete removes the row and its altEmbeddings from the vector store', async () => {
  const id = 'alt-clear-1'
  const content = 'ALT-EMBEDDING-CLEAR-MARKER 搬到上海了'
  await store.indexBatch([{
    id,
    content,
    embedding: [0.6, 0.8, 0, 0],
    layer: 'long_term',
    model: QWEN3_MEMORY_EMBEDDING_MODEL_ID,
  }])
  const hash = new Array(256).fill(0)
  hash[5] = 1
  await store.indexBatch([{ id, content, embedding: hash, layer: 'long_term', model: LOCAL_HASH_MEMORY_MODEL_ID }])
  await store.flush()

  const raw = JSON.parse(await fs.readFile(path.join(userData, 'memory-vectors.json'), 'utf8')) as {
    entries: Array<{ id: string; altEmbeddings?: Record<string, number[]> }>
  }
  const before = raw.entries.find((entry) => entry.id === id)
  assert.deepEqual(before?.altEmbeddings?.[QWEN3_MEMORY_EMBEDDING_MODEL_ID], [0.6, 0.8, 0, 0])

  assert.equal(await store.removeMemory(id), true)
  await store.flush()

  const after = JSON.parse(await fs.readFile(path.join(userData, 'memory-vectors.json'), 'utf8')) as {
    entries: Array<{ id: string; altEmbeddings?: Record<string, number[]> }>
  }
  assert.equal(after.entries.some((entry) => entry.id === id), false)
  assert.deepEqual(await store.searchSimilar([0.6, 0.8, 0, 0], { limit: 5, threshold: 0, model: QWEN3_MEMORY_EMBEDDING_MODEL_ID }), [])
  assert.deepEqual(await store.searchSimilar(hash, { limit: 5, threshold: 0, model: LOCAL_HASH_MEMORY_MODEL_ID }), [])
})

test('clear-all removes rows and their altEmbeddings from the snapshot', async () => {
  const id = 'alt-clear-all-1'
  const content = 'ALT-EMBEDDING-CLEAR-ALL 我搬到上海了'
  await store.indexBatch([{
    id,
    content,
    embedding: [1, 0, 0, 0],
    layer: 'long_term',
    model: QWEN3_MEMORY_EMBEDDING_MODEL_ID,
  }])
  const hash = new Array(256).fill(0)
  hash[7] = 1
  await store.indexBatch([{ id, content, embedding: hash, layer: 'long_term', model: LOCAL_HASH_MEMORY_MODEL_ID }])
  await store.flush()

  await store.clearAllEntries()

  const after = JSON.parse(await fs.readFile(path.join(userData, 'memory-vectors.json'), 'utf8')) as {
    entries: Array<{ id: string; altEmbeddings?: Record<string, number[]> }>
  }
  assert.deepEqual(after.entries, [])
})
