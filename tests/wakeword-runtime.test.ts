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

test('isPermanentWakewordError flags only truly unrecoverable conditions', () => {
  // Permission-class errors require user action — no point retrying.
  assert.equal(isPermanentWakewordError('NotAllowedError: user denied'), true)
  assert.equal(isPermanentWakewordError('permission denied'), true)
  assert.equal(isPermanentWakewordError('当前环境不支持唤醒词检测'), true)
  // Device-not-found is transient on Bluetooth headsets (A2DP↔HFP profile
  // switch takes a second on startup) so the retry loop, not the give-up
  // path, is the right place for it.
  assert.equal(isPermanentWakewordError('Requested device not found'), false)
  assert.equal(isPermanentWakewordError('NotFoundError: audio device missing'), false)
  // Other transient network/timeout failures keep retrying too.
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
      throw new Error('NotAllowedError: permission denied')
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

test('runtime uses full wake-word list when starting listener', async () => {
  let startedWith = ''
  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    startListener: async (callbacks, options) => {
      startedWith = options?.wakeWord ?? ''
      return {
        stop: () => undefined,
        subscribeFrames: () => () => undefined,
      }
    },
  })

  await runtime.update({
    enabled: true,
    wakeWord: '小白, 小助手',
    suspended: false,
  })

  assert.equal(startedWith, '小白, 小助手')
  assert.equal(runtime.getState().wakeWord, '小白')
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

test('runtime keeps the wakeword listener alive while suspended and unmutes on resume', async () => {
  const detected: string[] = []
  const stops: string[] = []
  let callbacks: Parameters<NonNullable<Parameters<typeof createWakewordRuntime>[0]['startListener']>>[0] | null = null
  const listener = {
    stop: () => { stops.push('stop') },
    subscribeFrames: () => () => undefined,
  }

  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    startListener: async (nextCallbacks) => {
      callbacks = nextCallbacks
      return listener
    },
    onKeywordDetected: (keyword) => { detected.push(keyword) },
  })

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })
  assert.equal(runtime.getState().phase, 'listening')

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: true, suspendReason: 'voice turn' })
  assert.equal(runtime.getState().phase, 'paused')
  assert.equal(stops.length, 0)

  callbacks?.onKeywordDetected('小猫')
  assert.deepEqual(detected, [], 'stale wake hits must be swallowed while suspended')

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })
  assert.equal(runtime.getState().phase, 'listening')
  assert.equal(stops.length, 0)

  callbacks?.onKeywordDetected('小猫')
  assert.deepEqual(detected, ['小猫'])
  runtime.destroy()
  assert.deepEqual(stops, ['stop'])
})

test('runtime stop publishes a fully disabled snapshot and tears down the listener', async () => {
  const stops: string[] = []
  const states: Array<{ phase: string; enabled: boolean; wakeWord: string }> = []
  const listener = {
    stop: () => { stops.push('stop') },
    subscribeFrames: () => () => undefined,
  }

  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    startListener: async () => listener,
    onStateChange: (next) => {
      states.push({
        phase: next.phase,
        enabled: next.enabled,
        wakeWord: next.wakeWord,
      })
    },
  })

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })
  assert.equal(runtime.getState().phase, 'listening')

  runtime.stop()

  const snapshot = runtime.getState()
  assert.equal(snapshot.phase, 'disabled')
  assert.equal(snapshot.enabled, false)
  assert.equal(snapshot.wakeWord, '')
  assert.equal(snapshot.active, false)
  assert.equal(snapshot.available, false)
  assert.equal(snapshot.suspended, false)
  assert.equal(snapshot.retryCount, 0)
  assert.deepEqual(stops, ['stop'])
  assert.deepEqual(states.at(-1), {
    phase: 'disabled',
    enabled: false,
    wakeWord: '',
  })
  runtime.destroy()
})

test('runtime schedules retry when availability status check throws', async () => {
  const phases: string[] = []
  const timers: Array<{ callback: () => void; delayMs: number }> = []

  const runtime = createWakewordRuntime({
    checkAvailability: async () => {
      throw new Error('status bridge failed')
    },
    onStateChange: (next) => { phases.push(next.phase) },
    setTimeoutFn: (callback, delayMs) => {
      timers.push({ callback, delayMs })
      return timers.length
    },
    clearTimeoutFn: () => undefined,
    retryBaseMs: 250,
    retryMaxMs: 1_000,
  })

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })

  assert.equal(timers.length, 1)
  assert.equal(timers[0].delayMs, 250)
  assert.equal(runtime.getState().phase, 'error')
  assert.equal(runtime.getState().retryCount, 1)
  assert.match(runtime.getState().error, /status bridge failed/)
  assert.ok(phases.includes('checking'))
  runtime.destroy()
})

