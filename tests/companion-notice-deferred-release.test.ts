import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import { useCompanionNotices } from '../src/hooks/chat/useCompanionNotices.ts'
import { useCompanionNoticeIdleFlush } from '../src/hooks/chat/useCompanionNoticeQueueSubscriptions.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { VoiceBus } from '../src/features/voice/bus.ts'
import { mergeContinuousVoiceActive } from '../src/hooks/voice/continuousVoice.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import type { VoiceState } from '../src/types/index.ts'
import type { TranslationKey, TranslationParams } from '../src/types/i18n.ts'

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

function createHookRenderer<T>(hook: () => T) {
  const slots: unknown[] = []
  let effects: EffectSlot[] = []
  let cursor = 0
  let effectCursor = 0
  let queuedEffects: Array<{ index: number; callback: () => void | (() => void) }> = []

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

function translate(key: TranslationKey, params?: TranslationParams): string {
  let text = (enMessages as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

type HarnessOptions = {
  voiceStateRef?: { current: VoiceState }
  continuousVoiceActiveRef?: { current: boolean }
  busyRef?: { current: boolean }
  shouldDropDeferredNotice?: (payload: CompanionNoticePayload) => boolean
}

function createHarness(options: HarnessOptions = {}) {
  const timers = fakeTimers()
  const bus = new VoiceBus()
  const voiceStateRef = options.voiceStateRef ?? { current: 'listening' as VoiceState }
  const continuousVoiceActiveRef = options.continuousVoiceActiveRef ?? { current: true }
  const busyRef = options.busyRef ?? { current: false }
  const spoken: string[] = []
  const bubbles: string[] = []
  const messages: string[] = []
  let nowMs = 0
  let api: ReturnType<typeof useCompanionNotices> | null = null

  const renderer = createHookRenderer(() => {
    const ctx = {
      voiceStateRef,
      continuousVoiceActiveRef,
      speakAssistantReply: async (text: string) => { spoken.push(text) },
    }
    api = useCompanionNotices({
      ctx,
      t: translate,
      busyRef,
      appendChatMessage: (message) => { messages.push(message.content) },
      presentPetDialogBubble: (bubble) => { bubbles.push(bubble.content) },
      setError: () => undefined,
      now: () => nowMs,
      shouldDropDeferredNotice: options.shouldDropDeferredNotice,
    })
    useCompanionNoticeIdleFlush(
      bus,
      api.flushDeferredCompanionNotices,
      timers,
      api.canDeliverDeferredCompanionNotice,
      {
        canForceRelease: () => api!.canDeliverDeferredCompanionNotice({ force: true }),
        forceFlush: () => api!.flushDeferredCompanionNotices({ force: true }),
        hasPending: api.hasDeferredCompanionNotices,
      },
    )
  })

  renderer.render()
  assert.ok(api)

  return {
    bus,
    timers,
    voiceStateRef,
    continuousVoiceActiveRef,
    busyRef,
    spoken,
    bubbles,
    messages,
    get api() { return api! },
    advance(ms: number) {
      nowMs += ms
      timers.advance(ms)
    },
    render: () => renderer.render(),
    unmount: () => renderer.unmount(),
  }
}

function reminder(
  id: string,
  speech: string,
  dueAt = 0,
  title = `title-${id}`,
): CompanionNoticePayload {
  return {
    chatContent: `${title}: ${speech}`,
    bubbleContent: speech,
    speechContent: speech,
    reminderId: id,
    reminderDueAt: dueAt,
  }
}

const END_CASES: Array<{
  name: string
  event: Parameters<VoiceBus['emit']>[0]
  continuousOff?: boolean
}> = [
  { name: 'normal end', event: { type: 'session:completed' } },
  { name: 'manual cancel', event: { type: 'session:aborted', abortReason: 'user_cancelled' } },
  { name: 'ASR error', event: { type: 'stt:error', code: 'network', message: 'network failed' } },
  { name: 'VAD error', event: { type: 'mic:error', message: 'vad failed' } },
  { name: 'no-speech', event: { type: 'vad:no_speech_timeout', waitedMs: 2_000 } },
  { name: 'transcription failure', event: { type: 'stt:error', code: 'decode', message: 'decode failed' } },
  { name: 'session interrupted', event: { type: 'session:aborted', abortReason: 'interrupted' } },
  { name: 'continuous turned off midway', event: { type: 'session:completed' }, continuousOff: true },
  { name: 'mic denied', event: { type: 'mic:error', message: 'permission denied' } },
]

for (const endCase of END_CASES) {
  test(`end path releases once: ${endCase.name}`, async () => {
    const harness = createHarness()
    await harness.api.pushCompanionNotice(reminder('r1', 'drink water'))
    assert.deepEqual(harness.spoken, [], 'queued while the session is active')

    harness.voiceStateRef.current = 'idle'
    harness.continuousVoiceActiveRef.current = false
    harness.bus.emit(endCase.event)
    await flushMicrotasks()

    assert.deepEqual(harness.spoken, ['drink water'], 'released once on session end')
    assert.equal(harness.timers.pending(), 0, 'release clears all timers')

    harness.bus.emit(endCase.event)
    harness.bus.emit(endCase.event)
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, ['drink water'], 'multiple end signals cannot double release')
    assert.equal(harness.timers.pending(), 0, 'extra end signals leave no timer behind')
    harness.unmount()
  })
}

test('a terminal ASR error releases even if the continuous flag has not cleared yet', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('error', 'error reminder'))
  harness.voiceStateRef.current = 'idle'
  harness.bus.emit({ type: 'stt:error', code: 'network', message: 'network failed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['error reminder'])
  harness.unmount()
})

test('hide alone keeps waiting, and session end while hidden still releases', async () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: { hidden: true, visibilityState: 'hidden' },
  })
  const harness = createHarness()
  try {
    await harness.api.pushCompanionNotice(reminder('hidden', 'take a break'))
    harness.advance(15_000)
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, [], 'hidden alone must not end the session')

    harness.voiceStateRef.current = 'idle'
    harness.continuousVoiceActiveRef.current = false
    harness.bus.emit({ type: 'session:completed' })
    await flushMicrotasks()
    assert.deepEqual(harness.spoken, ['take a break'], 'session end releases while hidden')
  } finally {
    harness.unmount()
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('new reminders merge by due time, dedupe by id, and speak once with one prefix', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('late', 'late reminder', 300))
  await harness.api.pushCompanionNotice(reminder('early', 'early reminder', 100))
  await harness.api.pushCompanionNotice(reminder('early', 'duplicate early reminder', 90))
  await harness.api.pushCompanionNotice(reminder('middle', 'middle reminder', 200))
  await harness.api.pushCompanionNotice(reminder('extra', 'extra reminder', 400))
  assert.deepEqual(harness.spoken, [])

  harness.advance(60_000)
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()

  assert.equal(harness.spoken.length, 1, 'one TTS call for the whole batch')
  assert.equal(
    harness.spoken[0],
    'While we were chatting, it was time for: early reminder; middle reminder; late reminder 1 more reminder.',
  )
  assert.equal(harness.bubbles.length, 1, 'one bubble for the whole batch')
  assert.equal(harness.messages.length, 1, 'one chat line for the whole batch')
  harness.unmount()
})

