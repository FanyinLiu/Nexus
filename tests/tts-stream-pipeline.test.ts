import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import { createTtsStreamService } from '../electron/ttsStreamService.js'
import {
  computeTtsStageDurations,
  createTtsTimingMarks,
} from '../electron/services/ttsStreamTiming.js'

type StreamEvent = {
  type: string
  requestId: string
  text?: string
  message?: string
  stages?: Record<string, number | null>
  firstSegmentChars?: number | null
}

function createSender() {
  const events: StreamEvent[] = []
  return {
    events,
    isDestroyed: () => false,
    send: (_channel: string, event: StreamEvent) => { events.push(event) },
    once: () => undefined,
    removeListener: () => undefined,
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function pacedPcmStream(byteLength = 2048, gapMs = 25) {
  let pushed = 0
  return new Readable({
    read() {
      if (pushed > 0) return
      pushed += 1
      this.push(Buffer.alloc(byteLength))
      setTimeout(() => {
        this.push(Buffer.alloc(byteLength))
        this.push(null)
      }, gapMs)
    },
  })
}

test('the lookahead synthesis starts while the current segment is still emitting', async () => {
  const log: string[] = []
  const sender = createSender()
  const originalSend = sender.send
  sender.send = (channel: string, event: StreamEvent) => {
    if (event.type === 'chunk') log.push(`chunk:${String(event.text)}`)
    originalSend(channel, event)
  }

  const service = createTtsStreamService({
    synthesizeRemote: async (_payload, text: string) => {
      log.push(`synth:start:${text}`)
      log.push(`synth:end:${text}`)
      return { pcmStream: pacedPcmStream(), pcmSampleRate: 24000 }
    },
  })

  const requestId = 'pipeline-order'
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local' })
  service.pushText(sender, { requestId, text: '第一句。' })
  service.pushText(sender, { requestId, text: '第二句。' })
  service.pushText(sender, { requestId, text: '第三句。' })
  await service.finish(sender, { requestId })

  const emittedTexts = [...new Set(
    sender.events.filter((event) => event.type === 'chunk').map((event) => event.text),
  )]
  assert.deepEqual(emittedTexts, ['第一句。', '第二句。', '第三句。'])

  // Interleaved log: the next sentence's synthesis starts BEFORE the current
  // one has finished emitting its PCM. That is the whole point of the
  // one-segment-ahead pipeline; emission itself stays strictly ordered.
  const startSecond = log.indexOf('synth:start:第二句。')
  const lastFirstChunk = log.lastIndexOf('chunk:第一句。')
  assert.ok(startSecond >= 0, 'lookahead synthesis ran')
  assert.ok(
    startSecond < lastFirstChunk,
    'second synthesis starts while the first segment is still emitting',
  )
})

test('abort cancels both the emitting and the lookahead synthesis', async () => {
  const sender = createSender()
  const aborted = new Set<string>()
  let markBothStarted: () => void = () => undefined
  const bothStarted = new Promise<void>((resolve) => { markBothStarted = resolve })
  const started: string[] = []

  const service = createTtsStreamService({
    synthesizeRemote: async (_payload, text: string, signal?: AbortSignal) => {
      started.push(text)
      if (started.length === 2) markBothStarted()
      signal?.addEventListener('abort', () => { aborted.add(text) })
      // A stream that never ends on its own: only the abort signal can stop it.
      const stream = new Readable({ read() {} })
      stream.push(Buffer.alloc(128))
      return { pcmStream: stream, pcmSampleRate: 24000 }
    },
  })

  const requestId = 'pipeline-abort'
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local' })
  service.pushText(sender, { requestId, text: '第一句。' })
  service.pushText(sender, { requestId, text: '第二句。' })
  await bothStarted

  service.abort(sender, { requestId })
  await delay(10)

  assert.deepEqual(started, ['第一句。', '第二句。'])
  assert.deepEqual([...aborted].sort(), ['第一句。', '第二句。'])
  assert.equal(sender.events.some((event) => event.type === 'error'), false)
})

test('a mid-reply synthesis failure stops the queue and reports one error', async () => {
  const sender = createSender()
  const synthesized: string[] = []
  const publishStreams: Array<Readable> = []

  const service = createTtsStreamService({
    synthesizeRemote: async (_payload, text: string) => {
      synthesized.push(text)
      if (text === '第二句。') {
        throw new Error('primary provider died mid-reply')
      }
      const stream = pacedPcmStream()
      publishStreams.push(stream)
      return { pcmStream: stream, pcmSampleRate: 24000 }
    },
  })

  const requestId = 'pipeline-failure'
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local' })
  service.pushText(sender, { requestId, text: '第一句。' })
  service.pushText(sender, { requestId, text: '第二句。' })
  service.pushText(sender, { requestId, text: '第三句。' })
  await service.finish(sender, { requestId })

  const chunks = sender.events.filter((event) => event.type === 'chunk')
  assert.deepEqual([...new Set(chunks.map((event) => event.text))], ['第一句。'])
  const errors = sender.events.filter((event) => event.type === 'error')
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]!.message), /mid-reply/)
  // The renderer's #194 fallback replays the accumulated reply text in order
  // through the fallback provider; the main process must not emit another
  // segment after the error.
  assert.equal(synthesized.includes('第三句。'), false)
  assert.equal(sender.events.some((event) => event.type === 'end'), false)
})

test('main reports stage durations once, without reply text', async () => {
  const sender = createSender()
  const service = createTtsStreamService({
    synthesizeRemote: async () => ({
      pcmStream: pacedPcmStream(2048, 1),
      pcmSampleRate: 24000,
    }),
  })

  const requestId = 'pipeline-latency'
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local' })
  service.pushText(sender, { requestId, text: '第一句。' })
  await service.finish(sender, { requestId })

  const latency = sender.events.filter((event) => event.type === 'latency')
  assert.equal(latency.length, 1)
  assert.equal(latency[0]!.firstSegmentChars, '第一句。'.length)
  assert.equal(JSON.stringify(latency[0]!.stages).includes('第一句'), false)
  assert.equal(typeof latency[0]!.stages?.firstSegmentQueuedToFirstAudibleSampleMs, 'number')
})

test('stage durations come from the pure helper', () => {
  let now = 1_000
  const timing = createTtsTimingMarks(() => now)
  now = 1_050
  timing.mark('firstSegmentQueued')
  now = 1_120
  timing.mark('firstSegmentSynthStart')
  now = 1_500
  timing.mark('firstPcmChunk')
  now = 1_560
  timing.mark('firstAudibleSample')
  // A second mark for the same stage keeps the first value.
  now = 9_999
  timing.mark('firstPcmChunk')

  assert.deepEqual(computeTtsStageDurations(timing.snapshot()), {
    streamStartToFirstSegmentQueuedMs: 50,
    firstSegmentQueuedToSynthStartMs: 70,
    synthStartToFirstPcmChunkMs: 380,
    firstPcmChunkToFirstAudibleSampleMs: 60,
    firstSegmentQueuedToFirstAudibleSampleMs: 510,
    streamStartToFirstAudibleSampleMs: 560,
  })

  assert.deepEqual(computeTtsStageDurations({ streamStart: 10 }), {
    streamStartToFirstSegmentQueuedMs: null,
    firstSegmentQueuedToSynthStartMs: null,
    synthStartToFirstPcmChunkMs: null,
    firstPcmChunkToFirstAudibleSampleMs: null,
    firstSegmentQueuedToFirstAudibleSampleMs: null,
    streamStartToFirstAudibleSampleMs: null,
  })
})
