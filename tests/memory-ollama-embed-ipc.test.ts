import assert from 'node:assert/strict'
import { test } from 'node:test'

import { embedWithOllama, normalizeOllamaBaseUrl } from '../electron/services/ollamaEmbed.js'
import { validateMemoryOllamaEmbedPayload } from '../electron/ipc/payloadSchemas.js'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('main-process Ollama embed: posts to /api/embed on the native root', async () => {
  const calls: Array<{ url: string; options: Record<string, unknown> }> = []
  const result = await embedWithOllama(
    { baseUrl: 'http://localhost:11434/v1', model: 'qwen3-embedding:0.6b', input: ['你好', '世界'] },
    async (url, options) => {
      calls.push({ url, options })
      return jsonResponse(200, { embeddings: [[0.1, 0.2, 0.3], [0.3, 0.2, 0.1]] })
    },
  )
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.dimensions, 3)
  assert.equal(calls[0]!.url, 'http://127.0.0.1:11434/api/embed')
  assert.equal(calls[0]!.options.allowPrivateNetwork, true)
  assert.deepEqual(JSON.parse(String(calls[0]!.options.body)), {
    model: 'qwen3-embedding:0.6b',
    input: ['你好', '世界'],
    truncate: true,
  })
})

test('main-process Ollama embed: classifies missing model, connection refused and bad payloads', async () => {
  const missing = await embedWithOllama(
    { model: 'qwen3-embedding:0.6b', input: ['x'] },
    async () => jsonResponse(404, { error: "model 'qwen3-embedding:0.6b' not found" }),
  )
  assert.deepEqual(missing, { ok: false, code: 'model-missing', message: "model 'qwen3-embedding:0.6b' not found" })

  const refused = await embedWithOllama(
    { model: 'qwen3-embedding:0.6b', input: ['x'] },
    async () => {
      const error = new TypeError('fetch failed') as TypeError & { cause?: unknown }
      error.cause = { code: 'ECONNREFUSED' }
      throw error
    },
  )
  assert.equal(refused.ok, false)
  assert.equal(!refused.ok && refused.code, 'unreachable')

  const notEmbedding = await embedWithOllama(
    { model: 'qwen3:8b', input: ['x'] },
    async () => jsonResponse(400, { error: '"qwen3:8b" does not support embeddings' }),
  )
  assert.equal(!notEmbedding.ok && notEmbedding.code, 'not-embedding-model')

  const mixed = await embedWithOllama(
    { model: 'm', input: ['a', 'b'] },
    async () => jsonResponse(200, { embeddings: [[1, 2], [1, 2, 3]] }),
  )
  assert.equal(!mixed.ok && mixed.code, 'bad-response')
})

test('main-process Ollama embed: base URL normalization', () => {
  assert.equal(normalizeOllamaBaseUrl(undefined), 'http://127.0.0.1:11434')
  assert.equal(normalizeOllamaBaseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434')
  assert.equal(normalizeOllamaBaseUrl('http://gpu-box:11434/api'), 'http://gpu-box:11434')
})

test('memory:ollama-embed payload schema', () => {
  const ok = validateMemoryOllamaEmbedPayload({ model: 'qwen3-embedding:0.6b', input: ['a'], extra: 1 })
  assert.deepEqual(ok, { model: 'qwen3-embedding:0.6b', input: ['a'] })
  assert.throws(() => validateMemoryOllamaEmbedPayload({ model: '', input: ['a'] }))
  assert.throws(() => validateMemoryOllamaEmbedPayload({ model: 'm', input: new Array(65).fill('a') }))
})
