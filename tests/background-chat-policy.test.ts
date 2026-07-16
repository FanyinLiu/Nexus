import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  acquireBackgroundChatLease,
  classifyBackgroundChatFailure,
  getBackgroundChatGate,
  isBackgroundChatLeaseAvailable,
  recordBackgroundChatFailure,
  recordBackgroundChatSuccess,
  releaseBackgroundChatLease,
  resetBackgroundChatPolicyForTests,
} from '../src/features/autonomy/backgroundChatPolicy.ts'
import { getChatConnectionTestPreflightFailure } from '../electron/chatRuntime.js'

const miniMax = {
  providerId: 'minimax',
  baseUrl: 'https://api.minimaxi.com/v1',
  model: 'MiniMax-M1',
}

function input(apiKey: string, overrides: Partial<typeof miniMax> = {}) {
  return { ...miniMax, ...overrides, apiKey }
}

test('missing MiniMax key is blocked before any executor can run', () => {
  resetBackgroundChatPolicyForTests()
  let executorCalls = 0
  let completeChatCalls = 0

  const gate = getBackgroundChatGate(input(''), 0)
  if (gate.allowed) {
    executorCalls += 1
    completeChatCalls += 1
  }

  assert.equal(gate.reason, 'missing_api_key')
  assert.equal(gate.shouldNotify, true)
  assert.equal(executorCalls, 0)
  assert.equal(completeChatCalls, 0)
  assert.equal(getBackgroundChatGate(input(''), 1).shouldNotify, false)
  assert.doesNotMatch(JSON.stringify(gate), /test-key|apiKey/i)
})

test('auth failure remains blocked across A→B→A identity changes', () => {
  resetBackgroundChatPolicyForTests()
  const identityA = input('key-a')
  const identityB = input('key-b', { model: 'MiniMax-M2' })

  assert.equal(getBackgroundChatGate(identityA, 0).allowed, true)
  recordBackgroundChatFailure(identityA, 'auth', 0)
  assert.equal(getBackgroundChatGate(identityA, 30_000).reason, 'auth_blocked')

  assert.equal(getBackgroundChatGate(identityB, 30_000).allowed, true)
  const blockedAgain = getBackgroundChatGate(identityA, 30_000)
  assert.equal(blockedAgain.reason, 'auth_blocked')
  assert.doesNotMatch(JSON.stringify(blockedAgain), /key-a/)
})

test('identity buckets have a bounded in-memory footprint', () => {
  resetBackgroundChatPolicyForTests()
  const identityA = input('key-a')
  recordBackgroundChatFailure(identityA, 'auth', 0)

  for (let index = 0; index < 16; index += 1) {
    assert.equal(
      getBackgroundChatGate(input(`key-${index}`, { model: `MiniMax-${index}` }), 0).allowed,
      true,
    )
  }

  // The oldest bucket is evicted at the fixed cap; a new A bucket is ready,
  // while ordinary identity changes still never persist or expose its key.
  assert.equal(getBackgroundChatGate(identityA, 0).allowed, true)
})

test('current Chinese 401 safe message is classified as auth', () => {
  assert.equal(
    classifyBackgroundChatFailure(new Error('API Key 好像不太对，去设置里看看？')),
    'auth',
  )
  assert.equal(
    classifyBackgroundChatFailure(new Error('接口密钥不太对。去「设置 → 模型」检查一下。')),
    'auth',
  )
})

test('safe preflight codes/status and missing-key fallbacks are auth', () => {
  const authErrors = [
    Object.assign(new Error('safe'), { code: 'auth_failed', status: 401 }),
    Object.assign(new Error('safe'), { code: 'missing_api_key', status: 'needs_key' }),
    Object.assign(new Error('safe'), { code: 'api_key_header_unsafe', status: 'needs_key' }),
    Object.assign(new Error('还没填 API Key 呢，先去设置里填一个吧。'), { status: 'needs_key' }),
    new Error('Missing API key; open settings to configure it.'),
  ]
  for (const error of authErrors) {
    assert.equal(classifyBackgroundChatFailure(error), 'auth')
  }

  assert.equal(classifyBackgroundChatFailure(new Error('request timed out')), 'transient')
  assert.equal(classifyBackgroundChatFailure(new Error('network connection reset')), 'transient')
})

test('real minimax preflight missing-key message stays auth through Electron prefixes', () => {
  const preflight = getChatConnectionTestPreflightFailure({
    providerId: 'minimax-coding',
    apiKey: '',
  })
  const message = preflight?.message
  assert.equal(typeof message, 'string')
  assert.match(message ?? '', /先填一下 API Key/)
  assert.equal(classifyBackgroundChatFailure(new Error(message ?? '')), 'auth')
  assert.equal(
    classifyBackgroundChatFailure(new Error(`Error invoking remote method 'chat:complete': ${message}`)),
    'auth',
  )
  assert.equal(classifyBackgroundChatFailure(new Error('request timeout')), 'transient')
  assert.equal(classifyBackgroundChatFailure(new Error('network unreachable')), 'transient')
})

test('transient failures use 1m, 5m, 25m, and 60m backoff boundaries', () => {
  resetBackgroundChatPolicyForTests()
  const config = input('key')
  const failureTimes = [0, 60_000, 360_000, 1_860_000]
  const delays = [60_000, 300_000, 1_500_000, 3_600_000]

  for (const [index, failedAt] of failureTimes.entries()) {
    recordBackgroundChatFailure(config, 'transient', failedAt)
    const blocked = getBackgroundChatGate(config, failedAt + delays[index] - 1)
    assert.equal(blocked.reason, 'transient_cooldown')
    assert.equal(blocked.retryAt, failedAt + delays[index])
    assert.equal(getBackgroundChatGate(config, failedAt + delays[index]).allowed, true)
  }
})

test('success clears transient cooldown and restarts at the first backoff', () => {
  resetBackgroundChatPolicyForTests()
  const config = input('key')
  recordBackgroundChatFailure(config, 'transient', 0)
  assert.equal(getBackgroundChatGate(config, 1).reason, 'transient_cooldown')

  recordBackgroundChatSuccess(config)
  assert.equal(getBackgroundChatGate(config, 1).allowed, true)
  recordBackgroundChatFailure(config, 'transient', 1)
  assert.equal(getBackgroundChatGate(config, 60_000).reason, 'transient_cooldown')
  assert.equal(getBackgroundChatGate(config, 60_001).allowed, true)
})

test('background chat lease is exclusive and cannot be released by another owner', () => {
  resetBackgroundChatPolicyForTests()
  assert.equal(isBackgroundChatLeaseAvailable(), true)
  const owner = acquireBackgroundChatLease()
  assert.ok(owner)
  assert.equal(isBackgroundChatLeaseAvailable(), false)
  assert.equal(acquireBackgroundChatLease(), null)
  assert.equal(releaseBackgroundChatLease(Symbol('not-owner')), false)
  assert.equal(isBackgroundChatLeaseAvailable(), false)

  try {
    throw new Error('exercise finally release')
  } catch {
    // The production callers release from finally; this mirrors that path.
  } finally {
    assert.equal(releaseBackgroundChatLease(owner), true)
  }

  assert.equal(isBackgroundChatLeaseAvailable(), true)
  assert.equal(releaseBackgroundChatLease(owner), false)
})
