import assert from 'node:assert/strict'
import { test } from 'node:test'

import React from 'react'

import { useCompanionNotices } from '../src/hooks/chat/useCompanionNotices.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { createStreamingSpeechOutputController } from '../src/hooks/voice/streamingSpeechOutput.ts'
import { interruptActiveSpeechOutputRuntime } from '../src/hooks/voice/runtimeSupport.ts'
import { isInterruptedError } from '../src/features/voice/interruptedError.ts'
import type { ChatMessage, VoiceState } from '../src/types/index.ts'
import type { AppSettings } from '../src/types/app.ts'
import type { VoiceStreamEvent } from '../src/types/voice.ts'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type CallbackSlot = { fn: unknown }

function renderCompanionNotices(options: {
  busyRef: { current: boolean }
  voiceStateRef: { current: VoiceState }
  speakAssistantReply: (text: string) => Promise<void>
}) {
  const messages: ChatMessage[] = []
  const slots: unknown[] = []
  let cursor = 0
  const dispatcher = {
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { fn }
      return (slots[index] as CallbackSlot).fn
    },
    useEffect(effect: () => void | (() => void)) {
      effect()
    },
  }

  function Probe() {
    return useCompanionNotices({
      ctx: {
        speakAssistantReply: options.speakAssistantReply,
        voiceStateRef: options.voiceStateRef,
      },
      t: (key) => String(key),
      busyRef: options.busyRef,
      appendChatMessage: (message) => { messages.push(message) },
      presentPetDialogBubble: () => undefined,
      setError: () => undefined,
    })
  }

  reactInternals.H = dispatcher
  try {
    return { api: Probe(), messages }
  } finally {
    reactInternals.H = null
  }
}

const SETTINGS = {
  speechOutputEnabled: true,
  speechOutputProviderId: 'openai-tts',
  speechOutputApiBaseUrl: '',
  speechOutputApiKey: '',
  speechOutputModel: '',
  speechOutputVoice: 'vivian',
  activeCharacterProfileId: 'char-1',
  speechOutputInstructions: '',
  speechSynthesisLang: 'zh-CN',
  speechRate: 1,
  speechPitch: 1,
  speechVolume: 1,
} as unknown as AppSettings

function installTtsBridge() {
  const listeners: Array<(event: VoiceStreamEvent) => void> = []
  const emit = (event: VoiceStreamEvent) => {
    for (const listener of [...listeners]) listener(event)
  }
  const desktopPet = {
    ttsStreamStart: async () => ({ ok: true }),
    ttsStreamPushText: async (payload: { requestId: string; text: string }) => {
      setTimeout(() => {
        emit({
          type: 'chunk',
          requestId: payload.requestId,
          chunkId: 'chunk-1',
          format: 'f32le',
          sampleRate: 24000,
          channels: 1,
          text: payload.text,
          segmentIndex: 0,
          samples: [0],
          isFinal: false,
        })
      }, 0)
      return { ok: true }
    },
    ttsStreamFinish: async () => ({ ok: true }),
    ttsStreamAbort: async () => ({ ok: true }),
    subscribeTtsStream: (listener: (event: VoiceStreamEvent) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      desktopPet,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    },
  })
  return desktopPet
}