test('session:completed before tts:completed and the 15 s fallback never flush mid-session', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('gap', 'gap reminder'))

  harness.bus.emit({ type: 'session:completed' })
  harness.bus.emit({ type: 'tts:completed', speechGeneration: 1, shouldResumeContinuousVoice: true })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'completion events only re-arm during continuous voice')

  harness.advance(15_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'the fallback also waits mid-session')

  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['gap reminder'], 'release after the session ends')
  assert.equal(harness.timers.pending(), 0, 'all timers are cleared after release')

  harness.advance(30_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['gap reminder'], 'no late extra flush')
  harness.unmount()
})

test('the 15 s fallback releases within 15 s once the continuous flag goes false', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('fallback', 'fallback reminder'))

  harness.bus.emit({ type: 'tts:completed', speechGeneration: 1, shouldResumeContinuousVoice: true })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [])

  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.advance(15_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['fallback reminder'])
  harness.unmount()
})

test('a 5 s gap does not trip the stuck fallback, and a voice event resets the 30 s window', async () => {
  const harness = createHarness()
  await harness.api.pushCompanionNotice(reminder('stuck', 'stuck reminder'))
  harness.voiceStateRef.current = 'idle'

  harness.advance(5_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], '5 s is not a stuck session')

  harness.bus.emit({ type: 'vad:speech_start' })
  harness.advance(29_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'a voice event restarts the stuck window')

  harness.advance(1_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['stuck reminder'], '30 s with no event releases once')
  assert.equal(harness.timers.pending(), 0)

  harness.advance(30_000)
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, ['stuck reminder'], 'the stuck fallback never double releases')
  harness.unmount()
})

