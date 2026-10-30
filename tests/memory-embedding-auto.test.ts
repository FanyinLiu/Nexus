import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { after, afterEach, beforeEach, test } from 'node:test'

register(new URL('./helpers/memory-vector-electron-hooks.mjs', import.meta.url))

const windowShim: Record<string, unknown> = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true },
}
;(globalThis as Record<string, unknown>).window = windowShim
const realBroadcastChannel = globalThis.BroadcastChannel
;(globalThis as Record<string, unknown>).BroadcastChannel = undefined

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-embed-auto-'))
;(globalThis as Record<string, unknown>).__nexusMemoryVectorUserData = userData

const {
  chooseAutoMemoryEmbeddingModel,
  getAutoMemoryEmbeddingEffectiveModel,
  getAutoMemoryEmbeddingState,
  isAutoMemoryEmbeddingModel,
  resetAutoMemoryEmbeddingState,
  resolveAutoMemoryEmbedding,
  resolveMemoryEmbeddingModelSetting,
} = await import('../src/features/memory/memoryEmbeddingAuto.ts')
const {
  QWEN3_MEMORY_EMBEDDING_MODEL_ID,
  resetOllamaEmbeddingState,
  setOllamaEmbedBaseUrl,
  setOllamaEmbedTransport,
} = await import('../src/features/memory/ollamaEmbedding.ts')
const {
  embedMemorySearchTextWithModel,
  isLocalHashMemoryModel,
  resolveActiveMemoryEmbeddingModel,
} = await import('../src/features/memory/vectorSearch.ts')
const {
  AUTO_MEMORY_EMBEDDING_MODEL_ID,
  DEFAULT_MEMORY_EMBEDDING_MODEL,
  LOCAL_HASH_MEMORY_MODEL_ID,
} = await import('../src/features/memory/constants.ts')
const { resolveMemoryEmbeddingStatusView } = await import('../src/features/memory/memoryEmbeddingStatusView.ts')
const { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } = await import('../src/lib/settingsMigrations.ts')
const { detectOllamaModel } = await import('../electron/services/ollamaEmbed.js')
const { validateMemoryOllamaDetectPayload } = await import('../electron/ipc/payloadSchemas.js')
const store = await import('../electron/services/memoryVectorStore.js')

;(globalThis as Record<string, unknown>).BroadcastChannel = realBroadcastChannel

const BASE = 'http://127.0.0.1:11434'
const originalFetch = globalThis.fetch
let fetchCalls: string[] = []