const ticks = async (count = 4) => {
  for (let index = 0; index < count; index += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

test('typing during a queued reminder interrupts it once and replays after idle', async () => {
  installTtsBridge()
  const player = {
    appendPcmChunk: async () => undefined,
    waitForDrain: async () => undefined,
    stopAndClear: () => undefined,
  }
  const busyRef = { current: true }
  const voiceStateRef = { current: 'processing' as VoiceState }
  let attempts = 0
  let firstController: ReturnType<typeof createStreamingSpeechOutputController> | null = null
  let firstOutcome: unknown = null

  const { api, messages } = renderCompanionNotices({
    busyRef,
    voiceStateRef,
    speakAssistantReply: async (text) => {
      attempts += 1
      if (attempts > 1) return
      const controller = createStreamingSpeechOutputController(SETTINGS, {
        getPlayer: () => player as never,
      })
      firstController = controller
      const completion = controller.waitForCompletion().then(
        () => 'resolved',
        (error: unknown) => error,
      )
      controller.pushDelta(`${text} This sentence is long enough.`)
      controller.flushPending()
      const outcome = await completion
      firstOutcome = outcome
      if (isInterruptedError(outcome)) throw outcome
    },
  })

  // Arrives during a turn: deferred.
  const notice: CompanionNoticePayload = {
    chatContent: 'Reminder text',
    bubbleContent: 'Reminder text',
    speechContent: 'Reminder speech',
    dedupeKey: 'integration-reminder',
  }
  await api.pushCompanionNotice(notice)
  assert.equal(messages.length, 0, 'a busy notice is deferred, not presented as played')
  assert.equal(attempts, 0)

  // The reply ends; flushing starts the reminder.
  busyRef.current = false
  voiceStateRef.current = 'idle'
  const firstFlush = api.flushDeferredCompanionNotices()
  await ticks()
  assert.equal(attempts, 1)
  assert.equal(messages.length, 1)
  assert.ok(firstController, 'the reminder owns a real streaming controller')

  // Typing interrupts it through the real runtime path.
  interruptActiveSpeechOutputRuntime({
    wakewordAcknowledgingRef: { current: false },
    stopSpeechInterruptMonitor: () => undefined,
    stopSpeechTracking: () => undefined,
    activeStreamingSpeechOutputRef: { current: firstController },
    streamAudioPlayerRef: { current: player as never },
    assistantSpeechGenerationRef: { current: 1 },
    interruptedSpeechGenerationRef: { current: null },
  })
  await firstFlush
  await ticks()

  assert.equal(isInterruptedError(firstOutcome), true, 'the interrupted reminder never completes')
  assert.equal(attempts, 1, 'the replay does not run inside the same flush')
  assert.equal(messages.length, 1, 'presentation is not duplicated')

  // Once idle again, the single replay runs.
  const replay = api.flushDeferredCompanionNotices()
  await ticks()
  assert.equal(attempts, 2, 'the reminder replays exactly once after idle')
  await replay
  assert.equal(messages.length, 1)
})

test('typing also requeues the other notice already queued in the shared player', async () => {
  installTtsBridge()
  const player = {
    appendPcmChunk: async () => undefined,
    waitForDrain: async () => undefined,
    stopAndClear: () => undefined,
  }
  const busyRef = { current: false }
  const voiceStateRef = { current: 'idle' as VoiceState }
  const attempts = new Map<string, number>()
  const controllers = new Map<string, ReturnType<typeof createStreamingSpeechOutputController>>()

  const { api, messages } = renderCompanionNotices({
    busyRef,
    voiceStateRef,
    speakAssistantReply: async (text) => {
      const count = (attempts.get(text) ?? 0) + 1
      attempts.set(text, count)
      if (count > 1) return
      const controller = createStreamingSpeechOutputController(SETTINGS, {
        getPlayer: () => player as never,
      })
      controllers.set(text, controller)
      const completion = controller.waitForCompletion().catch((error: unknown) => error)
      controller.pushDelta(`${text} This sentence is long enough.`)
      controller.flushPending()
      const outcome = await completion
      if (isInterruptedError(outcome)) throw outcome
    },
  })

  const firstPush = api.pushCompanionNotice({
    chatContent: 'First reminder',
    bubbleContent: 'First reminder',
    speechContent: 'first',
    dedupeKey: 'first-shared',
  })
  const secondPush = api.pushCompanionNotice({
    chatContent: 'Second reminder',
    bubbleContent: 'Second reminder',
    speechContent: 'second',
    dedupeKey: 'second-shared',
  })
  await ticks()
  assert.deepEqual([...attempts.values()], [1, 1])
  assert.equal(messages.length, 2)

  // Only the first controller is the "current" one; the second lives in the
  // registry. Interrupt must still abort both and requeue both notices.
  interruptActiveSpeechOutputRuntime({
    wakewordAcknowledgingRef: { current: false },
    stopSpeechInterruptMonitor: () => undefined,
    stopSpeechTracking: () => undefined,
    activeStreamingSpeechOutputRef: { current: controllers.get('first') },
    streamAudioPlayerRef: { current: player as never },
    assistantSpeechGenerationRef: { current: 3 },
    interruptedSpeechGenerationRef: { current: null },
  })
  await Promise.all([firstPush, secondPush])

  const replay = api.flushDeferredCompanionNotices()
  await ticks()
  assert.equal(attempts.get('first'), 2, 'the active notice replays')
  assert.equal(attempts.get('second'), 2, 'the second queued notice replays too')
  await replay
  assert.equal(messages.length, 2, 'replays never duplicate presentation')
})

test('barge-in without a new reply still replays the interrupted reminder', async () => {
  installTtsBridge()
  const player = {
    appendPcmChunk: async () => undefined,
    waitForDrain: async () => undefined,
    stopAndClear: () => undefined,
  }
  const busyRef = { current: false }
  const voiceStateRef = { current: 'idle' as VoiceState }
  let attempts = 0
  let controller: ReturnType<typeof createStreamingSpeechOutputController> | null = null

  const { api } = renderCompanionNotices({
    busyRef,
    voiceStateRef,
    speakAssistantReply: async (text) => {
      attempts += 1
      if (attempts > 1) return
      controller = createStreamingSpeechOutputController(SETTINGS, { getPlayer: () => player as never })
      const completion = controller.waitForCompletion().catch((error: unknown) => error)
      controller.pushDelta(`${text} This sentence is long enough.`)
      controller.flushPending()
      const outcome = await completion
      if (isInterruptedError(outcome)) throw outcome
    },
  })

  const push = api.pushCompanionNotice({
    chatContent: 'Reminder',
    bubbleContent: 'Reminder',
    speechContent: 'Reminder speech',
    dedupeKey: 'barge-in-reminder',
  })
  await ticks()
  assert.equal(attempts, 1)

  interruptActiveSpeechOutputRuntime({
    wakewordAcknowledgingRef: { current: false },
    stopSpeechInterruptMonitor: () => undefined,
    stopSpeechTracking: () => undefined,
    activeStreamingSpeechOutputRef: { current: controller },
    streamAudioPlayerRef: { current: player as never },
    assistantSpeechGenerationRef: { current: 2 },
    interruptedSpeechGenerationRef: { current: null },
  })
  await push

  const replay = api.flushDeferredCompanionNotices()
  await ticks()
  assert.equal(attempts, 2, 'the interrupted reminder is replayed once')
  await replay
})
