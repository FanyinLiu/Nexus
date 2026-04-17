import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FrameProcessor,
  Pipeline,
  createStartFrame,
  createTextDeltaFrame,
  createTextSentenceFrame,
  createAudioFrame,
  createAudioEndFrame,
  createEndFrame,
  createInterruptionFrame,
  createErrorFrame,
  isTerminalFrame,
  type Frame,
} from '../src/features/voice/tts-pipeline/index.ts'

class CollectorProcessor extends FrameProcessor {
  public readonly received: Frame[] = []
  public shutdownCount = 0

  async process(frame: Frame): Promise<void> {
    this.received.push(frame)
    await this.pushDownstream(frame)
  }

  override async shutdown(): Promise<void> {
    this.shutdownCount += 1
  }
}

class FailingShutdownProcessor extends FrameProcessor {
  async process(frame: Frame): Promise<void> {
    await this.pushDownstream(frame)
  }

  override async shutdown(): Promise<void> {
    throw new Error('shutdown error is isolated')
  }
}

test('frame factories stamp turnId, monotonic id, and current timestamp', () => {
  const a = createTextDeltaFrame('turn-1', 'hello')
  const b = createTextDeltaFrame('turn-1', 'world')
  assert.equal(a.type, 'text-delta')
  assert.equal(a.turnId, 'turn-1')
  assert.equal(a.text, 'hello')
  assert.notEqual(a.id, b.id)
  assert.ok(a.ts <= b.ts, 'timestamps should be monotonic')
})

test('createAudioFrame preserves sample buffer without copying', () => {
  const samples = new Float32Array([0.1, -0.2, 0.3])
  const frame = createAudioFrame('turn-1', samples, 24000, 1, 0)
  assert.equal(frame.samples, samples, 'samples should be referenced, not copied')
  assert.equal(frame.sampleRate, 24000)
  assert.equal(frame.segmentIndex, 0)
})

test('isTerminalFrame recognises end and interruption but not text/audio', () => {
  assert.equal(isTerminalFrame(createEndFrame('t')), true)
  assert.equal(isTerminalFrame(createInterruptionFrame('t', 'user-barge-in')), true)
  assert.equal(isTerminalFrame(createTextDeltaFrame('t', 'x')), false)
  assert.equal(isTerminalFrame(createAudioFrame('t', new Float32Array(), 24000, 1, 0)), false)
  assert.equal(isTerminalFrame(createErrorFrame('t', 'boom')), false)
})

test('FrameProcessor default process forwards frames downstream', async () => {
  const head = new FrameProcessor()
  const tail = new CollectorProcessor()
  head.linkDownstream(tail)
  await head.process(createTextSentenceFrame('t', 'greetings', 0))
  assert.equal(tail.received.length, 1)
  assert.equal(tail.received[0].type, 'text-sentence')
})

test('Pipeline links processors head-to-tail and propagates frames', async () => {
  const mid = new CollectorProcessor()
  const tail = new CollectorProcessor()
  const pipeline = new Pipeline([mid, tail])

  await pipeline.push(createStartFrame('turn-1'))
  await pipeline.push(createTextDeltaFrame('turn-1', '你好'))
  await pipeline.push(createTextSentenceFrame('turn-1', '你好呀', 0))
  await pipeline.push(createAudioFrame('turn-1', new Float32Array(4), 24000, 1, 0))
  await pipeline.push(createAudioEndFrame('turn-1', 0))

  assert.equal(mid.received.length, 5, 'mid should see every frame')
  assert.equal(tail.received.length, 5, 'tail should see every frame after mid')
  assert.deepEqual(
    mid.received.map((f) => f.type),
    ['start', 'text-delta', 'text-sentence', 'audio', 'audio-end'],
  )
})

test('Pipeline.push is a no-op after stop()', async () => {
  const tail = new CollectorProcessor()
  const pipeline = new Pipeline([tail])
  await pipeline.push(createTextDeltaFrame('t', 'before'))
  await pipeline.stop()
  await pipeline.push(createTextDeltaFrame('t', 'after'))
  assert.equal(tail.received.length, 1)
  assert.equal(pipeline.isStopped(), true)
})

test('Pipeline.stop calls shutdown exactly once and is idempotent', async () => {
  const head = new CollectorProcessor()
  const tail = new CollectorProcessor()
  const pipeline = new Pipeline([head, tail])
  await pipeline.stop()
  await pipeline.stop()
  assert.equal(head.shutdownCount, 1)
  assert.equal(tail.shutdownCount, 1)
})

test('Pipeline.stop isolates a failing processor shutdown from the others', async () => {
  const head = new CollectorProcessor()
  const mid = new FailingShutdownProcessor()
  const tail = new CollectorProcessor()
  const pipeline = new Pipeline([head, mid, tail])
  await pipeline.stop()
  assert.equal(head.shutdownCount, 1)
  assert.equal(tail.shutdownCount, 1, 'downstream shutdown must still run after mid threw')
})

test('Pipeline.pushAndStop accepts EndFrame and rejects non-terminal frames', async () => {
  const tail = new CollectorProcessor()
  const pipeline = new Pipeline([tail])
  await pipeline.pushAndStop(createEndFrame('t'))
  assert.equal(tail.received.length, 1)
  assert.equal(tail.received[0].type, 'end')
  assert.equal(pipeline.isStopped(), true)

  const tail2 = new CollectorProcessor()
  const pipeline2 = new Pipeline([tail2])
  await assert.rejects(
    () => pipeline2.pushAndStop(createTextDeltaFrame('t', 'nope')),
    /expects a terminal frame/u,
  )
})

test('Pipeline requires at least one processor', () => {
  assert.throws(() => new Pipeline([]), /at least one processor/u)
})
