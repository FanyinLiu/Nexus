import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'

// Recall imports renderer storage modules; give them the browser globals they
// expect without opening a BroadcastChannel that would keep Node alive.
const windowShim: Record<string, unknown> = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true },
}
;(globalThis as Record<string, unknown>).window = windowShim
const realBroadcastChannel = globalThis.BroadcastChannel
;(globalThis as Record<string, unknown>).BroadcastChannel = undefined

const { buildMemoryRecallContext } = await import('../src/features/memory/recall.ts')
const { clearMemoryEmbeddingCache } = await import('../src/features/memory/vectorSearch.ts')
const {
  QWEN3_MEMORY_EMBEDDING_MODEL_ID,
  resetOllamaEmbeddingState,
  setOllamaEmbedTransport,
} = await import('../src/features/memory/ollamaEmbedding.ts')
;(globalThis as Record<string, unknown>).BroadcastChannel = realBroadcastChannel

const QWEN3 = QWEN3_MEMORY_EMBEDDING_MODEL_ID

after(() => {
  setOllamaEmbedTransport(null)
})

beforeEach(() => {
  resetOllamaEmbeddingState()
  clearMemoryEmbeddingCache()
})

function memory(id: string, content: string) {
  return {
    id,
    content,
    category: 'preference',
    source: 'test',
    enabled: true,
    status: 'active',
    importance: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as never
}

async function recall(query: string, memories: ReturnType<typeof memory>[]) {
  return buildMemoryRecallContext({
    query,
    longTermMemories: memories,
    dailyMemories: {},
    searchMode: 'hybrid',
    embeddingModel: QWEN3,
    longTermLimit: 4,
    dailyLimit: 4,
    semanticLimit: 4,
    retentionDays: 7,
  })
}

test('an empty memory store says nothing fits instead of failing open', async () => {
  setOllamaEmbedTransport(async (request) => ({
    ok: true,
    embeddings: request.input.map(() => [1, 0, 0]),
  }))
  const context = await recall('我养过什么宠物', [])
  assert.equal(context.recallConfidence, 'none')
  assert.deepEqual(context.longTerm, [])
  assert.deepEqual(context.semantic, [])
})

test('one weak memory is kept and flagged, not suppressed', async () => {
  setOllamaEmbedTransport(async (request) => ({
    ok: true,
    embeddings: request.input.map((text) => text.includes('Instruct:') ? [1, 0, 0] : [0, 1, 0]),
  }))
  const context = await recall('我的车牌号是多少', [memory('m1', '我喜欢喝无糖乌龙茶')])
  assert.equal(context.recallConfidence, 'low')
  assert.deepEqual(context.longTerm.map((item) => item.id), ['m1'])
})

test('duplicate memories do not turn a weak match into a rejection', async () => {
  setOllamaEmbedTransport(async (request) => ({
    ok: true,
    embeddings: request.input.map((text) => text.includes('Instruct:') ? [1, 0, 0] : [0, 1, 0]),
  }))
  const context = await recall('我的车牌号是多少', [
    memory('m1', '我喜欢喝无糖乌龙茶'),
    memory('m2', '我喜欢喝无糖乌龙茶'),
  ])
  assert.equal(context.recallConfidence, 'low')
  assert.deepEqual(context.longTerm.map((item) => item.id).sort(), ['m1', 'm2'])
})

test('an unavailable embedding provider never suppresses recall', async () => {
  setOllamaEmbedTransport(async () => ({ ok: false, code: 'unreachable', message: 'down' }))
  const context = await recall('我喜欢喝什么茶', [memory('m1', '我喜欢喝无糖乌龙茶')])
  assert.equal(context.recallConfidence, undefined)
  assert.deepEqual(context.longTerm.map((item) => item.id), ['m1'])
})
