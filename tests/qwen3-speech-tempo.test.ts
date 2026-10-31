import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  EMOTION_SPEECH_TEMPO,
  isNeutralSegmentStyle,
  resolveEmotionSpeechTempo,
  resolveSegmentVoiceStyle,
} from '../src/features/voice/voiceEmotion.ts'
import {
  createWsolaStretcher,
  normalizeStretchRate,
} from '../electron/services/wsolaStretcher.js'
import { createTtsStreamService } from '../electron/ttsStreamService.js'

const SAMPLE_RATE = 24000

function sineWave(frequency, seconds, amplitude = 0.5) {
  const samples = new Float32Array(Math.round(SAMPLE_RATE * seconds))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE)
  }
  return samples
}

/** Stream a clip through the stretcher in fixed chunks. */
function stretch(samples, rate, chunkSize = 1024) {
  const stretcher = createWsolaStretcher(rate)
  const blocks = []
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    blocks.push(stretcher.push(samples.subarray(offset, offset + chunkSize)))
  }
  blocks.push(stretcher.flush())
  return { blocks, output: concat(blocks), stretcher }
}

function concat(blocks) {
  let total = 0
  for (const block of blocks) total += block.length
  const merged = new Float32Array(total)
  let offset = 0
  for (const block of blocks) {
    merged.set(block, offset)
    offset += block.length
  }
  return merged
}

/**
 * Frequency from the zero-crossing rate. WSOLA never resamples, so a pure
 * tone keeps its crossing count per second; that is a sharper pitch probe
 * than a spectral peak for a signal this clean.
 */
function zeroCrossingFrequency(samples) {
  const start = Math.floor(samples.length * 0.2)
  const end = Math.floor(samples.length * 0.8)
  let crossings = 0
  let previous = samples[start] ?? 0
  for (let index = start + 1; index < end; index += 1) {
    const current = samples[index] ?? 0
    if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) crossings += 1
    previous = current
  }
  return (crossings * SAMPLE_RATE) / (2 * (end - start))
}

function peakAmplitude(samples) {
  let peak = 0
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0))
  }
  return peak
}

/** Small deterministic PRNG so the chunking test never depends on chance. */
function createRandom(seed) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

test('the rate table keeps the six documented rows and a neutral default', () => {
  // Rows from the tuning table, pinned so a careless edit shows up here.
  assert.equal(EMOTION_SPEECH_TEMPO.idle, 1.5)
  assert.equal(EMOTION_SPEECH_TEMPO.calm, 1.5)
  assert.equal(EMOTION_SPEECH_TEMPO.happy, 1.65)
  assert.equal(EMOTION_SPEECH_TEMPO.excited, 1.65)
  assert.equal(EMOTION_SPEECH_TEMPO.sulky, 1.4)
  assert.equal(EMOTION_SPEECH_TEMPO.sad, 1.25)
  assert.equal(EMOTION_SPEECH_TEMPO.angry, 1.6)
  assert.equal(EMOTION_SPEECH_TEMPO.embarrassed, 1.35)

  // Every T6 category has an entry: a new emotion must not silently fall back.
  for (const emotion of [
    'idle', 'thinking', 'happy', 'sleepy', 'surprised', 'confused', 'embarrassed',
    'excited', 'affectionate', 'proud', 'curious', 'worried', 'playful', 'sad',
    'angry', 'sulky', 'hesitant', 'calm', 'whisper',
  ]) {
    assert.equal(typeof EMOTION_SPEECH_TEMPO[emotion], 'number', `${emotion} has a tempo`)
  }

  assert.equal(resolveEmotionSpeechTempo('idle'), 1.5)
  assert.equal(resolveEmotionSpeechTempo('whisper'), 1.25)
  assert.equal(resolveEmotionSpeechTempo('not-a-mood'), 1.5)
  assert.equal(resolveEmotionSpeechTempo(undefined), 1.5)
})

test('only the local Qwen3 style carries a speech tempo', () => {
  const qwen3 = resolveSegmentVoiceStyle({
    text: '今天真好！',
    providerId: 'qwen3-tts-local',
  })
  assert.equal(qwen3.speechTempo, EMOTION_SPEECH_TEMPO.excited)
  assert.equal(isNeutralSegmentStyle(qwen3), false)

  const neutral = resolveSegmentVoiceStyle({
    text: '嗯，好的。',
    providerId: 'qwen3-tts-local',
  })
  // A plain sentence still needs the 1.5x baseline to cross IPC.
  assert.equal(neutral.instruction, '')
  assert.equal(neutral.speechTempo, 1.5)
  assert.equal(isNeutralSegmentStyle(neutral), false)

  for (const providerId of ['minimax-tts', 'openai-tts', 'edge-tts', 'local-tts']) {
    const style = resolveSegmentVoiceStyle({ text: '今天真好！', providerId })
    assert.equal(style.speechTempo, undefined, `${providerId} is left alone`)
  }
  const sulky = resolveSegmentVoiceStyle({
    text: '才不会呢。',
    providerId: 'qwen3-tts-local',
    cue: { kind: 'tts', value: 'sulky' },
  })
  assert.equal(sulky.speechTempo, 1.4)
})

