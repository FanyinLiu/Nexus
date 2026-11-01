import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, test } from 'node:test'

import { createAssistantReplyRunner } from '../src/hooks/chat/assistantReply.ts'
import { executeAssistantTurn } from '../src/hooks/chat/turnExecution.ts'
import { createStreamingSpeechOutputController } from '../src/hooks/voice/streamingSpeechOutput.ts'
import { interruptSpeakingForVoiceInputRuntime } from '../src/hooks/voice/runtimeSupport.ts'
import { VoiceBus } from '../src/features/voice/bus.ts'
import { ensureLocaleLoaded, setLocale, t } from '../src/i18n/runtime.ts'
import { subscribePetNotify, type PetNotifyEvent } from '../src/lib/petNotifyBus.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { AppSettings, ChatMessage, PetMood, VoiceState } from '../src/types/index.ts'
import type { TtsStreamEvent } from '../src/types/voice.ts'

// Guard rails for the chat→pet notification contract. These tests drive the
// real chat turn runner, real streaming TTS controller, and real voice session
// bus; only the model stream, TTS transport, audio player, and timers are fakes.
// The recorded notification order is the observable behaviour the event-bus
// refactor must preserve exactly.

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }

  removeItem(key: string) {
    this.data.delete(key)
  }

  clear() {
    this.data.clear()
  }
}

before(async () => {
  await ensureLocaleLoaded('en-US')
  setLocale('en-US')
})

beforeEach(() => {
  const localStorage = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      localStorage,
      setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
        setTimeout(handler as () => void, timeout, ...args) as unknown as number
      ),
      clearTimeout: (id?: number) => clearTimeout(id as unknown as NodeJS.Timeout),
      addEventListener: () => undefined,
    },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: localStorage,
  })
})

type PetNotification =
  | { kind: 'mood'; mood: PetMood }
  | { kind: 'status'; text: string; duration?: number }
  | { kind: 'clear-cue' }
  | { kind: 'queue-cue'; cues: Array<{ stageDirection: string; gestureName?: string; expressionSlot?: string }> }
  | { kind: 'presence' }

function createPetSink() {
  const notifications: PetNotification[] = []
  const sink = {
    setMood: (mood: PetMood) => { notifications.push({ kind: 'mood', mood }) },
    updatePetStatus: (text: string, duration?: number) => {
      notifications.push({ kind: 'status', text, ...(duration !== undefined ? { duration } : {}) })
    },
    clearPetPerformanceCue: () => { notifications.push({ kind: 'clear-cue' }) },
    queuePetPerformanceCue: (
      cues: Array<{ stageDirection: string; gestureName?: string; expressionSlot?: string }> | null | undefined,
    ) => {
      notifications.push({ kind: 'queue-cue', cues: cues ?? [] })
    },
    markPresenceActivity: () => { notifications.push({ kind: 'presence' }) },
  }
  return { notifications, sink }
}

const petNotifyCleanups: Array<() => void> = []

afterEach(() => {
  while (petNotifyCleanups.length) petNotifyCleanups.pop()?.()
})

function wirePetNotifications(
  sink: ReturnType<typeof createPetSink>['sink'],
): void {
  petNotifyCleanups.push(subscribePetNotify((event: PetNotifyEvent) => {
    switch (event.type) {
      case 'mood':
        sink.setMood(event.mood)
        break
      case 'status':
        sink.updatePetStatus(event.text, event.duration)
        break
      case 'performance_cue_clear':
        sink.clearPetPerformanceCue()
        break
      case 'performance_cue_queue':
        sink.queuePetPerformanceCue(event.cues)
        break
      case 'presence_activity':
        sink.markPresenceActivity()
        break
    }
  }))
}

type TtsHarness = ReturnType<typeof installTtsHarness>

