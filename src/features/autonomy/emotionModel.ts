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

import { classifyByPatterns, driftToward } from '../../lib/common.ts'
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

export function normalizeEmotionState(value: unknown): EmotionState {
  const fallback = createDefaultEmotionState()
  if (!value || typeof value !== 'object') return fallback
  const obj = value as Partial<Record<keyof EmotionState, unknown>>
  return {
    energy: normalizeEmotionAxis(obj.energy, fallback.energy),
    warmth: normalizeEmotionAxis(obj.warmth, fallback.warmth),
    curiosity: normalizeEmotionAxis(obj.curiosity, fallback.curiosity),
    concern: normalizeEmotionAxis(obj.concern, fallback.concern),
  }
}

function normalizeEmotionAxis(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value)
    : fallback
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
  // Prosody-based signals from SenseVoice's inline emotion tag. Smaller
  // deltas than text-classified signals because voice emotion detection
  // is noisier — a single misread shouldn't shove the model around. The
  // model still takes the hint that "she heard the user sound tired"
  // even if the magnitude is gentle.
  | 'voice_emotion_happy'
  | 'voice_emotion_sad'
  | 'voice_emotion_angry'
  | 'voice_emotion_fearful'
  | 'voice_emotion_disgusted'
  | 'voice_emotion_surprised'
  // Companion-side empathy/awareness signals. These describe what SHE
  // noticed about the user's world, so they must never be projected back
  // into the user-affect timeline (that would be a feedback loop: the
  // observation was derived from that very timeline).
  | 'user_low_mood_observed'
  | 'missed_message_noticed'
  // Idle-arc signals (resolved by resolveIdleArcSignals below): winding
  // down, starting to miss the user, and the warm spike of reunion.
  | 'long_absence'
  | 'reunion'
  // The LLM read the user's mood as clearly positive (deep-emotion channel).
  | 'user_mood_uplift_observed'

const SIGNAL_DELTAS: Record<EmotionSignal, Partial<EmotionState>> = {
  user_greeting:     { energy: 0.1, warmth: 0.15, curiosity: 0.05 },
  user_question:     { curiosity: 0.2, energy: 0.05 },
  user_praise:       { warmth: 0.2, energy: 0.1 },
  user_frustration:  { concern: 0.25, warmth: 0.1, energy: -0.05 },
  user_farewell:     { energy: -0.1, warmth: 0.05 },
  long_idle:         { energy: -0.15, curiosity: -0.1 },
  user_returned:     { energy: 0.15, warmth: 0.1, curiosity: 0.1 },
  error_occurred:    { concern: 0.2, energy: -0.05 },
  // Empathy: the user's 14-day affect window reads stuck-low / recent-drop.
  // She genuinely worries and softens — gated by a long cooldown upstream
  // so repeated classification can't ratchet concern every turn.
  user_low_mood_observed: { concern: 0.15, warmth: 0.1, energy: -0.05 },
  // Someone tried to reach the user while they were away. A small flicker
  // of attentiveness — enough to color tone, not enough to dominate.
  missed_message_noticed: { concern: 0.05, curiosity: 0.05 },
  // 4+ hours away: she starts to wonder where you are. Once per absence.
  long_absence:      { concern: 0.12, energy: -0.1 },
  // You're back after a long absence — a genuine warm spike, the emotional
  // truth behind "你回来了！". Big enough to read as 'especially
  // affectionate' in the prompt tone for a little while.
  reunion:           { warmth: 0.25, energy: 0.2, curiosity: 0.05 },
  user_mood_uplift_observed: { warmth: 0.1, energy: 0.08 },
  task_completed:    { energy: 0.1, warmth: 0.05, concern: -0.1 },
  morning:           { energy: 0.1, curiosity: 0.05 },
  late_night:        { energy: -0.2, concern: 0.1 },
  voice_emotion_happy:     { energy: 0.05, warmth: 0.08 },
  voice_emotion_sad:       { concern: 0.12, warmth: 0.06, energy: -0.04 },
  voice_emotion_angry:     { concern: 0.10, energy: -0.04 },
  voice_emotion_fearful:   { concern: 0.14, warmth: 0.04, energy: -0.05 },
  voice_emotion_disgusted: { concern: 0.06, warmth: -0.03 },
  voice_emotion_surprised: { curiosity: 0.10, energy: 0.05 },
}

