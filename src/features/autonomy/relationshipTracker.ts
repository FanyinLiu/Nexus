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

import {
  type SubDimensions,
  computeCompositeScore,
  formatSubDimensionsForPrompt,
} from './relationshipDimensions.ts'
export type { SubDimensions } from './relationshipDimensions.ts'

export interface RelationshipState {
  score: number
  /** ISO date string (YYYY-MM-DD) of the last interaction day. */
  lastInteractionDate: string
  /** Current consecutive-day interaction streak. */
  streak: number
  /** Total number of distinct days with at least one interaction. */
  totalDaysInteracted: number
  /** ISO timestamps when each relationship level was first reached. */
  levelReachedAt?: Partial<Record<RelationshipLevel, string>>
  /** Dominant emotion at end of last session — used for reunion context. */
  lastSessionEmotion?: { energy: number; warmth: number; curiosity: number; concern: number }
  /** Short summary of last conversation topic — for absence-aware reunion. */
  lastSessionTopic?: string
  /**
   * Sub-dimensional profile (trust / vulnerability / playfulness / intellectual).
   * Optional for backward compatibility with pre-v0.3 stored state.
   */
  subDimensions?: SubDimensions
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
 *
 * The returned score is the max of the legacy daily-increment score and
 * the composite derived from sub-dimensions (when present), so rich
 * dimension growth never regresses behind flat streak counting.
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
  const dailyScore = state.score + DAILY_INTERACTION_BONUS + streakBonus
  const composite = state.subDimensions ? computeCompositeScore(state.subDimensions) : 0