function installTtsHarness(options: { holdEnd?: boolean } = {}) {
  const pushes: Array<{ requestId: string; text: string }> = []
  const listeners: Array<(event: TtsStreamEvent) => void> = []
  const abortCalls: string[] = []
  const appendCalls: Array<{ startedAtMs: number; durationMs: number }> = []
  const starts = [0, 1_000, 2_000, 3_000]
  let clock = 0

  const emit = (event: TtsStreamEvent) => {
    for (const listener of [...listeners]) listener(event)
  }

  const desktopPet = {
    ttsStreamStart: async () => ({ ok: true }),
    ttsStreamPushText: async (payload: { requestId: string; text: string }) => {
      const index = pushes.length
      pushes.push(payload)
      setTimeout(() => {
        emit({
          type: 'chunk',
          requestId: payload.requestId,
          chunkId: `chunk-${index}`,
          format: 'f32le',
          sampleRate: 1_000,
          channels: 1,
          text: payload.text,
          segmentIndex: index,
          isFinal: true,
          samples: Array.from({ length: 1_000 }, () => 0),
        })
      }, 0)
      return { ok: true }
    },
    ttsStreamFinish: async (payload: { requestId: string }) => {
      if (!options.holdEnd) {
        setTimeout(() => emit({ type: 'end', requestId: payload.requestId }), 0)
      }
      return { ok: true }
    },
    ttsStreamAbort: async (payload: { requestId: string }) => {
      abortCalls.push(payload.requestId)
      return { ok: true }
    },
    subscribeTtsStream: (listener: (event: TtsStreamEvent) => void) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { ...globalThis.window, desktopPet },
  })

  const player = {
    appendPcmChunk: async (samples: Float32Array | number[], sampleRate: number) => {
      const startedAtMs = starts[appendCalls.length] ?? 0
      const durationMs = (samples.length / sampleRate) * 1_000
      appendCalls.push({ startedAtMs, durationMs })
      return { startedAtMs, durationMs }
    },
    waitForDrain: async () => undefined,
    stopAndClear: () => undefined,
  }

  return {
    pushes,
    abortCalls,
    appendCalls,
    player,
    setClock: (value: number) => { clock = value },
    now: () => clock,
  }
}

const SETTINGS = {
  ...loadSettings(),
  speechOutputEnabled: true,
  speechOutputProviderId: 'openai-tts',
  speechOutputApiBaseUrl: '',
  speechOutputApiKey: '',
  speechOutputModel: '',
  speechOutputVoice: 'en',
  speechOutputInstructions: '',
  speechSynthesisLang: 'en-US',
  speechRate: 1,
  speechPitch: 1,
  speechVolume: 1,
  chatFailoverEnabled: false,
} as AppSettings

const ticks = async (count = 6) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  assert.fail(`timed out waiting for ${label}`)
}

function createHarness(replyText: string, tts: TtsHarness) {
  const { notifications, sink } = createPetSink()
  wirePetNotifications(sink)
  const bus = new VoiceBus()
  const voiceStateRef: { current: VoiceState } = { current: 'idle' }
  const busEvents: string[] = []
  const voiceStates: VoiceState[] = []
  let controller: ReturnType<typeof createStreamingSpeechOutputController> | null = null

  const busEmit = (event: import('../src/features/voice/busEvents.ts').VoiceBusEvent) => {
    busEvents.push(event.type)
    const previousUiPhase = bus.uiPhase
    const effects = bus.emit(event)
    const nextUiPhase = bus.uiPhase
    if (previousUiPhase !== nextUiPhase) {
      voiceStateRef.current = nextUiPhase
      voiceStates.push(nextUiPhase)
    }
    for (const effect of effects) {
      if (effect.type === 'set_mood') sink.setMood(effect.mood)
      if (effect.type === 'show_status') sink.updatePetStatus(effect.message, effect.duration)
    }
    return effects
  }

  const ctx = {
    voiceStateRef,
    loadDesktopContextSnapshot: async () => null,
    suppressVoiceReplyRef: { current: false },
    beginStreamingSpeechReply: () => {
      controller = createStreamingSpeechOutputController(
        SETTINGS,
        { getPlayer: () => tts.player as never, now: tts.now },
        {
          busEmit,
          speechGeneration: 1,
          onStart: () => busEmit({ type: 'tts:started', text: replyText, speechGeneration: 1 }),
          onEnd: () => busEmit({
            type: 'tts:completed',
            speechGeneration: 1,
            shouldResumeContinuousVoice: false,
          }),
        },
      )
      return controller
    },
    busEmit,
    updateVoicePipeline: () => {},
    appendVoiceTrace: () => {},
    clearPendingVoiceRestart: () => {},
    resetNoSpeechRestartCount: () => {},
    setVoiceState: (state: VoiceState) => {
      voiceStateRef.current = state
      voiceStates.push(state)
    },
    setLiveTranscript: () => {},
    appendDailyMemoryEntries: () => {},
    appendDebugConsoleEvent: () => {},
    onAssistantReplyDelivered: () => {},
    commitOnThisDayPromptText: () => {},
    settingsRef: { current: SETTINGS },
    setSettings: () => {},
    speakAssistantReply: async () => {},
  }

  const appended: ChatMessage[] = []
  const playbackFailures: unknown[] = []

  const runner = createAssistantReplyRunner({
    ctx,
    appendChatMessage: (message: ChatMessage) => { appended.push(message) },
    appendSystemMessage: () => {},
    presentPetDialogBubble: () => {},
    handleSpeechPlaybackFailure: (error: unknown) => { playbackFailures.push(error) },
    setError: () => {},
    setActiveStreamAbort: () => {},
    requestStreaming: (_settings, _history, _memory, onDelta) => {
      onDelta(replyText, true)
      return Promise.resolve({
        providerId: 'ollama',
        response: { content: replyText },
        usedFallback: false,
      })
    },
  } as unknown as Parameters<typeof createAssistantReplyRunner>[0])

  return {
    notifications,
    bus,
    busEvents,
    voiceStates,
    voiceStateRef,
    ctx,
    appended,
    playbackFailures,
    runner,
    get controller() { return controller },
  }
}

