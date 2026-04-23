import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyMessageSignals,
  createDefaultEmotionState,
  decayEmotion,
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

// ── decayEmotion ───────────────────────────────────────────────────────────

test('decayEmotion pulls elevated values toward baseline', () => {
  const elevated: EmotionState = { energy: 0.9, warmth: 0.9, curiosity: 0.9, concern: 0.9 }
  const decayed = decayEmotion(elevated)
  assert.ok(decayed.energy < elevated.energy, `energy should decay, got ${decayed.energy}`)
  assert.ok(decayed.warmth < elevated.warmth)
  assert.ok(decayed.curiosity < elevated.curiosity)
  assert.ok(decayed.concern < elevated.concern)
})

test('decayEmotion lifts below-baseline values back up toward baseline', () => {
  const depleted: EmotionState = { energy: 0.05, warmth: 0.05, curiosity: 0.05, concern: 0.05 }
  const recovered = decayEmotion(depleted)
  assert.ok(recovered.energy > depleted.energy)
  assert.ok(recovered.warmth > depleted.warmth)
})

test('decayEmotion at the decay baseline is a fixed point', () => {
  // decayEmotion's BASELINE is {0.5, 0.5, 0.4, 0.15} (distinct from createDefault).
  const baseline: EmotionState = { energy: 0.5, warmth: 0.5, curiosity: 0.4, concern: 0.15 }
  const next = decayEmotion(baseline)
  assert.ok(Math.abs(next.energy - baseline.energy) < 1e-9)
  assert.ok(Math.abs(next.warmth - baseline.warmth) < 1e-9)
  assert.ok(Math.abs(next.curiosity - baseline.curiosity) < 1e-9)
  assert.ok(Math.abs(next.concern - baseline.concern) < 1e-9)
})

test('decayEmotion returns a fresh object (no mutation)', () => {
  const original = createDefaultEmotionState()
  const next = decayEmotion(original)
  assert.notEqual(next, original, 'expected new reference')
})

// ── classifyMessageSignals ─────────────────────────────────────────────────

test('classifyMessageSignals detects greetings (CN and EN)', () => {
  assert.ok(classifyMessageSignals('你好呀').includes('user_greeting'))
  assert.ok(classifyMessageSignals('Hello there').includes('user_greeting'))
  assert.ok(classifyMessageSignals('hi!').includes('user_greeting'))
})

test('classifyMessageSignals detects question marks and question words', () => {
  assert.ok(classifyMessageSignals('really?').includes('user_question'))
  assert.ok(classifyMessageSignals('为什么会这样').includes('user_question'))
  assert.ok(classifyMessageSignals('what time is it').includes('user_question'))
  assert.ok(classifyMessageSignals('这是什么？').includes('user_question'))
})

test('classifyMessageSignals detects praise', () => {
  assert.ok(classifyMessageSignals('谢谢你').includes('user_praise'))
  assert.ok(classifyMessageSignals('thanks so much').includes('user_praise'))
  assert.ok(classifyMessageSignals('awesome').includes('user_praise'))
})

test('classifyMessageSignals detects frustration', () => {
  assert.ok(classifyMessageSignals('这个破 bug 真烦').includes('user_frustration'))
  assert.ok(classifyMessageSignals('shit, not working').includes('user_frustration'))
})

test('classifyMessageSignals detects farewells', () => {
  assert.ok(classifyMessageSignals('再见').includes('user_farewell'))
  assert.ok(classifyMessageSignals('晚安').includes('user_farewell'))
  assert.ok(classifyMessageSignals('goodbye bye').includes('user_farewell'))
})

test('classifyMessageSignals returns empty for neutral statements with no signal words', () => {
  assert.deepEqual(classifyMessageSignals('今天下雨了'), [])
  assert.deepEqual(classifyMessageSignals('the room was empty'), [])
})

test('classifyMessageSignals trims leading whitespace before anchor match', () => {
  assert.ok(classifyMessageSignals('  hi').includes('user_greeting'))
})
