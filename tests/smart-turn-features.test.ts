import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  extractSmartTurnFeatures,
  prepareSmartTurnAudio,
  SMART_TURN_FRAME_COUNT,
  SMART_TURN_MEL_BINS,
  SMART_TURN_SAMPLE_COUNT,
} from '../shared/smartTurnFeatures.js'

type MelReference = {
  sampleRate: number
  audioSeconds: number
  melBins: number
  frames: number
  selectedFrames: number[]
  selected: number[][]
  min: number
  max: number
  mean: number
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REFERENCE: MelReference = JSON.parse(
  readFileSync(join(ROOT, 'tests/fixtures/smart-turn/mel-reference.json'), 'utf8'),
)

/** Same deterministic signal the Python reference fixture was generated from. */
function referenceAudio() {
  const sampleRate = REFERENCE.sampleRate
  const length = sampleRate * REFERENCE.audioSeconds
  const audio = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate
    audio[i] = (
      0.4 * Math.sin(2 * Math.PI * 220 * t)
      + 0.2 * Math.sin(2 * Math.PI * 660 * t)
      + 0.05 * Math.sin(2 * Math.PI * 1500 * t)
    )
  }
  for (let i = 0; i < 1_000; i += 1) {
    audio[i] *= i / 999
  }
  return audio
}

function mean(values: Float32Array) {
  let sum = 0
  for (let i = 0; i < values.length; i += 1) sum += values[i]
  return sum / values.length
}

test('the Smart Turn front end matches the Whisper reference fixture', () => {
  const features = extractSmartTurnFeatures(referenceAudio())

  assert.equal(features.length, SMART_TURN_MEL_BINS * SMART_TURN_FRAME_COUNT)
  assert.equal(REFERENCE.melBins, SMART_TURN_MEL_BINS)
  assert.equal(REFERENCE.frames, SMART_TURN_FRAME_COUNT)

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < features.length; i += 1) {
    if (features[i] < min) min = features[i]
    if (features[i] > max) max = features[i]
  }

  // The fixture was produced by transformers' WhisperFeatureExtractor with the
  // same do_normalize=True path pipecat's inference.py uses.
  assert.ok(Math.abs(min - REFERENCE.min) < 1e-4, `min ${min} vs ${REFERENCE.min}`)
  assert.ok(Math.abs(max - REFERENCE.max) < 1e-4, `max ${max} vs ${REFERENCE.max}`)
  assert.ok(Math.abs(mean(features) - REFERENCE.mean) < 1e-4)

  for (let mel = 0; mel < SMART_TURN_MEL_BINS; mel += 1) {
    for (let index = 0; index < REFERENCE.selectedFrames.length; index += 1) {
      const frame = REFERENCE.selectedFrames[index]
      const actual = features[mel * SMART_TURN_FRAME_COUNT + frame]
      const expected = REFERENCE.selected[mel][index]
      assert.ok(
        Math.abs(actual - expected) < 1e-4,
        `mel ${mel} frame ${frame}: ${actual} vs ${expected}`,
      )
    }
  }
})

test('Smart Turn keeps the last eight seconds and pads at the front', () => {
  const short = new Float32Array(16_000)
  for (let i = 0; i < short.length; i += 1) short[i] = i / 16_000

  const padded = prepareSmartTurnAudio(short)
  assert.equal(padded.length, SMART_TURN_SAMPLE_COUNT)
  assert.equal(padded[0], 0)
  assert.equal(padded[SMART_TURN_SAMPLE_COUNT - short.length - 1], 0)
  assert.equal(padded[SMART_TURN_SAMPLE_COUNT - short.length], short[0])
  assert.equal(padded[SMART_TURN_SAMPLE_COUNT - 1], short[short.length - 1])

  const long = new Float32Array(SMART_TURN_SAMPLE_COUNT + 16_000)
  for (let i = 0; i < long.length; i += 1) long[i] = i
  const trimmed = prepareSmartTurnAudio(long)
  assert.equal(trimmed.length, SMART_TURN_SAMPLE_COUNT)
  assert.equal(trimmed[0], long[long.length - SMART_TURN_SAMPLE_COUNT])
  assert.equal(trimmed[trimmed.length - 1], long[long.length - 1])
})

test('silent input stays finite and keeps the encoder shape', () => {
  const features = extractSmartTurnFeatures(new Float32Array(SMART_TURN_SAMPLE_COUNT))
  assert.equal(features.length, SMART_TURN_MEL_BINS * SMART_TURN_FRAME_COUNT)
  for (let i = 0; i < features.length; i += 1) {
    assert.equal(Number.isFinite(features[i]), true)
  }
  // All-zero audio has log10(1e-10) everywhere, so every value normalizes to
  // the same constant after the max-8 clamp.
  assert.equal(new Set(features.slice(0, 64)).size, 1)
})
