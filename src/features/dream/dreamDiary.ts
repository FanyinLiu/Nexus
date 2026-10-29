/**
 * Pure decisions for her dream diary.
 *
 * A diary row is written only after a real sleeping stretch: the autonomy
 * dream switch, the night window, the idle threshold, and the "one per night"
 * store check all have to agree. The night is identified by a local day key
 * that rolls at 04:00, so a dream at 23:30 and one at 02:00 belong to the same
 * night. A failed model call never writes a row, which leaves that night
 * available for the next tick instead of spending it.
 *
 * Material selection is deliberately loose: one or two recent memories (or
 * only the week's mood) are passed to the prompt as *themes*, never as facts.
 * The prompt builder and parser own the "don't quote / don't claim" guard.
 */

import { localDayKey } from '../../lib/localDate.ts'
import type { MemoryItem } from '../../types/memory.ts'

export const DREAM_NIGHT_START_HOUR = 21
export const DREAM_NIGHT_END_HOUR = 9
export const DREAM_NIGHT_ROLL_HOUR = 4
export const DREAM_SOURCE_MEMORY_LIMIT = 2
export const DREAM_MIN_TEXT_CHARS = 12
export const DREAM_MAX_TEXT_CHARS = 320
export const DREAM_RECENT_MEMORY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export type DreamDiaryDecisionReason =
  | 'fire'
  | 'disabled'
  | 'autonomy_off'
  | 'outside_window'
  | 'not_idle_enough'
  | 'already_dreamed_tonight'
  | 'memory_paused'
  | 'no_material'

export type DreamDiaryDecision =
  | { shouldDream: true; reason: 'fire'; night: string }
  | { shouldDream: false; reason: Exclude<DreamDiaryDecisionReason, 'fire'>; night: string }

export interface DreamDiaryDecisionInput {
  enabled: boolean
  autonomyEnabled: boolean
  autonomyDreamEnabled: boolean
  nowMs: number
  idleSeconds: number
  sleepAfterIdleMinutes: number
  /** Pausing memory also pauses memory-shaped dreams. */
  memoryPaused?: boolean
  /** Night key of the newest stored row; null when she has never dreamed. */
  lastDreamNight?: string | null
  hasMaterial: boolean
}

/**
 * The local night a moment belongs to. Subtracting the roll hour makes
 * 00:00–03:59 count as the previous evening instead of a new day.
 */
export function dreamNightKey(nowMs = Date.now()): string {
  return localDayKey(nowMs - DREAM_NIGHT_ROLL_HOUR * 3_600_000)
}

/** Night window wraps midnight: 21:00 through 08:59. */
export function isDreamNightHour(hour: number): boolean {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false
  return hour >= DREAM_NIGHT_START_HOUR || hour < DREAM_NIGHT_END_HOUR
}

export function decideDreamDiary(input: DreamDiaryDecisionInput): DreamDiaryDecision {
  const night = dreamNightKey(input.nowMs)
  const skip = (reason: Exclude<DreamDiaryDecisionReason, 'fire'>): DreamDiaryDecision => ({
    shouldDream: false,
    reason,
    night,
  })

  if (!input.enabled) return skip('disabled')
  if (!input.autonomyEnabled || !input.autonomyDreamEnabled) return skip('autonomy_off')
  if (input.memoryPaused === true) return skip('memory_paused')
  if (!isDreamNightHour(new Date(input.nowMs).getHours())) return skip('outside_window')

  const idleThresholdSeconds = Math.max(1, input.sleepAfterIdleMinutes) * 60
  if (!Number.isFinite(input.idleSeconds) || input.idleSeconds < idleThresholdSeconds) {
    return skip('not_idle_enough')
  }

  if (input.lastDreamNight === night) return skip('already_dreamed_tonight')
  if (!input.hasMaterial) return skip('no_material')
  return { shouldDream: true, reason: 'fire', night }
}

export interface DreamSourceFragment {
  id: string
  text: string
}

function importanceWeight(memory: MemoryItem): number {
  if (memory.importance === 'pinned') return 4
  if (memory.importance === 'high') return 3
  if (memory.importance === 'reflection') return 1
  if (memory.importance === 'low') return 0
  return 2
}

function isUsableMemory(memory: MemoryItem): boolean {
  if (!memory.content.trim()) return false
  if (memory.status === 'archived' || memory.status === 'superseded') return false
  return memory.enabled !== false
}

/**
 * Pick at most two recent memories as loose dream material. Recent rows win;
 * importance only breaks ties, so a forgotten old fact cannot dominate a
 * dream about the current week.
 */
export function selectDreamFragments(
  memories: readonly MemoryItem[],
  nowMs = Date.now(),
  limit = DREAM_SOURCE_MEMORY_LIMIT,
): DreamSourceFragment[] {
  const candidates = memories.filter(isUsableMemory)
  const scored = candidates
    .map((memory) => {
      const createdAt = Date.parse(memory.createdAt)
      const age = Number.isFinite(createdAt) ? nowMs - createdAt : Number.POSITIVE_INFINITY
      const recent = age >= 0 && age <= DREAM_RECENT_MEMORY_WINDOW_MS
      return {
        memory,
        recent,
        age: Number.isFinite(age) ? age : 0,
        weight: importanceWeight(memory),
      }
    })
    .sort((left, right) => {
      if (left.recent !== right.recent) return left.recent ? -1 : 1
      if (left.weight !== right.weight) return right.weight - left.weight
      return left.age - right.age
    })

  return scored.slice(0, Math.max(0, limit)).map(({ memory }) => ({
    id: memory.id,
    text: memory.content.trim(),
  }))
}

export interface DreamMoodSample {
  energy: number
  warmth: number
  curiosity: number
  concern: number
}

/**
 * Turn her own recent affect into one prompt line. This is her mood, not the
 * user's, so it can flavour the dream without carrying a fact about anyone.
 */
export function summarizeDreamMood(samples: readonly DreamMoodSample[]): string | null {
  const recent = samples.slice(-20).filter((sample) => (
    Number.isFinite(sample.energy)
    && Number.isFinite(sample.warmth)
    && Number.isFinite(sample.curiosity)
    && Number.isFinite(sample.concern)
  ))
  if (recent.length < 3) return null

  const average = (pick: (sample: DreamMoodSample) => number) =>
    recent.reduce((sum, sample) => sum + pick(sample), 0) / recent.length
  const energy = average((sample) => sample.energy)
  const warmth = average((sample) => sample.warmth)
  const curiosity = average((sample) => sample.curiosity)
  const concern = average((sample) => sample.concern)

  const energyWord = energy < 0.35 ? 'quiet' : energy > 0.65 ? 'bright' : 'steady'
  const warmthWord = warmth < 0.35 ? 'a little distant' : warmth > 0.65 ? 'close' : 'warm'
  const curiosityWord = curiosity < 0.35 ? 'settled' : curiosity > 0.65 ? 'curious' : 'attentive'
  const concernWord = concern > 0.5 ? 'carrying a small worry' : concern > 0.3 ? 'tender' : 'easy'

  return `${energyWord}, ${warmthWord}, ${curiosityWord}, ${concernWord}`
}

export function hasDreamMaterial(
  fragments: readonly DreamSourceFragment[],
  weekMood: string | null | undefined,
): boolean {
  return fragments.length > 0 || Boolean(weekMood?.trim())
}
