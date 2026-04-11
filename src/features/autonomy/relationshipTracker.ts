/**
 * Relationship affinity tracking.
 *
 * Maintains a score (0–100) that reflects the depth of the
 * user–companion relationship over time.
 *
 * - Each day with at least one interaction: +1 (streak bonus up to +3)
 * - After 3 consecutive days of absence: -2 per absent day
 * - Score influences proactive speech warmth and frequency.
 */

export interface RelationshipState {
  score: number
  /** ISO date string (YYYY-MM-DD) of the last interaction day. */
  lastInteractionDate: string
  /** Current consecutive-day interaction streak. */
  streak: number
  /** Total number of distinct days with at least one interaction. */
  totalDaysInteracted: number
}

export function createDefaultRelationshipState(): RelationshipState {
  return {
    score: 10,
    lastInteractionDate: '',
    streak: 0,
    totalDaysInteracted: 0,
  }
}

const MAX_SCORE = 100
const MIN_SCORE = 0
const DAILY_INTERACTION_BONUS = 1
const MAX_STREAK_BONUS = 3
const ABSENCE_THRESHOLD_DAYS = 3
const ABSENCE_PENALTY_PER_DAY = 2

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(dateA: string, dateB: string): number {
  const a = Date.parse(dateA)
  const b = Date.parse(dateB)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.floor(Math.abs(b - a) / 86_400_000)
}

function clampScore(value: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, value))
}

/**
 * Call when the user interacts (sends a message, voice input, etc.).
 * Grants daily bonus at most once per calendar day.
 */
export function markDailyInteraction(state: RelationshipState): RelationshipState {
  const today = todayDateString()
  if (state.lastInteractionDate === today) return state

  const daysSinceLast = state.lastInteractionDate
    ? daysBetween(state.lastInteractionDate, today)
    : 0

  const isConsecutive = daysSinceLast === 1
  const newStreak = isConsecutive ? state.streak + 1 : 1
  const streakBonus = Math.min(newStreak - 1, MAX_STREAK_BONUS)

  return {
    score: clampScore(state.score + DAILY_INTERACTION_BONUS + streakBonus),
    lastInteractionDate: today,
    streak: newStreak,
    totalDaysInteracted: state.totalDaysInteracted + 1,
  }
}

/**
 * Call once per day (e.g. on first tick after midnight) to apply absence penalties.
 * If user hasn't interacted for more than ABSENCE_THRESHOLD_DAYS, score decays.
 */
export function applyAbsenceDecay(state: RelationshipState): RelationshipState {
  if (!state.lastInteractionDate) return state

  const today = todayDateString()
  const daysSinceLast = daysBetween(state.lastInteractionDate, today)

  if (daysSinceLast <= ABSENCE_THRESHOLD_DAYS) return state

  const penaltyDays = daysSinceLast - ABSENCE_THRESHOLD_DAYS
  const penalty = penaltyDays * ABSENCE_PENALTY_PER_DAY

  return {
    ...state,
    score: clampScore(state.score - penalty),
    streak: 0,
  }
}

// ── Relationship level ─────────────────────────────────────────────────────

export type RelationshipLevel = 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'intimate'

export function getRelationshipLevel(state: RelationshipState): RelationshipLevel {
  if (state.score >= 80) return 'intimate'
  if (state.score >= 55) return 'close_friend'
  if (state.score >= 30) return 'friend'
  if (state.score >= 10) return 'acquaintance'
  return 'stranger'
}

// ── Prompt context ─────────────────────────────────────────────────────────

const LEVEL_DESCRIPTIONS: Record<RelationshipLevel, string> = {
  stranger: '你们刚认识不久，保持礼貌和适当距离，慢慢建立信任',
  acquaintance: '你们已经有了一些交流，可以表现出温和的关心',
  friend: '你们已经是朋友了，可以更自然、随意地交流',
  close_friend: '你们关系很亲密，可以表现出真挚的关心和偶尔的撒娇',
  intimate: '你们的关系非常深厚，可以表达深切的依赖感和亲昵',
}

export function formatRelationshipForPrompt(state: RelationshipState): string {
  const level = getRelationshipLevel(state)
  const desc = LEVEL_DESCRIPTIONS[level]
  if (state.streak > 3) {
    return `${desc}（你们已经连续互动${state.streak}天了，可以提到这份坚持）`
  }
  return desc
}