/** Natural decay per tick — emotions drift toward neutral baseline. */
const DECAY_RATE = 0.02
const BASELINE: EmotionState = { energy: 0.5, warmth: 0.5, curiosity: 0.4, concern: 0.15 }

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Apply a signal to the emotion state. */
// ── LLM mood reads (deep-emotion channel) ────────────────────────────────────
//
// The reply model appends an invisible [mood:<word>-<0-9>] tag — its read of
// the USER's emotional state with the full conversation in view. This is the
// channel regex keywords can never reach ("我今天被裁了" has no sad keyword).
// Two consumers: a VAD sample for the user-affect timeline, and (for clear
// reads) a companion empathy signal.

import type { UserMoodWord } from '../pet/performance.ts'

const MOOD_READ_VAD: Record<UserMoodWord, { valence: number; arousal: number }> = {
  happy:      { valence: 0.6,  arousal: 0.5 },
  excited:    { valence: 0.7,  arousal: 0.8 },
  calm:       { valence: 0.3,  arousal: 0.2 },
  neutral:    { valence: 0,    arousal: 0.3 },
  tired:      { valence: -0.2, arousal: 0.15 },
  sad:        { valence: -0.6, arousal: 0.25 },
  anxious:    { valence: -0.4, arousal: 0.7 },
  frustrated: { valence: -0.5, arousal: 0.65 },
  angry:      { valence: -0.7, arousal: 0.8 },
}

/** Intensity (0-9) scales the valence magnitude; arousal shifts mildly. */
export function userMoodReadToVAD(mood: UserMoodWord, intensity: number): { valence: number; arousal: number } {
  const base = MOOD_READ_VAD[mood]
  const scale = 0.4 + 0.6 * (Math.min(9, Math.max(0, intensity)) / 9)
  return {
    valence: Math.max(-1, Math.min(1, base.valence * scale)),
    arousal: Math.max(0, Math.min(1, base.arousal * (0.7 + 0.3 * scale))),
  }
}

/**
 * Map a clear mood read to a companion empathy signal; mild/neutral reads
 * return null (the VAD sample still lands — restraint on the emotion side).
 */
export function userMoodReadToEmotionSignal(mood: UserMoodWord, intensity: number): EmotionSignal | null {
  if (intensity < 4) return null
  switch (mood) {
    case 'sad':
    case 'anxious':
      return 'user_low_mood_observed'
    case 'frustrated':
    case 'angry':
      return 'user_frustration'
    case 'happy':
    case 'excited':
      return 'user_mood_uplift_observed'
    default:
      return null
  }
}

export const LONG_IDLE_THRESHOLD_SECONDS = 600
export const LONG_ABSENCE_THRESHOLD_SECONDS = 4 * 60 * 60

export type IdleArcTracker = {
  longIdleFired: boolean
  longAbsenceFired: boolean
  /** Peak idle seconds seen in the current episode (for reunion detection). */
  peakIdleSeconds: number
}

export function createIdleArcTracker(): IdleArcTracker {
  return { longIdleFired: false, longAbsenceFired: false, peakIdleSeconds: 0 }
}

/**
 * Resolve which idle-arc signals fire on this tick. Pure: the caller owns
 * the tracker. Fixes the original always-on bug where long_idle re-applied
 * every tick during idleness — −0.15 energy every ~6 s pinned the state to
 * the floor within a minute, which the 2%/tick decay could never recover.
 * Each phase of the arc now fires exactly once per idle episode:
 *   10 min  → long_idle      (winding down)
 *    4 h    → long_absence   (starting to miss you)
 *   return  → reunion        (only after a long absence)
 */
export function resolveIdleArcSignals(
  tracker: IdleArcTracker,
  idleSeconds: number,
): { signals: EmotionSignal[]; tracker: IdleArcTracker } {
  const signals: EmotionSignal[] = []
  const next = { ...tracker }

  if (idleSeconds > LONG_IDLE_THRESHOLD_SECONDS) {
    next.peakIdleSeconds = Math.max(next.peakIdleSeconds, idleSeconds)
    if (!next.longIdleFired) {
      next.longIdleFired = true
      signals.push('long_idle')
    }
    if (!next.longAbsenceFired && idleSeconds >= LONG_ABSENCE_THRESHOLD_SECONDS) {
      next.longAbsenceFired = true
      signals.push('long_absence')
    }
    return { signals, tracker: next }
  }

  // Idle episode over. Reunion only when the absence was long enough to
  // have been missed — short coffee breaks come and go silently.
  if (next.peakIdleSeconds >= LONG_ABSENCE_THRESHOLD_SECONDS) {
    signals.push('reunion')
  }
  return {
    signals,
    tracker: createIdleArcTracker(),
  }
}

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
  return driftToward(state, BASELINE, DECAY_RATE)
}