test('stretched output length matches input / rate within 3%', () => {
  const input = sineWave(440, 2)
  for (const rate of [1.25, 1.35, 1.4, 1.5, 1.6, 1.65]) {
    const { output } = stretch(input, rate)
    const expected = input.length / rate
    const error = Math.abs(output.length - expected) / expected
    assert.ok(
      error <= 0.03,
      `rate ${rate}: ${output.length} samples vs expected ${expected.toFixed(0)} (${(error * 100).toFixed(2)}%)`,
    )
  }
})

test('pitch survives the stretch and the signal stays full scale', () => {
  for (const frequency of [120, 220, 440, 880]) {
    const input = sineWave(frequency, 2)
    for (const rate of [1.25, 1.4, 1.5, 1.65]) {
      const { output } = stretch(input, rate)
      const measured = zeroCrossingFrequency(output)
      const drift = Math.abs(measured - frequency) / frequency
      assert.ok(
        drift <= 0.02,
        `${frequency} Hz at ${rate}x measured ${measured.toFixed(1)} Hz (${(drift * 100).toFixed(2)}%)`,
      )
      assert.ok(
        Math.abs(peakAmplitude(output) - 0.5) < 0.02,
        `${frequency} Hz at ${rate}x keeps its level`,
      )
    }
  }
})

test('random chunking produces the same audio as one shot', () => {
  const input = sineWave(220, 1.5)
  const oneShot = stretch(input, 1.5, input.length).output
  const random = createRandom(20261031)
  const stretcher = createWsolaStretcher(1.5)
  const blocks = []
  let offset = 0
  while (offset < input.length) {
    const size = 1 + Math.floor(random() * 3000)
    blocks.push(stretcher.push(input.subarray(offset, offset + size)))
    offset += size
  }
  blocks.push(stretcher.flush())
  const streamed = concat(blocks)

  assert.equal(streamed.length, oneShot.length, 'same number of samples')
  let maximumDifference = 0
  for (let index = 0; index < oneShot.length; index += 1) {
    maximumDifference = Math.max(maximumDifference, Math.abs(oneShot[index]! - streamed[index]!))
  }
  assert.ok(maximumDifference < 1e-6, `chunk boundaries do not change the output (${maximumDifference})`)
})

test('flush returns the tail once and never leaves a click or a NaN', () => {
  const input = sineWave(300, 0.9)
  const stretcher = createWsolaStretcher(1.5)
  const pushed = []
  for (let offset = 0; offset < input.length; offset += 500) {
    pushed.push(stretcher.push(input.subarray(offset, offset + 500)))
  }
  const tail = stretcher.flush()
  assert.ok(tail.length > 0, 'the overlap-add residue is handed back')

  const output = concat([...pushed, tail])
  for (let index = 0; index < output.length; index += 1) {
    assert.ok(Number.isFinite(output[index]), 'no NaN or Infinity in the output')
  }
  // The tail ramps into the un-stretched remainder, so the last sample must be
  // quiet: a loud final sample is exactly the click this guards against.
  assert.ok(Math.abs(output[output.length - 1]!) < 0.02, 'the clip ends quietly')
  // The whole clip is accounted for, not dropped at the end.
  assert.ok(output.length > (input.length / 1.5) * 0.97)

  assert.equal(stretcher.flush().length, 0, 'a second flush has nothing left')
})

test('abort drops the stretcher state instead of leaking it into the next clip', () => {
  const first = sineWave(440, 0.5)
  const stretcher = createWsolaStretcher(1.5)
  stretcher.push(first.subarray(0, 5000))
  stretcher.reset()

  assert.equal(stretcher.push(new Float32Array(64)).length, 0, 'no audio from a partial frame')

  stretcher.reset()
  const second = sineWave(330, 0.6)
  const afterReset = concat([stretcher.push(second), stretcher.flush()])
  const fresh = stretch(second, 1.5, second.length).output
  assert.equal(afterReset.length, fresh.length)
  let maximumDifference = 0
  for (let index = 0; index < fresh.length; index += 1) {
    maximumDifference = Math.max(maximumDifference, Math.abs(fresh[index]! - afterReset[index]!))
  }
  assert.ok(maximumDifference < 1e-6, 'a reset stretcher behaves like a new one')
})

