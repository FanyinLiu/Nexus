import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createVoiceActivityDetector,
  encodeVadAudioToWavBlob,
  getVadSpeechProb,
  isVadSpeechActive,
} from '../src/features/hearing/browserVad.ts'

function createFakeStream(active = true) {
  const track = {
    stopped: false,
    stop() {
      this.stopped = true
    },
  }

  const stream = {
    active,
    track,
    cloneCount: 0,
    getTracks() {
      return [track]
    },
    getAudioTracks() {
      return [track]
    },
    clone() {
      this.cloneCount += 1
      return createFakeStream(active)
    },
  }

  return stream as unknown as MediaStream & {
    track: typeof track
    cloneCount: number
  }
}

function createVadModule(newImpl: (config: Record<string, unknown>) => Promise<unknown>) {
  return {
    MicVAD: {
      new: newImpl,
    },
  } as unknown as Parameters<typeof createVoiceActivityDetector>[2]['vadModule']
}

test('encodeVadAudioToWavBlob writes a mono 16-bit wav payload', async () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
  const blob = encodeVadAudioToWavBlob(samples, 16_000)
  const buffer = Buffer.from(await blob.arrayBuffer())

  assert.equal(blob.type, 'audio/wav')
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE')
  assert.equal(buffer.toString('ascii', 12, 16), 'fmt ')
  assert.equal(buffer.toString('ascii', 36, 40), 'data')
  assert.equal(buffer.readUInt16LE(22), 1)
  assert.equal(buffer.readUInt16LE(34), 16)
  assert.equal(buffer.readUInt32LE(24), 16_000)
  assert.equal(buffer.readUInt32LE(40), samples.length * 2)
  assert.equal(buffer.length, 44 + samples.length * 2)
})

test('createVoiceActivityDetector falls back to ScriptProcessor for worklet failures', async () => {
  const originalWarn = console.warn
  const processorTypes: string[] = []
  const sharedStream = createFakeStream()
  const vadModule = createVadModule(async (config) => {
    processorTypes.push(String(config.processorType))
    if (config.processorType === 'auto') {
      throw new Error('AudioWorklet failed to load')
    }

    const stream = await (config.getStream as () => Promise<MediaStream>)()
    await (config.pauseStream as (stream: MediaStream) => Promise<void>)(stream)

    return {
      start: async () => undefined,
      pause: async () => undefined,
      destroy: async () => undefined,
    }
  })

  console.warn = () => undefined

  try {
    const detector = await createVoiceActivityDetector({
      onSpeechEnd: () => undefined,
    }, 'medium', {
      sharedStream,
      vadModule,
    })

    assert.deepEqual(processorTypes, ['auto', 'ScriptProcessor'])
    assert.equal(sharedStream.cloneCount, 1)
    assert.equal(sharedStream.track.stopped, false)
    await detector.destroy()
  } finally {
    console.warn = originalWarn
  }
})

test('createVoiceActivityDetector does not retry non-worklet startup failures', async () => {
  const processorTypes: string[] = []
  const vadModule = createVadModule(async (config) => {
    processorTypes.push(String(config.processorType))
    throw new Error('NotAllowedError: permission denied')
  })

  await assert.rejects(
    createVoiceActivityDetector({
      onSpeechEnd: () => undefined,
    }, 'medium', { vadModule }),
    /permission denied/,
  )
  assert.deepEqual(processorTypes, ['auto'])
})

test('VAD frame probability keeps the speech gate active only within holdover', async () => {
  const originalDateNow = Date.now
  let nowMs = 1_000
  Date.now = () => nowMs

  try {
    let onFrameProcessed: ((probabilities: { isSpeech: number }) => void) | null = null
    const vadModule = createVadModule(async (config) => {
      onFrameProcessed = config.onFrameProcessed as (probabilities: { isSpeech: number }) => void
      return {
        start: async () => undefined,
        pause: async () => undefined,
        destroy: async () => undefined,
      }
    })

    await createVoiceActivityDetector({
      onSpeechEnd: () => undefined,
    }, 'medium', { vadModule })

    onFrameProcessed?.({ isSpeech: 0.5 })
    assert.equal(getVadSpeechProb(), 0.5)
    assert.equal(isVadSpeechActive(), true)

    nowMs += 2_500
    onFrameProcessed?.({ isSpeech: 0.1 })
    assert.equal(getVadSpeechProb(), 0.1)
    assert.equal(isVadSpeechActive(), false)
  } finally {
    Date.now = originalDateNow
  }
})