function makeTurnOptions(fromVoice: boolean) {
  const nextMessages: ChatMessage[] = [{
    id: 'user-1',
    role: 'user',
    content: 'tell me something',
    createdAt: '2026-10-30T12:00:00.000Z',
  }]
  return {
    currentSettings: SETTINGS,
    nextMessages,
    nextMemories: [],
    nextDailyMemories: {},
    content: 'tell me something',
    source: fromVoice ? 'voice' as const : 'text' as const,
    fromVoice,
    traceId: 'trace-1',
    traceLabel: '1',
    shouldResumeContinuousVoice: false,
  }
}

function createTurnDeps(harness: ReturnType<typeof createHarness>) {
  return {
    ctx: harness.ctx,
    setBusy: () => {},
    setError: () => {},
    busyRef: { current: false },
    activeTurnIdRef: { current: 0 },
    activeStreamAbortRef: { current: null },
    runAssistantReplyTurn: (options: import('../src/hooks/chat/assistantReply.ts').AssistantReplyRunnerOptions) => (
      harness.runner(options)
    ),
    flushDeferredCompanionNotices: async () => {},
  }
}

test('barge-in while replying keeps the heard prefix, reopens listening, and preserves pet notification order', async () => {
  const tts = installTtsHarness({ holdEnd: true })
  const harness = createHarness('First sentence. Second half here. Third sentence.', tts)
  const turn = executeAssistantTurn(
    createTurnDeps(harness) as never,
    makeTurnOptions(true) as never,
  )

  await waitFor(
    () => tts.pushes.length === 3 && harness.voiceStateRef.current === 'speaking',
    'streaming speech to start',
  )

  // The user starts speaking over the reply after the first sentence and half
  // of the second. Voice input tears the active speech down and reports the
  // interruption to the bus, exactly like the barge-in monitor does.
  tts.setClock(1_500)
  const interrupted = interruptSpeakingForVoiceInputRuntime({
    voiceStateRef: harness.voiceStateRef,
    canInterruptSpeech: () => true,
    showPetStatus: () => {},
    stopActiveSpeechOutput: () => { harness.controller?.abort() },
    abortPendingSpeechOutput: () => { harness.controller?.abort() },
    dispatchVoiceSessionAndSync: () => {
      harness.ctx.busEmit({ type: 'tts:interrupted', speechGeneration: 1 })
      return {} as never
    },
    voiceEchoCooldownUntilRef: { current: 0 },
    ti: (key) => String(key),
  })
  assert.equal(interrupted, true)

  // The post-barge-in restart timer opens a fresh listening session.
  harness.ctx.busEmit({ type: 'session:started', sessionId: 'voice-2', transport: 'local_vad' })

  assert.equal(await turn, true)
  await ticks(3)

  const controller = harness.controller
  assert.ok(controller)
  assert.equal(controller.wasInterrupted?.(), true)
  assert.deepEqual(harness.playbackFailures, [])
  assert.equal(harness.busEvents.includes('tts:error'), false)
  assert.equal(tts.abortCalls.length, 1)

  // History keeps only what she actually heard, marked as interrupted.
  assert.equal(harness.appended.length, 1)
  const committed = harness.appended[0]!
  const interruption = controller.getInterruption?.()
  assert.ok(interruption)
  assert.equal(committed.runStatus, 'interrupted')
  assert.equal(committed.content, interruption.heardText.trimEnd())
  assert.deepEqual(committed.interrupted, {
    heardChars: interruption.heardText.trimEnd().length,
    fullChars: interruption.fullChars,
  })
  assert.ok(committed.content.length > 0)
  assert.ok(committed.content.length < 'First sentence. Second half here. Third sentence.'.length)

  // The voice session is listening again after the restart.
  assert.equal(harness.bus.uiPhase, 'listening')
  assert.equal(harness.voiceStateRef.current, 'listening')

  // ── The pet notification contract ──────────────────────────────────────
  // Clear → thinking → status on turn start; happy while TTS plays; idle when
  // the barge-in tears speech down; idle again when the new session starts;
  // the reply's performance cues are queued once; the reply mood lands last.
  assert.deepEqual(harness.notifications, [
    { kind: 'clear-cue' },
    { kind: 'mood', mood: 'thinking' },
    { kind: 'status', text: t('chat.turn.voice_status') },
    { kind: 'mood', mood: 'happy' },
    { kind: 'mood', mood: 'idle' },
    { kind: 'mood', mood: 'idle' },
    { kind: 'queue-cue', cues: [] },
    { kind: 'mood', mood: 'idle' },
  ])
})

