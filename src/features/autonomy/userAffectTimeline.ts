/**
 * User-side affect timeline.
 *
 * Distinct from `stateTimeline.ts` which captures the **companion's**
 * emotion state. This module captures what we infer about the **user's**
 * affect from their messages and voice prosody. The two together let
 * downstream features (Sunday letter, monthly mood map, annual yearbook,
 * co-regulation report) say things like "your baseline lifted from 0.42
 * to 0.55 over March" or "the two of you synchronized hardest on the
 * mornings she did the bracket."
 *
 * Sources of user affect:
 *  - SenseVoice prosody label  → mapped to a VAD-style sample
 *  - Text classifier signals    → mapped to a VAD-style sample
 *  - Relationship signal hits   → secondary, lighter weight
 *
 * Retention is the same 1-year window stateTimeline uses (see notes there
 * for the storage budget — ~1-3 MB / year). Pruning by age happens on
 * every write, with a hard count cap as a runaway-write safety belt.
 *
 * The on-disk schema and the in-memory cache pattern mirror
 * stateTimeline so the diagnostics panel can render either series with
 * the same code.
 */

import {
  USER_AFFECT_HISTORY_STORAGE_KEY,
  readJson,
  writeJsonDebounced,
} from '../../lib/storage/core.ts'
import type { VoiceEmotionLabel } from '../../types'

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000  // 1-year window
const HARD_CAP = 36_000   // safety belt: ~100/day × 365 days
const DEDUP_MS = 30_000   // collapse rapid-fire samples (typing bursts) into one

export type UserAffectSource = 'voice_prosody' | 'text_signal' | 'relationship'

export interface UserAffectSample {
  ts: string
  /** -1..1; positive = pleasant, negative = unpleasant. Russell circumplex valence axis. */
  valence: number
  /** 0..1; activation. High = excited / agitated; low = calm / tired. */
  arousal: number
  source: UserAffectSource
  /**
   * Confidence in the inference. Voice prosody is mid-confidence (~0.6
   * out of the box; SenseVoice misreads happen). Text signals are higher
   * (regex matches the literal word). Caller can downstream-filter on
   * confidence when it matters.
   */
  confidence: number
  /** Optional small label for "what triggered this sample" — used by the
   *  diagnostics panel and yearbook annotations. */
  note?: string
}

let cache: UserAffectSample[] | null = null

function loadInternal(): UserAffectSample[] {
  if (!cache) {
    cache = readJson<UserAffectSample[]>(USER_AFFECT_HISTORY_STORAGE_KEY, [])
  }
  return cache
}

function pruneByAge(history: UserAffectSample[], nowMs: number): UserAffectSample[] {
  const cutoffMs = nowMs - RETENTION_MS
  let firstKeep = 0
  while (firstKeep < history.length) {
    const t = Date.parse(history[firstKeep].ts)
    if (Number.isFinite(t) && t < cutoffMs) {
      firstKeep += 1
    } else {
      break
    }
  }
  if (firstKeep > 0) history.splice(0, firstKeep)
  if (history.length > HARD_CAP) history.splice(0, history.length - HARD_CAP)
  return history
}

// ── Source-specific mappers (pure) ────────────────────────────────────────

/**
 * SenseVoice prosody → VAD. Numbers come from Russell-circumplex literature
 * grouping (Russell 1980; Mehrabian PAD): happy is high V/A, sad is low V
 * /low A, angry is low V / high A, fearful is low V / high A but more
 * tilted, surprised is mid V / very high A, disgusted is low V / mid A.
 */
export function voiceEmotionToVAD(label: VoiceEmotionLabel): { valence: number; arousal: number } {
  switch (label) {
    case 'happy':     return { valence: 0.7, arousal: 0.65 }
    case 'sad':       return { valence: -0.6, arousal: 0.25 }
    case 'angry':     return { valence: -0.6, arousal: 0.85 }
    case 'fearful':   return { valence: -0.55, arousal: 0.75 }
    case 'disgusted': return { valence: -0.5, arousal: 0.45 }
    case 'surprised': return { valence: 0.1, arousal: 0.85 }
  }
}

/**
 * Lightweight text signal → VAD. Matches the heuristic-classified
 * EmotionSignal categories from `emotionModel.ts`. Returned values are
 * intentionally smaller than voice prosody because text is one signal
 * among many (verbal vs. paraverbal); we don't want a single typed
 * "thanks" to outweigh ten seconds of audible exhaustion.
 */
export function textSignalToVAD(
  signal: 'praise' | 'frustration' | 'greeting' | 'farewell' | 'question',
): { valence: number; arousal: number } {
  switch (signal) {
    case 'praise':      return { valence: 0.5, arousal: 0.4 }
    case 'frustration': return { valence: -0.5, arousal: 0.55 }
    case 'greeting':    return { valence: 0.3, arousal: 0.45 }
    case 'farewell':    return { valence: 0.1, arousal: 0.3 }
    case 'question':    return { valence: 0.05, arousal: 0.5 }
  }
}

// ── Capture (public) ──────────────────────────────────────────────────────

export function captureUserAffectSample(
  sample: Omit<UserAffectSample, 'ts'>,
  now: Date = new Date(),
): UserAffectSample | null {
  const nowMs = now.getTime()
  const history = loadInternal()
  // Dedup rapid-fire samples from the same source (e.g. typing bursts)
  // by collapsing to the most recent one. Keeps the timeline readable
  // and the storage cheap.
  const last = history[history.length - 1]
  if (last && last.source === sample.source) {
    const lastMs = Date.parse(last.ts)
    if (Number.isFinite(lastMs) && nowMs - lastMs < DEDUP_MS) {
      return null
    }
  }
  const next: UserAffectSample = {
    ts: now.toISOString(),
    valence: clamp(sample.valence, -1, 1),
    arousal: clamp(sample.arousal, 0, 1),
    source: sample.source,
    confidence: clamp(sample.confidence, 0, 1),
    ...(sample.note ? { note: sample.note } : {}),
  }
  history.push(next)
  pruneByAge(history, nowMs)
  writeJsonDebounced(USER_AFFECT_HISTORY_STORAGE_KEY, history)
  return next
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

// ── Read (public) ─────────────────────────────────────────────────────────

export function loadUserAffectHistory(): UserAffectSample[] {
  return loadInternal().slice()
}

/**
 * Slice within a time window — used by the monthly mood map / annual
 * yearbook readers. `windowDays` is inclusive of today. Returns the
 * samples in chronological order.
 */
export function loadUserAffectWindow(windowDays: number, now: Date = new Date()): UserAffectSample[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  return loadInternal().filter((s) => {
    const t = Date.parse(s.ts)
    return Number.isFinite(t) && t >= cutoff
  })
}

// ── Test helpers ──────────────────────────────────────────────────────────

export function __resetUserAffectCache(): void {
  cache = null
}
