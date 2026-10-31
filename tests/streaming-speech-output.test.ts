import assert from 'node:assert/strict'
import test from 'node:test'

import { createStreamingSpeechOutputController } from '../src/hooks/voice/streamingSpeechOutput.ts'
import { createStreamingSpeechOutputWithFallback } from '../src/hooks/voice/streamingSpeechOutputFallback.ts'
import {
  getMaxSegmentCharsForProvider,
  prefersWholeReplySegments,
  prefersWholeSentenceSegments,
  splitReplyForSingleGeneration,
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

function createHarness(options: {
  failPushForFirstRequest?: boolean
  emitSegmentEvents?: boolean
  sampleCount?: number
} = {}) {
  const pushes: PushRecord[] = []
  const abortCalls: string[] = []
  const startCalls: string[] = []
  const failedRequestIds = new Set<string>()
  const listeners: Array<(event: VoiceStreamEvent) => void> = []

  const emit = (event: VoiceStreamEvent) => {
    for (const listener of [...listeners]) listener(event)
  }

  const emitChunkSoon = (requestId: string, text: string, segmentIndex: number) => {
    setTimeout(() => {
      const sampleCount = options.sampleCount ?? 0
      emit({
        type: 'chunk',
        requestId,
        chunkId: 'chunk-1',
        format: 'f32le',
        sampleRate: 24000,
        channels: 1,
        text,
        segmentIndex,
        samples: Array.from({ length: sampleCount }, () => 0),
        isFinal: false,
      })
      if (options.emitSegmentEvents) {
        emit({
          type: 'segment',
          requestId,
          segmentIndex,
          text,
          durationMs: sampleCount > 0 ? (sampleCount / 24000) * 1000 : 1_000,
        })
      }
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
      const index = pushes.length
      pushes.push({ requestId: payload.requestId, text: payload.text, style: payload.style })
      emitChunkSoon(payload.requestId, payload.text, index)
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

  const appendCalls: Array<{ sampleCount: number; sampleRate: number }> = []
  let stopCalls = 0
  const player = {
    appendPcmChunk: async (samples: Float32Array | number[], sampleRate: number) => {
      appendCalls.push({ sampleCount: samples.length, sampleRate })
      return undefined
    },
    waitForDrain: async () => undefined,
    stopAndClear: () => { stopCalls += 1 },
  }

  return {
    pushes,
    abortCalls,
    startCalls,
    listeners,
    player,
    emit,
    appendCalls,
    get stopCalls() { return stopCalls },
  }
}

// Sentence-chunking behaviour is exercised on a provider that still streams
// one sentence per request. Qwen3 has its own whole-reply contract below.
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

const QWEN3_SETTINGS = {
  ...SETTINGS,
  speechOutputProviderId: 'qwen3-tts-local',
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

test('Qwen3 buffers the whole reply into one generation with one style', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    QWEN3_SETTINGS,
    { getPlayer: () => harness.player as never },
    {
      resolveSegmentVoiceStyle: (text) => ({
        instruction: text.includes('！') ? '兴奋' : '别扭',
        rate: 1,
        pitch: 1,
      }),
    },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('今天天气真好！')
  await ticks()
  // Nothing is synthesized until the whole reply is known.
  assert.equal(harness.pushes.length, 0)

  controller.pushDelta('我才不会这样呢……')
  controller.finish()
  await ticks()

  assert.equal(harness.pushes.length, 1, 'one request for the whole reply')
  assert.equal(harness.pushes[0]!.text, '今天天气真好！我才不会这样呢…')
  // The style is resolved once from the whole reply, not per sentence.
  assert.match(String(harness.pushes[0]!.style?.instruction), /兴奋/)
})

test('Qwen3 speaks pre-tool text before a tool call, then buffers the rest', async () => {
  const harness = createHarness()
  const styleTexts: string[] = []
  const controller = createStreamingSpeechOutputController(
    QWEN3_SETTINGS,
    { getPlayer: () => harness.player as never },
    {
      resolveSegmentVoiceStyle: (text) => {
        styleTexts.push(text)
        return { instruction: 'mild', rate: 1, pitch: 1, speechTempo: 1.4 }
      },
    },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('我先查一下天气。')
  controller.flushPending()
  await ticks()

  // The pre-tool sentence is its own generation, so the user hears it while
  // the tool runs instead of waiting for the whole reply.
  assert.deepEqual(harness.pushes.map((push) => push.text), ['我先查一下天气。'])

  controller.pushDelta('今天很热，记得多喝水。')
  controller.finish()
  await ticks()

  assert.deepEqual(
    harness.pushes.map((push) => push.text),
    ['我先查一下天气。', '今天很热，记得多喝水。'],
  )
  assert.equal(new Set(harness.pushes.map((push) => push.requestId)).size, 1)
  // Both generations reuse the reply's mood/tempo/instruct.
  assert.equal(styleTexts.length, 1)
  for (const push of harness.pushes) {
    assert.equal(push.style?.instruction, 'mild')
    assert.equal(push.style?.speechTempo, 1.4)
  }
})

test('Qwen3 plays the tool-call filler once per burst from a cached generation', async () => {
  const harness = createHarness({ emitSegmentEvents: true, sampleCount: 240 })
  const filler = 'Let me check.'
  const controller = createStreamingSpeechOutputController(
    { ...QWEN3_SETTINGS, speechOutputVoice: 'filler-cache-test' } as AppSettings,
    { getPlayer: () => harness.player as never },
    {
      ti: (key) => (key === 'voice.streaming_tts.tool_call_filler' ? filler : String(key)),
    },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.flushPending()
  await ticks()
  assert.deepEqual(harness.pushes.map((push) => push.text), [filler])

  // A second tool call without new text belongs to the same burst: no repeat.
  controller.flushPending()
  await ticks()
  assert.equal(harness.pushes.length, 1)

  controller.pushDelta('我再看看。')
  controller.flushPending()
  await ticks()
  assert.equal(harness.pushes.length, 2)

  // New text opened a new burst; the filler is now replayed from cache without
  // another push_text / synthesis request.
  const appendsBefore = harness.appendCalls.length
  controller.flushPending()
  await ticks()
  assert.equal(harness.pushes.length, 2, 'cached filler did not hit the provider again')
  assert.ok(harness.appendCalls.length > appendsBefore, 'cached filler was scheduled for playback')

  controller.finish()
  await ticks()
})

test('Qwen3 tool-call filler stays silent when voice output is disabled', async () => {
  const harness = createHarness({ emitSegmentEvents: true, sampleCount: 240 })
  const controller = createStreamingSpeechOutputController(
    { ...QWEN3_SETTINGS, speechOutputEnabled: false } as AppSettings,
    { getPlayer: () => harness.player as never },
    { ti: (key) => String(key) },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.flushPending()
  await ticks()

  assert.deepEqual(harness.pushes, [])
  assert.deepEqual(harness.appendCalls, [])
})

test('Qwen3 starts the stream on the first delta so warm-up overlaps the LLM', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    QWEN3_SETTINGS,
    { getPlayer: () => harness.player as never },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('今天')
  await ticks()

  assert.equal(harness.startCalls.length, 1, 'stream/warm-up starts before finish()')
  assert.equal(harness.pushes.length, 0, 'no synthesis before the whole reply is known')

  controller.finish()
  await ticks()
  assert.equal(harness.pushes.length, 1)
})

test('aborting after an early start but before any segment still aborts the stream', async () => {
  const harness = createHarness()
  const controller = createStreamingSpeechOutputController(
    QWEN3_SETTINGS,
    { getPlayer: () => harness.player as never },
  )
  void controller.waitForCompletion().catch(() => undefined)

  controller.pushDelta('今天')
  await ticks()
  assert.equal(harness.startCalls.length, 1)
  assert.equal(harness.pushes.length, 0)

  controller.abort()
  await ticks()

  assert.deepEqual(harness.abortCalls, [harness.startCalls[0]])
})

test('Qwen3 splits only very long replies, at sentence ends, into a few chunks', async () => {
  assert.equal(prefersWholeReplySegments('qwen3-tts-local'), true)
  assert.equal(prefersWholeReplySegments('openai-tts'), false)

  const longReply = '第一句内容。第二句内容。第三句内容。第四句内容。'.repeat(20)
  const chunks = splitReplyForSingleGeneration(longReply, 400)
  assert.ok(chunks.length > 1 && chunks.length <= 4, `saw ${chunks.length} chunks`)
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 520, `chunk too long: ${chunk.length}`)
    assert.match(chunk, /。$/u)
  }
  assert.equal(chunks.join(''), longReply)
})

test('barge-in during the tool-call filler records no filler text', async () => {
  const harness = createHarness({ emitSegmentEvents: true, sampleCount: 24_000 })
  const filler = 'Let me check.'
  const queued: string[] = []
  const played: string[] = []
  const clock = { value: 0 }
  const controller = createStreamingSpeechOutputController(
    { ...QWEN3_SETTINGS, speechOutputVoice: 'filler-barge-in-test' } as AppSettings,
    { getPlayer: () => harness.player as never, now: () => clock.value },
    {
      ti: (key) => (key === 'voice.streaming_tts.tool_call_filler' ? filler : String(key)),
      onSegmentQueued: (segment) => { queued.push(segment.text) },
      onSegmentPlayed: (segment) => { played.push(segment.text) },
    },
  )
  const completion = controller.waitForCompletion().catch((error: unknown) => error)

  controller.flushPending()
  await ticks()
  assert.deepEqual(harness.pushes.map((push) => push.text), [filler])

  // The user barges in while the cue is playing. It was audible, but it is
  // not reply content and must not enter history or reply callbacks.
  clock.value = 500
  controller.abort()
  await completion

  const snapshot = controller.getInterruption?.()
  assert.equal(snapshot?.heardText, '')
  assert.equal(snapshot?.heardChars, 0)
  assert.equal(snapshot?.fullChars, 0)
  assert.equal(snapshot?.completeSegments, 0)
  assert.deepEqual(queued, [], 'the filler is not reported as queued reply text')
  assert.deepEqual(played, [], 'the filler is not reported as played reply text')
})

test('barge-in after the tool-call filler records only real reply text', async () => {
  const harness = createHarness({ emitSegmentEvents: true, sampleCount: 24_000 })
  const filler = 'Let me check.'
  const queued: string[] = []
  const played: string[] = []
  const clock = { value: 0 }
  const controller = createStreamingSpeechOutputController(
    { ...QWEN3_SETTINGS, speechOutputVoice: 'filler-after-barge-in-test' } as AppSettings,
    { getPlayer: () => harness.player as never, now: () => clock.value },
    {
      ti: (key) => (key === 'voice.streaming_tts.tool_call_filler' ? filler : String(key)),
      onSegmentQueued: (segment) => { queued.push(segment.text) },
      onSegmentPlayed: (segment) => { played.push(segment.text) },
    },
  )
  const completion = controller.waitForCompletion().catch((error: unknown) => error)

  controller.flushPending()
  await ticks()
  assert.deepEqual(harness.pushes.map((push) => push.text), [filler])

  controller.pushDelta('我查到了。')
  controller.flushPending()
  await ticks()
  const realText = harness.pushes[1]!.text
  assert.notEqual(realText, filler)

  // The filler has finished; the barge-in lands during the real reply.
  clock.value = 2_000
  controller.abort()
  await completion

  const snapshot = controller.getInterruption?.()
  assert.equal(snapshot?.heardText, realText)
  assert.equal(snapshot?.heardChars, realText.length)
  assert.equal(snapshot?.fullChars, realText.length)
  assert.equal(snapshot?.completeSegments, 1)
  assert.equal(snapshot?.heardText.includes(filler), false)
  assert.deepEqual(queued, [realText])
  assert.deepEqual(played, [realText])
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
