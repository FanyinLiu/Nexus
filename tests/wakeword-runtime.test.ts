import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createInitialWakewordRuntimeState,
  createWakewordRuntime,
  getWakewordRetryDelayMs,
  isPermanentWakewordError,
  shouldIgnoreWakewordTrigger,
} from '../src/features/hearing/wakewordRuntime.ts'

test('wakeword runtime starts from a disabled idle snapshot', () => {
  const state = createInitialWakewordRuntimeState()

  assert.equal(state.phase, 'disabled')
  assert.equal(state.enabled, false)
  assert.equal(state.active, false)
  assert.equal(state.retryCount, 0)
  assert.equal(state.wakeWord, '')
})

test('wakeword retry delay grows exponentially and caps at the configured max', () => {
  assert.equal(getWakewordRetryDelayMs(0, 500, 4_000), 500)
  assert.equal(getWakewordRetryDelayMs(1, 500, 4_000), 1_000)
  assert.equal(getWakewordRetryDelayMs(2, 500, 4_000), 2_000)
  assert.equal(getWakewordRetryDelayMs(5, 500, 4_000), 4_000)
})

test('wakeword trigger dedupe ignores hits that arrive inside the cooldown window', () => {
  assert.equal(shouldIgnoreWakewordTrigger({
    lastTriggeredAtMs: 1_000,
    nowMs: 1_600,
    cooldownMs: 800,
  }), true)

  assert.equal(shouldIgnoreWakewordTrigger({
    lastTriggeredAtMs: 1_000,
    nowMs: 1_900,
    cooldownMs: 800,
  }), false)
})

test('isPermanentWakewordError flags getUserMedia-style terminal failures', () => {
  assert.equal(isPermanentWakewordError('Requested device not found'), true)
  assert.equal(isPermanentWakewordError('NotFoundError: audio device missing'), true)
  assert.equal(isPermanentWakewordError('NotAllowedError: user denied'), true)
  assert.equal(isPermanentWakewordError('permission denied'), true)
  assert.equal(isPermanentWakewordError('当前环境不支持唤醒词检测'), true)
  // Transient failures keep retrying
  assert.equal(isPermanentWakewordError('fetch failed'), false)
  assert.equal(isPermanentWakewordError('timeout'), false)
  assert.equal(isPermanentWakewordError(''), false)
})

test('runtime gives up into unavailable phase when startListener fails repeatedly', async () => {
  const states: { phase: string; retryCount: number; error: string }[] = []
  const timers: Array<{ callback: () => void; delayMs: number }> = []

  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    startListener: async () => {
      throw new Error('Requested device not found')
    },
    onStateChange: (next) => {
      states.push({
        phase: next.phase,
        retryCount: next.retryCount,
        error: next.error,
      })
    },
    setTimeoutFn: (cb, delayMs) => {
      timers.push({ callback: cb, delayMs })
      return timers.length
    },
    clearTimeoutFn: () => undefined,
  })

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })

  // Permanent-error path: should skip the retry schedule entirely and
  // land directly in `unavailable` on the first failure.
  const final = states.at(-1)
  assert.ok(final, 'expected at least one state emit')
  assert.equal(final.phase, 'unavailable')
  assert.equal(
    timers.length,
    0,
    'no retry timer should be scheduled for a permanent error',
  )
  runtime.destroy()
})

test('runtime short-circuits to unavailable when retryMaxAttempts is exhausted', async () => {
  // retryMaxAttempts=0 means "state.retryCount (0) >= cap (0)" on the very
  // first failure, which exercises the give-up branch without us having to
  // drive the fake timer through multiple async reconcile cycles.
  const states: string[] = []
  const timers: Array<() => void> = []

  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    startListener: async () => {
      throw new Error('transient network hiccup')
    },
    onStateChange: (next) => { states.push(next.phase) },
    setTimeoutFn: (cb) => { timers.push(cb); return timers.length },
    clearTimeoutFn: () => undefined,
    retryMaxAttempts: 0,
  })

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })

  assert.equal(states.at(-1), 'unavailable')
  assert.equal(
    timers.length,
    0,
    'no retry should be scheduled once the attempts cap is hit',
  )
  runtime.destroy()
})
