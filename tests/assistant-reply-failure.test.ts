import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'

import { createAssistantReplyRunner } from '../src/hooks/chat/assistantReply.ts'
import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { AppSettings } from '../src/types/app.ts'
import type { ChatMessage } from '../src/types/chat.ts'

// Covers the catch-block wiring in createAssistantReplyRunner: the
// user-facing surfaces (error banner, failure bubble, system message) must
// receive the humanized message, while the diagnostic surfaces (voice trace,
// bus abort reason) keep the raw provider text. The humanizeError mapping
// itself is covered in humanize-error.test.ts — this file pins which surface
// gets which variant, the part a revert of the wiring would silently undo.

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
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: new MemoryStorage(),
      setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
        setTimeout(handler as () => void, timeout, ...args) as unknown as number
      ),
      clearTimeout: (id?: number) => clearTimeout(id as unknown as NodeJS.Timeout),
      addEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  })
})

const RAW_PROVIDER_ERROR = '模型请求失败（状态码：429）'

type RecordedCalls = {
  setError: Array<string | null>
  bubbles: string[]
  systemMessages: Array<{ content: string; tone?: string }>
  voiceTraces: Array<{ label: string; detail: string; tone: string }>
  voicePipeline: Array<{ stage: string; status: string }>
  busEvents: Array<Record<string, unknown>>
}

function createFailingRunner(failure: Error) {
  const calls: RecordedCalls = {
    setError: [],
    bubbles: [],
    systemMessages: [],
    voiceTraces: [],
    voicePipeline: [],
    busEvents: [],
  }

  const ctx = {
    loadDesktopContextSnapshot: async () => null,
    suppressVoiceReplyRef: { current: false },
    beginStreamingSpeechReply: () => null,
    setMood: () => {},
    busEmit: (event: Record<string, unknown>) => { calls.busEvents.push(event) },
    updateVoicePipeline: (stage: string, status: string) => { calls.voicePipeline.push({ stage, status }) },
    appendVoiceTrace: (label: string, detail: string, tone: string) => { calls.voiceTraces.push({ label, detail, tone }) },
    clearPendingVoiceRestart: () => {},
    resetNoSpeechRestartCount: () => {},
    updatePetStatus: () => {},
    appendDailyMemoryEntries: () => {},
    appendDebugConsoleEvent: () => {},
    queuePetPerformanceCue: () => {},
    settingsRef: { current: null },
    setSettings: () => {},
    updateVoicePipelineStage: () => {},
    speakAssistantReply: async () => {},
  }

  const runner = createAssistantReplyRunner({
    ctx,
    appendChatMessage: () => {},
    appendSystemMessage: (content: string, tone?: string) => { calls.systemMessages.push({ content, tone }) },
    presentPetDialogBubble: (bubble: { content: string }) => { calls.bubbles.push(bubble.content) },
    handleSpeechPlaybackFailure: () => {},
    setError: (error: string | null) => { calls.setError.push(error) },
    setActiveStreamAbort: () => {},
    requestStreaming: () => Promise.reject(failure),
  } as unknown as Parameters<typeof createAssistantReplyRunner>[0])

  return { runner, calls }
}

function makeOptions(fromVoice: boolean) {
  const settings: AppSettings = {
    ...loadSettings(),
    speechOutputEnabled: false,
    chatFailoverEnabled: false,
  }
  const nextMessages: ChatMessage[] = [{
    id: 'user-1',
    role: 'user',
    content: 'hello',
    createdAt: '2026-06-09T12:00:00.000Z',
  }]
  return {
    currentSettings: settings,
    nextMessages,
    nextMemories: [],
    nextDailyMemories: {},
    content: 'hello',
    source: fromVoice ? ('voice' as const) : ('text' as const),
    fromVoice,
    traceId: 'trace-1',
    traceLabel: '1',
    shouldResumeContinuousVoice: false,
    turnId: 1,
    isLatestTurn: () => true,
  }
}

test('text-source failure surfaces humanized advice, keeps raw text on diagnostic surfaces', async () => {
  const { runner, calls } = createFailingRunner(new Error(RAW_PROVIDER_ERROR))

  const result = await runner(makeOptions(false))
  assert.equal(result, false)

  // Error banner: humanized 429 advice, no raw provider text.
  assert.equal(calls.setError.length, 1)
  assert.match(calls.setError[0] ?? '', /(too many|wait|moment)/i)
  assert.doesNotMatch(calls.setError[0] ?? '', /状态码|429/)

  // Failure bubble: humanized as well.
  const bubble = calls.bubbles.at(-1) ?? ''
  assert.match(bubble, /(too many|wait|moment)/i)
  assert.doesNotMatch(bubble, /状态码/)

  // Bus abort reason stays raw — downstream logging depends on it.
  const aborted = calls.busEvents.find((event) => event.type === 'session:aborted')
  assert.ok(aborted)
  assert.equal(aborted.abortReason, RAW_PROVIDER_ERROR)
})

test('voice-source failure humanizes the system message and status, keeps the voice trace raw', async () => {
  const { runner, calls } = createFailingRunner(new Error(RAW_PROVIDER_ERROR))

  const result = await runner(makeOptions(true))
  assert.equal(result, false)

  // System message in the chat: humanized.
  assert.equal(calls.systemMessages.length, 1)
  assert.match(calls.systemMessages[0].content, /(too many|wait|moment)/i)
  assert.doesNotMatch(calls.systemMessages[0].content, /状态码/)
  assert.equal(calls.systemMessages[0].tone, 'error')

  // Voice pipeline status: humanized preview.
  const failedStage = calls.voicePipeline.find((entry) => entry.stage === 'reply_failed')
  assert.ok(failedStage)
  assert.doesNotMatch(failedStage.status, /状态码/)

  // Voice trace is a diagnostic surface — it intentionally keeps raw text.
  assert.equal(calls.voiceTraces.length, 1)
  assert.equal(calls.voiceTraces[0].tone, 'error')
  assert.match(calls.voiceTraces[0].detail, /状态码：429/)

  // Error banner: voice summary wrapping the humanized message.
  assert.match(calls.setError[0] ?? '', /(too many|wait|moment)/i)
})
