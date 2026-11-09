import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import { useCompanionNotices } from '../src/hooks/chat/useCompanionNotices.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { useCompanionNoticeIdleFlush } from '../src/hooks/chat/useCompanionNoticeQueueSubscriptions.ts'
import { VoiceBus } from '../src/features/voice/bus.ts'
import { InterruptedError } from '../src/features/voice/interruptedError.ts'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type RefSlot = { current: unknown }
type CallbackSlot = { fn: unknown; deps?: readonly unknown[] }
type EffectSlot = {
  deps?: readonly unknown[]
  cleanup?: () => void
  callback?: () => void | (() => void)
}

function depsEqual(left?: readonly unknown[], right?: readonly unknown[]) {
  if (left === undefined || right === undefined) return left === right
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

/**
 * Minimal rerender-capable React dispatcher. It follows the same dependency
 * contract as React (refs persist, callbacks/effects rerun only when deps
 * change), which is exactly what the heartbeat-rerender regression depends on.
 */
function createHookRenderer<T>(hook: () => T) {
  const slots: unknown[] = []
  let effects: EffectSlot[] = []
  let cursor = 0
  let effectCursor = 0
  let queuedEffects: Array<{ index: number; callback: () => void | (() => void) }> = []
  let mounted = true

  const dispatcher = {
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index] as RefSlot
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      const index = cursor++
      const previous = slots[index] as CallbackSlot | undefined
      if (previous && depsEqual(previous.deps, deps)) return previous.fn
      slots[index] = { fn, deps }
      return fn
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = effectCursor++
      const previous = effects[index]
      if (previous && deps !== undefined && depsEqual(previous.deps, deps)) return
      effects[index] = { deps, callback }
      queuedEffects.push({ index, callback })
    },
  }

  function flushEffects() {
    const queued = queuedEffects
    queuedEffects = []
    for (const { index, callback } of queued) {
      const slot = effects[index]
      slot.cleanup?.()
      const cleanup = callback()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  function render(): T {
    cursor = 0
    effectCursor = 0
    reactInternals.H = dispatcher
    try {
      const result = hook()
      flushEffects()
      return result
    } finally {
      reactInternals.H = null
    }
  }

  return {
    render,
    unmount() {
      if (!mounted) return
      mounted = false
      for (const slot of effects) {
        slot.cleanup?.()
        slot.cleanup = undefined
      }
      effects = []
    },
  }
}

function fakeTimers() {
  let id = 1
  let now = 0
  const pending = new Map<number, { callback: () => void; at: number }>()
  return {
    setTimeoutFn: (callback: () => void, delayMs: number) => {
      const next = id++
      pending.set(next, { callback, at: now + delayMs })
      return next
    },
    clearTimeoutFn: (next: number) => { pending.delete(next) },
    advance: (ms: number) => {
      now += ms
      for (const [next, timer] of [...pending]) {
        if (timer.at > now) continue
        pending.delete(next)
        timer.callback()
      }
    },
    pending: () => pending.size,
  }
}

const flushMicrotasks = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

const NOTICE: CompanionNoticePayload = {
  chatContent: 'Reminder',
  bubbleContent: 'Reminder',
  speechContent: 'drink water',
  dedupeKey: 'rerender-reminder',
}

test('heartbeat rerenders do not postpone the user-button fallback', async () => {
  const timers = fakeTimers()
  const bus = new VoiceBus()
  const spoken: string[] = []
  const voiceStateRef = { current: 'idle' as const }
  const busyRef = { current: false }
  let interruptNext = true
  const stable = {
    t: (key: string) => key,
    appendChatMessage: () => undefined,
    presentPetDialogBubble: () => undefined,
    setError: () => undefined,
  }
  let api: ReturnType<typeof useCompanionNotices> | null = null

  const renderer = createHookRenderer(() => {
    // useAppController passes a new ctx literal on every render.
    const ctx = {
      voiceStateRef,
      speakAssistantReply: async (text: string) => {
        if (interruptNext) {
          interruptNext = false
          throw new InterruptedError('interrupt')
        }
        spoken.push(text)
      },
    }
    api = useCompanionNotices({
      ctx,
      t: stable.t as never,
      busyRef,
      appendChatMessage: stable.appendChatMessage,
      presentPetDialogBubble: stable.presentPetDialogBubble,
      setError: stable.setError,
    })
    useCompanionNoticeIdleFlush(bus, api.flushDeferredCompanionNotices, timers)
  })

  renderer.render()
  assert.ok(api)

  await api!.pushCompanionNotice(NOTICE)
  assert.deepEqual(spoken, [], 'the interrupted notice is queued, not played')

  bus.emit({ type: 'session:aborted', abortReason: 'user-button' })
  await flushMicrotasks()
  assert.deepEqual(spoken, [], 'the button abort waits for the fallback')

  // Heartbeat-driven rerenders every 4 s. Under the old flush-identity
  // dependency each render restarted the 15 s timer and nothing ever played.
  for (let tick = 1; tick <= 4; tick += 1) {
    void tick
    renderer.render()
    timers.advance(4_000)
    await flushMicrotasks()
  }

  assert.deepEqual(spoken, ['drink water'], 'exactly one replay after the fallback')
  timers.advance(30_000)
  await flushMicrotasks()
  assert.deepEqual(spoken, ['drink water'], 'the replay is not repeated')

  renderer.unmount()
  assert.equal(timers.pending(), 0)
})

test('a fresh flush identity on every render does not restart the fallback', async () => {
  const timers = fakeTimers()
  const bus = new VoiceBus()
  let flushes = 0
  const renderer = createHookRenderer(() => {
    // Mirrors the pre-fix hook when ctx-keyed callbacks change identity.
    useCompanionNoticeIdleFlush(bus, async () => { flushes += 1 }, timers)
  })

  renderer.render()
  bus.emit({ type: 'session:aborted', abortReason: 'user-button' })
  await flushMicrotasks()

  for (let tick = 1; tick <= 4; tick += 1) {
    void tick
    renderer.render()
    timers.advance(4_000)
    await flushMicrotasks()
  }

  assert.equal(flushes, 1, 'the fallback fires once despite new flush identities')
  renderer.unmount()
  assert.equal(timers.pending(), 0)
})

test('unmount cancels the fallback and a queued release cannot flush afterwards', async () => {
  const timers = fakeTimers()
  const bus = new VoiceBus()
  let flushes = 0
  const renderer = createHookRenderer(() => {
    useCompanionNoticeIdleFlush(bus, async () => { flushes += 1 }, timers)
  })

  renderer.render()
  bus.emit({ type: 'tts:error', message: 'boom', speechGeneration: 1, shouldResumeContinuousVoice: false })
  // The release is a microtask; unmount before it runs and before the timer
  // it would have armed.
  renderer.unmount()
  await flushMicrotasks()
  timers.advance(30_000)
  await flushMicrotasks()

  assert.equal(flushes, 0, 'a disposed subscription never flushes')
  assert.equal(timers.pending(), 0, 'a disposed subscription leaves no timer')
})
