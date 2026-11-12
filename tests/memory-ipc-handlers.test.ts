import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register as registerModuleHooks } from 'node:module'
import { test, type TestContext } from 'node:test'

import { bindWindowCapability } from '../electron/ipc/windowCapabilities.js'

// memoryIpc.js imports `electron` at the top level, so it can only load under
// node:test through the stub hooks. The vector store is also replaced by a
// recording fake: these tests pin the IPC contract, not vector scoring.
registerModuleHooks(new URL('./helpers/memory-ipc-electron-hooks.mjs', import.meta.url))

const AT = '2026-10-20T00:00:00.000Z'
const SYNTHETIC_ROWS = [
  {
    id: 'mem-1',
    content: 'synthetic memory alpha',
    category: 'manual',
    source: 'manual',
    createdAt: AT,
    importance: 'normal',
  },
  {
    id: 'mem-2',
    content: 'synthetic memory beta',
    category: 'manual',
    source: 'manual',
    createdAt: AT,
    importance: 'normal',
  },
]

type Handler = (event: unknown, payload?: unknown) => unknown

type SenderEvent = {
  sender: object
  senderFrame: { url: string; parent: null }
}

type FakeVectorCalls = {
  indexMemory: unknown[][]
  indexBatch: unknown[][]
  searchSimilar: unknown[][]
  removeMemory: unknown[][]
  removeMemories: unknown[][]
  searchKeyword: unknown[][]
  searchHybrid: unknown[][]
  getStats: number
  clearAllEntries: number
}

function createFakeVectorBackend() {
  const calls: FakeVectorCalls = {
    indexMemory: [],
    indexBatch: [],
    searchSimilar: [],
    removeMemory: [],
    removeMemories: [],
    searchKeyword: [],
    searchHybrid: [],
    getStats: 0,
    clearAllEntries: 0,
  }

  return {
    calls,
    async indexMemory(...args: unknown[]) {
      calls.indexMemory.push(args)
    },
    async indexBatch(...args: unknown[]) {
      calls.indexBatch.push(args)
    },
    async searchSimilar(...args: unknown[]) {
      calls.searchSimilar.push(args)
      return [{ id: 'mem-1', content: 'synthetic memory alpha', layer: 'long_term', score: 0.9 }]
    },
    async removeMemory(...args: unknown[]) {
      calls.removeMemory.push(args)
      return true
    },
    async removeMemories(...args: unknown[]) {
      calls.removeMemories.push(args)
      const ids = args[0] as string[] | undefined
      return Array.isArray(ids) ? ids.length : 0
    },
    async searchKeyword(...args: unknown[]) {
      calls.searchKeyword.push(args)
      return [{ id: 'mem-1', content: 'synthetic memory alpha', layer: 'long_term', score: 1.2 }]
    },
    async searchHybrid(...args: unknown[]) {
      calls.searchHybrid.push(args)
      return [{
        id: 'mem-1',
        content: 'synthetic memory alpha',
        layer: 'long_term',
        vectorScore: 1,
        rawVectorScore: 0.9,
        keywordScore: 1,
        score: 1,
      }]
    },
    async getStats() {
      calls.getStats += 1
      return {
        totalEntries: 1,
        longTermCount: 1,
        dailyCount: 0,
        maxEntries: 2_000,
        storePath: 'app-user-data/memory-vectors.json',
        logPath: 'app-user-data/memory-vectors.log',
      }
    },
    async clearAllEntries() {
      calls.clearAllEntries += 1
      return 3
    },
  }
}

type TestGlobals = typeof globalThis & {
  __nexusMemoryIpcHandlers?: Map<string, Handler>
  __nexusMemoryIpcWindows?: Map<object, { webContents: object; isDestroyed: () => boolean }>
  __nexusMemoryIpcSession?: {
    clearStorageData: (options?: unknown) => Promise<unknown>
    flushStorageData: () => Promise<unknown>
  }
  __nexusMemoryIpcUserData?: string
  __nexusMemoryIpcAllWindows?: unknown[]
  __nexusMemoryVectorBackend?: ReturnType<typeof createFakeVectorBackend>
}

