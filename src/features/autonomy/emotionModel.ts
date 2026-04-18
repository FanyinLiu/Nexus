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

/**
 * Map the multi-dimensional emotion to a discrete PetMood for Live2D.
 *
 * Order of checks matters — the most distinctive states are checked first so
 * stronger feelings dominate weaker ones (e.g., high concern wins over high
 * curiosity even if both are above their thresholds).
 *
 * Available PetMoods: idle | thinking | happy | sleepy | surprised | confused | embarrassed
 */
export function emotionToPetMood(state: EmotionState): PetMood {
  // Severe states first.
  if (state.concern > 0.75) return 'confused'
  if (state.energy < 0.2) return 'sleepy'

  // Embarrassed = high warmth + high concern (flustered affection).
  if (state.warmth > 0.7 && state.concern > 0.5) return 'embarrassed'

  // Surprised = strong curiosity spike.
  if (state.curiosity > 0.75) return 'surprised'

  // Happy = warmth and energy together — low energy + warmth feels affectionate
  // but tired, so we require both.
  if (state.warmth > 0.65 && state.energy > 0.5) return 'happy'

  // Thinking = curious but not energetic — mid-curiosity with low/mid energy.
  if (state.curiosity > 0.55 && state.energy < 0.6) return 'thinking'

  // Mild lift from energy alone still reads as happy.
  if (state.energy > 0.75 && state.warmth > 0.4) return 'happy'

  // Persistent moderate concern without other strong signals → confused.
  if (state.concern > 0.5 && state.energy < 0.5) return 'confused'

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

  if (state.energy > 0.7) toneWords.push('full of energy')
  else if (state.energy < 0.3) toneWords.push('a little tired')

  if (state.warmth > 0.7) toneWords.push('especially warm')
  else if (state.warmth < 0.3) toneWords.push('somewhat reserved')

  if (state.curiosity > 0.7) toneWords.push('full of curiosity')
  if (state.concern > 0.6) toneWords.push('a little worried')

  if (toneWords.length === 0) return ''
  return `Current emotional state: ${toneWords.join(', ')}. Let this emotion come through naturally in your reply.`
}
