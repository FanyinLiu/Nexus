/**
 * Affective memory retrieval — emotional resonance scoring.
 *
 * Given the user's current emotion state and a memory's emotion snapshot,
 * compute an additive boost in [0, MAX_EMOTION_BOOST] for the recall ranker.
 *
 * Design (three components, all gated by current emotional intensity):
 *
 *   1. VAD projection — project the 4D emotion into (valence, arousal).
 *   2. Regulatory mode — detect whether the companion should match, empathize,
 *      or repair the user's mood, and flip the resonance direction accordingly.
 *   3. Priming coherence — nudge toward the emotional neighborhood of recent
 *      recalls so the narrative doesn't whiplash.
 *
 * References: Russell (1980) circumplex model, Bower (1981) mood-congruent
 * recall, Gross emotion regulation, Neely (1977) spreading activation.
 */

import type { EmotionState } from '../autonomy/emotionModel.ts'
import type { EmotionalValence } from '../../types/index.ts'

export const MAX_EMOTION_BOOST = 0.15

// VA space: valence ∈ [-1, 1], arousal ∈ [0, 1]
// Max Euclidean distance in that box is sqrt(2^2 + 1^2) = sqrt(5)
const MAX_VA_DISTANCE = Math.sqrt(5)
const NEUTRAL_POINT: VAPoint = { valence: 0, arousal: 0.5 }

export interface VAPoint {
  valence: number
  arousal: number
}

/** Project a 4D emotion state onto Russell's 2D circumplex. */
export function projectToVA(state: EmotionState): VAPoint {
  return {
    valence: state.warmth - state.concern,
    arousal: (state.energy + state.curiosity) / 2,
  }
}

function vaDistance(a: VAPoint, b: VAPoint): number {
  const dv = a.valence - b.valence
  const da = a.arousal - b.arousal
  return Math.sqrt(dv * dv + da * da)
}

function normalizedDistance(a: VAPoint, b: VAPoint): number {
  return vaDistance(a, b) / MAX_VA_DISTANCE
}

// ── Regulatory mode ────────────────────────────────────────────────────────

/**
 * The companion's strategic stance toward the user's current emotion:
 *
 *   - empathy:   match sad with sad, witness pain (user asked to be heard)
 *   - repair:    surface uplifting memories to help the user reframe
 *   - reinforce: match the current mood (default — resonance as similarity)
 */
export type RegulatoryMode = 'empathy' | 'repair' | 'reinforce'

