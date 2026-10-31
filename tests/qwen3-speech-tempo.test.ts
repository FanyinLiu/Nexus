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

function createSender() {
  return {
    isDestroyed: () => false,
    send: () => undefined,
    once: () => undefined,
    removeListener: () => undefined,
  }
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

/** A vibrato-free female-like voiced signal: steady f0, formants, slow syllables. */
function syntheticVoicedSignal(frequency, seconds) {
  const samples = new Float32Array(Math.round(SAMPLE_RATE * seconds))
  const formants = [[650, 1, 120], [1150, 0.7, 160], [2700, 0.35, 260]]
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / SAMPLE_RATE
    let value = 0
    for (let harmonic = 1; harmonic <= 30; harmonic += 1) {
      const hz = frequency * harmonic
      if (hz > SAMPLE_RATE / 2 - 200) break
      let weight = 0.05
      for (const [center, gain, bandwidth] of formants) {
        weight += gain / (1 + ((hz - center) / bandwidth) ** 2)
      }
      value += (weight / harmonic ** 0.35) * Math.sin(2 * Math.PI * hz * time + 0.4 * harmonic)
    }
    const envelope = 0.55 + 0.35 * Math.sin(2 * Math.PI * 3 * time) ** 2
      + 0.1 * Math.sin(2 * Math.PI * 0.7 * time)
    samples[index] = 0.055 * envelope * value
  }
  return samples
}

/** Autocorrelation f0 estimate used only by the tremble regression. */
function estimateFrameF0(frame) {
  let mean = 0
  for (let index = 0; index < frame.length; index += 1) mean += frame[index]
  mean /= frame.length
  const centered = new Float32Array(frame.length)
  for (let index = 0; index < frame.length; index += 1) centered[index] = frame[index] - mean

  let energy = 0
  for (let index = 0; index < centered.length; index += 1) energy += centered[index] * centered[index]
  if (energy < 1e-9) return { f0: 0, clarity: 0 }

  const minLag = Math.max(2, Math.floor(SAMPLE_RATE / 450))
  const maxLag = Math.min(centered.length - 2, Math.floor(SAMPLE_RATE / 70))
  let bestLag = 0
  let bestScore = -1
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0
    let lagEnergy = 0
    for (let index = 0; index < centered.length - lag; index += 1) {
      correlation += centered[index] * centered[index + lag]
      lagEnergy += centered[index + lag] * centered[index + lag]
    }
    const score = correlation / (Math.sqrt(energy * lagEnergy) + 1e-12)
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  return { f0: bestLag ? SAMPLE_RATE / bestLag : 0, clarity: bestScore }
}

/** Mean frame-to-frame f0 change on voiced frames, in percent. */
function meanJitterPercent(samples) {
  const frameSize = Math.round(SAMPLE_RATE * 0.04)
  const hop = Math.round(SAMPLE_RATE * 0.02)
  const track = []
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    track.push(estimateFrameF0(samples.subarray(start, start + frameSize)))
  }
  let total = 0
  let count = 0
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1]!
    const current = track[index]!
    if (previous.clarity < 0.5 || current.clarity < 0.5 || previous.f0 <= 0 || current.f0 <= 0) continue
    total += Math.abs(current.f0 - previous.f0) / ((current.f0 + previous.f0) / 2)
    count += 1
  }
  return count ? (total / count) * 100 : 0
}

function stretchWith(factory, samples, rate) {
  const stretcher = factory(rate)
  const blocks = []
  for (let offset = 0; offset < samples.length; offset += 1024) {
    blocks.push(stretcher.push(samples.subarray(offset, offset + 1024)))
  }
  blocks.push(stretcher.flush())
  return concat(blocks)
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
  assert.equal(normalizeStretchRate(9), 2.5)
  assert.equal(normalizeStretchRate('nonsense'), 1)
  assert.equal(normalizeStretchRate(undefined), 1)
  assert.equal(normalizeStretchRate(0), 1)
})


// ── Frozen 20 ms baseline, only for the tremble regression ─────────────────
// This is the pre-change WSOLA: 20 ms frames, 50% hop, +/-5 ms search, and a
// stride-2 correlation. It stays in the test so the regression can compare the
// old and new output without keeping a second production copy.

