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