test('streaming TTS speaks every sentence chunk once in order and queues the reply performance cue once', async () => {
  const tts = installTtsHarness()
  const replyText = '（眼睛亮了）First sentence. Second half here. Third sentence.'
  const harness = createHarness(replyText, tts)
  const turn = executeAssistantTurn(
    createTurnDeps(harness) as never,
    makeTurnOptions(false) as never,
  )

  await waitFor(() => tts.pushes.length === 3, 'all reply sentences to reach TTS')
  assert.equal(await turn, true)
  await ticks(4)

  // Chunked as the model streamed, but each sentence reaches the provider exactly
  // once, in reply order, under one request.
  assert.deepEqual(
    tts.pushes.map((push) => push.text),
    ['First sentence.', 'Second half here.', 'Third sentence.'],
  )
  assert.equal(new Set(tts.pushes.map((push) => push.requestId)).size, 1)
  assert.equal(tts.appendCalls.length >= 3, true, 'each sentence was scheduled for playback')
  assert.deepEqual(harness.playbackFailures, [])
  assert.equal(harness.busEvents.includes('tts:error'), false)
  assert.equal(harness.busEvents.filter((type) => type === 'tts:started').length, 1)
  assert.equal(harness.busEvents.filter((type) => type === 'tts:completed').length, 1)

  // The reply's stage direction became exactly one performance cue, queued
  // once after the message committed.
  const cueNotifications = harness.notifications.filter(
    (notification): notification is Extract<PetNotification, { kind: 'queue-cue' }> => (
      notification.kind === 'queue-cue'
    ),
  )
  assert.equal(cueNotifications.length, 1)
  assert.equal(cueNotifications[0]!.cues.length, 1)
  assert.equal(cueNotifications[0]!.cues[0]!.expressionSlot, 'happy')
  assert.match(cueNotifications[0]!.cues[0]!.stageDirection, /眼睛亮了/)

  // Clear → thinking → status; happy while speaking; idle on completion; the
  // cue queue and the settled reply mood follow. No notification is lost or
  // reordered by streaming continuation.
  assert.deepEqual(harness.notifications, [
    { kind: 'clear-cue' },
    { kind: 'mood', mood: 'thinking' },
    { kind: 'status', text: t('chat.turn.text_status') },
    { kind: 'mood', mood: 'happy' },
    { kind: 'mood', mood: 'idle' },
    { kind: 'queue-cue', cues: cueNotifications[0]!.cues },
    { kind: 'mood', mood: 'idle' },
  ])
})
