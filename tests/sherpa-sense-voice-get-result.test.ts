import assert from 'node:assert/strict'
import test from 'node:test'

import sherpaSenseVoiceService from '../electron/sherpaSenseVoice.js'

// Native sherpa-onnx and the SenseVoice model are unavailable in CI, so these
// tests drive the real service paths with a stub recognizer. The stub mirrors
// sherpa-onnx-node's contract: the transcript is returned by
// `recognizer.getResult(stream)`, and the stream itself has no `result`.

const SAMPLE_RATE = 16000
const TONE_SECONDS = 0.1
const TONE_HZ = 440
const RAW_RESULT_TEXT = '<|zh|><|HAPPY|><|Speech|><|woitn|>你好'

type AcceptedWaveform = {
  samples: Float32Array
  sampleRate: number
}

type StubStream = {
  acceptWaveform: (payload: AcceptedWaveform) => void
}

function createSineWaveWav(): Buffer {
  const totalSamples = Math.round(SAMPLE_RATE * TONE_SECONDS)
  const dataSize = totalSamples * 2
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // fmt chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < totalSamples; i += 1) {
    const sample = Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE) * 0.5
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + i * 2)
  }
  return buffer
}

function parseWav(buffer: Buffer): { samples: Float32Array; sampleRate: number } {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE')

  let sampleRate = 0
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const dataStart = offset + 8

    if (chunkId === 'fmt ') {
      assert.equal(buffer.readUInt16LE(dataStart), 1) // PCM
      assert.equal(buffer.readUInt16LE(dataStart + 2), 1) // mono
      sampleRate = buffer.readUInt32LE(dataStart + 4)
      assert.equal(buffer.readUInt16LE(dataStart + 14), 16) // bits per sample
    } else if (chunkId === 'data') {
      const sampleCount = Math.floor(chunkSize / 2)
      const samples = new Float32Array(sampleCount)
      for (let i = 0; i < sampleCount; i += 1) {
        samples[i] = buffer.readInt16LE(dataStart + i * 2) / 0x8000
      }
      return { samples, sampleRate }
    }

    offset = dataStart + chunkSize + (chunkSize % 2)
  }

  throw new Error('WAV data chunk missing')
}

function installStubRecognizer() {
  const accepted: AcceptedWaveform[] = []
  const streams: StubStream[] = []
  const decoded: StubStream[] = []
  const getResultStreams: StubStream[] = []

  const recognizer = {
    createStream(): StubStream {
      const stream: StubStream = {
        acceptWaveform(payload) {
          accepted.push(payload)
        },
      }
      streams.push(stream)
      return stream
    },
    decode(stream: StubStream) {
      decoded.push(stream)
    },
    getResult(stream: StubStream) {
      getResultStreams.push(stream)
      return { text: RAW_RESULT_TEXT }
    },
  }

  sherpaSenseVoiceService.recognizer = recognizer
  sherpaSenseVoiceService.initialized = true

  return { accepted, streams, decoded, getResultStreams }
}

const wav = parseWav(createSineWaveWav())

test('finishStream reads the transcript from recognizer.getResult', (t) => {
  t.after(() => sherpaSenseVoiceService.destroy())
  const stub = installStubRecognizer()

  assert.equal(sherpaSenseVoiceService.startStream(), true)

  const midpoint = Math.floor(wav.samples.length / 2)
  sherpaSenseVoiceService.feedAudio(wav.samples.subarray(0, midpoint))
  sherpaSenseVoiceService.feedAudio(wav.samples.subarray(midpoint))

  const result = sherpaSenseVoiceService.finishStream()

  assert.equal(result.text, '你好')
  assert.equal(result.voiceEmotion, 'happy')
  assert.equal(stub.accepted.length, 1)
  assert.equal(stub.accepted[0].sampleRate, SAMPLE_RATE)
  assert.equal(stub.accepted[0].samples.length, wav.samples.length)
  assert.deepEqual(stub.accepted[0].samples, wav.samples)
  assert.equal(stub.streams.length, 1)
  assert.equal(stub.decoded[0], stub.streams[0])
  assert.equal(stub.getResultStreams.length, 1)
  assert.equal(stub.getResultStreams[0], stub.streams[0])
  assert.equal('result' in stub.streams[0], false)
})

test('transcribe reads the transcript from recognizer.getResult', (t) => {
  t.after(() => sherpaSenseVoiceService.destroy())
  const stub = installStubRecognizer()

  const result = sherpaSenseVoiceService.transcribe(wav.samples, SAMPLE_RATE)

  assert.equal(result.text, '你好')
  assert.equal(result.voiceEmotion, 'happy')
  assert.equal(stub.accepted.length, 1)
  assert.equal(stub.accepted[0].sampleRate, SAMPLE_RATE)
  assert.equal(stub.accepted[0].samples.length, wav.samples.length)
  assert.deepEqual(stub.accepted[0].samples, wav.samples)
  assert.equal(stub.streams.length, 1)
  assert.equal(stub.getResultStreams.length, 1)
  assert.equal(stub.getResultStreams[0], stub.streams[0])
  assert.equal('result' in stub.streams[0], false)
})
