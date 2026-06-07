/**
 * Time-series capture for emotion + relationship state.
 *
 * The autonomy store keeps the *current* emotion and relationship state
 * only — there's no way to answer "how has she felt this week?" without
 * a history. This module samples each state on meaningful changes and
 * persists samples per series to localStorage.
 *
 * Design notes:
 *
 *  - **Dedup on small changes.** Every tick can nudge emotion by 1-2 %.
 *    Without a threshold the history fills with near-duplicates that
 *    tell no story. A sample is recorded only when any of the 4 axes
 *    (or the relationship score) has moved by at least CHANGE_THRESHOLD
 *    vs. the most recent sample.
 *
 *  - **Heartbeat.** Even without any change, we still drop a sample
 *    every HEARTBEAT_MS so the chart shows that a quiet day *was* quiet
 *    rather than going blank.
 *
 *  - **Retention by time window, not count.** v0.4 rebalanced this to
 *    support affect-dynamics monthly / annual reports. Samples are kept
 *    for up to 365 days and pruned by age on every write. Hard count
 *    caps still apply as a runaway-write safety belt (~36k emotion /
 *    1k relationship) but the time window is the primary gate.
 *
 *  - **Footprint.** ~150 bytes per emotion sample × 30-50 samples/day
 *    × 365 days = 1-3 MB / year in localStorage. The Settings timeline
 *    panel reads only the recent slice (last 14 days) for charting;
 *    yearbook / annual report consumers read the full window on demand.
 */

import {
  AUTONOMY_EMOTION_HISTORY_STORAGE_KEY,
  AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY,
  readJson,
  writeJson,
  writeJsonDebounced,
} from '../../lib/storage/core.ts'
import type { EmotionState } from './emotionModel'
import type { RelationshipLevel, RelationshipState } from './relationshipTracker'
import { getRelationshipLevel } from './relationshipTracker.ts'

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000  // hard 1-year window
const EMOTION_HARD_CAP = 36_000   // safety belt: ~100/day × 365 days
const RELATIONSHIP_HARD_CAP = 1_500
const EMOTION_CHANGE_THRESHOLD = 0.06 // any axis moving by ≥6% triggers a sample
const EMOTION_HEARTBEAT_MS = 6 * 60 * 60 * 1000 // 6h idle heartbeat
const RELATIONSHIP_SCORE_THRESHOLD = 1 // integer score; any tick-level delta
const RELATIONSHIP_LEVEL_SEED: RelationshipState = {
  score: 0,
  lastInteractionDate: '',
  streak: 0,
  totalDaysInteracted: 0,
}

export interface EmotionSample {
  ts: string
  energy: number
  warmth: number
  curiosity: number
  concern: number
}

export interface RelationshipSample {
  ts: string
  score: number
  level: RelationshipLevel
  streak: number
  daysInteracted: number
}

// ── In-memory caches to avoid re-reading localStorage on every tick ──────

let emotionHistoryCache: EmotionSample[] | null = null
let relationshipHistoryCache: RelationshipSample[] | null = null

function loadEmotionHistoryInternal(): EmotionSample[] {
  if (!emotionHistoryCache) {
    const raw = readJson<unknown>(
      AUTONOMY_EMOTION_HISTORY_STORAGE_KEY,
      [],
    )
    emotionHistoryCache = normalizeEmotionHistory(raw)
    if (JSON.stringify(emotionHistoryCache) !== JSON.stringify(raw)) {
      writeJson(AUTONOMY_EMOTION_HISTORY_STORAGE_KEY, emotionHistoryCache)
    }
  }
  return emotionHistoryCache
}

