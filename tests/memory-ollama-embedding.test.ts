import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

// recall.ts pulls in storage modules that touch `window` at import time.
const windowShim: Record<string, unknown> = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true },
}
;(globalThis as Record<string, unknown>).window = windowShim

const {
  QWEN3_MEMORY_EMBEDDING_MODEL_ID,
  QWEN3_MEMORY_QUERY_INSTRUCTION,
  getMemoryEmbeddingBackendStatus,
  normalizeOllamaEmbedBaseUrl,
  resetOllamaEmbeddingState,
  resolveOllamaEmbedBaseUrl,
  setOllamaEmbedBaseUrl,
  setOllamaEmbedTransport,
} = await import('../src/features/memory/ollamaEmbedding.ts')
const {
  cosineSimilarity,
  embedMemorySearchTextWithModel,
  embedMemoryTextsWithModel,
  resolveActiveMemoryEmbeddingModel,
} = await import('../src/features/memory/vectorSearch.ts')
const { LOCAL_HASH_MEMORY_MODEL_ID, MEMORY_EMBEDDING_MODEL_OPTIONS } = await import('../src/features/memory/constants.ts')
const { resolveMemoryEmbeddingStatusView } = await import('../src/features/memory/memoryEmbeddingStatusView.ts')

type Request = { baseUrl: string; model: string; input: string[] }

let requests: Request[] = []

/** Deterministic fake 4-dim embeddings keyed on content. */
function fakeVector(text: string) {
  const body = text.replace(/^Instruct:[^\n]*\nQuery: /, '')
  let hash = 0
  for (const char of body) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return [1 + (hash % 7), 2 + (hash % 5), 3 + (hash % 3), 4]
}

function installHealthyTransport(vectorFor: (text: string) => number[] = fakeVector) {
  setOllamaEmbedTransport(async (request) => {
    requests.push(request)
    return { ok: true, embeddings: request.input.map(vectorFor) }
  })
}

beforeEach(() => {
  requests = []
  resetOllamaEmbeddingState()
  setOllamaEmbedBaseUrl('http://127.0.0.1:11434')
})

afterEach(() => {
  setOllamaEmbedTransport(null)
  delete windowShim.desktopPet
})

let uniqueCounter = 0
function unique(text: string) {
  uniqueCounter += 1
  return `${text} #${uniqueCounter}`
}

test('qwen3 option is offered and hash stays the default', () => {
  assert.equal(QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'ollama:qwen3-embedding:0.6b')
  assert.ok(MEMORY_EMBEDDING_MODEL_OPTIONS.some((option) => option.value === QWEN3_MEMORY_EMBEDDING_MODEL_ID))
  assert.equal(MEMORY_EMBEDDING_MODEL_OPTIONS[0]!.value, LOCAL_HASH_MEMORY_MODEL_ID)
})

