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
  getChatProviderProtocol,
  normalizeChatProviderId,
  summarizeChatConnectionTestFailure,
  summarizeChatConnectionTestSuccess,
  summarizeChatConnectionTransportFailure,
} from '../electron/chatRuntime.js'

test('ollama is inferred from the default local port and does not require an API key', () => {
  assert.equal(normalizeChatProviderId('', 'http://127.0.0.1:11434/v1'), 'ollama')
  assert.equal(chatProviderRequiresApiKey('ollama'), false)
})

test('provider base URLs map to the correct Nexus provider ids', () => {
  assert.equal(normalizeChatProviderId('', 'https://qianfan.baidubce.com/v2'), 'qianfan')
  assert.equal(normalizeChatProviderId('', 'https://open.bigmodel.cn/api/paas/v4'), 'zai')
  assert.equal(normalizeChatProviderId('', 'https://ark.ap-southeast.bytepluses.com/api/v3'), 'byteplus')
  assert.equal(normalizeChatProviderId('', 'https://ark.ap-southeast.bytepluses.com/api/coding/v3'), 'byteplus-coding')
  assert.equal(normalizeChatProviderId('', 'https://ark.cn-beijing.volces.com/api/v3'), 'doubao')
  assert.equal(normalizeChatProviderId('', 'https://ark.cn-beijing.volces.com/api/coding/v3'), 'doubao-coding')
  assert.equal(normalizeChatProviderId('', 'https://integrate.api.nvidia.com/v1'), 'nvidia')
  assert.equal(normalizeChatProviderId('', 'https://api.venice.ai/api/v1'), 'venice')
  assert.equal(normalizeChatProviderId('', 'https://api.moonshot.ai/v1'), 'moonshot-global')
  assert.equal(normalizeChatProviderId('', 'https://api.moonshot.ai/anthropic'), 'kimi-coding-global')
  assert.equal(normalizeChatProviderId('', 'https://api.minimax.io/anthropic'), 'minimax-global')
  assert.equal(normalizeChatProviderId('', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'), 'dashscope-global')
  assert.equal(normalizeChatProviderId('', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), 'dashscope')
  assert.equal(normalizeChatProviderId('', 'https://api.siliconflow.com/v1'), 'siliconflow-global')
  assert.equal(normalizeChatProviderId('', 'https://api.siliconflow.cn/v1'), 'siliconflow')
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

test('coding-plan anthropic-compatible providers use Anthropic messages protocol', () => {
  const minimaxRequest = buildChatRequest({
    providerId: 'minimax-coding',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiKey: 'test-key',
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'Ping' }],
  })
  const kimiRequest = buildChatRequest({
    providerId: 'kimi-coding-global',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    apiKey: 'test-key',
    model: 'kimi-k2.6',
    messages: [{ role: 'user', content: 'Ping' }],
  })

  assert.equal(minimaxRequest.protocol, 'anthropic')
  assert.equal(minimaxRequest.endpoint, 'https://api.minimaxi.com/anthropic/v1/messages')
  assert.deepEqual(JSON.parse(minimaxRequest.body).thinking, { type: 'disabled' })
  assert.equal(kimiRequest.protocol, 'anthropic')
  assert.equal(kimiRequest.endpoint, 'https://api.moonshot.ai/anthropic/v1/messages')
})

test('chat auth headers trim keys and reject pasted non-header text', () => {
  const trimmedRequest = buildChatRequest({
    providerId: 'minimax-coding',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiKey: '  test-key  ',
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'Ping' }],
  })
  assert.equal(trimmedRequest.headers['x-api-key'], 'test-key')

  assert.throws(
    () => buildChatRequest({
      providerId: 'minimax-coding',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'test-key 模型说明',
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'Ping' }],
    }),
    /MiniMax Token Plan API Key 格式好像不太对/,
  )

  const preflight = getChatConnectionTestPreflightFailure({
    providerId: 'minimax-coding',
    apiKey: 'test-key 模型说明',
  })
  assert.equal(preflight?.ok, false)
  assert.match(preflight?.message ?? '', /MiniMax Token Plan API Key 格式好像不太对/)
})

