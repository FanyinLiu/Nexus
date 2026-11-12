import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import React from 'react'

import { useCompanionNotices } from '../src/hooks/chat/useCompanionNotices.ts'
import { useCompanionNoticeIdleFlush } from '../src/hooks/chat/useCompanionNoticeQueueSubscriptions.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { VoiceBus } from '../src/features/voice/bus.ts'
import type { VoiceState } from '../src/types/index.ts'
import { createRealReactRoot } from './helpers/realReactRoot.ts'

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
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

/** react-dom reads `window.event`; the hooks themselves use the injected timers. */
function installWindow(t: TestContext) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { event: undefined },
  })
  t.after(() => { Reflect.deleteProperty(globalThis, 'window') })
}

type TimerBag = ReturnType<typeof fakeTimers>

type IdleFlushProbeProps = {
  bus: VoiceBus
  timers: TimerBag
  flush: () => Promise<void>
  hasPending: () => boolean
}

function IdleFlushProbe({ bus, timers, flush, hasPending }: IdleFlushProbeProps) {
  useCompanionNoticeIdleFlush(bus, flush, timers, () => true, { hasPending })
  return null
}

type SpeakAssistantReply = (text: string, shouldResume: boolean) => Promise<void>

type NoticeCtx = {
  voiceStateRef: { current: VoiceState }
  continuousVoiceActiveRef: { current: boolean }
  speakAssistantReply: SpeakAssistantReply
}

type NoticeApi = ReturnType<typeof useCompanionNotices>

type NoticeProbeProps = {
  ctx: NoticeCtx
  busyRef: { current: boolean }
  apiRef: { current: NoticeApi | null }
}

function NoticeProbe({ ctx, busyRef, apiRef }: NoticeProbeProps) {
  const api = useCompanionNotices({
    ctx,
    t: ((key: string) => key) as never,
    busyRef,
    appendChatMessage: () => undefined,
    presentPetDialogBubble: () => undefined,
    setError: () => undefined,
  })
  React.useEffect(() => { apiRef.current = api }, [api, apiRef])
  return null
}

function notice(id: string, speech: string): CompanionNoticePayload {
  return {
    chatContent: `chat-${id}`,
    bubbleContent: `bubble-${id}`,
    speechContent: speech,
    dedupeKey: `queue-guard-${id}`,
  }
}

test('an in-flight flush that finishes after unmount never re-arms a timer', async (t) => {
  installWindow(t)
  const timers = fakeTimers()
  const bus = new VoiceBus()
  const root = createRealReactRoot()
  let resolveFlush: () => void = () => undefined
  const inFlight = new Promise<void>((resolve) => { resolveFlush = resolve })
  let flushes = 0

  await root.render(React.createElement(IdleFlushProbe, {
    bus,
    timers,
    flush: () => {
      flushes += 1
      return inFlight
    },
    hasPending: () => true,
  }))

  bus.emit({ type: 'tts:completed', speechGeneration: 1, shouldResumeContinuousVoice: false })
  await flushMicrotasks()
  assert.equal(flushes, 1, 'the release starts the one in-flight flush')

  await root.unmount()
  assert.equal(timers.pending(), 0, 'unmount cancels the armed fallback and stuck timers')

  resolveFlush()
  await flushMicrotasks()
  assert.equal(timers.pending(), 0, 'a flush finishing after unmount must not re-arm a timer')

  timers.advance(60_000)
  await flushMicrotasks()
  assert.equal(flushes, 1, 'advancing time after unmount never flushes again')
})

test('the user-button fallback counts from the press and uses the latest flush across rerenders', async (t) => {
  installWindow(t)
  const timers = fakeTimers()
  const bus = new VoiceBus()
  const root = createRealReactRoot()
  const renders: number[] = []
  const flushes: number[] = []

  const mount = async (renderId: number) => {
    renders.push(renderId)
    await root.render(React.createElement(IdleFlushProbe, {
      bus,
      timers,
      // A host that recreates its flush callback on every render.
      flush: async () => { flushes.push(renderId) },
      hasPending: () => false,
    }))
  }

  await mount(0)
  bus.emit({ type: 'session:aborted', abortReason: 'user-button' })
  await flushMicrotasks()
  assert.equal(timers.pending(), 2, 'the button arms the fallback and stuck timers')

  for (let tick = 1; tick <= 3; tick += 1) {
    await root.act(() => { timers.advance(4_000) })
    await mount(tick)
    await flushMicrotasks()
  }
  assert.deepEqual(renders, [0, 1, 2, 3], 'three rerenders happened while the fallback waited')

  await root.act(() => { timers.advance(2_999) })
  await flushMicrotasks()
  assert.deepEqual(flushes, [], 'no rerender reset the fallback before 15 s')

  await root.act(() => { timers.advance(1) })
  await flushMicrotasks()
  assert.deepEqual(flushes, [3], 'exactly one flush fires 15 s after the press through the latest identity')

  await root.act(() => { timers.advance(30_000) })
  await flushMicrotasks()
  assert.deepEqual(flushes, [3], 'rerenders and later time never add another replay')

  await root.unmount()
})

test('a notice delivered after a rerender uses the latest ctx, not the first-render closure', async (t) => {
  installWindow(t)
  const root = createRealReactRoot()
  const apiRef: { current: NoticeApi | null } = { current: null }
  const busyRef = { current: false }
  const voiceStateRef = { current: 'idle' as VoiceState }
  const continuousVoiceActiveRef = { current: false }
  const spoken: string[] = []

  const ctxFor = (label: string): NoticeCtx => ({
    voiceStateRef,
    continuousVoiceActiveRef,
    speakAssistantReply: async (text: string) => { spoken.push(`${label}:${text}`) },
  })

  await root.render(React.createElement(NoticeProbe, {
    ctx: ctxFor('first'),
    busyRef,
    apiRef,
  }))
  const pushFromFirstRender = apiRef.current!.pushCompanionNotice

  await root.render(React.createElement(NoticeProbe, {
    ctx: ctxFor('second'),
    busyRef,
    apiRef,
  }))

  await pushFromFirstRender(notice('latest-ctx', 'latest ctx speech'))
  assert.deepEqual(spoken, ['second:latest ctx speech'], 'delivery reads the current ctx ref')

  await root.unmount()
})