const globals = globalThis as TestGlobals

let webContentsId = 1

async function createHarness(t: TestContext) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-ipc-'))
  t.after(async () => {
    await fs.rm(userDataPath, { recursive: true, force: true })
  })

  const handlers = new Map<string, Handler>()
  const windows = new Map<object, { webContents: object; isDestroyed: () => boolean }>()
  const sessionCalls = {
    clearStorageData: [] as unknown[][],
    flushStorageData: 0,
  }
  const session = {
    async clearStorageData(...args: unknown[]) {
      sessionCalls.clearStorageData.push(args)
    },
    async flushStorageData() {
      sessionCalls.flushStorageData += 1
    },
  }
  const inbox = {
    calls: 0,
    async clear() {
      inbox.calls += 1
      return true
    },
  }
  const backend = createFakeVectorBackend()

  globals.__nexusMemoryIpcHandlers = handlers
  globals.__nexusMemoryIpcWindows = windows
  globals.__nexusMemoryIpcSession = session
  globals.__nexusMemoryIpcUserData = userDataPath
  globals.__nexusMemoryVectorBackend = backend
  globals.__nexusMemoryIpcAllWindows = []

  const { register } = await import('../electron/ipc/memoryIpc.js')
  register({ clearProactiveInbox: inbox.clear })

  function trustedSender(kind: 'panel' | 'pet'): SenderEvent {
    const url = 'http://localhost/index.html'
    const webContents = {
      id: webContentsId++,
      getURL: () => url,
      isDestroyed: () => false,
      send: () => undefined,
    }
    bindWindowCapability(webContents, kind)
    windows.set(webContents, { webContents, isDestroyed: () => false })
    return { sender: webContents, senderFrame: { url, parent: null } }
  }

  function untrustedSender(): SenderEvent {
    const url = 'http://localhost/index.html'
    return {
      sender: {
        id: webContentsId++,
        getURL: () => url,
        isDestroyed: () => false,
        send: () => undefined,
      },
      senderFrame: { url, parent: null },
    }
  }

  async function invoke(channel: string, event: SenderEvent, payload?: unknown) {
    const handler = handlers.get(channel)
    assert.ok(handler, `missing handler for ${channel}`)
    Object.defineProperty(event, 'channel', { value: channel, configurable: true })
    return await handler(event, payload)
  }

  return {
    userDataPath,
    backend: backend.calls,
    inbox,
    sessionCalls,
    invoke,
    trustedSender,
    untrustedSender,
  }
}

test('long-term memory round-trips through the IPC handlers and clear removes it', async (t) => {
  const harness = await createHarness(t)
  const sender = harness.trustedSender('panel')
  const filePath = path.join(harness.userDataPath, 'memory', 'long-term-memory.json')

  assert.deepEqual(await harness.invoke('memory:long-term-load', sender), { exists: false, memories: [] })

  assert.deepEqual(
    await harness.invoke('memory:long-term-save', sender, { memories: SYNTHETIC_ROWS }),
    { ok: true, count: 2 },
  )
  const onDisk = await fs.readFile(filePath, 'utf8')
  assert.match(onDisk, /synthetic memory alpha/)
  assert.deepEqual(
    await harness.invoke('memory:long-term-load', sender),
    { exists: true, memories: SYNTHETIC_ROWS },
  )

  assert.deepEqual(await harness.invoke('memory:long-term-clear', sender), { ok: true })
  assert.deepEqual(await harness.invoke('memory:long-term-load', sender), { exists: false, memories: [] })
  await assert.rejects(() => fs.access(filePath))

  // An unbound sender cannot resurrect or write rows after the clear.
  await assert.rejects(
    () => harness.invoke('memory:long-term-save', harness.untrustedSender(), { memories: SYNTHETIC_ROWS }),
  )
  assert.deepEqual(await harness.invoke('memory:long-term-load', sender), { exists: false, memories: [] })
})

