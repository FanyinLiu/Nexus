import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildChatConnectionTestRequest,
  buildChatRequest,
  chatProviderRequiresApiKey,
  extractChatResponseContent,
  extractChatStreamingDeltaContent,
  normalizeChatProviderId,
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
  assert.equal(body.system, 'You are helpful.')
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