function tagsResponse(names: string[]) {
  return new Response(JSON.stringify({ models: names.map((name) => ({ name, model: name })) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(handler: (url: string) => Promise<Response> | Response) {
  globalThis.fetch = (async (url: string) => {
    fetchCalls.push(String(url))
    return handler(String(url))
  }) as typeof fetch
}

/** Let fire-and-forget promise chains settle. */
async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  fetchCalls = []
  resetAutoMemoryEmbeddingState()
  resetOllamaEmbeddingState()
  setOllamaEmbedBaseUrl(BASE)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  setOllamaEmbedTransport(null)
  delete windowShim.desktopPet
})

after(async () => {
  await store.terminate()
  await fs.rm(userData, { recursive: true, force: true })
})

// ── Choice and settings resolution ──

test('auto is the default and resolves to the local hash before detection', () => {
  assert.equal(DEFAULT_MEMORY_EMBEDDING_MODEL, AUTO_MEMORY_EMBEDDING_MODEL_ID)
  assert.ok(isAutoMemoryEmbeddingModel('auto'))
  assert.ok(isAutoMemoryEmbeddingModel(' AUTO '))
  assert.ok(!isAutoMemoryEmbeddingModel(LOCAL_HASH_MEMORY_MODEL_ID))
  assert.equal(getAutoMemoryEmbeddingState().phase, 'detecting')
  assert.equal(resolveMemoryEmbeddingModelSetting('auto'), LOCAL_HASH_MEMORY_MODEL_ID)
  assert.ok(isLocalHashMemoryModel('auto'))
})

test('pure choice: qwen3 only when Ollama answered and the model is pulled', () => {
  assert.equal(chooseAutoMemoryEmbeddingModel({ reachable: true, installed: true }), QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  assert.equal(chooseAutoMemoryEmbeddingModel({ reachable: true, installed: false }), LOCAL_HASH_MEMORY_MODEL_ID)
  assert.equal(chooseAutoMemoryEmbeddingModel({ reachable: false, installed: false }), LOCAL_HASH_MEMORY_MODEL_ID)
  assert.equal(chooseAutoMemoryEmbeddingModel(null), LOCAL_HASH_MEMORY_MODEL_ID)
})

test('auto picks qwen3 when Ollama lists qwen3-embedding:0.6b (mock fetch)', async () => {
  mockFetch(() => tagsResponse(['llama3.2:3b', 'qwen3-embedding:0.6b']))
  const state = await resolveAutoMemoryEmbedding({ baseUrl: BASE })
  assert.deepEqual(fetchCalls, [`${BASE}/api/tags`])
  assert.deepEqual(state, { phase: 'active', model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
  assert.equal(resolveMemoryEmbeddingModelSetting('auto'), QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  assert.equal(resolveActiveMemoryEmbeddingModel('auto'), QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  assert.ok(!isLocalHashMemoryModel('auto'))
  // Never pulls: the only request was the tag listing.
  assert.ok(fetchCalls.every((url) => !url.includes('/api/pull')))
})

test('auto stays on the hash when the model is absent, with the pull hint', async () => {
  mockFetch(() => tagsResponse(['llama3.2:3b', 'nomic-embed-text:latest']))
  const state = await resolveAutoMemoryEmbedding({ baseUrl: BASE })
  assert.deepEqual(state, { phase: 'unavailable', reason: 'not-installed' })
  assert.equal(resolveMemoryEmbeddingModelSetting('auto'), LOCAL_HASH_MEMORY_MODEL_ID)
  const view = resolveMemoryEmbeddingStatusView('auto', { state: 'idle' }, (key) => key, state)
  assert.equal(view?.key, 'memory.embedding.auto.status.not_installed')
  assert.equal(view?.params.model, 'qwen3-embedding:0.6b')
})

test('auto stays on the hash when Ollama is unreachable or answers garbage', async () => {
  mockFetch(() => {
    throw new TypeError('fetch failed')
  })
  assert.deepEqual(await resolveAutoMemoryEmbedding({ baseUrl: BASE }), { phase: 'unavailable', reason: 'unreachable' })
  assert.equal(resolveMemoryEmbeddingModelSetting('auto'), LOCAL_HASH_MEMORY_MODEL_ID)

  mockFetch(() => new Response('nope', { status: 500 }))
  assert.deepEqual(await resolveAutoMemoryEmbedding({ baseUrl: BASE }), { phase: 'unavailable', reason: 'unreachable' })

  const view = resolveMemoryEmbeddingStatusView('auto', { state: 'idle' }, (key) => key, getAutoMemoryEmbeddingState())
  assert.equal(view?.key, 'memory.embedding.auto.status.unreachable')
})

test('an explicit model choice is respected whatever detection says', async () => {
  mockFetch(() => tagsResponse(['qwen3-embedding:0.6b']))
  await resolveAutoMemoryEmbedding({ baseUrl: BASE })
  assert.equal(resolveMemoryEmbeddingModelSetting('auto'), QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  assert.equal(resolveMemoryEmbeddingModelSetting(LOCAL_HASH_MEMORY_MODEL_ID), LOCAL_HASH_MEMORY_MODEL_ID)
  assert.ok(isLocalHashMemoryModel(LOCAL_HASH_MEMORY_MODEL_ID))
  assert.equal(
    resolveMemoryEmbeddingModelSetting('Xenova/all-MiniLM-L6-v2'),
    'Xenova/all-MiniLM-L6-v2',
  )

  resetAutoMemoryEmbeddingState()
  mockFetch(() => tagsResponse([]))
  await resolveAutoMemoryEmbedding({ baseUrl: BASE })
  assert.equal(resolveMemoryEmbeddingModelSetting(QWEN3_MEMORY_EMBEDDING_MODEL_ID), QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  // Explicit Ollama choices show their own backend status, not the auto line.
  assert.equal(
    resolveMemoryEmbeddingStatusView(QWEN3_MEMORY_EMBEDDING_MODEL_ID, { state: 'idle' }, (key) => key, getAutoMemoryEmbeddingState()),
    null,
  )
})

test('detection goes through the main-process bridge inside Electron', async () => {
  const seen: unknown[] = []
  windowShim.desktopPet = {
    memoryOllamaDetect: async (payload: unknown) => {
      seen.push(payload)
      return { reachable: true, installed: true }
    },
  }
  mockFetch(() => {
    throw new Error('renderer must not fetch Ollama directly')
  })
  const state = await resolveAutoMemoryEmbedding({ baseUrl: 'http://192.168.1.5:11434' })
  assert.equal(state.phase, 'active')
  assert.deepEqual(seen, [{ baseUrl: 'http://192.168.1.5:11434', model: 'qwen3-embedding:0.6b' }])
  assert.equal(fetchCalls.length, 0)
})

// ── Background re-embed and session fallback ──

test('recall stays on the hash while qwen3 re-embeds in the background, then switches', async () => {
  mockFetch(() => tagsResponse(['qwen3-embedding:0.6b']))
  let finish: (ok: boolean) => void = () => undefined
  const reindexed: string[] = []
  const state = await resolveAutoMemoryEmbedding({
    baseUrl: BASE,
    reindex: (model) => {
      reindexed.push(model)
      return new Promise<boolean>((resolve) => { finish = resolve })
    },
  })
  // resolve returned before the re-embed finished (non-blocking).
  assert.deepEqual(state, { phase: 'indexing', model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
  await flushMicrotasks()
  assert.deepEqual(reindexed, [QWEN3_MEMORY_EMBEDDING_MODEL_ID])
  assert.equal(getAutoMemoryEmbeddingEffectiveModel(), LOCAL_HASH_MEMORY_MODEL_ID)

  // A recall-time embedding during the re-embed works and uses the hash.
  const during = await embedMemorySearchTextWithModel('我对花生过敏', 'auto', 'query')
  assert.equal(during.model, LOCAL_HASH_MEMORY_MODEL_ID)
  assert.equal(during.embedding.length, 256)

  const indexingView = resolveMemoryEmbeddingStatusView('auto', { state: 'idle' }, (key) => key, getAutoMemoryEmbeddingState())
  assert.equal(indexingView?.key, 'memory.embedding.auto.status.indexing')

  finish(true)
  await flushMicrotasks()
  assert.deepEqual(getAutoMemoryEmbeddingState(), { phase: 'active', model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
  assert.equal(getAutoMemoryEmbeddingEffectiveModel(), QWEN3_MEMORY_EMBEDDING_MODEL_ID)
})

test('a re-embed that fails (or loses Ollama) leaves auto on the hash', async () => {
  mockFetch(() => tagsResponse(['qwen3-embedding:0.6b']))
  await resolveAutoMemoryEmbedding({ baseUrl: BASE, reindex: async () => false })
  await flushMicrotasks()
  assert.equal(getAutoMemoryEmbeddingState().phase, 'fallback')
  assert.equal(resolveMemoryEmbeddingModelSetting('auto'), LOCAL_HASH_MEMORY_MODEL_ID)

  await resolveAutoMemoryEmbedding({ baseUrl: BASE, reindex: async () => { throw new Error('boom') } })
  await flushMicrotasks()
  assert.equal(getAutoMemoryEmbeddingState().phase, 'fallback')
})

test('Ollama going away mid-session falls back to the hash for the session, with a warning', async () => {
  mockFetch(() => tagsResponse(['qwen3-embedding:0.6b']))
  setOllamaEmbedTransport(async (request) => ({ ok: true, embeddings: request.input.map(() => [1, 2, 3, 4]) }))
  await resolveAutoMemoryEmbedding({ baseUrl: BASE })
  const up = await embedMemorySearchTextWithModel('第一条', 'auto', 'query')
  assert.equal(up.model, QWEN3_MEMORY_EMBEDDING_MODEL_ID)

  setOllamaEmbedTransport(async () => ({ ok: false, code: 'unreachable', message: 'down' }))
  const down = await embedMemorySearchTextWithModel('第二条', 'auto', 'query')
  assert.equal(down.model, LOCAL_HASH_MEMORY_MODEL_ID)
  assert.deepEqual(getAutoMemoryEmbeddingState(), {
    phase: 'fallback',
    model: QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    code: 'unreachable',
  })

  // Sticky for the session, even after the backend cooldown ends.
  resetOllamaEmbeddingState()
  setOllamaEmbedTransport(async (request) => ({ ok: true, embeddings: request.input.map(() => [1, 2, 3, 4]) }))
  assert.equal(resolveMemoryEmbeddingModelSetting('auto'), LOCAL_HASH_MEMORY_MODEL_ID)
  const view = resolveMemoryEmbeddingStatusView('auto', { state: 'idle' }, (key) => key, getAutoMemoryEmbeddingState())
  assert.equal(view?.tone, 'warning')
  assert.equal(view?.key, 'memory.embedding.auto.status.fallback')
})

test('a newer resolution supersedes a slower earlier one', async () => {
  let release: () => void = () => undefined
  let call = 0
  mockFetch(async () => {
    call += 1
    if (call === 1) {
      await new Promise<void>((resolve) => { release = resolve })
      return tagsResponse(['qwen3-embedding:0.6b'])
    }
    return tagsResponse([])
  })
  const first = resolveAutoMemoryEmbedding({ baseUrl: BASE })
  await flushMicrotasks()
  await resolveAutoMemoryEmbedding({ baseUrl: BASE })
  release()
  await first
  assert.deepEqual(getAutoMemoryEmbeddingState(), { phase: 'unavailable', reason: 'not-installed' })
})

// ── Main-process detection ──

test('main-process detect: GET /api/tags on the native root with a short timeout', async () => {
  const calls: Array<{ url: string; options: Record<string, unknown> }> = []
  const result = await detectOllamaModel(
    { baseUrl: 'http://localhost:11434/v1', model: 'qwen3-embedding:0.6b' },
    async (url: string, options: Record<string, unknown>) => {
      calls.push({ url, options })
      return tagsResponse(['qwen3-embedding:0.6b'])
    },
  )
  assert.deepEqual(result, { reachable: true, installed: true, baseUrl: BASE, model: 'qwen3-embedding:0.6b' })
  assert.equal(calls[0]!.url, `${BASE}/api/tags`)
  assert.equal(calls[0]!.options.method, 'GET')
  assert.equal(calls[0]!.options.timeoutMs, 1_500)
  assert.equal(calls[0]!.options.allowPrivateNetwork, true)
})

test('main-process detect: absent model, untagged names, refused and bad answers', async () => {
  const absent = await detectOllamaModel({ model: 'qwen3-embedding:0.6b' }, async () => tagsResponse(['qwen3:8b']))
  assert.equal(absent.reachable, true)
  assert.equal(absent.installed, false)

  const latest = await detectOllamaModel({ model: 'qwen3-embedding' }, async () => tagsResponse(['qwen3-embedding:latest']))
  assert.equal(latest.installed, true)

  const refused = await detectOllamaModel({ model: 'qwen3-embedding:0.6b' }, async () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' })
  })
  assert.deepEqual({ reachable: refused.reachable, installed: refused.installed }, { reachable: false, installed: false })

  const notOllama = await detectOllamaModel({ model: 'qwen3-embedding:0.6b' }, async () => new Response('<html>', { status: 200 }))
  assert.equal(notOllama.reachable, false)

  const serverError = await detectOllamaModel({ model: 'qwen3-embedding:0.6b' }, async () => new Response('', { status: 503 }))
  assert.equal(serverError.reachable, false)
})

test('detect payload schema requires a model name', () => {
  assert.deepEqual(
    validateMemoryOllamaDetectPayload({ baseUrl: BASE, model: 'qwen3-embedding:0.6b' }),
    { baseUrl: BASE, model: 'qwen3-embedding:0.6b' },
  )
  assert.throws(() => validateMemoryOllamaDetectPayload({ model: '' }))
  assert.throws(() => validateMemoryOllamaDetectPayload({}))
})

// ── Settings migration ──

test('schema 23 moves the old local-hash default to auto', () => {
  assert.equal(CURRENT_SETTINGS_SCHEMA_VERSION, 24)
  const next = migrateSettings({ settingsSchemaVersion: 22, memoryEmbeddingModel: 'local-hash-v1' }, 22)
  assert.equal(next.memoryEmbeddingModel, 'auto')
  assert.equal(next.settingsSchemaVersion, 24)

  const missing = migrateSettings({ settingsSchemaVersion: 22 }, 22)
  assert.equal(missing.memoryEmbeddingModel, 'auto')
})

test('schema 23 keeps an explicit non-default memory embedding model', () => {
  for (const model of [QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'Xenova/all-MiniLM-L6-v2', 'ollama:bge-m3']) {
    const next = migrateSettings({ settingsSchemaVersion: 22, memoryEmbeddingModel: model }, 22)
    assert.equal(next.memoryEmbeddingModel, model)
  }
})

test('schema 23 does not run again: a hash chosen after the upgrade stays hash', () => {
  const next = migrateSettings(
    { settingsSchemaVersion: 23, memoryEmbeddingModel: 'local-hash-v1' },
    23,
  )
  assert.equal(next.memoryEmbeddingModel, 'local-hash-v1')
})

// ── Model-tagged vector store keeps both spaces ──

test('vector store keeps the qwen3 vector when the same memory is re-indexed with the hash', async () => {
  const qwen = [0.6, 0.8, 0, 0]
  const hash = new Array(256).fill(0)
  hash[3] = 1
  await store.indexBatch([{ id: 'm1', content: '我对花生严重过敏', embedding: qwen, layer: 'long_term', model: QWEN3_MEMORY_EMBEDDING_MODEL_ID }])
  // Session fell back to the hash: the same content is indexed again.
  await store.indexBatch([{ id: 'm1', content: '我对花生严重过敏', embedding: hash, layer: 'long_term', model: LOCAL_HASH_MEMORY_MODEL_ID }])

  const byHash = await store.searchSimilar(hash, { limit: 5, threshold: 0, model: LOCAL_HASH_MEMORY_MODEL_ID })
  assert.deepEqual(byHash.map((row: { id: string }) => row.id), ['m1'])
  assert.ok(Math.abs(byHash[0].score - 1) < 1e-9)

  // qwen3 comes back: its vector was kept, no re-embed needed, and the
  // 256-dim hash vector is never compared with a 4-dim qwen3 query.
  const byQwen = await store.searchSimilar(qwen, { limit: 5, threshold: 0, model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
  assert.deepEqual(byQwen.map((row: { id: string }) => row.id), ['m1'])
  assert.ok(Math.abs(byQwen[0].score - 1) < 1e-9)

  const hybrid = await store.searchHybrid(qwen, '花生', { limit: 5, threshold: 0, model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
  assert.equal(hybrid[0].id, 'm1')
  assert.equal(hybrid[0].vectorStale, undefined)

  // Another model's query of a third dimension sees nothing comparable.
  const other = await store.searchSimilar([1, 0, 0], { limit: 5, threshold: 0, model: 'ollama:bge-m3' })
  assert.equal(other.length, 0)
})

test('vector store drops kept vectors when the memory text changes', async () => {
  const qwen = [0, 1, 0, 0]
  const hash = new Array(256).fill(0)
  hash[9] = 1
  await store.indexBatch([{ id: 'm2', content: '住在杭州', embedding: qwen, layer: 'long_term', model: QWEN3_MEMORY_EMBEDDING_MODEL_ID }])
  await store.indexBatch([{ id: 'm2', content: '搬到上海了', embedding: hash, layer: 'long_term', model: LOCAL_HASH_MEMORY_MODEL_ID }])

  const byQwen = await store.searchSimilar(qwen, { limit: 5, threshold: 0, model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
  assert.ok(!byQwen.some((row: { id: string }) => row.id === 'm2'))
  const hybrid = await store.searchHybrid(qwen, '上海', { limit: 5, threshold: 0, model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
  const row = hybrid.find((entry: { id: string }) => entry.id === 'm2')
  assert.equal(row?.vectorStale, true)
})

test('kept vectors survive a snapshot round trip', async () => {
  await store.flush()
  const raw = JSON.parse(await fs.readFile(path.join(userData, 'memory-vectors.json'), 'utf8')) as {
    entries: Array<{ id: string; model?: string; altEmbeddings?: Record<string, number[]> }>
  }
  const m1 = raw.entries.find((entry) => entry.id === 'm1')
  assert.equal(m1?.model, LOCAL_HASH_MEMORY_MODEL_ID)
  assert.deepEqual(m1?.altEmbeddings?.[QWEN3_MEMORY_EMBEDDING_MODEL_ID], [0.6, 0.8, 0, 0])
  const m2 = raw.entries.find((entry) => entry.id === 'm2')
  assert.equal(m2?.altEmbeddings, undefined)
})
