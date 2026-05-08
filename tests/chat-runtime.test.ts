import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildChatConnectionTestRequest,
  buildChatModelListRequest,
  buildChatRequest,
  buildDiscoveredChatModels,
  chatProviderRequiresApiKey,
  extractChatModelEntries,
  extractChatResponseContent,
  extractChatStreamingDeltaContent,
  getChatConnectionTestPreflightFailure,
  normalizeChatProviderId,
  summarizeChatConnectionTestFailure,
  summarizeChatConnectionTestSuccess,
} from '../electron/chatRuntime.js'

test('ollama is inferred from the default local port and does not require an API key', () => {
  assert.equal(normalizeChatProviderId('', 'http://127.0.0.1:11434/v1'), 'ollama')
  assert.equal(chatProviderRequiresApiKey('ollama'), false)
})

test('provider base URLs map to the correct Nexus provider ids', () => {
  assert.equal(normalizeChatProviderId('', 'https://qianfan.baidubce.com/v2'), 'qianfan')
  assert.equal(normalizeChatProviderId('', 'https://open.bigmodel.cn/api/paas/v4'), 'zai')
  assert.equal(normalizeChatProviderId('', 'https://ark.ap-southeast.bytepluses.com/api/v3'), 'byteplus')
  assert.equal(normalizeChatProviderId('', 'https://integrate.api.nvidia.com/v1'), 'nvidia')
  assert.equal(normalizeChatProviderId('', 'https://api.venice.ai/api/v1'), 'venice')
  assert.equal(chatProviderRequiresApiKey('qianfan'), true)
})

test('anthropic requests use the messages endpoint and separate the system prompt', () => {
  const request = buildChatRequest({
    providerId: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'test-key',
    model: 'claude-opus-4-6',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello there.' },
    ],
    maxTokens: 64,
  })

  const body = JSON.parse(request.body)

  assert.equal(request.endpoint, 'https://api.anthropic.com/v1/messages')
  assert.equal(request.headers['x-api-key'], 'test-key')
  // System is emitted as a single text block with cache_control: ephemeral so
  // the Anthropic prompt cache can reuse the rendered prefix across turns.
  assert.deepEqual(body.system, [
    { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
  ])
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello there.' }])
})

test('minimax anthropic-compatible base URL receives the v1/messages suffix', () => {
  const request = buildChatRequest({
    providerId: 'minimax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiKey: 'test-key',
    model: 'MiniMax-M1',
    messages: [{ role: 'user', content: 'Ping' }],
  })

  assert.equal(request.endpoint, 'https://api.minimaxi.com/anthropic/v1/messages')
})

test('anthropic connection tests use a lightweight messages probe', () => {
  const request = buildChatConnectionTestRequest({
    providerId: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'test-key',
    model: 'claude-opus-4-6',
  })

  assert.equal(request.endpoint, 'https://api.anthropic.com/v1/messages')
  assert.equal(request.request.method, 'POST')
  assert.equal(request.successKind, 'message')
})

test('ollama connection test reports a missing configured model clearly', () => {
  const result = summarizeChatConnectionTestSuccess({
    providerId: 'ollama',
    successKind: 'model_list',
    model: 'qwen3:8b',
    data: {
      data: [
        { id: 'llama3.2:3b' },
      ],
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /ollama pull qwen3:8b/i)
})

test('ollama connection test reports an empty local model list clearly', () => {
  const result = summarizeChatConnectionTestSuccess({
    providerId: 'ollama',
    successKind: 'model_list',
    model: 'qwen3:8b',
    data: { data: [] },
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /还没有发现可用模型/)
  assert.equal(result.status, 'model_missing')
})

test('ollama model discovery accepts OpenAI-compatible and native Ollama shapes', () => {
  assert.deepEqual(
    extractChatModelEntries({ data: [{ id: 'qwen3:8b' }] }).map((entry) => entry.id),
    ['qwen3:8b'],
  )
  assert.deepEqual(
    extractChatModelEntries({ models: [{ name: 'llama3.2:3b', size: 123 }] }).map((entry) => entry.id),
    ['llama3.2:3b'],
  )

  const models = buildDiscoveredChatModels({
    providerId: 'ollama',
    data: { data: [{ id: 'qwen3:8b' }] },
  })

  assert.equal(models[0]?.source, 'ollama')
  assert.equal(models[0]?.capabilities.runLocation, 'local')
  assert.equal(models[0]?.capabilities.requiresApiKey, false)
})

test('buildChatModelListRequest uses provider-aware model-list endpoints', () => {
  assert.equal(
    buildChatModelListRequest({
      providerId: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
    }).endpoint,
    'http://127.0.0.1:11434/v1/models',
  )

  assert.equal(
    buildChatModelListRequest({
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'test',
    }).endpoint,
    'https://api.anthropic.com/v1/models',
  )
})

test('deepseek connection test asks for an API key before probing the network', () => {
  const result = getChatConnectionTestPreflightFailure({
    providerId: 'deepseek',
    apiKey: '',
  })

  assert.equal(result?.ok, false)
  assert.match(result?.message ?? '', /DeepSeek API.*API Key/)
})

test('deepseek connection test reports model mismatches with a recommended fallback', () => {
  const result = summarizeChatConnectionTestFailure({
    providerId: 'deepseek',
    status: 400,
    hasApiKey: true,
    model: 'not-a-real-model',
    data: {
      error: {
        message: 'model not found',
      },
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /deepseek-v4-flash/)
})

test('extractChatResponseContent handles anthropic text blocks', () => {
  const content = extractChatResponseContent('anthropic', {
    content: [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'world' },
    ],
  })

  assert.equal(content, 'Hello\nworld')
})

test('extractChatStreamingDeltaContent reads anthropic text deltas', () => {
  const delta = extractChatStreamingDeltaContent('anthropic', {
    type: 'content_block_delta',
    delta: {
      type: 'text_delta',
      text: 'Hello',
    },
  })

  assert.equal(delta, 'Hello')
})