test('long-term load rejects an untrusted sender instead of returning seeded rows', async (t) => {
  const harness = await createHarness(t)
  const sender = harness.trustedSender('panel')

  assert.deepEqual(
    await harness.invoke('memory:long-term-save', sender, { memories: SYNTHETIC_ROWS }),
    { ok: true, count: 2 },
  )

  const outcome = await harness
    .invoke('memory:long-term-load', harness.untrustedSender())
    .then((value) => ({ rejected: false as const, value }), () => ({ rejected: true as const }))
  assert.equal(outcome.rejected, true, 'untrusted long-term load must reject')
  assert.doesNotMatch(JSON.stringify(outcome), /synthetic memory alpha/)

  // A trusted sender still reads the seeded rows, so the rejection above came
  // from the sender guard rather than from an empty store.
  assert.deepEqual(
    await harness.invoke('memory:long-term-load', sender),
    { exists: true, memories: SYNTHETIC_ROWS },
  )
})

test('clear-user-data clears vectors and the proactive inbox for a trusted panel only', async (t) => {
  const harness = await createHarness(t)
  const sender = harness.trustedSender('panel')

  assert.deepEqual(
    await harness.invoke('memory:clear-user-data', sender, { needles: ['synthetic needle'] }),
    {
      ok: true,
      removed: 3,
      localDataCleared: true,
      snapshotMemoryFilesRemoved: 0,
    },
  )
  assert.equal(harness.backend.clearAllEntries, 1)
  assert.equal(harness.sessionCalls.flushStorageData, 1)
  assert.equal(harness.inbox.calls, 1)

  const clearedCalls = {
    clearAllEntries: harness.backend.clearAllEntries,
    flushStorageData: harness.sessionCalls.flushStorageData,
    inbox: harness.inbox.calls,
  }

  await assert.rejects(
    () => harness.invoke('memory:clear-user-data', harness.untrustedSender(), { needles: [] }),
  )
  await assert.rejects(
    () => harness.invoke('memory:clear-user-data', harness.trustedSender('pet'), { needles: [] }),
  )
  await assert.rejects(
    () => harness.invoke('memory:clear-user-data', sender, { needles: 'not-an-array' }),
  )

  assert.deepEqual(
    {
      clearAllEntries: harness.backend.clearAllEntries,
      flushStorageData: harness.sessionCalls.flushStorageData,
      inbox: harness.inbox.calls,
    },
    clearedCalls,
  )
})

test('flush-complete acknowledges only a trusted sender', async (t) => {
  const harness = await createHarness(t)

  assert.deepEqual(await harness.invoke('memory:flush-complete', harness.trustedSender('pet')), { ok: true })
  await assert.rejects(() => harness.invoke('memory:flush-complete', harness.untrustedSender()))
})

test('reset-local-storage calls the session clear only for a trusted sender', async (t) => {
  const harness = await createHarness(t)
  const sender = harness.trustedSender('panel')

  assert.deepEqual(await harness.invoke('memory:reset-local-storage', sender), { ok: true })
  assert.deepEqual(harness.sessionCalls.clearStorageData, [[{ storages: ['localstorage'] }]])

  await assert.rejects(() => harness.invoke('memory:reset-local-storage', harness.untrustedSender()))
  assert.equal(harness.sessionCalls.clearStorageData.length, 1)
})

