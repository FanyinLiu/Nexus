import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionToolCall,
} from '../src/types/chat.ts'
import {
  MAX_TOOL_CALLS_PER_ROUND,
  MAX_TOOL_CALL_ROUNDS,
  runToolCallLoop,
} from '../src/features/chat/toolCallLoop.ts'

function makeToolCall(id: string, args = '{}'): ChatCompletionToolCall {
  return {
    id,
    type: 'function',
    function: {
      name: 'sample_tool',
      arguments: args,
    },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        mcpCallTool: async () => ({ ok: true }),
      },
    },
    configurable: true,
    writable: true,
  })
})

test('runToolCallLoop falls back to the limit message when even the final tool-free answer is empty', async () => {
  const continuationPayloads: ChatCompletionRequest[] = []
  const initialResponse: ChatCompletionResponse = {
    content: '',
    tool_calls: [makeToolCall('call-0')],
  }

  const result = await runToolCallLoop(
    initialResponse,
    async () => ({
      baseUrl: 'https://example.test',
      apiKey: 'test-key',
      model: 'test-model',
      messages: [],
    }),
    async (payload) => {
      continuationPayloads.push(payload)
      // Model never yields a text reply, even on the final tools-stripped call.
      return {
        content: '',
        tool_calls: [makeToolCall(`call-${continuationPayloads.length}`)],
      }
    },
  )

  // MAX rounds in the loop, plus one final tools-removed answer attempt.
  assert.equal(continuationPayloads.length, MAX_TOOL_CALL_ROUNDS + 1)
  assert.equal(continuationPayloads.at(-1)?.tools, undefined)
  assert.equal(result.tool_calls, undefined)
  assert.equal(result.finish_reason, 'tool_call_limit')
  assert.match(result.content, new RegExp(String(MAX_TOOL_CALL_ROUNDS)))
})

test('runToolCallLoop makes one final tool-free answer when the round limit is hit', async () => {
  const continuationPayloads: ChatCompletionRequest[] = []
  const finalText = '明天想看哪个城市的天气呀～'

  const result = await runToolCallLoop(
    { content: '', tool_calls: [makeToolCall('call-0')] },
    async () => ({
      baseUrl: 'https://example.test',
      apiKey: 'test-key',
      model: 'test-model',
      messages: [{ role: 'user', content: '帮我看看明天的天气' }],
      tools: [{
        type: 'function',
        function: { name: 'sample_tool', description: 'x', parameters: { type: 'object' } },
      }],
    }),
    async (payload) => {
      continuationPayloads.push(payload)
      // The final answer call appends a system directive and removes the tools.
      if (payload.messages.at(-1)?.role === 'system') {
        return { content: finalText }
      }
      return { content: '', tool_calls: [makeToolCall(`call-${continuationPayloads.length}`)] }
    },
  )

  assert.equal(continuationPayloads.length, MAX_TOOL_CALL_ROUNDS + 1)
  assert.equal(result.content, finalText)
  assert.equal(result.tool_calls, undefined)
  assert.equal(result.finish_reason, 'stop')
  const finalPayload = continuationPayloads.at(-1)
  assert.equal(finalPayload?.tools, undefined)
  assert.equal(finalPayload?.messages.at(-1)?.role, 'system')
})

test('runToolCallLoop bounds tool calls per round before executing them', async () => {
  const executedToolNames: string[] = []
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        mcpCallTool: async (payload: { name: string }) => {
          executedToolNames.push(payload.name)
          return { ok: true }
        },
      },
    },
    configurable: true,
    writable: true,
  })

  const initialResponse: ChatCompletionResponse = {
    content: 'Checking several things.',
    tool_calls: Array.from({ length: MAX_TOOL_CALLS_PER_ROUND + 3 }, (_, index) => (
      makeToolCall(`call-${index}`, JSON.stringify({ index }))
    )),
  }
  let continuationPayload: ChatCompletionRequest | undefined

  const result = await runToolCallLoop(
    initialResponse,
    async () => ({
      baseUrl: 'https://example.test',
      apiKey: 'test-key',
      model: 'test-model',
      messages: [],
    }),
    async (payload) => {
      continuationPayload = payload
      return { content: 'done' }
    },
  )

  assert.equal(result.content, 'done')
  assert.equal(executedToolNames.length, MAX_TOOL_CALLS_PER_ROUND)
  const assistantMessage = continuationPayload?.messages[0]
  assert.equal(assistantMessage?.role, 'assistant')
  assert.equal(assistantMessage?.tool_calls?.length, MAX_TOOL_CALLS_PER_ROUND)
  assert.match(String(assistantMessage?.content ?? ''), /skipped 3 excessive tool calls/)
  assert.equal(
    continuationPayload?.messages.filter((message) => message.role === 'tool').length,
    MAX_TOOL_CALLS_PER_ROUND,
  )
})

test('runToolCallLoop skips duplicate tool calls with the same normalized arguments', async () => {
  const executedToolArgs: unknown[] = []
  const continuationPayloads: ChatCompletionRequest[] = []
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        mcpCallTool: async (payload: { arguments: unknown }) => {
          executedToolArgs.push(payload.arguments)
          return { ok: true }
        },
      },
    },
    configurable: true,
    writable: true,
  })

  const result = await runToolCallLoop(
    {
      content: '',
      tool_calls: [makeToolCall('call-0', '{ "city": "上海", "unit": "c" }')],
    },
    async () => ({
      baseUrl: 'https://example.test',
      apiKey: 'test-key',
      model: 'test-model',
      messages: [],
    }),
    async (payload) => {
      continuationPayloads.push(payload)
      if (continuationPayloads.length === 1) {
        return {
          content: '',
          tool_calls: [makeToolCall('call-1', '{ "unit": "c", "city": "上海" }')],
        }
      }
      return { content: 'done' }
    },
  )

  assert.equal(result.content, 'done')
  assert.equal(executedToolArgs.length, 1)
  const secondRoundToolMessage = continuationPayloads[1]?.messages.find((message) => message.role === 'tool')
  assert.match(String(secondRoundToolMessage?.content ?? ''), /Duplicate tool call skipped/)
})

test('runToolCallLoop still executes repeated tool names when arguments differ', async () => {
  const executedToolArgs: unknown[] = []
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        mcpCallTool: async (payload: { arguments: unknown }) => {
          executedToolArgs.push(payload.arguments)
          return { ok: true }
        },
      },
    },
    configurable: true,
    writable: true,
  })

  let continuationCount = 0
  await runToolCallLoop(
    {
      content: '',
      tool_calls: [makeToolCall('call-0', '{ "city": "上海" }')],
    },
    async () => ({
      baseUrl: 'https://example.test',
      apiKey: 'test-key',
      model: 'test-model',
      messages: [],
    }),
    async () => {
      continuationCount += 1
      if (continuationCount === 1) {
        return {
          content: '',
          tool_calls: [makeToolCall('call-1', '{ "city": "北京" }')],
        }
      }
      return { content: 'done' }
    },
  )

  assert.equal(executedToolArgs.length, 2)
})