test('normalizeStretchRate clamps and rejects nonsense', () => {
  assert.equal(normalizeStretchRate(1.5), 1.5)
  assert.equal(normalizeStretchRate(0.1), 0.5)
  assert.equal(normalizeStretchRate(9), 2)
  assert.equal(normalizeStretchRate('nonsense'), 1)
  assert.equal(normalizeStretchRate(undefined), 1)
  assert.equal(normalizeStretchRate(0), 1)
})

test('the stream service stretches local Qwen3 PCM and reports the stretched duration', async () => {
  const events = []
  const sender = {
    isDestroyed: () => false,
    send: (_channel, event) => { events.push(event) },
    once: () => undefined,
    removeListener: () => undefined,
  }
  const inputSamples = 24000 // 1 s at 24 kHz
  const payloads = []

  const pcmFor = (samples) => {
    const pcm = Buffer.alloc(samples * 2)
    for (let index = 0; index < samples; index += 1) {
      pcm.writeInt16LE(Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE)), index * 2)
    }
    const stream = new Readable({ read() {} })
    stream.push(pcm)
    stream.push(null)
    return stream
  }

  const service = createTtsStreamService({
    synthesizeRemote: async (payload) => {
      payloads.push(payload)
      // Mirrors ttsService: the tempo rides with the streamed result.
      return {
        pcmStream: pcmFor(payload.text === '第一句。' ? 4800 : inputSamples),
        pcmSampleRate: SAMPLE_RATE,
        speechTempo: payload.speechTempo,
      }
    },
  })

  const requestId = 'tempo-pipeline'
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local', voice: 'vivian' })
  // A first segment without a tempo so the measured one is not the stream's
  // first chunk, which carries the 18 ms lead-in silence.
  service.pushText(sender, {
    requestId,
    text: '第一句。',
    style: { instruction: '', rate: 1, pitch: 1 },
  })
  service.pushText(sender, {
    requestId,
    text: '第二句。',
    style: { instruction: '', rate: 1, pitch: 1, speechTempo: 1.5 },
  })
  await service.finish(sender, { requestId })

  assert.equal(payloads.length, 2)
  assert.equal(payloads[1].speechTempo, 1.5, 'the tempo reaches the provider payload')
  assert.equal(payloads[1].voice, 'vivian')
  assert.equal(payloads[0].speechTempo, undefined, 'a style without a tempo stays plain')

  const chunks = events.filter((event) => event.type === 'chunk' && event.text === '第二句。')
  const emittedSamples = chunks.reduce((total, event) => total + event.samples.length, 0)
  // 1 s of source at 1.5x is ~0.667 s of playback.
  assert.ok(
    Math.abs(emittedSamples - inputSamples / 1.5) / (inputSamples / 1.5) < 0.03,
    `emitted ${emittedSamples} samples for ${inputSamples} source samples`,
  )

  const segment = events.find((event) => event.type === 'segment' && event.segmentIndex === 1)
  assert.ok(segment, 'duration is reported')
  assert.ok(
    Math.abs(segment.durationMs - (emittedSamples / SAMPLE_RATE) * 1000) < 5,
    'lip-sync duration follows the stretched audio',
  )
})

test('a style without a tempo leaves other providers untouched', async () => {
  const events = []
  const sender = {
    isDestroyed: () => false,
    send: (_channel, event) => { events.push(event) },
    once: () => undefined,
    removeListener: () => undefined,
  }
  const inputSamples = 9600
  const service = createTtsStreamService({
    synthesizeRemote: async () => {
      const stream = new Readable({ read() {} })
      stream.push(Buffer.alloc(inputSamples * 2, 0))
      stream.push(null)
      return { pcmStream: stream, pcmSampleRate: SAMPLE_RATE }
    },
  })

  const requestId = 'no-tempo'
  await service.start(sender, { requestId, providerId: 'omnivoice-tts' })
  service.pushText(sender, { requestId, text: '第一句。' })
  service.pushText(sender, {
    requestId,
    text: '第二句。',
    style: { instruction: '语气温柔', rate: 1, pitch: 1 },
  })
  await service.finish(sender, { requestId })

  const emittedSamples = events
    .filter((event) => event.type === 'chunk' && event.text === '第二句。')
    .reduce((total, event) => total + event.samples.length, 0)
  assert.equal(emittedSamples, inputSamples)
})
