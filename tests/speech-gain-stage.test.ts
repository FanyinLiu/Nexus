import assert from 'node:assert/strict'
import test from 'node:test'

import { createSpeechGainStage } from '../electron/services/speechGainStage.js'

const SAMPLE_RATE = 24000
const MINUS_THREE_DB = 10 ** (-3 / 20)

function makeTone(seconds: number, amplitude: number, frequency = 220): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE)
  }
  return samples
}

/** Dense, transient-heavy "speech": steady tone plus periodic spikes. */
function makeLoudSpeech(seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  for (let index = 0; index < samples.length; index += 1) {
    const tone = 0.62 * Math.sin((2 * Math.PI * 180 * index) / SAMPLE_RATE)
    const second = 0.22 * Math.sin((2 * Math.PI * 430 * index) / SAMPLE_RATE)
    const spike = index % 1600 === 0 ? 1.6 : 0
    samples[index] = tone + second + spike
  }
  return samples
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

function decibels(ratio: number): number {
  return 20 * Math.log10(ratio)
}

function concat(chunks: Float32Array[]): Float32Array {
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

function runStage(
  stage: ReturnType<typeof createSpeechGainStage>,
  reference: Float32Array,
  stretched: Float32Array,
  chunkSizes: number[],
  referenceMode: 'incremental' | 'all' = 'incremental',
): Float32Array {
  const chunks: Float32Array[] = []
  const referenceStep = 257
  let referenceOffset = 0
  let stretchedOffset = 0
  let sizeIndex = 0
  if (referenceMode === 'all') {
    stage.pushReference(reference)
    referenceOffset = reference.length
  }
  while (stretchedOffset < stretched.length) {
    const size = chunkSizes[sizeIndex % chunkSizes.length]!
    sizeIndex += 1
    const stretchedEnd = Math.min(stretched.length, stretchedOffset + size)
    // Feed the reference ahead of the processed range. The canonical block
    // size keeps this helper itself from changing the comparison windows.
    const referenceTarget = Math.min(reference.length, stretchedEnd)
    while (referenceOffset < referenceTarget) {
      const referenceEnd = Math.min(referenceTarget, referenceOffset + referenceStep)
      stage.pushReference(reference.subarray(referenceOffset, referenceEnd))
      referenceOffset = referenceEnd
    }
    chunks.push(stage.process(stretched.subarray(stretchedOffset, stretchedEnd)))
    stretchedOffset = stretchedEnd
  }
  chunks.push(stage.flush())
  return concat(chunks)
}

test('loudness matching keeps stretched RMS within 1 dB of input and never boosts', () => {
  const reference = makeTone(3, 0.12)
  // WSOLA's overlap-add makes the same speech ~1.25x louder on dense frames.
  const stretched = reference.map((sample) => sample * 1.25)
  const stage = createSpeechGainStage({
    sampleRate: SAMPLE_RATE,
    headroomDb: 0,
    ceilingDb: 0,
  })

  const output = runStage(stage, reference, stretched, [4096])
  assert.equal(output.length, reference.length)

  // Skip the first second: the 300 ms windows and gain settling are complete.
  const inputRms = rms(reference.subarray(SAMPLE_RATE))
  const outputRms = rms(output.subarray(SAMPLE_RATE))
  const difference = decibels(outputRms / inputRms)
  assert.ok(difference <= 0.1, `stretched output got louder (${difference.toFixed(2)} dB)`)
  assert.ok(difference >= -1, `stretched output drifted away (${difference.toFixed(2)} dB)`)
})

test('loudness matching leaves a quieter stretched signal alone (no boost)', () => {
  const reference = makeTone(1.5, 0.2)
  const stretched = reference.map((sample) => sample * 0.6)
  const stage = createSpeechGainStage({
    sampleRate: SAMPLE_RATE,
    headroomDb: 0,
    ceilingDb: 0,
  })

  const output = runStage(stage, reference, stretched, [1024])
  const inputRms = rms(reference.subarray(SAMPLE_RATE / 2))
  const outputRms = rms(output.subarray(SAMPLE_RATE / 2))
  const difference = decibels(outputRms / inputRms)
  assert.ok(difference < 0, 'a quieter signal was boosted')
  assert.ok(
    Math.abs(difference - decibels(0.6)) < 0.2,
    `quiet signal level changed (${difference.toFixed(2)} dB)`,
  )
})

test('the default stage keeps a loud synthetic signal below -3 dBFS', () => {
  const reference = makeLoudSpeech(2)
  const stretched = reference.map((sample) => sample * 1.08)
  const stage = createSpeechGainStage({ sampleRate: SAMPLE_RATE })

  const output = runStage(stage, reference, stretched, [777, 4096])
  assert.equal(output.length, reference.length)
  assert.ok(
    peak(output) <= MINUS_THREE_DB + 1e-6,
    `peak ${decibels(peak(output)).toFixed(2)} dBFS exceeds the ceiling`,
  )

  // The fixed trim keeps the steady level 3 dB below the source (plus at most
  // a fraction of a dB of limiter action on the loudest frames).
  const inputRms = rms(reference.subarray(SAMPLE_RATE))
  const outputRms = rms(output.subarray(SAMPLE_RATE))
  const difference = decibels(outputRms / inputRms)
  assert.ok(difference <= 0.1, `full chain boosted the signal (${difference.toFixed(2)} dB)`)
  assert.ok(difference >= -6.5, `full chain lost too much level (${difference.toFixed(2)} dB)`)
})

test('chunk boundaries do not change the output', () => {
  const reference = makeLoudSpeech(1.2)
  const stretched = reference.map((sample, index) => (
    sample * 1.12 + 0.01 * Math.sin(index / 7)
  ))

  const single = runStage(
    createSpeechGainStage({ sampleRate: SAMPLE_RATE }),
    reference,
    stretched,
    [stretched.length],
    'all',
  )
  const fragmented = runStage(
    createSpeechGainStage({ sampleRate: SAMPLE_RATE }),
    reference,
    stretched,
    [1, 7, 64, 333, 1000, 4096],
    'all',
  )

  assert.equal(single.length, fragmented.length)
  for (let index = 0; index < single.length; index += 1) {
    assert.ok(
      Math.abs(single[index]! - fragmented[index]!) < 1e-6,
      `sample ${index} depends on the chunk boundary`,
    )
  }
})

test('flush returns exactly the look-ahead tail, once, and reset restarts the stage', () => {
  const stage = createSpeechGainStage({ sampleRate: SAMPLE_RATE })
  const short = makeTone(0.002, 0.2)
  stage.pushReference(short)
  const beforeLookahead = stage.process(short)
  assert.equal(beforeLookahead.length, 0)
  assert.equal(stage.flush().length, short.length)
  assert.equal(stage.flush().length, 0)

  stage.reset()
  const reference = makeTone(0.5, 0.2)
  stage.pushReference(reference)
  const streamed = stage.process(reference)
  const tail = stage.flush()
  assert.equal(streamed.length + tail.length, reference.length)
})