function loadRelationshipHistoryInternal(): RelationshipSample[] {
  if (!relationshipHistoryCache) {
    const raw = readJson<unknown>(
      AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY,
      [],
    )
    relationshipHistoryCache = normalizeRelationshipHistory(raw)
    if (JSON.stringify(relationshipHistoryCache) !== JSON.stringify(raw)) {
      writeJson(AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY, relationshipHistoryCache)
    }
  }
  return relationshipHistoryCache
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampFinite(value: unknown, min: number, max: number): number | null {
  const numeric = finiteNumber(value)
  return numeric === null ? null : clamp(numeric, min, max)
}

function clampFiniteForSample(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? clamp(value, min, max) : min
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = finiteNumber(value)
  return numeric === null ? null : Math.max(0, Math.round(numeric))
}

function scoreToRelationshipLevel(score: number): RelationshipLevel {
  return getRelationshipLevel({ ...RELATIONSHIP_LEVEL_SEED, score })
}

function normalizeEmotionSample(value: unknown): EmotionSample | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (typeof obj.ts !== 'string' || !Number.isFinite(Date.parse(obj.ts))) return null

  const energy = clampFinite(obj.energy, 0, 1)
  const warmth = clampFinite(obj.warmth, 0, 1)
  const curiosity = clampFinite(obj.curiosity, 0, 1)
  const concern = clampFinite(obj.concern, 0, 1)
  if (energy === null || warmth === null || curiosity === null || concern === null) {
    return null
  }

  return { ts: obj.ts, energy, warmth, curiosity, concern }
}

function normalizeEmotionHistory(raw: unknown): EmotionSample[] {
  if (!Array.isArray(raw)) return []
  const normalized = raw
    .map(normalizeEmotionSample)
    .filter((sample): sample is EmotionSample => Boolean(sample))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  if (normalized.length > EMOTION_HARD_CAP) {
    normalized.splice(0, normalized.length - EMOTION_HARD_CAP)
  }
  return normalized
}

function normalizeRelationshipSample(value: unknown): RelationshipSample | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (typeof obj.ts !== 'string' || !Number.isFinite(Date.parse(obj.ts))) return null

  const rawScore = clampFinite(obj.score, 0, 100)
  const streak = nonNegativeInteger(obj.streak)
  const daysInteracted = nonNegativeInteger(obj.daysInteracted)
  if (rawScore === null || streak === null || daysInteracted === null) {
    return null
  }

  const score = Math.round(rawScore)
  return {
    ts: obj.ts,
    score,
    level: scoreToRelationshipLevel(score),
    streak,
    daysInteracted,
  }
}

function normalizeRelationshipHistory(raw: unknown): RelationshipSample[] {
  if (!Array.isArray(raw)) return []
  const normalized = raw
    .map(normalizeRelationshipSample)
    .filter((sample): sample is RelationshipSample => Boolean(sample))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  if (normalized.length > RELATIONSHIP_HARD_CAP) {
    normalized.splice(0, normalized.length - RELATIONSHIP_HARD_CAP)
  }
  return normalized
}

// ── Sampling decisions (pure) ────────────────────────────────────────────

export function shouldCaptureEmotionSample(
  next: EmotionState,
  last: EmotionSample | undefined,
  nowMs: number,
): boolean {
  if (!last) return true

  const lastAt = Date.parse(last.ts)
  if (Number.isFinite(lastAt) && nowMs - lastAt >= EMOTION_HEARTBEAT_MS) {
    return true
  }

  const dEnergy = Math.abs(next.energy - last.energy)
  const dWarmth = Math.abs(next.warmth - last.warmth)
  const dCuriosity = Math.abs(next.curiosity - last.curiosity)
  const dConcern = Math.abs(next.concern - last.concern)
  return (
    dEnergy >= EMOTION_CHANGE_THRESHOLD
    || dWarmth >= EMOTION_CHANGE_THRESHOLD
    || dCuriosity >= EMOTION_CHANGE_THRESHOLD
    || dConcern >= EMOTION_CHANGE_THRESHOLD
  )
}

