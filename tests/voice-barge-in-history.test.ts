import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'

import { createAssistantReplyRunner } from '../src/hooks/chat/assistantReply.ts'
import { createStreamingSpeechOutputController } from '../src/hooks/voice/streamingSpeechOutput.ts'
import { interruptSpeakingForVoiceInputRuntime } from '../src/hooks/voice/runtimeSupport.ts'
import {
  cutTextAtNaturalBoundary,
  resolveHeardSpeech,
  type HeardSpeechSegment,
} from '../src/features/voice/heardSpeech.ts'
import { InterruptedError, isInterruptedError } from '../src/features/voice/interruptedError.ts'
import { buildChatRequestPayload } from '../src/features/chat/systemPromptBuilder.ts'
import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { AppSettings } from '../src/types/app.ts'
import type { ChatMessage } from '../src/types/chat.ts'
import type { TtsStreamEvent } from '../src/types/voice.ts'
import type { MemoryRecallContext } from '../src/types/memory.ts'

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
    value: {
      localStorage,
      setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
        setTimeout(handler as () => void, timeout, ...args) as unknown as number
      ),
      clearTimeout: (id?: number) => clearTimeout(id as unknown as NodeJS.Timeout),
      addEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
    writable: true,
  })
})

const segments: HeardSpeechSegment[] = [
  { index: 0, text: 'First sentence. ', durationMs: 1_000, startedAtMs: 0 },
  { index: 1, text: 'Second half here. ', durationMs: 1_000, startedAtMs: 1_000 },
  { index: 2, text: 'Third sentence.', durationMs: 1_000, startedAtMs: 2_000 },
]

test('heard text keeps full segments plus the proportional head of the playing one', () => {
  const snapshot = resolveHeardSpeech(segments, 1_500)

  assert.equal(snapshot.completeSegments, 1)
  assert.equal(snapshot.heardText, 'First sentence. Second')
  assert.equal(snapshot.heardChars, 'First sentence. Second'.length)
  assert.equal(snapshot.fullChars, segments.reduce((sum, segment) => sum + segment.text.length, 0))
  // The cut never lands mid-word: it backs up to the space after "Second".
  assert.equal(cutTextAtNaturalBoundary('Second half here. ', 0.5), 'Second')
})

test('sentence progress keeps whole sentences and only a mostly-played partial', () => {
  const sentenceSegments: HeardSpeechSegment[] = [{
    index: 0,
    text: '第一句。第二句。第三句。',
    durationMs: 3_000,
    startedAtMs: 0,
    sentenceProgress: [
      { charEnd: 4, endMs: 1_000 },
      { charEnd: 8, endMs: 2_000 },
      { charEnd: 12, endMs: 3_000 },
    ],
  }]

  // 50% through the second sentence: only the fully played first survives.
  assert.equal(resolveHeardSpeech(sentenceSegments, 1_500).heardText, '第一句。')
  // 70% through the third sentence: it is counted as heard, in full.
  assert.equal(resolveHeardSpeech(sentenceSegments, 2_700).heardText, '第一句。第二句。第三句。')
  // 60% is not "more than 60%".
  assert.equal(resolveHeardSpeech(sentenceSegments, 1_600).heardText, '第一句。')
})

function installTtsHarness() {
  const pushes: Array<{ requestId: string; text: string }> = []
  const listeners: Array<(event: TtsStreamEvent) => void> = []
  const started: string[] = []
  let clock = 0
  const durations = [1_000, 1_000, 1_000]
  const starts = [0, 1_000, 2_000]

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
          samples: Array.from({ length: durations[index] ?? 1_000 }, () => 0),
        })
      }, 0)
      return { ok: true }
    },
    ttsStreamFinish: async () => ({ ok: true }),
    ttsStreamAbort: async (payload: { requestId: string }) => {
      started.push(payload.requestId)
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
    value: {
      ...globalThis.window,
      desktopPet,
    },
  })

  const errors: string[] = []
  let appendCall = 0
  const player = {
    appendPcmChunk: async () => {
      const startedAtMs = starts[appendCall] ?? 0
      appendCall += 1
      return { startedAtMs, durationMs: durations[0] ?? 1_000 }
    },
    waitForDrain: async () => undefined,
    stopAndClear: () => undefined,
  }

  return {
    pushes,
    errors,
    setClock: (value: number) => { clock = value },
    now: () => clock,
    player,
    abortCalls: started,
  }
}

const SETTINGS = {
  ...loadSettings(),
  speechOutputEnabled: true,
  speechOutputProviderId: 'edge-tts',
  speechOutputApiBaseUrl: '',
  speechOutputApiKey: '',
  speechOutputModel: '',
  speechOutputVoice: 'en',
  speechOutputInstructions: '',
  speechSynthesisLang: 'en-US',
  speechRate: 1,
  speechPitch: 1,
  speechVolume: 1,
} as AppSettings

const ticks = async (count = 6) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

test('a barge-in during the second sentence exposes only the heard prefix', async () => {
  const harness = installTtsHarness()
  const controller = createStreamingSpeechOutputController(
    SETTINGS,
    { getPlayer: () => harness.player as never, now: harness.now },
    { onError: (message) => harness.errors.push(message) },
  )
  const completion = controller.waitForCompletion().catch((error: unknown) => error)

  controller.pushDelta('First sentence. Second half here. Third sentence.')
  controller.flushPending()
  await ticks()
  assert.equal(harness.pushes.length, 3)

  harness.setClock(1_500)
  controller.abort()
  const rejection = await completion

  assert.equal(isInterruptedError(rejection), true)
  assert.equal(controller.wasInterrupted?.(), true)
  const snapshot = controller.getInterruption?.()
  assert.equal(snapshot?.heardText, 'First sentence.Second')
  assert.equal(snapshot?.completeSegments, 1)
  assert.deepEqual(harness.errors, [], 'a barge-in never surfaces a playback error')
  assert.equal(harness.abortCalls.length, 1)
})

