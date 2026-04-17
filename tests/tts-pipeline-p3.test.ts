import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { TtsStreamEvent } from '../src/types/voice.ts'
import {
  AudioPlayerSink,
  FrameProcessor,
  Pipeline,
  TTSStreamService,
  createEndFrame,
  createInterruptionFrame,
  createStartFrame,
  createTextSentenceFrame,
  type AudioFrame,
  type ErrorFrame,
  type Frame,
  type TtsIpcBridge,
  type TTSStreamServiceSettings,
} from '../src/features/voice/tts-pipeline/index.ts'

class RecordingProcessor extends FrameProcessor {
  public readonly received: Frame[] = []
  override async process(frame: Frame): Promise<void> {
    this.received.push(frame)
    await this.pushDownstream(frame)
  }
}

type IpcCall =
  | { kind: 'start'; payload: Record<string, unknown> }
  | { kind: 'push'; payload: Record<string, unknown> }
  | { kind: 'finish'; payload: Record<string, unknown> }
  | { kind: 'abort'; payload: Record<string, unknown> }

function makeMockIpc(options: { failOn?: IpcCall['kind']; failMessage?: string } = {}) {
  const calls: IpcCall[] = []
  let listener: ((event: TtsStreamEvent) => void) | null = null
  let unsubscribeCalls = 0

  const bridge: TtsIpcBridge = {
    async ttsStreamStart(payload) {
      calls.push({ kind: 'start', payload })
      if (options.failOn === 'start') throw new Error(options.failMessage ?? 'start failed')
    },
    async ttsStreamPushText(payload) {
      calls.push({ kind: 'push', payload })
      if (options.failOn === 'push') throw new Error(options.failMessage ?? 'push failed')
    },
    async ttsStreamFinish(payload) {
      calls.push({ kind: 'finish', payload })
    },
    async ttsStreamAbort(payload) {
      calls.push({ kind: 'abort', payload })
    },
    subscribeTtsStream(cb) {
      listener = cb
      return () => {
        unsubscribeCalls += 1
        listener = null
      }
    },
  }

  return {
    bridge,
    calls,
    getUnsubscribeCalls: () => unsubscribeCalls,
    emit(event: TtsStreamEvent) {
      listener?.(event)
    },
  }
}

const BASE_SETTINGS: TTSStreamServiceSettings = {
  speechOutputProviderId: 'volcengine-tts',
  speechOutputApiBaseUrl: 'https://example.test',
  speechOutputApiKey: 'test-key',
  speechOutputModel: 'volcano_tts',
  speechOutputVoice: 'BV001_streaming',
  speechOutputInstructions: '',
  speechSynthesisLang: 'zh-CN',
  speechRate: 1,
  speechPitch: 1,
  speechVolume: 1,
}

function createService(overrides?: Partial<TTSStreamServiceSettings>, ipc?: ReturnType<typeof makeMockIpc>) {
  const mock = ipc ?? makeMockIpc()
  const service = new TTSStreamService({
    settings: { ...BASE_SETTINGS, ...(overrides ?? {}) },
    ipc: mock.bridge,
    createRequestId: (turnId) => `req-${turnId}`,
  })
  return { service, mock }
}

// ─── Lazy start ───────────────────────────────────────────────────────

test('TTSStreamService does not call ttsStreamStart until the first sentence arrives', async () => {
  const { service, mock } = createService()
  const pipeline = new Pipeline([service])
  await pipeline.push(createStartFrame('t1'))
  assert.deepEqual(mock.calls.map((c) => c.kind), [])
})

test('TTSStreamService starts and pushes text on the first sentence', async () => {
  const { service, mock } = createService()
  const pipeline = new Pipeline([service])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '你好呀。', 0))
  assert.deepEqual(mock.calls.map((c) => c.kind), ['start', 'push'])
  assert.equal((mock.calls[0].payload as { requestId: string }).requestId, 'req-t1')
  assert.equal((mock.calls[1].payload as { text: string }).text, '你好呀。')
})

test('TTSStreamService reuses the session for multiple sentences (one start, many pushes)', async () => {
  const { service, mock } = createService()
  const pipeline = new Pipeline([service])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '你好。', 0))
  await pipeline.push(createTextSentenceFrame('t1', '再见。', 1))
  await pipeline.push(createTextSentenceFrame('t1', '明天见。', 2))
  const kinds = mock.calls.map((c) => c.kind)
  assert.deepEqual(kinds, ['start', 'push', 'push', 'push'])
})

// ─── Lifecycle ────────────────────────────────────────────────────────

test('TTSStreamService calls finish on EndFrame after any push', async () => {
  const { service, mock } = createService()
  const pipeline = new Pipeline([service])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '你好。', 0))
  await pipeline.push(createEndFrame('t1'))
  assert.deepEqual(
    mock.calls.map((c) => c.kind),
    ['start', 'push', 'finish'],
  )
})

test('TTSStreamService skips finish when the turn never produced a sentence', async () => {
  const { service, mock } = createService()
  const pipeline = new Pipeline([service])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createEndFrame('t1'))
  assert.deepEqual(
    mock.calls.map((c) => c.kind),
    [],
    'an empty turn should never open a TTS session',
  )
})

