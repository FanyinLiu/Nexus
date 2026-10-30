import assert from 'node:assert/strict'
import test from 'node:test'

import { createStreamingSpeechOutputController } from '../src/hooks/voice/streamingSpeechOutput.ts'
import { createStreamingSpeechOutputWithFallback } from '../src/hooks/voice/streamingSpeechOutputFallback.ts'
import {
  getMaxSegmentCharsForProvider,
  prefersWholeSentenceSegments,
} from '../src/hooks/voice/speechTextSegmentation.ts'
import { measureSegmentWeight, StreamingTtsChunker } from '../src/features/voice/streamingTts.ts'
import type { SegmentVoiceStyle, VoiceStreamEvent } from '../src/types/index.ts'
import type { AppSettings } from '../src/types/index.ts'

type PushRecord = {
  requestId: string
  text: string
  style?: SegmentVoiceStyle
}

type DesktopPetStub = {
  ttsStreamStart: (payload: { requestId: string }) => Promise<{ ok: boolean }>
  ttsStreamPushText: (payload: PushRecord) => Promise<{ ok: boolean }>
  ttsStreamFinish: (payload: { requestId: string }) => Promise<{ ok: boolean }>
  ttsStreamAbort: (payload: { requestId: string }) => Promise<{ ok: boolean }>
  subscribeTtsStream: (listener: (event: VoiceStreamEvent) => void) => () => void
}

function createHarness(options: { failPushForFirstRequest?: boolean } = {}) {
  const pushes: PushRecord[] = []
  const abortCalls: string[] = []
  const startCalls: string[] = []
  const failedRequestIds = new Set<string>()
  const listeners: Array<(event: VoiceStreamEvent) => void> = []

  const emit = (event: VoiceStreamEvent) => {
    for (const listener of [...listeners]) listener(event)
  }

  const emitChunkSoon = (requestId: string) => {
    setTimeout(() => {
      emit({
        type: 'chunk',
        requestId,
        chunkId: 'chunk-1',
        format: 'f32le',
        sampleRate: 24000,
        channels: 1,
        samples: [],
        isFinal: false,
      })
    }, 0)
  }

  const desktopPet: DesktopPetStub = {
    ttsStreamStart: async (payload) => {
      startCalls.push(payload.requestId)
      if (options.failPushForFirstRequest && startCalls.length === 1) {
        failedRequestIds.add(payload.requestId)
      }
      return { ok: true }
    },
    ttsStreamPushText: async (payload) => {
      if (failedRequestIds.has(payload.requestId)) {
        throw new Error('primary provider unavailable')
      }
      pushes.push({ requestId: payload.requestId, text: payload.text, style: payload.style })
      emitChunkSoon(payload.requestId)
      return { ok: true }
    },
    ttsStreamFinish: async (payload) => {
      setTimeout(() => emit({ type: 'end', requestId: payload.requestId }), 0)
      return { ok: true }
    },
    ttsStreamAbort: async (payload) => {
      abortCalls.push(payload.requestId)
      return { ok: true }
    },
    subscribeTtsStream: (listener) => {
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
      desktopPet,
      // Storage/metering helpers touch these globals; keep the test output
      // focused on the controller instead of "window is not a browser" noise.
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
  })

  const player = {
    appendPcmChunk: async () => undefined,
    waitForDrain: async () => undefined,
    stopAndClear: () => undefined,
  }

  return { pushes, abortCalls, startCalls, listeners, player, emit }
}

