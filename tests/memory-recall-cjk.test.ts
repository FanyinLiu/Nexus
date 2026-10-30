import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { after, test } from 'node:test'

register(new URL('./helpers/memory-vector-electron-hooks.mjs', import.meta.url))

const windowShim: Record<string, unknown> = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true },
}
;(globalThis as Record<string, unknown>).window = windowShim
// Storage modules open a BroadcastChannel when `window` exists, which keeps
// the Node event loop alive; hide it while importing.
const realBroadcastChannel = globalThis.BroadcastChannel
;(globalThis as Record<string, unknown>).BroadcastChannel = undefined

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-recall-cjk-'))
;(globalThis as Record<string, unknown>).__nexusMemoryVectorUserData = userData

const { tokenizeForRecall, scoreRecallKeywordOverlap } = await import('../src/features/memory/recallTokens.ts')
const { rankMemories, scoreLexicalSimilarity } = await import('../src/features/memory/memory.ts')
const { buildMemoryRecallContext } = await import('../src/features/memory/recall.ts')
const { embedLocalHashMemoryText, clearMemoryEmbeddingCache } = await import('../src/features/memory/vectorSearch.ts')
const { resetOllamaEmbeddingState, setOllamaEmbedTransport, QWEN3_MEMORY_EMBEDDING_MODEL_ID } = await import(
  '../src/features/memory/ollamaEmbedding.ts'
)
const { tokenize: bm25Tokenize } = await import('../electron/services/bm25Search.js')
const store = await import('../electron/services/memoryVectorStore.js')
;(globalThis as Record<string, unknown>).BroadcastChannel = realBroadcastChannel

after(async () => {
  setOllamaEmbedTransport(null)
  await store.terminate()
  await fs.rm(userData, { recursive: true, force: true })
})

function memory(id: string, content: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    content,
    category: 'preference',
    source: 'test',
    enabled: true,
    status: 'active',
    importance: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as never
}

test('CJK tokenization: Chinese runs become bigrams, Latin words stay whole', () => {
  assert.deepEqual(tokenizeForRecall('我对花生过敏'), ['我对', '对花', '花生', '生过', '过敏'])
  assert.deepEqual(tokenizeForRecall('最喜欢的 movie 是 Spirited Away'), ['最喜', '喜欢', '欢的', 'movie', 'spirited', 'away'])
  // Lone particles are dropped, lone content characters kept.
  assert.deepEqual(tokenizeForRecall('猫 的 狗'), ['猫', '狗'])
})

test('CJK tokenization: the old word scorer saw a Chinese clause as one token', () => {
  // Regression guard documenting the root cause.
  assert.equal(scoreLexicalSimilarity('我对花生严重过敏', '我有什么过敏的东西'), 0)
  assert.ok(scoreRecallKeywordOverlap('我对花生严重过敏', '我有什么过敏的东西') > 0)
})

test('keyword ranking finds the Chinese memory that shares words with the query', () => {
  const ranked = rankMemories([
    memory('a', '每周二和周四下班后去游泳'),
    memory('b', '我对花生严重过敏，吃一点就会起疹子'),
    memory('c', '我养了一只橘猫，叫土豆'),
  ], '我对什么东西过敏？')
  assert.equal(ranked[0]!.id, 'b')
})

test('English keyword ranking is unchanged', () => {
  const memories = [memory('a', 'dark roast coffee'), memory('b', 'green tea')]
  assert.equal(rankMemories(memories, 'coffee roast')[0]!.id, 'a')
  assert.equal(scoreRecallKeywordOverlap('dark roast', 'dark roast'), scoreLexicalSimilarity('dark roast', 'dark roast'))
})

test('BM25 tokenizer adds CJK bigrams next to unigrams', () => {
  assert.deepEqual(bm25Tokenize('过敏 cat'), ['过', '敏', '过敏', 'cat'])
})

test('hybrid recall scores every memory: a paraphrase with no word overlap is no longer filtered out', async () => {
  // 20 distractors share words with the query; the target shares none but is
  // semantically identical according to the (fake) embedding model.
  const distractors = Array.from({ length: 20 }, (_, index) => memory(`d${index}`, `周末 计划 第${index}条 普通记录`))
  const target = memory('target', '弟弟明年六月高考')
  const query = '周末计划：家里谁要参加升学考试'

  resetOllamaEmbeddingState()
  setOllamaEmbedTransport(async (request) => ({
    ok: true,
    embeddings: request.input.map((text) => (
      text === '弟弟明年六月高考' || text.endsWith(query) ? [1, 0, 0] : [0, 1, 0]
    )),
  }))

  const context = await buildMemoryRecallContext({
    query,
    longTermMemories: [...distractors, target],
    dailyMemories: {},
    searchMode: 'hybrid',
    embeddingModel: QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    longTermLimit: 4,
    dailyLimit: 4,
    semanticLimit: 4,
    retentionDays: 7,
  })
  assert.equal(context.longTerm[0]!.id, 'target')
  setOllamaEmbedTransport(null)
})