export function shouldCaptureRelationshipSample(
  next: RelationshipState,
  last: RelationshipSample | undefined,
): boolean {
  if (!last) return true
  const delta = Math.abs(next.score - last.score)
  if (delta >= RELATIONSHIP_SCORE_THRESHOLD) return true
  if (next.streak !== last.streak) return true
  if (getRelationshipLevel(next) !== last.level) return true
  return false
}

// ── Retention helpers ────────────────────────────────────────────────────

/**
 * Drop samples older than RETENTION_MS, then enforce the hard count cap
 * as a final safety net. Returns the same array (mutated) for chaining
 * on the write path. Pure relative to the system clock; pass `nowMs`
 * explicitly so tests can pin behaviour.
 */
function pruneByAge<T extends { ts: string }>(
  history: T[],
  hardCap: number,
  nowMs: number,
): T[] {
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
  if (firstKeep > 0) {
    history.splice(0, firstKeep)
  }
  if (history.length > hardCap) {
    history.splice(0, history.length - hardCap)
  }
  return history
}

// ── Capture (public) ──────────────────────────────────────────────────────

export function captureEmotionSample(
  state: EmotionState,
  now: Date = new Date(),
): EmotionSample | null {
  const history = loadEmotionHistoryInternal()
  const last = history.length > 0 ? history[history.length - 1] : undefined
  const nextState: EmotionState = {
    energy: clampFiniteForSample(state.energy, 0, 1),
    warmth: clampFiniteForSample(state.warmth, 0, 1),
    curiosity: clampFiniteForSample(state.curiosity, 0, 1),
    concern: clampFiniteForSample(state.concern, 0, 1),
  }
  if (!shouldCaptureEmotionSample(nextState, last, now.getTime())) {
    return null
  }

  const sample: EmotionSample = {
    ts: now.toISOString(),
    energy: nextState.energy,
    warmth: nextState.warmth,
    curiosity: nextState.curiosity,
    concern: nextState.concern,
  }
  history.push(sample)
  pruneByAge(history, EMOTION_HARD_CAP, now.getTime())
  writeJsonDebounced(AUTONOMY_EMOTION_HISTORY_STORAGE_KEY, history)
  return sample
}

export function captureRelationshipSample(
  state: RelationshipState,
  now: Date = new Date(),
): RelationshipSample | null {
  const history = loadRelationshipHistoryInternal()
  const last = history.length > 0 ? history[history.length - 1] : undefined
  const score = Math.round(clampFiniteForSample(state.score, 0, 100))
  const samplingState: RelationshipState = {
    ...state,
    score,
    streak: Math.max(0, Math.round(clampFiniteForSample(state.streak, 0, Number.MAX_SAFE_INTEGER))),
    totalDaysInteracted: Math.max(0, Math.round(clampFiniteForSample(
      state.totalDaysInteracted,
      0,
      Number.MAX_SAFE_INTEGER,
    ))),
  }
  if (!shouldCaptureRelationshipSample(samplingState, last)) {
    return null
  }

  const sample: RelationshipSample = {
    ts: now.toISOString(),
    score,
    level: getRelationshipLevel(samplingState),
    streak: samplingState.streak,
    daysInteracted: samplingState.totalDaysInteracted,
  }
  history.push(sample)
  pruneByAge(history, RELATIONSHIP_HARD_CAP, now.getTime())
  writeJsonDebounced(AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY, history)
  return sample
}

// ── Read (public) ─────────────────────────────────────────────────────────

export function loadEmotionHistory(): EmotionSample[] {
  return loadEmotionHistoryInternal().slice()
}

export function loadRelationshipHistory(): RelationshipSample[] {
  return loadRelationshipHistoryInternal().slice()
}

// ── Test helpers ──────────────────────────────────────────────────────────

/** Reset module-scoped caches. Exported for tests; do not use in product code. */
export function __resetStateTimelineCaches(): void {
  emotionHistoryCache = null
  relationshipHistoryCache = null
}