test('Do-Not-Disturb while queued drops the reminder instead of replaying it', async () => {
  let dnd = false
  const harness = createHarness({
    shouldDropDeferredNotice: () => dnd,
  })
  await harness.api.pushCompanionNotice(reminder('dnd', 'dnd reminder'))
  assert.deepEqual(harness.spoken, [])

  dnd = true
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'DND drops the queued reminder')
  assert.equal(harness.api.hasDeferredCompanionNotices(), false)
  harness.unmount()
})

test('pausing the reminder while queued drops it instead of replaying it', async () => {
  let paused = false
  const harness = createHarness({
    shouldDropDeferredNotice: (payload) => paused && payload.reminderId === 'paused',
  })
  await harness.api.pushCompanionNotice(reminder('paused', 'paused reminder'))
  paused = true
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'reminders off drops the queued item')
  harness.unmount()
})

test('a fresh queue has nothing to replay after restart', async () => {
  const harness = createHarness()
  harness.voiceStateRef.current = 'idle'
  harness.continuousVoiceActiveRef.current = false
  harness.bus.emit({ type: 'session:completed' })
  await flushMicrotasks()
  assert.deepEqual(harness.spoken, [], 'no phantom replay from an empty in-memory queue')
  harness.unmount()
})

test('panel inherits the pet continuous-voice flag and holds reminders', async () => {
  const merged = mergeContinuousVoiceActive({
    view: 'panel',
    localActive: false,
    petRuntimeActive: true,
  })
  assert.equal(merged, true, 'panel sees the pet continuous session')

  const harness = createHarness({
    voiceStateRef: { current: 'idle' },
    continuousVoiceActiveRef: { current: merged },
  })
  await harness.api.pushCompanionNotice(reminder('panel', 'panel reminder'))
  assert.deepEqual(harness.spoken, [], 'panel queues while the pet is in continuous voice')
  harness.unmount()
})

test('queue/release/drop logs never include reminder text or user speech', async () => {
  const captured: unknown[][] = []
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const originals = methods.map((method) => console[method])
  for (const method of methods) {
    console[method] = (...args: unknown[]) => { captured.push(args) }
  }
  const harness = createHarness({
    shouldDropDeferredNotice: (payload) => payload.reminderId === 'drop-secret',
  })
  try {
    await harness.api.pushCompanionNotice(reminder(
      'secret',
      'SECRET-REMINDER-TITLE',
      1,
      'SECRET-USER-SPEECH',
    ))
    harness.voiceStateRef.current = 'idle'
    harness.continuousVoiceActiveRef.current = false
    harness.bus.emit({ type: 'session:completed' })
    await flushMicrotasks()

    await harness.api.pushCompanionNotice(reminder('drop-secret', 'SECRET-REMINDER-TITLE'))
    harness.bus.emit({ type: 'session:completed' })
    await flushMicrotasks()
  } finally {
    for (const [index, method] of methods.entries()) {
      console[method] = originals[index]
    }
    harness.unmount()
  }

  const text = captured.flat().map((value) => String(value)).join('\n')
  assert.doesNotMatch(text, /SECRET-REMINDER-TITLE/)
  assert.doesNotMatch(text, /SECRET-USER-SPEECH/)
})