test('vector index, search, remove and stats handlers forward validated payloads', async (t) => {
  const harness = await createHarness(t)
  const sender = harness.trustedSender('pet')

  const indexPayload = {
    id: 'mem-1',
    content: 'synthetic memory alpha',
    embedding: [1, 0, 0],
    layer: 'long_term',
    model: 'synthetic-model',
  }
  assert.deepEqual(await harness.invoke('memory:vector-index', sender, indexPayload), { ok: true })
  assert.deepEqual(harness.backend.indexMemory, [[
    'mem-1',
    'synthetic memory alpha',
    [1, 0, 0],
    'long_term',
    'synthetic-model',
  ]])

  const batchPayload = [
    indexPayload,
    { ...indexPayload, id: 'mem-2', content: 'synthetic memory beta' },
  ]
  assert.deepEqual(
    await harness.invoke('memory:vector-index-batch', sender, batchPayload),
    { ok: true, count: 2 },
  )
  assert.deepEqual(harness.backend.indexBatch, [[batchPayload]])

  const searchPayload = {
    queryEmbedding: [1, 0, 0],
    limit: 5,
    threshold: 0.2,
    layer: 'long_term',
    model: 'synthetic-model',
  }
  assert.deepEqual(
    await harness.invoke('memory:vector-search', sender, searchPayload),
    [{ id: 'mem-1', content: 'synthetic memory alpha', layer: 'long_term', score: 0.9 }],
  )
  assert.deepEqual(harness.backend.searchSimilar, [[
    [1, 0, 0],
    { limit: 5, threshold: 0.2, layer: 'long_term', model: 'synthetic-model' },
  ]])

  assert.deepEqual(await harness.invoke('memory:vector-remove', sender, { id: 'mem-1' }), { ok: true })
  assert.deepEqual(harness.backend.removeMemory, [['mem-1']])

  assert.deepEqual(
    await harness.invoke('memory:vector-remove', sender, { ids: ['mem-1', 'mem-2'] }),
    { ok: true, count: 2 },
  )
  assert.deepEqual(harness.backend.removeMemories, [[['mem-1', 'mem-2']]])

  const stats = await harness.invoke('memory:vector-stats', sender)
  assert.equal(harness.backend.getStats, 1)
  assert.deepEqual(stats, {
    totalEntries: 1,
    longTermCount: 1,
    dailyCount: 0,
    maxEntries: 2_000,
    storePath: 'app-user-data/memory-vectors.json',
    logPath: 'app-user-data/memory-vectors.log',
  })
})

test('vector search rejects an untrusted sender before calling the store', async (t) => {
  const harness = await createHarness(t)
  const sender = harness.trustedSender('pet')
  const searchPayload = {
    queryEmbedding: [1, 0, 0],
    limit: 5,
    threshold: 0.2,
    layer: 'long_term',
    model: 'synthetic-model',
  }

  await assert.rejects(
    () => harness.invoke('memory:vector-search', harness.untrustedSender(), searchPayload),
  )
  assert.deepEqual(harness.backend.searchSimilar, [])

  // The same payload reaches the store for a trusted sender, so the rejection
  // above is the sender guard rather than payload validation.
  assert.deepEqual(
    await harness.invoke('memory:vector-search', sender, searchPayload),
    [{ id: 'mem-1', content: 'synthetic memory alpha', layer: 'long_term', score: 0.9 }],
  )
  assert.equal(harness.backend.searchSimilar.length, 1)
})

test('keyword and hybrid search handlers forward the query to the store', async (t) => {
  const harness = await createHarness(t)
  const sender = harness.trustedSender('pet')

  assert.deepEqual(
    await harness.invoke('memory:keyword-search', sender, {
      query: 'alpha',
      limit: 4,
      threshold: 0.1,
      layer: 'long_term',
    }),
    [{ id: 'mem-1', content: 'synthetic memory alpha', layer: 'long_term', score: 1.2 }],
  )
  assert.deepEqual(harness.backend.searchKeyword, [[
    'alpha',
    { limit: 4, threshold: 0.1, layer: 'long_term' },
  ]])

  const hybrid = await harness.invoke('memory:hybrid-search', sender, {
    queryEmbedding: [1, 0, 0],
    queryText: 'alpha',
    limit: 4,
    threshold: 0.1,
    layer: 'long_term',
    model: 'synthetic-model',
  })
  assert.deepEqual(hybrid, [{
    id: 'mem-1',
    content: 'synthetic memory alpha',
    layer: 'long_term',
    vectorScore: 1,
    rawVectorScore: 0.9,
    keywordScore: 1,
    score: 1,
  }])
  assert.deepEqual(harness.backend.searchHybrid, [[
    [1, 0, 0],
    'alpha',
    { limit: 4, threshold: 0.1, layer: 'long_term', model: 'synthetic-model' },
  ]])
})
