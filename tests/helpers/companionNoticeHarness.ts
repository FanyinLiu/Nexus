import assert from 'node:assert/strict'

import React from 'react'

import { useCompanionNotices } from '../../src/hooks/chat/useCompanionNotices.ts'
import {
  useCompanionNoticeIdleFlush,
  useCompanionNoticeStopSubscription,
} from '../../src/hooks/chat/useCompanionNoticeQueueSubscriptions.ts'
import type { CompanionNoticePayload } from '../../src/hooks/chat/types.ts'
import { VoiceBus } from '../../src/features/voice/bus.ts'
import { InterruptedError } from '../../src/features/voice/interruptedError.ts'
import { enMessages } from '../../src/i18n/locales/en/index.ts'
import type { VoiceState } from '../../src/types/index.ts'
import type { TranslationKey, TranslationParams } from '../../src/types/i18n.ts'

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

export const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

export type HarnessOptions = {
  voiceStateRef?: { current: VoiceState }
  continuousVoiceActiveRef?: { current: boolean }
  ownContinuousVoiceActiveRef?: { current: boolean }
  busyRef?: { current: boolean }
  shouldDropDeferredNotice?: (payload: CompanionNoticePayload) => boolean
  speakAssistantReply?: (text: string) => Promise<void>
  onStuckFallback?: () => void
}

export function createHarness(options: HarnessOptions = {}) {
  const timers = fakeTimers()
  const bus = new VoiceBus()
  const voiceStateRef = options.voiceStateRef ?? { current: 'listening' as VoiceState }
  const continuousVoiceActiveRef = options.continuousVoiceActiveRef ?? { current: true }
  const ownContinuousVoiceActiveRef = options.ownContinuousVoiceActiveRef ?? continuousVoiceActiveRef
  const busyRef = options.busyRef ?? { current: false }
  const spoken: string[] = []
  const resumeFlags: boolean[] = []
  const bubbles: string[] = []
  const messages: string[] = []
  let nowMs = 0
  let api: ReturnType<typeof useCompanionNotices> | null = null

  const renderer = createHookRenderer(() => {
    const ctx = {
      voiceStateRef,
      continuousVoiceActiveRef,
      ownContinuousVoiceActiveRef,
      speakAssistantReply: async (text: string, shouldResume: boolean) => {
        spoken.push(text)
        resumeFlags.push(shouldResume)
        await options.speakAssistantReply?.(text)
      },
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
    useCompanionNoticeStopSubscription(api.discardDeferredCompanionNotices)
    useCompanionNoticeIdleFlush(
      bus,
      api.flushDeferredCompanionNotices,
      timers,
      api.canDeliverDeferredCompanionNotice,
      {
        canForceRelease: () => api!.canDeliverDeferredCompanionNotice({ force: true }),
        forceFlush: () => api!.flushDeferredCompanionNotices({ force: true }),
        onStuckFallback: options.onStuckFallback,
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
    resumeFlags,
    bubbles,
    messages,
    ownContinuousVoiceActiveRef,
    get api() { return api! },
    advance(ms: number) {
      nowMs += ms
      timers.advance(ms)
    },
    render: () => renderer.render(),
    unmount: () => renderer.unmount(),
  }
}

export function pendingSpeech() {
  const pending: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []
  return {
    speak: () => new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject })
    }),
    interruptLatest: () => {
      const entry = pending.shift()
      assert.ok(entry, 'no pending speech to interrupt')
      entry.reject(new InterruptedError('interrupt'))
    },
    resolveLatest: () => {
      const entry = pending.shift()
      assert.ok(entry, 'no pending speech to finish')
      entry.resolve()
    },
  }
}

export function reminder(
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
