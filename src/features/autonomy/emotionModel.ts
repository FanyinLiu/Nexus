/**
 * Multi-dimensional emotion state model.
 *
 * Four continuous dimensions (0–1):
 *   - energy:    low = tired/calm, high = excited/active
 *   - warmth:    low = distant/formal, high = affectionate/friendly
 *   - curiosity: low = disengaged, high = interested/questioning
 *   - concern:   low = relaxed, high = worried/attentive
 *
 * Updated after each interaction based on context signals.
 * Drives system prompt tone parameters and Live2D mood mapping.
 */

import type { PetMood } from '../../types'

export interface EmotionState {
  energy: number
  warmth: number
  curiosity: number
  concern: number
}

export function createDefaultEmotionState(): EmotionState {
  return { energy: 0.5, warmth: 0.6, curiosity: 0.5, concern: 0.2 }
}

// ── Update signals ──────────────────────────────────────────────────────────

export type EmotionSignal =
  | 'user_greeting'
  | 'user_question'
  | 'user_praise'
  | 'user_frustration'
  | 'user_farewell'
  | 'long_idle'
  | 'user_returned'
  | 'error_occurred'
  | 'task_completed'
  | 'morning'
  | 'late_night'

const SIGNAL_DELTAS: Record<EmotionSignal, Partial<EmotionState>> = {
  user_greeting:     { energy: 0.1, warmth: 0.15, curiosity: 0.05 },
  user_question:     { curiosity: 0.2, energy: 0.05 },
  user_praise:       { warmth: 0.2, energy: 0.1 },
  user_frustration:  { concern: 0.25, warmth: 0.1, energy: -0.05 },
  user_farewell:     { energy: -0.1, warmth: 0.05 },
  long_idle:         { energy: -0.15, curiosity: -0.1 },
  user_returned:     { energy: 0.15, warmth: 0.1, curiosity: 0.1 },
  error_occurred:    { concern: 0.2, energy: -0.05 },
  task_completed:    { energy: 0.1, warmth: 0.05, concern: -0.1 },
  morning:           { energy: 0.1, curiosity: 0.05 },
  late_night:        { energy: -0.2, concern: 0.1 },
}

/** Natural decay per tick — emotions drift toward neutral baseline. */
const DECAY_RATE = 0.02
const BASELINE: EmotionState = { energy: 0.5, warmth: 0.5, curiosity: 0.4, concern: 0.15 }

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Apply a signal to the emotion state. */
export function applyEmotionSignal(state: EmotionState, signal: EmotionSignal): EmotionState {
  const deltas = SIGNAL_DELTAS[signal]
  return {
    energy: clamp(state.energy + (deltas.energy ?? 0)),
    warmth: clamp(state.warmth + (deltas.warmth ?? 0)),
    curiosity: clamp(state.curiosity + (deltas.curiosity ?? 0)),
    concern: clamp(state.concern + (deltas.concern ?? 0)),
  }
}

/** Decay emotion state toward baseline (call once per tick). */
export function decayEmotion(state: EmotionState): EmotionState {
  return {
    energy: state.energy + (BASELINE.energy - state.energy) * DECAY_RATE,
    warmth: state.warmth + (BASELINE.warmth - state.warmth) * DECAY_RATE,
    curiosity: state.curiosity + (BASELINE.curiosity - state.curiosity) * DECAY_RATE,
    concern: state.concern + (BASELINE.concern - state.concern) * DECAY_RATE,
  }
}

// ── Mood mapping ────────────────────────────────────────────────────────────

/** Map the multi-dimensional emotion to a discrete PetMood for Live2D. */
export function emotionToPetMood(state: EmotionState): PetMood {
  if (state.concern > 0.7) return 'confused'
  if (state.energy < 0.25) return 'sleepy'
  if (state.warmth > 0.7 && state.energy > 0.5) return 'happy'
  if (state.curiosity > 0.7) return 'surprised'
  if (state.energy > 0.7) return 'happy'
  if (state.warmth < 0.3) return 'idle'
  return 'idle'
}

// ── Message signal classification ──────────────────────────────────────────

/** Classify a user message into emotion signals (simple heuristic, no LLM). */
export function classifyMessageSignals(text: string): EmotionSignal[] {
  const signals: EmotionSignal[] = []
  const t = text.trim().toLowerCase()

  if (/^(你好|早上好|嗨|hi|hello|hey|早|早安|午安)/.test(t)) {
    signals.push('user_greeting')
  }
  if (/(再见|拜拜|bye|晚安|下次见|回头见)/.test(t)) {
    signals.push('user_farewell')
  }
  if (/[?？]$/.test(t) || /^(为什么|怎么|什么|哪|谁|how|what|why|where|when|who)/.test(t)) {
    signals.push('user_question')
  }
  if (/(谢谢|棒|厉害|不错|好的|太好了|感谢|真棒|666|nice|great|awesome|thanks|thank you)/i.test(t)) {
    signals.push('user_praise')
  }
  if (/(烦|不行|错了|废物|垃圾|没用|bug|坏了|崩溃|shit|damn|frustrated)/i.test(t)) {
    signals.push('user_frustration')
  }

  return signals
}

// ── Prompt context ──────────────────────────────────────────────────────────

/** Format emotion state as a tone guide for the LLM system prompt. */
export function formatEmotionForPrompt(state: EmotionState): string {
  const toneWords: string[] = []

  if (state.energy > 0.7) toneWords.push('充满活力')
  else if (state.energy < 0.3) toneWords.push('有些疲惫')

  if (state.warmth > 0.7) toneWords.push('格外亲切')
  else if (state.warmth < 0.3) toneWords.push('稍显克制')

  if (state.curiosity > 0.7) toneWords.push('充满好奇')
  if (state.concern > 0.6) toneWords.push('有些担心')

  if (toneWords.length === 0) return ''
  return `当前情绪状态：${toneWords.join('、')}。请在回复中自然体现这种情绪。`
}
