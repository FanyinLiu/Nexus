import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'

import { createAssistantReplyRunner } from '../src/hooks/chat/assistantReply.ts'
import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { AppSettings } from '../src/types/app.ts'
import type { ChatMessage } from '../src/types/chat.ts'

// The reply path decides the face the pet wears. A sad reply must not leave
// a smiling pet, and a plain reply must not be turned into a happy one —
// the mood comes from the reply, not from a fixed default.

const SMILING = new Set(['happy', 'excited', 'playful', 'proud'])

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

type SpeechPath = 'off' | 'direct' | 'streaming'

function createRunner(replyContent: string, speech: SpeechPath = 'off') {
  const moods: string[] = []
  let resolveStream = () => {}
  const streamDone = new Promise<void>((resolve) => { resolveStream = resolve })
  let streamStarted = false
  const streamingController = {
    pushDelta() { streamStarted = true },
    flushPending() {},
    finish() {
      streamStarted = true
      resolveStream()
    },
    waitForCompletion() {
      return streamDone.then(() => { moods.push('idle') })
    },
    hasStarted() { return streamStarted },
    abort() { resolveStream() },
  }
  const ctx = {
    loadDesktopContextSnapshot: async () => null,
    suppressVoiceReplyRef: { current: false },
    beginStreamingSpeechReply: () => (speech === 'streaming' ? streamingController : null),
    setMood: (mood: string) => { moods.push(mood) },
    busEmit: () => {},
    updateVoicePipeline: () => {},
    appendVoiceTrace: () => {},
    clearPendingVoiceRestart: () => {},
    resetNoSpeechRestartCount: () => {},
    updatePetStatus: () => {},
    appendDailyMemoryEntries: () => {},
    appendDebugConsoleEvent: () => {},
    queuePetPerformanceCue: () => {},
    onAssistantReplyDelivered: () => {},
    settingsRef: { current: null },
    setSettings: () => {},
    speakAssistantReply: async () => {
      // The voice bus forces a smile while audio plays, then idle when it ends.
      if (speech === 'direct') {
        moods.push('happy')
        moods.push('idle')
      }
    },
  }

  const runner = createAssistantReplyRunner({
    ctx,
    appendChatMessage: () => {},
    appendSystemMessage: () => {},
    presentPetDialogBubble: () => {},
    handleSpeechPlaybackFailure: () => {},
    setError: () => {},
    setActiveStreamAbort: () => {},
    requestStreaming: () => Promise.resolve({
      providerId: 'ollama',
      response: { content: replyContent },
      usedFallback: false,
    }),
  } as unknown as Parameters<typeof createAssistantReplyRunner>[0])

  return { runner, moods }
}

function makeOptions(speech: SpeechPath = 'off') {
  const currentSettings: AppSettings = {
    ...loadSettings(),
    speechOutputEnabled: speech !== 'off',
    chatFailoverEnabled: false,
  }
  const nextMessages: ChatMessage[] = [{
    id: 'user-1',
    role: 'user',
    content: 'hello',
    createdAt: '2026-06-09T12:00:00.000Z',
  }]
  return {
    currentSettings,
    nextMessages,
    nextMemories: [],
    nextDailyMemories: {},
    content: 'hello',
    source: 'text' as const,
    fromVoice: false,
    traceId: 'trace-1',
    traceLabel: '1',
    shouldResumeContinuousVoice: false,
    turnId: 1,
    isLatestTurn: () => true,
  }
}

async function runReply(replyContent: string, speech: SpeechPath = 'off') {
  const { runner, moods } = createRunner(replyContent, speech)
  const result = await runner(makeOptions(speech))
  // The reply mood is applied on a later turn so it wins over tts:completed.
  // Streaming playback schedules that turn from a microtask, so wait twice.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { result, moods }
}

test('a sad reply does not leave the pet with a happy face', async () => {
  const { result, moods } = await runReply("I'm sorry you're going through this. That sounds really hard.")

  assert.equal(result, true)
  assert.equal(moods.length, 1)
  assert.equal(SMILING.has(moods[0]), false, moods[0])
})

test('a plain reply does not force a happy face', async () => {
  const { result, moods } = await runReply('The file is saved.')

  assert.equal(result, true)
  assert.equal(moods.length, 1)
  assert.equal(moods[0], 'idle')
})

test('a reply that reads a happy user keeps a smiling face', async () => {
  const { result, moods } = await runReply('Nice to see you! [mood:happy]')

  assert.equal(result, true)
  assert.equal(moods.length, 1)
  assert.equal(SMILING.has(moods[0]), true, moods[0])
})

test('spoken replies wear the reply mood after playback resets the face', async () => {
  const sad = await runReply("I'm sorry you're going through this. That sounds really hard.", 'direct')
  assert.equal(sad.result, true)
  assert.deepEqual(sad.moods, ['happy', 'idle', 'worried'])

  const polite = await runReply("I'm sorry, I can't find that file.", 'direct')
  assert.equal(polite.result, true)
  assert.deepEqual(polite.moods, ['happy', 'idle', 'idle'])

  const cheerful = await runReply('Nice to see you! [mood:happy]', 'direct')
  assert.equal(cheerful.result, true)
  assert.equal(SMILING.has(cheerful.moods.at(-1) ?? ''), true, cheerful.moods.join(','))
  assert.notEqual(cheerful.moods.at(-1), 'idle')
})

test('streaming speech applies the reply mood after playback ends', async () => {
  const { result, moods } = await runReply(
    "I'm sorry you're going through this. That sounds really hard.",
    'streaming',
  )

  assert.equal(result, true)
  assert.equal(moods.at(-1), 'worried', moods.join(','))
  assert.equal(moods.includes('idle'), true)
})
