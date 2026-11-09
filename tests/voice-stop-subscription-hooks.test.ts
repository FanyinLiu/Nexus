import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import { useSpeechPlaybackStopSubscription } from '../src/hooks/useSpeechPlaybackStopSubscription.ts'
import {
  useCompanionNoticeIdleFlush,
  useCompanionNoticeStopSubscription,
} from '../src/hooks/chat/useCompanionNoticeQueueSubscriptions.ts'
import { VoiceBus } from '../src/features/voice/bus.ts'
import { emitSpeechStopAll } from '../src/features/voice/speechStopBus.ts'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type Slot = { current: unknown }

function fakeTimers() {
  let nextId = 1
  let now = 0
  const timers = new Map<number, { callback: () => void; at: number }>()
  return {
    setTimeoutFn: (callback: () => void, delayMs: number) => {
      const id = nextId++
      timers.set(id, { callback, at: now + delayMs })
      return id
    },
    clearTimeoutFn: (id: number) => { timers.delete(id) },
    advance: (ms: number) => {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue
        timers.delete(id)
        timer.callback()
      }
    },
    pending: () => timers.size,
  }
}

/** Minimal dispatcher: the hooks under test use only refs, callbacks, effects. */
function renderHook<T>(hook: () => T) {
  const slots: unknown[] = []
  const cleanups: Array<() => void> = []
  let cursor = 0
  const dispatcher = {
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index] as Slot
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { fn, deps }
      return (slots[index] as { fn: unknown }).fn
    },
    useEffect(effect: () => void | (() => void)) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }

  function Probe() {
    return hook()
  }

  reactInternals.H = dispatcher
  try {
    const result = Probe()
    return {
      result,
      unmount: () => {
        for (const cleanup of cleanups.splice(0)) cleanup()
      },
    }
  } finally {
    reactInternals.H = null
  }
}

test('the playback-stop hook subscribes and runs the local stop once', () => {
  let listener: (() => void) | null = null
  let unsubscribed = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      desktopPet: {
        subscribeSpeechPlaybackStop: (next: () => void) => {
          listener = next
          return () => { unsubscribed += 1 }
        },
      },
    },
  })

  let stops = 0
  const session = renderHook(() => useSpeechPlaybackStopSubscription(() => { stops += 1 }))
  assert.equal(typeof listener, 'function')

  listener!()
  assert.equal(stops, 1)
  session.unmount()
  assert.equal(unsubscribed, 1)
})

test('the chat stop subscription clears the deferred queue', () => {
  let cleared = 0
  const session = renderHook(() => useCompanionNoticeStopSubscription(() => {
    cleared += 1
    return 1
  }))

  emitSpeechStopAll()
  assert.equal(cleared, 1)
  session.unmount()
  emitSpeechStopAll()
  assert.equal(cleared, 1, 'unsubscribed hook stops clearing')
})

test('idle flush resumes on a completed reply but never on an interrupt', async () => {
  const bus = new VoiceBus()
  const timers = fakeTimers()
  let flushes = 0
  const session = renderHook(() => useCompanionNoticeIdleFlush(
    bus,
    async () => { flushes += 1 },
    timers,
  ))

  bus.emit({ type: 'tts:started', text: 'reply', speechGeneration: 1 })
  bus.emit({ type: 'tts:interrupted', speechGeneration: 1 })
  await Promise.resolve()
  assert.equal(flushes, 0, 'an interrupted turn must not resume the queue')

  bus.emit({ type: 'tts:started', text: 'reply', speechGeneration: 2 })
  bus.emit({ type: 'tts:completed', speechGeneration: 2, shouldResumeContinuousVoice: false })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(flushes, 1, 'a completed reply resumes the queue')

  session.unmount()
  bus.emit({ type: 'tts:started', text: 'reply', speechGeneration: 3 })
  bus.emit({ type: 'tts:completed', speechGeneration: 3, shouldResumeContinuousVoice: false })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(flushes, 1, 'unmounted hook no longer flushes')
})

test('a speech error releases the deferred queue', async () => {
  const bus = new VoiceBus()
  const timers = fakeTimers()
  let flushes = 0
  const session = renderHook(() => useCompanionNoticeIdleFlush(
    bus,
    async () => { flushes += 1 },
    timers,
  ))

  bus.emit({ type: 'tts:started', text: 'reply', speechGeneration: 1 })
  bus.emit({
    type: 'tts:error',
    message: 'provider failed',
    speechGeneration: 1,
    shouldResumeContinuousVoice: false,
  })
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(flushes, 1)
  session.unmount()
})

test('ending the listening session releases the deferred queue', async () => {
  const bus = new VoiceBus()
  const timers = fakeTimers()
  let flushes = 0
  const session = renderHook(() => useCompanionNoticeIdleFlush(
    bus,
    async () => { flushes += 1 },
    timers,
  ))

  bus.emit({ type: 'tts:started', text: 'reply', speechGeneration: 1 })
  bus.emit({ type: 'tts:interrupted', speechGeneration: 1 })
  bus.emit({ type: 'session:aborted', abortReason: 'user' })
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(flushes, 1)
  session.unmount()
})

test('the idle fallback releases the queue when no voice event arrives', async () => {
  const bus = new VoiceBus()
  const timers = fakeTimers()
  let flushes = 0
  const session = renderHook(() => useCompanionNoticeIdleFlush(
    bus,
    async () => { flushes += 1 },
    timers,
  ))

  bus.emit({ type: 'tts:started', text: 'reply', speechGeneration: 1 })
  assert.equal(flushes, 0)
  timers.advance(15_000)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(flushes, 1)
  session.unmount()
})

for (const phase of ['speaking', 'listening'] as const) {
  test(`the pet voice button during ${phase} waits for the 15 s fallback`, async () => {
    const bus = new VoiceBus()
    const timers = fakeTimers()
    let flushes = 0
    const session = renderHook(() => useCompanionNoticeIdleFlush(
      bus,
      async () => { flushes += 1 },
      timers,
    ))

    if (phase === 'speaking') {
      bus.emit({ type: 'tts:started', text: 'reply', speechGeneration: 1 })
    } else {
      bus.emit({ type: 'session:started', sessionId: 'session-1', transport: 'api' })
    }
    bus.emit({ type: 'session:aborted', abortReason: 'user-button' })
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(flushes, 0, 'the button never releases the queue immediately')

    timers.advance(14_999)
    await Promise.resolve()
    assert.equal(flushes, 0, 'still waiting before 15 s')

    timers.advance(1)
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(flushes, 1, 'the fallback replays once after 15 s')
    session.unmount()
  })
}
