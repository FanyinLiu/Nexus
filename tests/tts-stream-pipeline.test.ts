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
  samples?: Float32Array
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

const MINUS_THREE_DB = 10 ** (-3 / 20)

function pcm16BufferFromTone(seconds: number, amplitude: number): Buffer {
  const sampleRate = 24000
  const sampleCount = Math.round(seconds * sampleRate)
  const buffer = Buffer.alloc(sampleCount * 2)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = amplitude * Math.sin((2 * Math.PI * 220 * index) / sampleRate)
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), index * 2)
  }
  return buffer
}

function oneShotStream(buffer: Buffer): Readable {
  return new Readable({
    read() {
      this.push(buffer)
      this.push(null)
    },
  })
}

function collectChunkSamples(events: StreamEvent[]): Float32Array {
  const chunks = events
    .filter((event) => event.type === 'chunk' && event.samples)
    .map((event) => event.samples!)
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index]! * samples[index]!
  }
  return Math.sqrt(sum / samples.length)
}

function peak(samples: Float32Array): number {
  let maximum = 0
  for (let index = 0; index < samples.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(samples[index]!))
  }
  return maximum
}

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

test('sped-up local Qwen3 output is loudness-matched and limited to -3 dBFS', async () => {
  const sender = createSender()
  const input = pcm16BufferFromTone(2.5, 0.95)
  const service = createTtsStreamService({
    synthesizeRemote: async () => ({
      pcmStream: oneShotStream(input),
      pcmSampleRate: 24000,
      speechTempo: 1.65,
    }),
  })

  const requestId = 'gain-local-stretched'
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local' })
  service.pushText(sender, { requestId, text: '开心的话。' })
  await service.finish(sender, { requestId })

  const output = collectChunkSamples(sender.events)
  // Skip the 18 ms lead-in silence and the matcher's 300 ms window fill.
  const measured = output.subarray(24000 * 0.4)
  const inputLevel = 0.95 / Math.SQRT2
  const outputLevel = rms(measured)
  assert.ok(
    peak(measured) <= MINUS_THREE_DB + 1e-3,
    `peak ${peak(measured).toFixed(3)} exceeds -3 dBFS`,
  )
  assert.ok(outputLevel <= inputLevel, 'sped-up speech became louder than its source')
  assert.ok(
    outputLevel >= inputLevel * 0.5,
    `sped-up speech lost more than the 3 dB trim (${(outputLevel / inputLevel).toFixed(2)}x)`,
  )
  // 2.5 s at 1.65x, plus the first-segment silence and look-ahead tail.
  const seconds = output.length / 24000
  assert.ok(seconds > 1.4 && seconds < 1.8, `stretched duration was ${seconds.toFixed(2)} s`)
})

test('1.0x local Qwen3 audio keeps its original level', async () => {
  const sender = createSender()
  const input = pcm16BufferFromTone(1, 0.9)
  const service = createTtsStreamService({
    synthesizeRemote: async () => ({
      pcmStream: oneShotStream(input),
      pcmSampleRate: 24000,
    }),
  })

  const requestId = 'gain-local-unstretched'
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local' })
  service.pushText(sender, { requestId, text: '普通的话。' })
  await service.finish(sender, { requestId })

  const output = collectChunkSamples(sender.events)
  const measured = output.subarray(24000 * 0.2)
  assert.ok(peak(measured) > 0.85, '1.0x audio was attenuated')
  assert.ok(rms(measured) > 0.5, '1.0x audio was attenuated')
})

test('abort during a stretched local stream tears down the gain stage cleanly', async () => {
  const sender = createSender()
  const input = pcm16BufferFromTone(2, 0.8)
  let sent = false
  const service = createTtsStreamService({
    synthesizeRemote: async () => ({
      pcmStream: new Readable({
        read() {
          if (sent) return
          sent = true
          this.push(input)
        },
      }),
      pcmSampleRate: 24000,
      speechTempo: 1.65,
    }),
  })

  const requestId = 'gain-local-abort'
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local' })
  service.pushText(sender, { requestId, text: '被中断的话。' })
  await delay(20)
  service.abort(sender, { requestId })
  await delay(10)

  assert.equal(sender.events.some((event) => event.type === 'error'), false)
  assert.equal(sender.events.some((event) => event.type === 'end'), false)
})
