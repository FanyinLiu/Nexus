import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  buildFailoverKey,
  isFailoverCoolingDown,
  isFailoverEligibleError,
  recordFailoverFailure,
  recordFailoverSuccess,
  clearFailoverCooldown,
} from '../src/features/failover/runtime.ts'
import { executeWithFailover } from '../src/features/failover/orchestrator.ts'
import type { FailoverEvent } from '../src/features/failover/orchestrator.ts'
import {
  buildChatFailoverCandidates,
  executeChatRequestWithFailover,
} from '../src/features/chat/failoverChain.ts'
import { getCoreRuntime } from '../src/lib/coreRuntime.ts'
import { loadSettings } from '../src/lib/storage.ts'
import { AUTH_PROFILES_STORAGE_KEY } from '../src/lib/storage/core.ts'
import type { AppSettings } from '../src/types/app.ts'
import type { ChatCompletionRequest, ChatMessage } from '../src/types/chat.ts'
import type { MemoryRecallContext } from '../src/types/memory.ts'

// Mock localStorage for runtime.ts
beforeEach(() => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    },
    configurable: true,
    writable: true,
  })
  getCoreRuntime().authStore.restore({ profiles: [] })
})

function makeChatSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...loadSettings(),
    apiProviderId: 'deepseek',
    apiBaseUrl: 'https://api.deepseek.com',
    apiKey: 'primary-key',
    model: 'deepseek-v4-flash',
    chatFailoverEnabled: false,
    ...overrides,
  }
}

// ── chat failover candidate construction ──

test('chat failover does not append an empty-key default candidate when auth profiles exist', () => {
  const runtime = getCoreRuntime()
  runtime.authStore.register({
    id: 'deepseek-a',
    providerId: 'deepseek',
    apiKey: 'profile-key',
  })

  const candidates = buildChatFailoverCandidates(makeChatSettings({ apiKey: '' }))

  assert.deepEqual(candidates.map((candidate) => candidate.id), ['deepseek#deepseek-a'])
  assert.deepEqual(
    candidates.map((candidate) => candidate.payload.settings.apiKey),
    ['profile-key'],
  )
})

test('chat failover keeps a non-empty default key and deduplicates profile keys', () => {
  const runtime = getCoreRuntime()
  runtime.authStore.register({
    id: 'deepseek-a',
    providerId: 'deepseek',
    apiKey: 'same-key',
  })
  runtime.authStore.register({
    id: 'deepseek-b',
    providerId: 'deepseek',
    apiKey: 'same-key',
  })

  const candidates = buildChatFailoverCandidates(makeChatSettings({ apiKey: '  primary-key  ' }))

  assert.deepEqual(candidates.map((candidate) => candidate.id), [
    'deepseek#deepseek-a',
    'deepseek',
  ])
  assert.deepEqual(
    candidates.map((candidate) => candidate.payload.settings.apiKey),
    ['same-key', 'primary-key'],
  )
})

test('chat failover excludes auth profiles that are in cooldown', () => {
  const runtime = getCoreRuntime()
  runtime.authStore.register({
    id: 'cooling',
    providerId: 'deepseek',
    apiKey: 'cooldown-key',
  })
  runtime.authStore.setStatus('cooling', 'cooldown')

  const candidates = buildChatFailoverCandidates(makeChatSettings({ apiKey: 'primary-key' }))

  assert.deepEqual(candidates.map((candidate) => candidate.id), ['deepseek'])
  assert.deepEqual(
    candidates.map((candidate) => candidate.payload.settings.apiKey),
    ['primary-key'],
  )
})

test('chat failover keeps empty-key default candidates for keyless providers', () => {
  const candidates = buildChatFailoverCandidates(makeChatSettings({
    apiProviderId: 'ollama',
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: 'qwen3:8b',
  }))

  assert.deepEqual(candidates.map((candidate) => candidate.id), ['ollama'])
  assert.equal(candidates[0]?.payload.settings.apiKey, '')
})

test('chat failover returns the request payload built for the winning candidate', async () => {
  Object.assign(globalThis.window, {
    desktopPet: {
      completeChat: async () => ({ content: '' }),
      personaLoadSoul: async () => '',
      personaLoadMemory: async () => '',
    },
  })

  const history: ChatMessage[] = [{
    id: 'user-1',
    role: 'user',
    content: 'hello nexus',
    createdAt: '2026-06-04T12:00:00.000Z',
  }]
  const memoryContext: MemoryRecallContext = {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed: 'keyword',
    vectorSearchAvailable: false,
  }
  let executedPayload: ChatCompletionRequest | undefined

  const result = await executeChatRequestWithFailover(
    makeChatSettings({ chatFailoverEnabled: false }),
    history,
    memoryContext,
    {},
    async (payload) => {
      executedPayload = payload
      return { content: 'ok' }
    },
  )

  assert.equal(result.providerId, 'deepseek')
  assert.equal(result.response.content, 'ok')
  assert.equal(result.requestPayload, executedPayload)
  assert.equal(executedPayload?.providerId, 'deepseek')
  assert.equal(executedPayload?.messages.at(-1)?.role, 'user')
  assert.match(String(executedPayload?.messages.at(-1)?.content), /hello nexus/)
})