// ── Mood mapping ────────────────────────────────────────────────────────────

/**
 * Map the multi-dimensional emotion to a discrete PetMood for Live2D +
 * prompt tone + presence-line selection.
 *
 * Order of checks matters — the most distinctive combinations are matched
 * first so stronger feelings dominate weaker ones (e.g., high concern wins
 * over high curiosity even if both are above their thresholds).
 *
 * Ordering layers, strongest → weakest:
 *   1. Severe/overriding singles: worried (high concern), sleepy (low energy)
 *   2. Multi-axis distinctive peaks: excited, playful, affectionate, proud
 *   3. Warmth + concern pairs: embarrassed
 *   4. Curiosity bursts vs sustained: surprised (burst) / curious (sustained)
 *   5. Classic happy / thinking
 *   6. Residual concern → confused
 *   7. Default: idle
 */
export function emotionToPetMood(state: EmotionState): PetMood {
  // Severe states first.
  if (state.concern > 0.8) return 'worried'
  if (state.concern > 0.6 && state.energy < 0.55) return 'worried'
  if (state.energy < 0.2) return 'sleepy'

  // Excited = full energy + strong curiosity. Most distinctive upward state.
  if (state.energy > 0.8 && state.curiosity > 0.65) return 'excited'

  // Playful = high energy + high warmth + calm (low concern). Bouncy, teasing.
  if (state.energy > 0.7 && state.warmth > 0.7 && state.concern < 0.3) return 'playful'

  // Affectionate = sustained warmth at a gentler energy level — softer than happy.
  if (state.warmth > 0.8 && state.energy >= 0.4 && state.energy <= 0.7) return 'affectionate'

  // Proud = task_completed lift — raised energy + warmth, concern fully relaxed.
  if (state.energy > 0.65 && state.warmth > 0.6 && state.concern < 0.2) return 'proud'

  // Embarrassed = high warmth + elevated concern (flustered affection).
  if (state.warmth > 0.7 && state.concern > 0.5) return 'embarrassed'

  // Surprised = sharp curiosity spike with lifted energy (burst).
  if (state.curiosity > 0.8 && state.energy > 0.6) return 'surprised'

  // Curious = sustained high curiosity without the energy spike (attentive).
  if (state.curiosity > 0.7) return 'curious'

  // Happy = warmth and energy together — low energy + warmth feels affectionate
  // but tired (covered by 'affectionate' above), so require both lifted here.
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

const EMOTION_SIGNAL_PATTERNS: ReadonlyArray<{ signal: EmotionSignal; pattern: RegExp }> = [
  { signal: 'user_greeting', pattern: /^(你好|早上好|嗨|hi|hello|hey|早|早安|午安)/i },
  { signal: 'user_farewell', pattern: /(再见|拜拜|bye|晚安|下次见|回头见)/i },
  { signal: 'user_question', pattern: /^(为什么|怎么|什么|哪|谁|how|what|why|where|when|who)|[?？]$/i },
  { signal: 'user_praise', pattern: /(谢谢|棒|厉害|不错|好的|太好了|感谢|真棒|666|nice|great|awesome|thanks|thank you)/i },
  { signal: 'user_frustration', pattern: /(烦|不行|错了|废物|垃圾|没用|bug|坏了|崩溃|shit|damn|frustrated)/i },
]

/** Classify a user message into emotion signals (simple heuristic, no LLM). */
export function classifyMessageSignals(text: string): EmotionSignal[] {
  return classifyByPatterns(text.trim(), EMOTION_SIGNAL_PATTERNS)
}

/**
 * Map a SenseVoice prosody label to its emotion-model signal counterpart.
 * Returns `null` for labels that don't correspond to a defined signal —
 * NEUTRAL / EMO_UNKNOWN never reach this point because the parser
 * returns `null` for them, but the type-narrow helps consumers.
 */
import type { VoiceEmotionLabel } from '../../types'
export function voiceEmotionToSignal(label: VoiceEmotionLabel): EmotionSignal {
  switch (label) {
    case 'happy': return 'voice_emotion_happy'
    case 'sad': return 'voice_emotion_sad'
    case 'angry': return 'voice_emotion_angry'
    case 'fearful': return 'voice_emotion_fearful'
    case 'disgusted': return 'voice_emotion_disgusted'
    case 'surprised': return 'voice_emotion_surprised'
  }
}

// ── Prompt context ──────────────────────────────────────────────────────────

/** Format emotion state as a tone guide for the LLM system prompt. */
/**
 * How far the relationship has grown, in three bands. The same felt emotion
 * should express differently by stage: reserved while still getting to know
 * each other, open and direct once close. emotionModel owns this coarse enum
 * so it stays free of the relationship module (which already imports from
 * here — a `RelationshipLevel` import back would be a cycle); the caller maps
 * the 5-level relationship to one of these three.
 */
export type RelationshipCloseness = 'early' | 'established' | 'close'

export function formatEmotionForPrompt(
  state: EmotionState,
  closeness: RelationshipCloseness = 'established',
): string {
  const toneWords: string[] = []

  // Energy axis — three bands rather than two, so the prompt distinguishes
  // 'bouncy' from 'tired' from 'calm neutral'.
  if (state.energy > 0.8) toneWords.push('bouncing with energy')
  else if (state.energy > 0.7) toneWords.push('full of energy')
  else if (state.energy < 0.25) toneWords.push('sleepy and slow')
  else if (state.energy < 0.35) toneWords.push('a little tired')

  // Warmth axis — three bands, plus the distinctive "tender" intersection
  // when warmth dominates energy (sustained-care feel).
  if (state.warmth > 0.8) toneWords.push('especially affectionate')
  else if (state.warmth > 0.65) toneWords.push('warm')
  else if (state.warmth < 0.3) toneWords.push('somewhat reserved')

  if (state.curiosity > 0.8) toneWords.push('eyes lighting up with curiosity')
  else if (state.curiosity > 0.65) toneWords.push('curious')

  if (state.concern > 0.75) toneWords.push('genuinely worried')
  else if (state.concern > 0.55) toneWords.push('a little concerned')

  // Combined shade: post-success streak — the "proud" mood tone.
  if (state.energy > 0.65 && state.warmth > 0.6 && state.concern < 0.2) {
    toneWords.push('quietly proud of how things are going')
  }

  if (toneWords.length === 0) return ''
  // The felt state is the same; the relationship stage shapes how openly it
  // shows. 'established' (friend) is the natural default — no extra clause.
  const stageClause = closeness === 'early'
    ? ' Since you are still early in getting to know each other, keep how it shows light and unimposing.'
    : closeness === 'close'
      ? ' You two are close now, so you can let it show openly and directly.'
      : ''
  return `Current emotional state: ${toneWords.join(', ')}. Let this emotion come through naturally in your reply.${stageClause}`
}

/** Map the 5-level relationship to the 3-band closeness emotionModel uses. */
export function relationshipLevelToCloseness(
  level: 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'intimate',
): RelationshipCloseness {
  if (level === 'stranger' || level === 'acquaintance') return 'early'
  if (level === 'close_friend' || level === 'intimate') return 'close'
  return 'established'
}

// ── Emotion-driven proactivity ───────────────────────────────────────────────
//
// The autonomy decision engine used to see emotion as a bare number line
// (energy=0.50 warmth=0.50 ...) with no guidance — pure narrator context.
// resolveProactiveLean translates the four axes into ONE actionable leaning
// that colors the character of a proactive moment, and at the margins nudges
// the speak/stay-quiet boundary. It never overrides upstream suppression
// (quiet hours, away/locked, cost caps still gate everything): a 'rest_quiet'
// lean only makes silence more likely when she's already deciding, and a
// 'check_in_gently' lean only shapes HOW she reaches out when reaching out is
// already appropriate. Restraint-first: worry and tiredness bias toward
// gentleness/quiet; only a genuinely bright state leans outward.

export type ProactiveLean =
  | 'check_in_gently'
  | 'rest_quiet'
  | 'playful_share'
  | 'reach_out_warmly'
  | 'neutral'

export function resolveProactiveLean(state: EmotionState): ProactiveLean {
  // Worry is the most action-relevant: a gentle check-in takes precedence.
  if (state.concern > 0.6) return 'check_in_gently'
  // Tired (and not worried) → prefer quiet; don't manufacture energy.
  if (state.energy < 0.3) return 'rest_quiet'
  // Bright and inquisitive, with nothing weighing on her → playful share.
  if (state.energy > 0.65 && state.curiosity > 0.65 && state.concern < 0.4) return 'playful_share'
  // Tender and not flat → if she does reach out, do it warmly.
  if (state.warmth > 0.7 && state.energy >= 0.4 && state.concern < 0.4) return 'reach_out_warmly'
  return 'neutral'
}