test('TTSStreamService aborts on InterruptionFrame and unsubscribes the listener', async () => {
  const { service, mock } = createService()
  const pipeline = new Pipeline([service])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '一半说完', 0))
  await pipeline.push(createInterruptionFrame('t1', 'user-barge-in'))
  const kinds = mock.calls.map((c) => c.kind)
  assert.deepEqual(kinds, ['start', 'push', 'abort'])
  assert.equal(mock.getUnsubscribeCalls(), 1)
})

test('TTSStreamService.shutdown aborts when a session is in flight', async () => {
  const { service, mock } = createService()
  const pipeline = new Pipeline([service])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '未完成', 0))
  await pipeline.stop()
  assert.equal(mock.calls.filter((c) => c.kind === 'abort').length, 1)
})

test('TTSStreamService resets cleanly on a new StartFrame after an earlier turn', async () => {
  const { service, mock } = createService()
  const pipeline = new Pipeline([service])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '你好。', 0))
  await pipeline.push(createEndFrame('t1'))
  await pipeline.push(createStartFrame('t2'))
  await pipeline.push(createTextSentenceFrame('t2', '嗨。', 0))
  const requestIds = mock.calls
    .filter((c) => c.kind === 'start' || c.kind === 'push')
    .map((c) => (c.payload as { requestId: string }).requestId)
  assert.deepEqual(requestIds, ['req-t1', 'req-t1', 'req-t2', 'req-t2'])
})

// ─── Event plumbing ──────────────────────────────────────────────────

test('chunk events from the IPC become downstream AudioFrames', async () => {
  const { service, mock } = createService()
  const tail = new RecordingProcessor()
  const pipeline = new Pipeline([service, tail])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '你好。', 0))

  mock.emit({
    type: 'chunk',
    requestId: 'req-t1',
    chunkId: 'c0',
    format: 'f32le',
    sampleRate: 24000,
    channels: 1,
    isFinal: false,
    samples: [0.1, -0.2, 0.3, -0.4],
  })

  const audioFrames = tail.received.filter((f): f is AudioFrame => f.type === 'audio')
  assert.equal(audioFrames.length, 1)
  assert.ok(audioFrames[0].samples instanceof Float32Array)
  assert.equal(audioFrames[0].samples.length, 4)
  assert.equal(audioFrames[0].sampleRate, 24000)
  assert.equal(audioFrames[0].turnId, 't1')
})

test('chunk events for a mismatching requestId are ignored', async () => {
  const { service, mock } = createService()
  const tail = new RecordingProcessor()
  const pipeline = new Pipeline([service, tail])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '你好。', 0))

  mock.emit({
    type: 'chunk',
    requestId: 'wrong-id',
    chunkId: 'c0',
    format: 'f32le',
    sampleRate: 24000,
    channels: 1,
    isFinal: false,
    samples: [0.1],
  })

  const audioFrames = tail.received.filter((f) => f.type === 'audio')
  assert.equal(audioFrames.length, 0)
})

test('error events from the IPC become downstream ErrorFrames', async () => {
  const { service, mock } = createService()
  const tail = new RecordingProcessor()
  const pipeline = new Pipeline([service, tail])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '你好。', 0))

  mock.emit({
    type: 'error',
    requestId: 'req-t1',
    message: 'remote exploded',
  })

  const errorFrames = tail.received.filter((f): f is ErrorFrame => f.type === 'error')
  assert.equal(errorFrames.length, 1)
  assert.equal(errorFrames[0].message, 'remote exploded')
})

// ─── Error tolerance ──────────────────────────────────────────────────

test('ttsStreamStart failure surfaces as an ErrorFrame without throwing', async () => {
  const mock = makeMockIpc({ failOn: 'start', failMessage: 'no credentials' })
  const { service } = createService({}, mock)
  const tail = new RecordingProcessor()
  const pipeline = new Pipeline([service, tail])
  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '你好。', 0))

  const errorFrames = tail.received.filter((f): f is ErrorFrame => f.type === 'error')
  assert.equal(errorFrames.length, 1)
  assert.match(errorFrames[0].message, /no credentials/u)
})

// ─── End-to-end wiring with AudioPlayerSink ──────────────────────────

test('end-to-end: service → sink routes chunks to the player', async () => {
  const { service, mock } = createService()
  const playerCalls: Array<['append', number] | ['stop']> = []
  const fakePlayer = {
    appendPcmChunk(samples: Float32Array) {
      playerCalls.push(['append', samples.length])
    },
    stopAndClear() {
      playerCalls.push(['stop'])
    },
  }
  const sink = new AudioPlayerSink({ getPlayer: () => fakePlayer as never })
  const pipeline = new Pipeline([service, sink])

  await pipeline.push(createStartFrame('t1'))
  await pipeline.push(createTextSentenceFrame('t1', '第一句。', 0))
  mock.emit({
    type: 'chunk',
    requestId: 'req-t1',
    chunkId: 'c0',
    format: 'f32le',
    sampleRate: 24000,
    channels: 1,
    isFinal: false,
    samples: new Array(1024).fill(0.05),
  })
  await pipeline.push(createInterruptionFrame('t1', 'user-barge-in'))

  assert.deepEqual(
    playerCalls,
    [['append', 1024], ['stop']],
    'chunk must append then interruption must stop',
  )
})