const EMPATHY_CUE = /(陪陪我|陪我|安慰|倾诉|听我说|说说话|说话陪|需要你|抱抱|comfort|listen to me|need you|hold me)/i
const REPAIR_CUE = /(别提了|不想说|换个话题|算了|不聊这个|说点别的|stop|change.{0,6}topic|move on|don['’]t want to talk)/i

/**
 * Detect whether to match, empathize, or repair. Cues in the current user
 * message dominate; emotion intensity is the tiebreaker.
 */
export function detectRegulatoryMode(
  currentEmotion: EmotionState,
  userMessage: string | undefined,
): RegulatoryMode {
  const text = userMessage?.trim() ?? ''

  if (text && EMPATHY_CUE.test(text) && currentEmotion.concern > 0.5) {
    return 'empathy'
  }
  if (text && REPAIR_CUE.test(text)) {
    return 'repair'
  }
  // Heavy sustained distress with no explicit cue — lean toward repair so
  // the companion surfaces something hopeful rather than deepening the dip.
  if (currentEmotion.concern > 0.8 && currentEmotion.warmth < 0.35) {
    return 'repair'
  }
  return 'reinforce'
}

// ── Component scoring ──────────────────────────────────────────────────────

/** Directional closeness in VA space, 1 = same point, 0 = diagonal opposite. */
function resonance(current: VAPoint, memory: VAPoint): number {
  return 1 - normalizedDistance(current, memory)
}

/** How far the memory is from neutral — emotional charge / memorability. */
function salience(memory: VAPoint): number {
  return normalizedDistance(memory, NEUTRAL_POINT)
}

/** How intense the user's current state is — gates whether we intervene. */
function intensity(current: VAPoint): number {
  return normalizedDistance(current, NEUTRAL_POINT)
}

// ── Valence fallback ───────────────────────────────────────────────────────

/**
 * Map a discrete valence label to a representative point in VA space.
 * Used when a memory has `emotionalValence` but no `emotionSnapshot`.
 */
function valenceToVA(valence: EmotionalValence): VAPoint {
  switch (valence) {
    case 'positive': return { valence: 0.7, arousal: 0.65 }
    case 'negative': return { valence: -0.7, arousal: 0.55 }
    case 'mixed':    return { valence: 0, arousal: 0.6 }
    case 'neutral':
    default:         return { valence: 0, arousal: 0.4 }
  }
}

// ── Priming coherence ──────────────────────────────────────────────────────

/**
 * Running record of the last few recalls' emotional centroids. Used to nudge
 * subsequent recalls toward the same emotional neighborhood so the conversation
 * doesn't whiplash across unrelated moods.
 *
 * Kept in-memory (not persisted) — cold starts read nothing, and a few turns
 * of warmup is enough to fill it.
 */
const PRIMING_CAPACITY = 3
const primingBuffer: VAPoint[] = []

export function recordPrimingCentroid(point: VAPoint): void {
  primingBuffer.push(point)
  if (primingBuffer.length > PRIMING_CAPACITY) {
    primingBuffer.shift()
  }
}

export function clearPrimingBuffer(): void {
  primingBuffer.length = 0
}

/** Mean of the priming ring buffer, or null if empty. */
function primingCentroid(): VAPoint | null {
  if (primingBuffer.length === 0) return null
  let v = 0, a = 0
  for (const p of primingBuffer) { v += p.valence; a += p.arousal }
  return { valence: v / primingBuffer.length, arousal: a / primingBuffer.length }
}

// ── Composite boost ────────────────────────────────────────────────────────

export interface ResonanceInput {
  currentEmotion: EmotionState
  memorySnapshot?: EmotionState
  memoryValence?: EmotionalValence
  mode: RegulatoryMode
}

/**
 * Compute the final emotion-resonance boost in [0, MAX_EMOTION_BOOST].
 *
 * Scoring per mode (intensity-gated so neutral users get no biased recalls):
 *
 *   reinforce:  directional = 0.7 * resonance + 0.3 * salience
 *               (soft match, with a memorability bonus)
 *   empathy:    directional = resonance * salience
 *               (match on tone AND be emotionally weighty — a vivid but
 *                unrelated memory should NOT beat a matching sad memory)
 *   repair:     directional = (1 - resonance) * max(memoryValence, 0)
 *               (want distant, positive memories for mood repair)
 *
 *   priming   = 0.15 * (1 - normDist(memory, primingCentroid))
 *               (coherence with the last few recalls, if any)
 *   boost     = intensity(current) * (directional + priming)  clamped to [0, MAX]
 */
export function computeEmotionResonance({
  currentEmotion,
  memorySnapshot,
  memoryValence,
  mode,
}: ResonanceInput): number {
  const currentVA = projectToVA(currentEmotion)
  const memoryVA = memorySnapshot
    ? projectToVA(memorySnapshot)
    : memoryValence
      ? valenceToVA(memoryValence)
      : null

  if (!memoryVA) return 0

  const gate = intensity(currentVA)
  if (gate < 0.05) return 0

  const res = resonance(currentVA, memoryVA)
  const sal = salience(memoryVA)

  let directional: number
  switch (mode) {
    case 'empathy':
      directional = res * sal
      break
    case 'repair':
      directional = (1 - res) * Math.max(memoryVA.valence, 0)
      break
    case 'reinforce':
    default:
      directional = 0.7 * res + 0.3 * sal
      break
  }

  let priming = 0
  const centroid = primingCentroid()
  if (centroid) {
    priming = 0.15 * (1 - normalizedDistance(memoryVA, centroid))
  }

  const raw = gate * (directional + priming)
  return Math.min(MAX_EMOTION_BOOST, Math.max(0, raw * MAX_EMOTION_BOOST))
}

// ── Test helpers ───────────────────────────────────────────────────────────

/** Expose for testing only. Do not use in production code. */
export const _internals = {
  MAX_VA_DISTANCE,
  NEUTRAL_POINT,
  vaDistance,
  normalizedDistance,
  resonance,
  salience,
  intensity,
  valenceToVA,
  primingCentroid,
  primingBuffer,
}
