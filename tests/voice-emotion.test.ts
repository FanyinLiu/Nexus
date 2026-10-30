import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyEmotionSignal,
  voiceEmotionToSignal,
  createDefaultEmotionState,
} from '../src/features/autonomy/emotionModel.ts'
import type { VoiceEmotionLabel } from '../src/types'

test('voiceEmotionToSignal: maps every defined label', () => {
  const labels: VoiceEmotionLabel[] = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised']
  for (const label of labels) {
    const signal = voiceEmotionToSignal(label)
    assert.equal(signal, `voice_emotion_${label}`)
  }
})

test('applyEmotionSignal: voice_emotion_sad raises concern, lowers energy', () => {
  const initial = createDefaultEmotionState()
  const next = applyEmotionSignal(initial, 'voice_emotion_sad')
  assert.ok(next.concern > initial.concern, 'concern should increase on sad voice')
  assert.ok(next.energy < initial.energy, 'energy should drop on sad voice')
  assert.ok(next.warmth >= initial.warmth, 'warmth should not drop')
})

test('applyEmotionSignal: voice_emotion_happy raises warmth + energy', () => {
  const initial = createDefaultEmotionState()
  const next = applyEmotionSignal(initial, 'voice_emotion_happy')
  assert.ok(next.warmth > initial.warmth)
  assert.ok(next.energy > initial.energy)
})

test('applyEmotionSignal: voice_emotion_fearful raises concern strongly', () => {
  const initial = createDefaultEmotionState()
  const next = applyEmotionSignal(initial, 'voice_emotion_fearful')
  assert.ok(next.concern - initial.concern >= 0.1, 'fearful should bump concern by ≥ 0.1')
})

test('applyEmotionSignal: voice_emotion_surprised raises curiosity', () => {
  const initial = createDefaultEmotionState()
  const next = applyEmotionSignal(initial, 'voice_emotion_surprised')
  assert.ok(next.curiosity > initial.curiosity)
})

test('applyEmotionSignal: voice signals stay clamped to [0,1]', () => {
  // Saturated state — repeated signals shouldn't push anything past the bounds.
  let state = { energy: 0.95, warmth: 0.95, curiosity: 0.95, concern: 0.95 }
  for (let i = 0; i < 5; i++) {
    state = applyEmotionSignal(state, 'voice_emotion_happy')
  }
  for (const value of Object.values(state)) {
    assert.ok(value >= 0 && value <= 1, `value ${value} out of [0,1]`)
  }

  state = { energy: 0.05, warmth: 0.05, curiosity: 0.05, concern: 0.05 }
  for (let i = 0; i < 5; i++) {
    state = applyEmotionSignal(state, 'voice_emotion_sad')
  }
  for (const value of Object.values(state)) {
    assert.ok(value >= 0 && value <= 1, `value ${value} out of [0,1]`)
  }
})

test('applyEmotionSignal: voice deltas are gentler than text-classified counterparts', () => {
  // user_frustration (text) bumps concern by 0.25; voice_emotion_angry only by 0.10.
  // The asymmetry is intentional — voice prosody is noisier than text patterns.
  const initial = createDefaultEmotionState()
  const textHit = applyEmotionSignal(initial, 'user_frustration')
  const voiceHit = applyEmotionSignal(initial, 'voice_emotion_angry')
  assert.ok(
    textHit.concern - initial.concern > voiceHit.concern - initial.concern,
    'text frustration should raise concern more than voice anger',
  )
})