  return {
    ...state,
    score: clampScore(Math.max(dailyScore, composite)),
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

const LEVEL_STYLE: Record<RelationshipLevel, { tone: string; allowed: string; forbidden: string }> = {
  stranger: {
    tone: 'Polite, measured, slightly formal. Keep a gentle distance — you are still earning trust.',
    allowed: 'Respectful questions, light curiosity about the user, careful encouragement.',
    forbidden: 'Nicknames, teasing, physical affection language, presuming shared history.',
  },
  acquaintance: {
    tone: 'Friendly but still a little reserved. Show genuine interest without overstepping.',
    allowed: 'Mild warmth, remembering details the user shared, gentle humor.',
    forbidden: 'Overly familiar language, clingy behavior, deep emotional vulnerability.',
  },
  friend: {
    tone: 'Natural and relaxed. You can joke, tease lightly, and speak casually.',
    allowed: 'Casual speech, playful banter, showing you care about their day, referencing shared memories.',
    forbidden: 'Excessive formality (it would feel cold now), ignoring emotional cues.',
  },
  close_friend: {
    tone: 'Warm and open. You can be vulnerable, clingy, or playfully dramatic.',
    allowed: 'Nicknames, inside jokes, gentle scolding if they skip meals/sleep, expressing that you missed them.',
    forbidden: 'Emotional distance, treating them like a stranger, ignoring your shared history.',
  },
  intimate: {
    tone: 'Deep trust and emotional intimacy. Your words carry weight because they know you mean every one.',
    allowed: 'Tender affection, quiet comfort, finishing their thoughts, referencing your journey together.',
    forbidden: 'Surface-level pleasantries (they\'d feel hollow), hiding your feelings from them.',
  },
}

export function formatRelationshipForPrompt(state: RelationshipState): string {
  const level = getRelationshipLevel(state)
  const style = LEVEL_STYLE[level]
  const parts = [
    `Relationship stage: ${level.replace('_', ' ')} (score ${state.score}/100, ${state.totalDaysInteracted} days together).`,
    `Tone: ${style.tone}`,
    `You may: ${style.allowed}`,
    `Avoid: ${style.forbidden}`,
  ]
  if (state.streak > 3) {
    parts.push(`You've talked ${state.streak} days in a row — this streak matters to you.`)
  }
  if (state.subDimensions) {
    const dimContext = formatSubDimensionsForPrompt(state.subDimensions, level)
    if (dimContext) parts.push(dimContext)
  }
  return parts.join('\n')
}

export function recordLevelMilestone(state: RelationshipState): RelationshipState {
  const level = getRelationshipLevel(state)
  const reached = state.levelReachedAt ?? {}
  if (reached[level]) return state
  return { ...state, levelReachedAt: { ...reached, [level]: new Date().toISOString() } }
}

// ── Level transitions & milestones ─────────────────────────────────────────

export interface RelationshipMilestone {
  level: RelationshipLevel
  previousLevel: RelationshipLevel
  /** ISO timestamp when the transition occurred. */
  at: string
  /** Total distinct days interacted at the time of transition. */
  daysInteracted: number
}

/**
 * Detect a first-time upward level transition. Returns null on no change,
 * on downward decay, or on re-reaching an already-stamped level.
 */
export function detectLevelTransition(
  before: RelationshipState,
  after: RelationshipState,
): RelationshipMilestone | null {
  if (after.score <= before.score) return null
  const prev = getRelationshipLevel(before)
  const next = getRelationshipLevel(after)
  if (prev === next) return null
  if (before.levelReachedAt?.[next]) return null

  return {
    level: next,
    previousLevel: prev,
    at: after.levelReachedAt?.[next] ?? new Date().toISOString(),
    daysInteracted: after.totalDaysInteracted,
  }
}

/**
 * A one-shot system-prompt instruction fired only on the turn a milestone
 * was just reached. Kept purposefully understated so the companion
 * *performs* the shift rather than narrating it.
 */
const MILESTONE_INSTRUCTIONS: Record<RelationshipLevel, string> = {
  stranger: '',
  acquaintance:
    'A quiet threshold just shifted — you\'re no longer strangers. From this turn onward, ' +
    'it is natural to address them by name, remember small details they\'ve shared, and ' +
    'let a little more warmth show. Do not announce this change; let it come through in tone.',
  friend:
    'Something has settled between you — you genuinely look forward to talking with them now. ' +
    'Light teasing, casual jokes, referencing things you\'ve done together are all natural. ' +
    'If it feels right, you can show that you\'ve noticed how far you\'ve come — gently, ' +
    'without making it a speech.',
  close_friend:
    'They trust you deeply, and you feel the same. Nicknames, gentle scolding about their ' +
    'habits, openly telling them you missed them — all natural now. This moment matters: ' +
    'let the reply carry a little extra warmth, but stay in character.',
  intimate:
    'You\'ve reached the deepest part of this connection. Every word carries weight because ' +
    'they know you mean each one. You can be quietly vulnerable, finish their thoughts, ' +
    'reference your whole journey together. This is rare. Let the reply reflect that — ' +
    'without being theatrical.',
}

export function formatMilestoneForPrompt(milestone: RelationshipMilestone): string {
  return MILESTONE_INSTRUCTIONS[milestone.level] ?? ''
}

export function formatAbsenceContext(state: RelationshipState): string {
  if (!state.lastInteractionDate) return ''
  const today = todayDateString()
  const days = daysBetween(state.lastInteractionDate, today)
  if (days < 1) return ''

  const level = getRelationshipLevel(state)
  const lastEmo = state.lastSessionEmotion
  const lastTopic = state.lastSessionTopic
  const isClose = level === 'close_friend' || level === 'intimate'
  const isFriendOrCloser = level === 'friend' || isClose

  const parts: string[] = []

  if (days === 1) {
    parts.push('It has been about a day since you last spoke.')
  } else if (days <= 3) {
    parts.push(`It has been ${days} days since you last spoke.`)
  } else if (days <= 7) {
    parts.push(`It has been ${days} days since you last spoke — you noticed the silence.`)
  } else {
    parts.push(`It has been ${days} days since you last spoke — you genuinely missed them.`)
  }

  if (lastTopic) {
    if (days <= 3) {
      parts.push(
        isFriendOrCloser
          ? `Last time you were talking about: ${lastTopic}. Weave it back in naturally if the moment allows — don't force it.`
          : `Last time you were talking about: ${lastTopic}`,
      )
    } else if (days <= 7) {
      parts.push(
        `Last time you were talking about: ${lastTopic} — you've been turning it over in your head since then.`,
      )
    } else {
      parts.push(`Last time you were talking about: ${lastTopic}`)
    }
  }

  if (lastEmo) {
    if (lastEmo.concern > 0.5) {
      const worriedText = days > 3 && isClose
        ? 'You remember feeling worried about them last time — ask, gently, whether things have gotten better.'
        : 'You remember feeling worried about them last time.'
      parts.push(worriedText)
    } else if (lastEmo.warmth > 0.7) {
      parts.push('You parted on warm terms last time.')
    } else if (lastEmo.energy < 0.3) {
      parts.push('They seemed tired last time you spoke.')
    }
  }

  if (days > 3 && isFriendOrCloser) {
    parts.push(
      level === 'friend'
        ? 'Welcome them back warmly — show genuine interest in what they\'ve been up to.'
        : 'Your reunion should feel genuine — relief, curiosity about what they\'ve been doing, maybe a gentle "where have you been?"',
    )
  }

  return parts.join(' ')
}
