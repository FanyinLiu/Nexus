import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createDefaultEmotionState,
  emotionToPetMood,
  formatEmotionForPrompt,
  type EmotionState,
} from '../src/features/autonomy/emotionModel.ts'

// Helper: produce an emotion state with overrides on top of the neutral
// baseline so each test reads as a delta rather than a wall of numbers.
function withState(overrides: Partial<EmotionState>): EmotionState {
  return { ...createDefaultEmotionState(), ...overrides }
}

// ── Original 7 moods ───────────────────────────────────────────────────────

test('emotionToPetMood returns idle for the neutral baseline', () => {
  assert.equal(emotionToPetMood(createDefaultEmotionState()), 'idle')
})

test('low energy → sleepy', () => {
  assert.equal(emotionToPetMood(withState({ energy: 0.1 })), 'sleepy')
})

test('very high concern → worried (was confused pre-v0.2.7+)', () => {
  // 0.85 concern was previously confused; now it reads as the distinctive
  // 'worried' state so the presence-line and tone can differ.
  assert.equal(emotionToPetMood(withState({ concern: 0.85 })), 'worried')
})

test('moderate concern + low energy → worried', () => {
  assert.equal(emotionToPetMood(withState({ concern: 0.65, energy: 0.4 })), 'worried')
})

test('warmth + concern spike → embarrassed', () => {
  assert.equal(emotionToPetMood(withState({ warmth: 0.8, concern: 0.6, energy: 0.5 })), 'embarrassed')
})

test('sustained mild curiosity + low energy → thinking', () => {
  assert.equal(emotionToPetMood(withState({ curiosity: 0.6, energy: 0.4, warmth: 0.5 })), 'thinking')
})

// ── New fine-grained moods ─────────────────────────────────────────────────

test('high energy + high curiosity → excited', () => {
  assert.equal(emotionToPetMood(withState({ energy: 0.85, curiosity: 0.7, warmth: 0.5 })), 'excited')
})

test('high energy + high warmth + calm → playful', () => {
  assert.equal(emotionToPetMood(withState({ energy: 0.75, warmth: 0.75, concern: 0.1 })), 'playful')
})

test('very high warmth at moderate energy → affectionate', () => {
  assert.equal(emotionToPetMood(withState({ warmth: 0.85, energy: 0.55, concern: 0.3 })), 'affectionate')
})

test('post task-completed lift with zero concern → proud', () => {
  assert.equal(emotionToPetMood(withState({ energy: 0.7, warmth: 0.65, concern: 0.15 })), 'proud')
})

test('burst curiosity with lifted energy → surprised', () => {
  assert.equal(emotionToPetMood(withState({ curiosity: 0.85, energy: 0.7, warmth: 0.5 })), 'surprised')
})

test('sustained curiosity without the energy spike → curious', () => {
  assert.equal(emotionToPetMood(withState({ curiosity: 0.75, energy: 0.5, warmth: 0.5 })), 'curious')
})

// ── Ordering guarantees ────────────────────────────────────────────────────

test('worried dominates playful when both thresholds cross (severe state wins)', () => {
  // High energy + warmth would be playful, but high concern should override.
  assert.equal(
    emotionToPetMood(withState({ energy: 0.8, warmth: 0.75, concern: 0.85 })),
    'worried',
  )
})

test('sleepy dominates curious when energy is very low', () => {
  assert.equal(
    emotionToPetMood(withState({ energy: 0.15, curiosity: 0.8 })),
    'sleepy',
  )
})

// ── Prompt text changes ────────────────────────────────────────────────────

test('formatEmotionForPrompt emits "bouncing with energy" at very high energy', () => {
  const text = formatEmotionForPrompt(withState({ energy: 0.85 }))
  assert.ok(text.includes('bouncing with energy'), text)
})

test('formatEmotionForPrompt emits "quietly proud" for the proud shade', () => {
  const text = formatEmotionForPrompt(withState({ energy: 0.7, warmth: 0.65, concern: 0.15 }))
  assert.ok(text.includes('quietly proud'), text)
})

test('formatEmotionForPrompt returns empty string at neutral baseline', () => {
  assert.equal(formatEmotionForPrompt(createDefaultEmotionState()), '')
})