// Harness for the frame-subscription tests: each startListener call returns
// a fake listener whose frame taps can be pumped manually, so a test can
// simulate "listener dies mid-VAD-session, retry loop rebuilds it".
function createControllableListenerHarness() {
  type FrameTap = (samples: Float32Array, sampleRate: number) => void
  const listeners: Array<{ taps: Set<FrameTap>; stopped: boolean }> = []
  let listenerCallbacks: { onError?: (message: string) => void } | null = null

  const startListener = async (callbacks: { onError?: (message: string) => void }) => {
    listenerCallbacks = callbacks
    const entry = { taps: new Set<FrameTap>(), stopped: false }
    listeners.push(entry)
    return {
      stop: () => { entry.stopped = true },
      subscribeFrames: (subscriber: FrameTap) => {
        entry.taps.add(subscriber)
        return () => { entry.taps.delete(subscriber) }
      },
    }
  }

  const pump = (listenerIndex: number, frameLength: number) => {
    const samples = new Float32Array(frameLength)
    for (const tap of listeners[listenerIndex].taps) {
      tap(samples, 16_000)
    }
  }

  return {
    listeners,
    startListener,
    pump,
    fireListenerError: (message: string) => listenerCallbacks?.onError?.(message),
  }
}

test('mic frame subscribers survive a mid-session listener error and are re-attached to the rebuilt listener', async () => {
  const harness = createControllableListenerHarness()
  const timers: Array<{ callback: () => void; delayMs: number }> = []

  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    startListener: harness.startListener,
    setTimeoutFn: (callback, delayMs) => {
      timers.push({ callback, delayMs })
      return timers.length
    },
    clearTimeoutFn: () => undefined,
  })

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })
  assert.equal(runtime.getState().phase, 'listening')
  assert.equal(harness.listeners.length, 1)

  const received: number[] = []
  const unsubscribe = runtime.subscribeMicFrames((samples) => {
    received.push(samples.length)
  })

  harness.pump(0, 3)
  assert.deepEqual(received, [3])

  // The wakeword listener dies mid-VAD-session (mic track ended, KWS feed
  // failure, ...): the runtime tears it down and schedules a retry.
  harness.fireListenerError('Microphone track ended unexpectedly — triggering recovery.')
  assert.equal(runtime.getState().phase, 'error')
  assert.equal(harness.listeners[0].stopped, true)
  assert.equal(timers.length, 1)

  // Retry timer fires → reconcile builds a fresh listener.
  timers[0].callback()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(harness.listeners.length, 2)
  assert.equal(runtime.getState().phase, 'listening')
  // The live subscriber must be migrated onto the rebuilt listener. Before
  // the fix nothing re-subscribed, so mainVAD starved from here on and the
  // 3s noSpeechTimer silently dropped the voice turn.
  assert.equal(harness.listeners[1].taps.size, 1)

  harness.pump(1, 5)
  assert.deepEqual(received, [3, 5])

  unsubscribe()
  assert.equal(harness.listeners[1].taps.size, 0)
  runtime.destroy()
})

test('frames subscribed during a paused window with no live listener flow once the listener is rebuilt', async () => {
  const harness = createControllableListenerHarness()

  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    startListener: harness.startListener,
  })

  // VAD session starts while the runtime is paused *without* a listener
  // (e.g. the listener errored out before the voice turn began, so the
  // suspend path had nothing to keep alive).
  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: true, suspendReason: 'voice turn' })
  assert.equal(runtime.getState().phase, 'paused')
  assert.equal(harness.listeners.length, 0)
  assert.equal(runtime.hasActiveFrameSource(), false)

  const received: number[] = []
  runtime.subscribeMicFrames((samples) => {
    received.push(samples.length)
  })

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })
  assert.equal(runtime.getState().phase, 'listening')
  assert.equal(runtime.hasActiveFrameSource(), true)
  assert.equal(harness.listeners.length, 1)

  harness.pump(0, 4)
  assert.deepEqual(received, [4])
  runtime.destroy()
})

test('hasActiveFrameSource stays true while paused with a kept-alive listener', async () => {
  const harness = createControllableListenerHarness()

  const runtime = createWakewordRuntime({
    checkAvailability: async () => ({
      installed: true,
      modelFound: true,
      modelKind: 'zh',
      modelsDir: '',
      reason: '',
    }),
    startListener: harness.startListener,
  })

  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: false })
  assert.equal(runtime.getState().phase, 'listening')
  assert.equal(runtime.hasActiveFrameSource(), true)

  // Suspend keeps the listener alive (mic stream stays up, KWS hits are
  // muted) — the shared-frame path VAD relies on during continuous voice
  // restarts must keep reporting a live source and delivering frames.
  await runtime.update({ enabled: true, wakeWord: '小猫', suspended: true, suspendReason: 'voice turn' })
  assert.equal(runtime.getState().phase, 'paused')
  assert.equal(harness.listeners.length, 1)
  assert.equal(runtime.hasActiveFrameSource(), true)

  const received: number[] = []
  runtime.subscribeMicFrames((samples) => {
    received.push(samples.length)
  })
  harness.pump(0, 2)
  assert.deepEqual(received, [2])
  runtime.destroy()
})