test('base URL: chat /v1 suffix is stripped and localhost canonicalized', () => {
  assert.equal(normalizeOllamaEmbedBaseUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434')
  assert.equal(normalizeOllamaEmbedBaseUrl('http://localhost:11434/v1/'), 'http://127.0.0.1:11434')
  assert.equal(normalizeOllamaEmbedBaseUrl('192.168.1.5:11434'), 'http://192.168.1.5:11434')
  assert.equal(normalizeOllamaEmbedBaseUrl(''), 'http://127.0.0.1:11434')
  assert.equal(
    resolveOllamaEmbedBaseUrl({ apiProviderId: 'ollama', apiBaseUrl: 'http://10.0.0.2:11434/v1' }),
    'http://10.0.0.2:11434',
  )
  // A cloud chat provider's URL is never reused for memory embeddings.
  assert.equal(
    resolveOllamaEmbedBaseUrl({ apiProviderId: 'openai', apiBaseUrl: 'https://api.openai.com/v1' }),
    'http://127.0.0.1:11434',
  )
})

test('ollama backend: queries get the qwen3 instruction, documents are plain, vectors are normalized', async () => {
  installHealthyTransport()
  const queryText = unique('我做什么工作的')
  const docText = unique('我在杭州当产品经理')

  const query = await embedMemorySearchTextWithModel(queryText, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'query')
  const doc = await embedMemorySearchTextWithModel(docText, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')

  assert.equal(query.model, QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  assert.equal(doc.model, QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  assert.equal(requests.length, 2)
  assert.equal(requests[0]!.model, 'qwen3-embedding:0.6b')
  assert.equal(requests[0]!.baseUrl, 'http://127.0.0.1:11434')
  assert.equal(requests[0]!.input[0], `Instruct: ${QWEN3_MEMORY_QUERY_INSTRUCTION}\nQuery: ${queryText}`)
  assert.equal(requests[1]!.input[0], docText)
  assert.ok(Math.abs(Math.hypot(...query.embedding) - 1) < 1e-9)
  assert.deepEqual(getMemoryEmbeddingBackendStatus(), {
    state: 'ready',
    model: QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    dimensions: 4,
  })
})

test('ollama backend: documents are batched into one request', async () => {
  installHealthyTransport()
  const texts = Array.from({ length: 5 }, (_, index) => unique(`记忆 ${index}`))
  const result = await embedMemoryTextsWithModel(texts, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(result.model, QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  assert.equal(result.embeddings.length, 5)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0]!.input, texts)
})

test('fallback: Ollama down -> local hash, visible status, cooldown keeps the recall on one model', async () => {
  setOllamaEmbedTransport(async (request) => {
    requests.push(request)
    return { ok: false, code: 'unreachable', message: 'Cannot reach Ollama at http://127.0.0.1:11434' }
  })

  const result = await embedMemorySearchTextWithModel(unique('我养了一只猫'), QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'query')
  assert.equal(result.model, LOCAL_HASH_MEMORY_MODEL_ID)
  assert.equal(result.embedding.length, 256)

  const status = getMemoryEmbeddingBackendStatus()
  assert.equal(status.state, 'fallback')
  assert.equal(status.state === 'fallback' && status.code, 'unreachable')
  assert.equal(resolveActiveMemoryEmbeddingModel(QWEN3_MEMORY_EMBEDDING_MODEL_ID), LOCAL_HASH_MEMORY_MODEL_ID)

  // During the cooldown no further requests hit Ollama.
  const second = await embedMemorySearchTextWithModel(unique('另一条'), QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(second.model, LOCAL_HASH_MEMORY_MODEL_ID)
  assert.equal(requests.length, 1)

  const view = resolveMemoryEmbeddingStatusView(QWEN3_MEMORY_EMBEDDING_MODEL_ID, status, (key) => key)
  assert.equal(view?.tone, 'warning')
  assert.equal(view?.key, 'memory.embedding.status.fallback')
  assert.equal(view?.params.reason, 'memory.embedding.status.unreachable')
})

test('fallback: missing model explains how to pull it', async () => {
  setOllamaEmbedTransport(async () => ({ ok: false, code: 'model-missing', message: "model 'qwen3-embedding:0.6b' not found" }))
  await embedMemorySearchTextWithModel(unique('测试'), QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  const status = getMemoryEmbeddingBackendStatus()
  assert.equal(status.state, 'fallback')
  assert.match(status.state === 'fallback' ? status.message : '', /ollama pull qwen3-embedding:0\.6b/)

  const view = resolveMemoryEmbeddingStatusView(
    QWEN3_MEMORY_EMBEDDING_MODEL_ID,
    status,
    (key, params) => `${key}:${params?.model ?? ''}`,
  )
  assert.equal(view?.params.reason, 'memory.embedding.status.model_missing:qwen3-embedding:0.6b')
})

test('cache is keyed by model: a fallback hash vector never shadows the real one', async () => {
  const text = unique('早上要喝冰美式')
  setOllamaEmbedTransport(async () => ({ ok: false, code: 'unreachable', message: 'down' }))
  const down = await embedMemorySearchTextWithModel(text, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(down.embedding.length, 256)

  resetOllamaEmbeddingState() // cooldown over
  installHealthyTransport()
  const up = await embedMemorySearchTextWithModel(text, QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
  assert.equal(up.model, QWEN3_MEMORY_EMBEDDING_MODEL_ID)
  assert.equal(up.embedding.length, 4)
})

test('default transport uses fetch outside Electron and classifies a 404 as model-missing', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; body: { model: string; input: string[] } }> = []
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    if (calls.length === 1) {
      return new Response(JSON.stringify({ embeddings: [[3, 4]] }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: "model 'qwen3-embedding:0.6b' not found" }), { status: 404 })
  }) as typeof fetch
  try {
    const ok = await embedMemorySearchTextWithModel(unique('fetch ok'), QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
    assert.deepEqual(ok.embedding, [0.6, 0.8])
    assert.equal(calls[0]!.url, 'http://127.0.0.1:11434/api/embed')
    assert.equal(calls[0]!.body.model, 'qwen3-embedding:0.6b')

    const missing = await embedMemorySearchTextWithModel(unique('fetch 404'), QWEN3_MEMORY_EMBEDDING_MODEL_ID, 'document')
    assert.equal(missing.model, LOCAL_HASH_MEMORY_MODEL_ID)
    const status = getMemoryEmbeddingBackendStatus()
    assert.equal(status.state === 'fallback' && status.code, 'model-missing')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('cosine of mismatched dimensions is 0, never a garbage partial dot product', () => {
  assert.equal(cosineSimilarity([1, 0, 0, 0], new Array(256).fill(0.01)), 0)
})