const SETTINGS = {
  speechOutputProviderId: 'qwen3-tts-local',
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

const ticks = async (count = 4) => {
  for (let index = 0; index < count; index += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

test('first-fragment weight separates "嗯，" from a real sentence', () => {
  assert.ok(measureSegmentWeight('嗯，') < 6)
  assert.ok(measureSegmentWeight('今天天气挺好的。') >= 6)
  assert.ok(measureSegmentWeight('Hi.') < 6)
  assert.ok(measureSegmentWeight('The weather is nice today.') >= 6)
})

test('English sentence periods split mid-stream, decimals do not', () => {
  const english = new StreamingTtsChunker()
  assert.deepEqual(english.pushText('Hi there, you are back.'), [])
  assert.deepEqual(english.pushText(' I was just'), ['Hi there, you are back.'])
  assert.deepEqual(english.flush(), ['I was just'])

  const decimal = new StreamingTtsChunker()
  assert.deepEqual(decimal.pushText('Pi is 3.14'), [])
  assert.deepEqual(decimal.flush(), ['Pi is 3.14'])
})

test('per-provider chunk ceilings never exceed the request caps', () => {
  assert.equal(getMaxSegmentCharsForProvider('volcengine-tts'), 120)
  assert.equal(getMaxSegmentCharsForProvider('minimax-tts'), 120)
  assert.equal(getMaxSegmentCharsForProvider('omnivoice-tts'), 80)
  assert.equal(getMaxSegmentCharsForProvider('qwen3-tts-local'), 72)
  assert.equal(prefersWholeSentenceSegments('volcengine-tts'), true)
  assert.equal(prefersWholeSentenceSegments('minimax-tts'), true)
  assert.equal(prefersWholeSentenceSegments('qwen3-tts-local'), false)
})

test('queues the first sentence while the model is still streaming', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    SETTINGS,
    { getPlayer: () => harness.player as never },
  )
  void controller.waitForCompletion().catch(() => undefined)

  const reply = '好呀，今天天气挺好的，要不要一起出去走走？我刚刚看到…'
  for (const char of reply) {
    controller.pushDelta(char)
  }

  await ticks()
  assert.equal(harness.pushes.length, 1, 'first sentence is queued before finish()')
  assert.equal(harness.pushes[0]!.text, '好呀，今天天气挺好的，要不要一起出去走走？')

  controller.finish()
  await ticks()

  assert.deepEqual(
    harness.pushes.map((push) => push.text),
    ['好呀，今天天气挺好的，要不要一起出去走走？', '我刚刚看到…'],
  )
  assert.equal(new Set(harness.pushes.map((push) => push.requestId)).size, 1)
  assert.equal(harness.startCalls.length, 1)
})

test('a too-short first fragment waits for the next sentence', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    SETTINGS,
    { getPlayer: () => harness.player as never },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('嗯。')
  await ticks()
  assert.equal(harness.pushes.length, 0, 'a 1.5-weight fragment alone is not worth a request')

  controller.pushDelta('今天天气挺好的。')
  await ticks()
  assert.deepEqual(
    harness.pushes.map((push) => push.text),
    ['嗯。今天天气挺好的。'],
  )
  controller.finish()
  await ticks()
})

test('a short reply is still spoken when the stream ends', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    SETTINGS,
    { getPlayer: () => harness.player as never },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('嗯。')
  controller.finish()
  await ticks()

  assert.deepEqual(harness.pushes.map((push) => push.text), ['嗯。'])
})

test('segments keep the order the model produced them in', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    SETTINGS,
    { getPlayer: () => harness.player as never },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('今天天气真不错。明天也许会更好。我们一起出去走走吧。')
  controller.finish()
  await ticks()

  assert.deepEqual(
    harness.pushes.map((push) => push.text),
    ['今天天气真不错。', '明天也许会更好。', '我们一起出去走走吧。'],
  )
})

test('each sentence still carries its own T6 style', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    SETTINGS,
    { getPlayer: () => harness.player as never },
    {
      resolveSegmentVoiceStyle: (text) => ({
        instruction: text.includes('！') ? '兴奋' : '别扭',
        rate: text.includes('！') ? 1.2 : 0.9,
        pitch: 1,
      }),
    },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('今天天气真好！')
  await ticks()
  controller.pushDelta('我才不会这样呢……')
  controller.finish()
  await ticks()

  assert.equal(harness.pushes.length, 2)
  assert.match(String(harness.pushes[0]!.style?.instruction), /兴奋/)
  assert.ok((harness.pushes[0]!.style?.rate ?? 1) > 1)
  assert.match(String(harness.pushes[1]!.style?.instruction), /别扭/)
  assert.ok((harness.pushes[1]!.style?.rate ?? 1) < 1)
})

test('abort mid-stream sends exactly one ttsStreamAbort', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    SETTINGS,
    { getPlayer: () => harness.player as never },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('今天天气真不错。')
  await ticks()
  assert.equal(harness.startCalls.length, 1)

  controller.abort()
  controller.abort()
  await ticks()

  assert.deepEqual(harness.abortCalls, [harness.startCalls[0]])
  assert.equal(harness.abortCalls.length, 1)
})

test('a primary that fails before audio hands the remaining segments to the fallback in order', async () => {
  const harness = createHarness({ failPushForFirstRequest: true })

  let fallbackNotices = 0
  const controller = createStreamingSpeechOutputWithFallback({
    primarySettings: SETTINGS,
    fallbackSettings: { ...SETTINGS, speechOutputProviderId: 'edge-tts' } as AppSettings,
    runtime: { getPlayer: () => harness.player as never },
    onFallback: () => { fallbackNotices += 1 },
  })
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('今天天气真不错。明天也许会更好。我们一起出去走走吧。')
  await ticks(8)

  assert.equal(fallbackNotices, 1)
  assert.deepEqual(
    harness.pushes.map((push) => push.text),
    ['今天天气真不错。', '明天也许会更好。', '我们一起出去走走吧。'],
  )
  assert.equal(new Set(harness.pushes.map((push) => push.requestId)).size, 1)
  controller.abort()
})