function legacyBuildHannWindow(size) {
  const window = new Float32Array(size)
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)))
  }
  return window
}

function legacyConcatBlocks(blocks) {
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

function createLegacyWsolaStretcher(rate) {
  const tempo = Math.min(2, Math.max(0.5, Number(rate) || 1))
  const frameSize = 480
  const hop = 240
  const tolerance = 120
  const analysisHop = hop * tempo
  const window = legacyBuildHannWindow(frameSize)
  let input = new Float32Array(4096)
  let inputLength = 0
  let position = 0
  let nominal = 0
  let framesProcessed = 0
  let ended = false
  const accumulator = new Float32Array(frameSize)
  const weights = new Float32Array(frameSize)

  function appendInput(chunk) {
    if (inputLength + chunk.length > input.length) {
      let capacity = input.length || 4096
      while (capacity < inputLength + chunk.length) capacity *= 2
      const grown = new Float32Array(capacity)
      grown.set(input.subarray(0, inputLength))
      input = grown
    }
    input.set(chunk, inputLength)
    inputLength += chunk.length
  }

  function drainBlock() {
    const block = new Float32Array(hop)
    for (let index = 0; index < hop; index += 1) {
      const weight = weights[index]
      block[index] = weight > 1e-4 ? accumulator[index] / weight : 0
    }
    accumulator.copyWithin(0, hop)
    accumulator.fill(0, frameSize - hop)
    weights.copyWithin(0, hop)
    weights.fill(0, frameSize - hop)
    return block
  }

  function findBestOffset(center, targetStart) {
    let bestOffset = 0
    let bestScore = Number.NEGATIVE_INFINITY
    for (let offset = -tolerance; offset <= tolerance; offset += 1) {
      const start = center + offset
      if (start < 0 || start + frameSize > inputLength) continue
      let correlation = 0
      let energy = 0
      for (let index = 0; index < frameSize; index += 2) {
        const candidate = input[start + index]
        correlation += candidate * input[targetStart + index]
        energy += candidate * candidate
      }
      const score = correlation / (Math.sqrt(energy) + 1e-9)
      if (score > bestScore) {
        bestScore = score
        bestOffset = offset
      }
    }
    return bestOffset
  }

  function runFrames(allowTail, blocks) {
    for (;;) {
      if (position + frameSize > inputLength) return
      const frameStart = position
      const nextNominal = nominal + analysisHop
      const center = Math.round(nextNominal)
      const targetStart = position + hop
      if (!allowTail) {
        const required = Math.max(center + tolerance, targetStart) + frameSize
        if (required > inputLength) return
      }
      for (let index = 0; index < frameSize; index += 1) {
        accumulator[index] += input[position + index] * window[index]
        weights[index] += window[index]
      }
      blocks.push(drainBlock())
      framesProcessed += 1
      let next = center
      if (targetStart + frameSize <= inputLength) {
        next = center + findBestOffset(center, targetStart)
      }
      const highestStart = inputLength - frameSize
      if (next < 0) next = 0
      if (next > highestStart) next = Math.max(0, highestStart)
      if (next <= frameStart) return
      position = next
      nominal = nextNominal
    }
  }

  return {
    push(chunk) {
      if (ended || !chunk || chunk.length === 0) return new Float32Array(0)
      appendInput(chunk)
      const blocks = []
      runFrames(false, blocks)
      return legacyConcatBlocks(blocks)
    },
    flush() {
      if (ended) return new Float32Array(0)
      ended = true
      const blocks = []
      runFrames(true, blocks)
      if (framesProcessed === 0) return input.slice(0, inputLength)
      const tail = drainBlock()
      const remainderStart = position + frameSize
      if (remainderStart < inputLength) {
        blocks.push(legacyConcatBlocks([tail, input.slice(remainderStart, inputLength)]))
      } else {
        blocks.push(tail)
      }
      return legacyConcatBlocks(blocks)
    },
  }
}

test('48 ms WSOLA holds a vibrato-free voice steadier than the old 20 ms one', () => {
  const input = syntheticVoicedSignal(180, 3)
  const current = stretchWith(createWsolaStretcher, input, 1.65)
  const legacy = stretchWith(createLegacyWsolaStretcher, input, 1.65)

  const currentJitter = meanJitterPercent(current)
  const legacyJitter = meanJitterPercent(legacy)
  // The baseline must actually tremble on this signal, or the comparison is
  // vacuous; at 180 Hz the old 20 ms frame lands between pitch periods.
  assert.ok(legacyJitter > 0.05, `old stretcher jitter ${legacyJitter.toFixed(3)}%`)
  assert.ok(
    currentJitter < legacyJitter * 0.5,
    `new ${currentJitter.toFixed(3)}% vs old ${legacyJitter.toFixed(3)}%`,
  )
  const expected = input.length / 1.65
  assert.ok(Math.abs(current.length - expected) / expected <= 0.03)
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

test('the user speechRate multiplies the mood tempo on the local Qwen3 path', async () => {
  const payloads = []
  const service = createTtsStreamService({
    synthesizeRemote: async (payload) => {
      payloads.push(payload)
      const stream = new Readable({ read() {} })
      stream.push(Buffer.alloc(4800 * 2, 0))
      stream.push(null)
      return {
        pcmStream: stream,
        pcmSampleRate: SAMPLE_RATE,
        speechTempo: payload.speechTempo,
      }
    },
  })

  const requestId = 'tempo-user-rate'
  const sender = createSender()
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local', rate: 0.8 })
  service.pushText(sender, {
    requestId,
    text: '第一句。',
    style: { instruction: '', rate: 1, pitch: 1, speechTempo: 1.5 },
  })
  await service.finish(sender, { requestId })

  assert.equal(payloads.length, 1)
  assert.ok(
    Math.abs(payloads[0].speechTempo - 1.2) < 1e-9,
    '0.8 x 1.5 reaches the provider payload',
  )
  assert.equal(payloads[0].rate, 0.8, 'the rate still reaches providers that read it')
})

/** Capture the payload that reaches the provider for one style-less segment. */
async function captureNoStylePayload(providerId: string, rate: number) {
  const payloads = []
  const service = createTtsStreamService({
    synthesizeRemote: async (payload) => {
      payloads.push(payload)
      const stream = new Readable({ read() {} })
      stream.push(Buffer.alloc(4800 * 2, 0))
      stream.push(null)
      return { pcmStream: stream, pcmSampleRate: SAMPLE_RATE }
    },
  })

  const requestId = `tempo-no-style-${providerId}-${rate}`
  const sender = createSender()
  await service.start(sender, { requestId, providerId, rate })
  // No style at all: the neutral-mood path whose style normalizes to null.
  service.pushText(sender, { requestId, text: '嗯，好的。' })
  await service.finish(sender, { requestId })
  return payloads
}

test('a neutral segment still folds the user speechRate on the local Qwen3 path', async () => {
  const payloads = await captureNoStylePayload('qwen3-tts-local', 1.3)
  assert.equal(payloads.length, 1)
  assert.equal(payloads[0].speechTempo, 1.3)
})

test('a neutral segment leaves other providers without a speech tempo', async () => {
  const payloads = await captureNoStylePayload('omnivoice-tts', 1.3)
  assert.equal(payloads.length, 1)
  assert.equal('speechTempo' in payloads[0], false)
  assert.equal(payloads[0].rate, 1.3, 'the provider still reads rate itself')
})

test('rate 1 with no style asks for no stretch', async () => {
  const payloads = await captureNoStylePayload('qwen3-tts-local', 1)
  assert.equal(payloads.length, 1)
  assert.equal('speechTempo' in payloads[0], false)
})

test('the folded tempo is clamped to the 0.5x-2.5x stretcher range', async () => {
  const payloads = []
  const service = createTtsStreamService({
    synthesizeRemote: async (payload) => {
      payloads.push(payload)
      const stream = new Readable({ read() {} })
      stream.push(Buffer.alloc(2, 0))
      stream.push(null)
      return { pcmStream: stream, pcmSampleRate: SAMPLE_RATE }
    },
  })

  const requestId = 'tempo-clamp'
  const sender = createSender()
  await service.start(sender, { requestId, providerId: 'qwen3-tts-local', rate: 2 })
  service.pushText(sender, {
    requestId,
    text: '第一句。',
    style: { instruction: '', rate: 1, pitch: 1, speechTempo: 2 },
  })
  await service.finish(sender, { requestId })

  assert.equal(payloads[0].speechTempo, 2.5)
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