test('recency is a tie-break, not a reason to outrank the semantic answer', async () => {
  // "What did I say before" has no lexical overlap with either Chinese
  // memory, so only the fake cosine decides. The newer memory is a weaker
  // match; a large recency bonus let it win before these weights.
  clearMemoryEmbeddingCache()
  resetOllamaEmbeddingState()
  const older = Math.sqrt(1 - 0.6 * 0.6)
  const newer = Math.sqrt(1 - 0.48 * 0.48)
  setOllamaEmbedTransport(async (request) => ({
    ok: true,
    embeddings: request.input.map((text) => {
      if (text.includes('Instruct:')) return [1, 0]
      if (text.includes('旧')) return [0.6, older]
      if (text.includes('新')) return [0.48, newer]
      return [0, 1]
    }),
  }))
  const context = await buildMemoryRecallContext({
    query: 'what did I say before',
    longTermMemories: [
      memory('old', '旧事实甲', { createdAt: '2020-01-01T00:00:00.000Z' }),
      memory('fresh', '新事实乙', { createdAt: new Date().toISOString() }),
      memory('noise', '无关记录', { createdAt: new Date().toISOString() }),
    ],
    dailyMemories: {},
    searchMode: 'hybrid',
    embeddingModel: QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    longTermLimit: 3,
    dailyLimit: 2,
    semanticLimit: 3,
    retentionDays: 7,
  })
  assert.equal(context.longTerm[0]!.id, 'old')
  setOllamaEmbedTransport(null)
})

test('lexical overlap breaks a near-tie that the embedding alone cannot', async () => {
  clearMemoryEmbeddingCache()
  resetOllamaEmbeddingState()
  const target = Math.sqrt(1 - 0.58 * 0.58)
  const distract = Math.sqrt(1 - 0.6 * 0.6)
  setOllamaEmbedTransport(async (request) => ({
    ok: true,
    embeddings: request.input.map((text) => {
      if (text.includes('Instruct:')) return [1, 0]
      if (text.includes('coffee')) return [0.58, target]
      if (text.includes('green')) return [0.6, distract]
      return [0, 1]
    }),
  }))
  const context = await buildMemoryRecallContext({
    query: 'coffee roast',
    longTermMemories: [
      memory('target', 'coffee roast notes'),
      memory('distract', 'green tea notes'),
      memory('noise', 'unrelated diary'),
    ],
    dailyMemories: {},
    searchMode: 'hybrid',
    embeddingModel: QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    longTermLimit: 3,
    dailyLimit: 2,
    semanticLimit: 3,
    retentionDays: 7,
  })
  assert.equal(context.longTerm[0]!.id, 'target')
  setOllamaEmbedTransport(null)
})

test('dimension change: stored hash vectors are skipped and re-scored with the new model', async () => {
  await store.clearAllEntries()
  // Index written while the user was on the 256-dim local hash.
  await store.indexBatch([
    { id: 'm1', content: '我对花生严重过敏', embedding: embedLocalHashMemoryText('我对花生严重过敏'), layer: 'long_term', model: 'local-hash-v1' },
    { id: 'm2', content: '我养了一只橘猫', embedding: embedLocalHashMemoryText('我养了一只橘猫'), layer: 'long_term' },
  ])

  // A 1024-dim qwen3 query must not be compared with them.
  const query = new Array(1024).fill(0)
  query[0] = 1
  assert.deepEqual(await store.searchSimilar(query, { limit: 10, threshold: 0, model: QWEN3_MEMORY_EMBEDDING_MODEL_ID }), [])

  // Same length but another tagged model is skipped too.
  const sameDim = new Array(256).fill(0)
  sameDim[0] = 1
  assert.deepEqual(
    (await store.searchSimilar(sameDim, { limit: 10, threshold: -1, model: 'Xenova/other-256' })).map((r: { id: string }) => r.id),
    ['m2'], // untagged legacy entry of matching length is still usable
  )

  // Keyword hits with incompatible vectors are flagged for re-embedding.
  const hybrid = await store.searchHybrid(query, '花生过敏', { limit: 10, threshold: 0, model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
  const hit = hybrid.find((r: { id: string }) => r.id === 'm1')
  assert.equal(hit?.vectorStale, true)
  assert.equal(hit?.vectorScore, 0)

  // End to end: recall with the new model re-scores locally and re-indexes
  // with the new model tag instead of trusting vectorScore 0.
  resetOllamaEmbeddingState()
  setOllamaEmbedTransport(async (request) => ({
    ok: true,
    embeddings: request.input.map((text) => (/过敏/.test(text) ? [1, 0, 0] : [0, 1, 0])),
  }))
  windowShim.desktopPet = {
    memoryVectorIndexBatch: async (batch: unknown[]) => {
      await store.indexBatch(batch)
      return { ok: true, count: batch.length }
    },
    memoryHybridSearch: async (payload: { queryEmbedding: number[]; queryText: string; model?: string; limit?: number }) => (
      store.searchHybrid(payload.queryEmbedding, payload.queryText, payload)
    ),
  }
  try {
    const context = await buildMemoryRecallContext({
      query: '我有什么过敏的吗',
      longTermMemories: [memory('m1', '我对花生严重过敏'), memory('m2', '我养了一只橘猫')],
      dailyMemories: {},
      searchMode: 'hybrid',
      embeddingModel: QWEN3_MEMORY_EMBEDDING_MODEL_ID,
      longTermLimit: 2,
      dailyLimit: 2,
      semanticLimit: 2,
      retentionDays: 7,
    })
    assert.equal(context.longTerm[0]!.id, 'm1')
    assert.ok(context.semantic.some((match) => match.id === 'm1' && match.score > 0.9))

    // Background re-index replaced the 256-dim vectors with 3-dim qwen ones.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const reindexed = await store.searchSimilar([1, 0, 0], { limit: 10, threshold: 0, model: QWEN3_MEMORY_EMBEDDING_MODEL_ID })
    assert.deepEqual(reindexed.map((r: { id: string }) => r.id).sort(), ['m1', 'm2'])
  } finally {
    delete windowShim.desktopPet
    setOllamaEmbedTransport(null)
  }
})