test('aborting a reply while it is still thinking keeps its audio unplayed', async () => {
  const harness = installTtsHarness()
  const controller = createStreamingSpeechOutputController(
    SETTINGS,
    { getPlayer: () => harness.player as never, now: harness.now },
    { onError: (message) => harness.errors.push(message) },
  )
  const completion = controller.waitForCompletion().catch((error: unknown) => error)

  // No chunk has started: the user opened a new voice turn while she was
  // still thinking. The stale reply must never reach the speaker.
  controller.abort()
  controller.pushDelta('A stale reply that must stay silent.')
  controller.finish()
  await ticks()
  const rejection = await completion

  assert.equal(isInterruptedError(rejection), true)
  assert.deepEqual(harness.pushes, [])
  assert.deepEqual(harness.errors, [])
})

test('a new voice turn aborts a pending reply without opening the microphone', () => {
  let abortCount = 0
  let stopCount = 0

  const result = interruptSpeakingForVoiceInputRuntime({
    voiceStateRef: { current: 'processing' },
    canInterruptSpeech: () => true,
    showPetStatus: () => {},
    stopActiveSpeechOutput: () => { stopCount += 1 },
    abortPendingSpeechOutput: () => { abortCount += 1 },
    dispatchVoiceSessionAndSync: () => ({}) as never,
    voiceEchoCooldownUntilRef: { current: 0 },
    ti: (key) => String(key),
  })

  assert.equal(result, true)
  assert.equal(abortCount, 1)
  assert.equal(stopCount, 0)
})

function emptyMemoryContext(): MemoryRecallContext {
  return {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed: 'keyword',
    vectorSearchAvailable: false,
    recalledLongTermIds: [],
  }
}

test('an interrupted reply stores heard text and the next prompt carries the hidden hint', async () => {
  const interruption = resolveHeardSpeech(segments, 1_500)
  const appended: ChatMessage[] = []
  const dailyEntries: Array<{ content: string }> = []
  const setErrors: Array<string | null> = []
  const busEvents: Array<{ type: string }> = []
  let playbackFailures = 0

  const controller = {
    pushDelta() {},
    flushPending() {},
    finish() {},
    waitForCompletion: () => Promise.reject(new InterruptedError()),
    hasStarted: () => true,
    abort() {},
    wasInterrupted: () => true,
    getInterruption: () => interruption,
  }

  const runner = createAssistantReplyRunner({
    ctx: {
      loadDesktopContextSnapshot: async () => null,
      suppressVoiceReplyRef: { current: false },
      beginStreamingSpeechReply: () => controller,
      busEmit: (event: { type: string }) => { busEvents.push(event) },
      updateVoicePipeline: () => {},
      appendVoiceTrace: () => {},
      clearPendingVoiceRestart: () => {},
      resetNoSpeechRestartCount: () => {},
      appendDailyMemoryEntries: (entries: Array<{ content: string }>) => { dailyEntries.push(...entries) },
      appendDebugConsoleEvent: () => {},
      onAssistantReplyDelivered: () => {},
      commitOnThisDayPromptText: () => {},
      settingsRef: { current: null },
      setSettings: () => {},
      speakAssistantReply: async () => {},
    },
    appendChatMessage: (message: ChatMessage) => { appended.push(message) },
    appendSystemMessage: () => {},
    presentPetDialogBubble: () => {},
    handleSpeechPlaybackFailure: () => { playbackFailures += 1 },
    setError: (value: string | null) => { setErrors.push(value) },
    setActiveStreamAbort: () => {},
    requestStreaming: () => Promise.resolve({
      providerId: 'ollama',
      response: { content: 'First sentence. Second half here. Third sentence.' },
      usedFallback: false,
    }),
  } as unknown as Parameters<typeof createAssistantReplyRunner>[0])

  const nextMessages: ChatMessage[] = [{
    id: 'user-1',
    role: 'user',
    content: 'tell me something',
    createdAt: '2026-10-30T12:00:00.000Z',
  }]
  const result = await runner({
    currentSettings: { ...SETTINGS, chatFailoverEnabled: false },
    nextMessages,
    nextMemories: [],
    nextDailyMemories: {},
    content: 'tell me something',
    source: 'voice',
    fromVoice: true,
    traceId: 'trace-1',
    traceLabel: '1',
    shouldResumeContinuousVoice: false,
    turnId: 1,
    isLatestTurn: () => true,
  })
  await ticks(2)

  assert.equal(result, true)
  assert.equal(appended.length, 1)
  assert.equal(appended[0]!.content, interruption.heardText.trimEnd())
  assert.deepEqual(appended[0]!.interrupted, {
    heardChars: interruption.heardChars,
    fullChars: interruption.fullChars,
  })
  assert.equal(appended[0]!.runStatus, 'interrupted')
  assert.equal(setErrors.length, 0)
  assert.equal(playbackFailures, 0)
  assert.equal(busEvents.some((event) => event.type === 'tts:error'), false)
  assert.equal(dailyEntries.length, 1)
  assert.equal(dailyEntries[0]!.content, interruption.heardText.trimEnd())

  const prompt = await buildChatRequestPayload(
    { ...SETTINGS, uiLanguage: 'en-US' },
    [...nextMessages, ...appended],
    emptyMemoryContext(),
    {},
  )
  const assistantPrompt = prompt.messages.findLast((message) => message.role === 'assistant')
  assert.ok(assistantPrompt)
  assert.match(String(assistantPrompt.content), /interrupted you here/i)
  assert.match(String(assistantPrompt.content), /First sentence\. Second/)
})