test('chat failover runs through the injected executor without requiring completeChat bridge', async () => {
  Object.assign(globalThis.window, {
    desktopPet: {
      completeChatStream: async () => ({ content: 'stream-ok' }),
    },
  })

  const history: ChatMessage[] = [{
    id: 'user-1',
    role: 'user',
    content: 'hello streaming nexus',
    createdAt: '2026-06-04T12:00:00.000Z',
  }]
  const memoryContext: MemoryRecallContext = {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed: 'keyword',
    vectorSearchAvailable: false,
  }

  const result = await executeChatRequestWithFailover(
    makeChatSettings({ chatFailoverEnabled: false }),
    history,
    memoryContext,
    {},
    async () => ({ content: 'ok' }),
  )

  assert.equal(result.response.content, 'ok')
  assert.equal(result.providerId, 'deepseek')
  assert.equal(result.usedFallback, false)
})

test('chat failover persists auth profile success state after a profile candidate wins', async () => {
  const runtime = getCoreRuntime()
  runtime.authStore.register({
    id: 'deepseek-profile',
    providerId: 'deepseek',
    apiKey: 'profile-key',
  })
  Object.assign(globalThis.window, {
    desktopPet: {
      personaLoadSoul: async () => '',
      personaLoadMemory: async () => '',
    },
  })

  await executeChatRequestWithFailover(
    makeChatSettings({ apiKey: '' }),
    [{
      id: 'user-1',
      role: 'user',
      content: 'hello persisted profile',
      createdAt: '2026-06-04T12:00:00.000Z',
    }],
    {
      longTerm: [],
      daily: [],
      semantic: [],
      searchModeUsed: 'keyword',
      vectorSearchAvailable: false,
    },
    {},
    async () => ({ content: 'ok' }),
  )

  const persisted = JSON.parse(window.localStorage.getItem(AUTH_PROFILES_STORAGE_KEY) ?? '{}')
  assert.equal(persisted.profiles?.[0]?.id, 'deepseek-profile')
  assert.equal(persisted.profiles?.[0]?.successCount, 1)
  assert.equal(persisted.profiles?.[0]?.status, 'active')
})

// ── buildFailoverKey ──

test('builds key with domain and provider', () => {
  assert.equal(buildFailoverKey('chat', 'openai'), 'chat:openai')
})

test('builds key with identity', () => {
  assert.equal(
    buildFailoverKey('speech-input', 'whisper', 'https://api.example.com'),
    'speech-input:whisper:https://api.example.com',
  )
})

test('normalizes key parts to lowercase', () => {
  assert.equal(buildFailoverKey('chat', 'OpenAI'), 'chat:openai')
})

// ── isFailoverEligibleError ──

test('network errors are eligible for failover', () => {
  assert.ok(isFailoverEligibleError(new Error('fetch failed')))
  assert.ok(isFailoverEligibleError(new Error('ECONNREFUSED')))
  assert.ok(isFailoverEligibleError(new Error('timeout')))
})

test('configuration errors are not eligible for failover', () => {
  assert.ok(!isFailoverEligibleError(new Error('请先填写API Key')))
  assert.ok(!isFailoverEligibleError(new Error('未连接桌面客户端')))
  assert.ok(!isFailoverEligibleError(new Error('关键词不能为空')))
})

test('empty error message is eligible', () => {
  assert.ok(isFailoverEligibleError(new Error('')))
})

test('non-Error values are handled', () => {
  assert.ok(isFailoverEligibleError('some string error'))
  assert.ok(isFailoverEligibleError(null))
  assert.ok(isFailoverEligibleError(undefined))
})

test('aborted requests are not eligible for failover', () => {
  assert.ok(!isFailoverEligibleError(new Error('This operation was aborted')))
  assert.ok(!isFailoverEligibleError(new Error('模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：This operation was aborted')))
})

// ── recordFailoverFailure / isFailoverCoolingDown ──

test('records failure and enters cooldown', () => {
  const key = 'chat:test-provider'
  assert.ok(!isFailoverCoolingDown(key))
  recordFailoverFailure(key, 'connection refused')
  assert.ok(isFailoverCoolingDown(key))
})

test('cooldown expires after the backoff window', () => {
  const key = 'chat:test-provider'
  recordFailoverFailure(key, 'timeout')
  // First failure: 60s cooldown. Check with a timestamp far in the future.
  const futureMs = Date.now() + 120_000
  assert.ok(!isFailoverCoolingDown(key, futureMs))
})

