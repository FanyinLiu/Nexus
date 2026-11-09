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
  let flushes = 0
  const session = renderHook(() => useCompanionNoticeIdleFlush(
    bus,
    async () => { flushes += 1 },
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