test('anthropic-compatible base URL infers messages protocol for custom providers', () => {
  assert.equal(getChatProviderProtocol('custom', 'https://api.example.test/anthropic'), 'anthropic')

  const request = buildChatRequest({
    providerId: 'custom',
    baseUrl: 'https://api.example.test/anthropic',
    apiKey: 'test-key',
    model: 'compatible-model',
    messages: [{ role: 'user', content: 'Ping' }],
  })

  assert.equal(request.endpoint, 'https://api.example.test/anthropic/v1/messages')
})

test('deepseek v4 requests disable default thinking for chat compatibility', () => {
  const request = buildChatRequest({
    providerId: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'Ping' }],
  })

  assert.deepEqual(JSON.parse(request.body).thinking, { type: 'disabled' })
})

test('claude opus 4.8 requests omit non-default sampling parameters', () => {
  const request = buildChatRequest({
    providerId: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'test-key',
    model: 'claude-opus-4-8',
    messages: [{ role: 'user', content: 'Ping' }],
  })

  assert.equal(Object.hasOwn(JSON.parse(request.body), 'temperature'), false)
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
  assert.match(result.message, /还没有模型/)
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
  assert.match(result?.message ?? '', /DeepSeek.*API Key/)
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

test('429 rate-limit returns actionable recommendation', () => {
  const result = summarizeChatConnectionTestFailure({
    providerId: 'openai',
    status: 429,
    hasApiKey: true,
    model: 'gpt-4o',
    data: { error: { message: 'Rate limit exceeded' } },
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /Rate limit/)
})

test('404 with model returns model_missing status for non-deepseek providers', () => {
  const result = summarizeChatConnectionTestFailure({
    providerId: 'openai',
    status: 404,
    hasApiKey: true,
    model: 'gpt-99',
    data: {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'model_missing')
  assert.match(result.message, /gpt-99/)
})

test('402 returns needs_key for non-deepseek providers', () => {
  const result = summarizeChatConnectionTestFailure({
    providerId: 'openai',
    status: 402,
    hasApiKey: true,
    model: 'gpt-4o',
    data: {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'needs_key')
})

test('408 timeout returns unreachable with recommendation', () => {
  const result = summarizeChatConnectionTestFailure({
    providerId: 'openai',
    status: 408,
    hasApiKey: true,
    model: 'gpt-4o',
    data: {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'unreachable')
  assert.ok(result.recommendation)
})

test('ollama transport failure tells the user to start the local service', () => {
  const result = summarizeChatConnectionTransportFailure({
    providerId: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    reason: 'connect ECONNREFUSED 127.0.0.1:11434',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'unreachable')
  assert.match(result.message, /本机 Ollama/)
  assert.match(result.message, /http:\/\/127\.0\.0\.1:11434\/v1/)
  assert.match(result.recommendation ?? '', /ollama serve/)
  assert.match(result.recommendation ?? '', /ollama pull qwen3:8b/)
})

test('ollama transport timeout keeps the same actionable startup path', () => {
  const result = summarizeChatConnectionTransportFailure({
    providerId: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    reason: 'ETIMEDOUT',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'unreachable')
  assert.match(result.message, /一直没有回应/)
  assert.match(result.recommendation ?? '', /连接测试/)
})

test('non-local transport failures keep generic network repair guidance', () => {
  const result = summarizeChatConnectionTransportFailure({
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reason: 'fetch failed',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'unreachable')
  assert.match(result.message, /fetch failed/)
  assert.match(result.recommendation ?? '', /地址和网络/)
})

test('502 returns unreachable with maintenance hint', () => {
  const result = summarizeChatConnectionTestFailure({
    providerId: 'openai',
    status: 502,
    hasApiKey: true,
    model: 'gpt-4o',
    data: {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'unreachable')
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

test('extractChatStreamingDeltaContent preserves OpenAI-compatible delta whitespace', () => {
  const delta = extractChatStreamingDeltaContent('deepseek', {
    choices: [
      {
        delta: {
          content: ' stream path',
        },
      },
    ],
  })

  assert.equal(delta, ' stream path')
})

test('extractChatStreamingDeltaContent preserves anthropic delta whitespace', () => {
  const delta = extractChatStreamingDeltaContent('anthropic', {
    type: 'content_block_delta',
    delta: {
      type: 'text_delta',
      text: ' hello world ',
    },
  })

  assert.equal(delta, ' hello world ')
})