test('successive failures increase cooldown duration', () => {
  const key = 'chat:escalating'
  recordFailoverFailure(key, 'err1')
  recordFailoverFailure(key, 'err2')

  // After 2 failures: 5min cooldown. Still cooling down at 2min mark.
  const twoMinutesLater = Date.now() + 2 * 60_000
  assert.ok(isFailoverCoolingDown(key, twoMinutesLater))

  // But not at 6min mark.
  const sixMinutesLater = Date.now() + 6 * 60_000
  assert.ok(!isFailoverCoolingDown(key, sixMinutesLater))
})

// ── recordFailoverSuccess ──

test('success resets error count and clears cooldown', () => {
  const key = 'chat:reset-test'
  recordFailoverFailure(key, 'err')
  assert.ok(isFailoverCoolingDown(key))
  recordFailoverSuccess(key)
  assert.ok(!isFailoverCoolingDown(key))
})

// ── clearFailoverCooldown ──

test('clears cooldown for a specific key', () => {
  const key = 'chat:clear-test'
  recordFailoverFailure(key, 'err')
  assert.ok(isFailoverCoolingDown(key))
  clearFailoverCooldown(key)
  assert.ok(!isFailoverCoolingDown(key))
})

// ── executeWithFailover ──

test('returns result from primary on success', async () => {
  const result = await executeWithFailover({
    domain: 'chat',
    candidates: [
      { id: 'primary', identity: 'p', payload: 'data' },
    ],
    execute: async () => 'ok',
    failoverEnabled: false,
  })

  assert.equal(result.result, 'ok')
  assert.equal(result.candidateId, 'primary')
  assert.equal(result.usedFallback, false)
})

test('falls back to secondary when primary fails and failover is enabled', async () => {
  const events: FailoverEvent[] = []

  const result = await executeWithFailover({
    domain: 'chat',
    candidates: [
      { id: 'primary', identity: 'p', payload: 'data' },
      { id: 'fallback', identity: 'f', payload: 'data2' },
    ],
    execute: async (candidate) => {
      if (candidate.id === 'primary') throw new Error('primary down')
      return 'fallback-ok'
    },
    failoverEnabled: true,
    onEvent: (event) => events.push(event),
  })

  assert.equal(result.result, 'fallback-ok')
  assert.equal(result.candidateId, 'fallback')
  assert.equal(result.usedFallback, true)
  assert.ok(events.some((e) => e.type === 'failure'))
  assert.ok(events.some((e) => e.type === 'success'))
})

test('throws immediately when failover is disabled', async () => {
  await assert.rejects(
    executeWithFailover({
      domain: 'chat',
      candidates: [
        { id: 'primary', identity: 'p', payload: 'data' },
        { id: 'fallback', identity: 'f', payload: 'data2' },
      ],
      execute: async () => { throw new Error('primary down') },
      failoverEnabled: false,
    }),
    { message: 'primary down' },
  )
})

test('throws when all candidates fail', async () => {
  await assert.rejects(
    executeWithFailover({
      domain: 'chat',
      candidates: [
        { id: 'a', identity: 'a', payload: null },
        { id: 'b', identity: 'b', payload: null },
      ],
      execute: async (c) => { throw new Error(`${c.id} failed`) },
      failoverEnabled: true,
    }),
    (err: Error) => {
      assert.ok(err.message.includes('a failed'))
      assert.ok(err.message.includes('b failed'))
      return true
    },
  )
})

test('skips candidates in cooldown', async () => {
  // Put fallback into cooldown
  const fallbackKey = buildFailoverKey('chat', 'fallback', 'f')
  recordFailoverFailure(fallbackKey, 'previous error')

  const attempted: string[] = []

  await assert.rejects(
    executeWithFailover({
      domain: 'chat',
      candidates: [
        { id: 'primary', identity: 'p', payload: null },
        { id: 'fallback', identity: 'f', payload: null },
      ],
      execute: async (c) => {
        attempted.push(c.id)
        throw new Error(`${c.id} failed`)
      },
      failoverEnabled: true,
    }),
  )

  assert.ok(attempted.includes('primary'))
  assert.ok(!attempted.includes('fallback'), 'fallback should be skipped due to cooldown')
})

test('non-eligible errors do not trigger failover', async () => {
  await assert.rejects(
    executeWithFailover({
      domain: 'chat',
      candidates: [
        { id: 'primary', identity: 'p', payload: null },
        { id: 'fallback', identity: 'f', payload: null },
      ],
      execute: async () => { throw new Error('请先填写API Key') },
      failoverEnabled: true,
    }),
    { message: '请先填写API Key' },
  )
})

test('aborted requests do not trigger fallback providers', async () => {
  const attempted: string[] = []

  await assert.rejects(
    executeWithFailover({
      domain: 'chat',
      candidates: [
        { id: 'primary', identity: 'p', payload: null },
        { id: 'fallback', identity: 'f', payload: null },
      ],
      execute: async (candidate) => {
        attempted.push(candidate.id)
        throw new Error('模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：This operation was aborted')
      },
      failoverEnabled: true,
    }),
    { message: '模型接口连接失败，请检查 API Base URL、网络或代理设置。原始错误：This operation was aborted' },
  )

  assert.deepEqual(attempted, ['primary'])
})
