/**
 * Morning surfacing decision for the dream diary.
 *
 * A dream may be mentioned once, on the morning after the night it belongs
 * to, and only occasionally (three days apart on the normal pace, a week on
 * the quiet pace). It is the lowest-priority proactive open: a due event
 * follow-up, a Sunday letter, or the morning bracket always wins. When the
 * bracket is enabled the mention waits until that bracket has already landed
 * and the same open has moved on, so the two never stack.
 *
 * The decision is pure; the hook owns reading the stores and delivering the
 * line through the shared companion-notice path.
 */

import { isSameLocalDay } from '../../lib/localDate.ts'
import { isQuietHour, PROACTIVE_MIN_GAP_MS } from '../autonomy/proactiveBudget.ts'
import type { FocusState } from '../../types/autonomy.ts'
import type { ProactiveFrequencyPreset } from '../../types/proactive.ts'
import type { CompanionRelationshipType, DreamDiaryEntry } from '../../types/index.ts'

export const DREAM_MENTION_START_HOUR = 5
export const DREAM_MENTION_END_HOUR = 12
export const DREAM_MENTION_MAX_AGE_MS = 18 * 60 * 60_000
export const DREAM_MENTION_AFTER_BRACKET_MS = 30 * 60_000
export const DREAM_MENTION_GAP_DAYS = 3
export const DREAM_MENTION_QUIET_GAP_DAYS = 7

export type DreamSurfacingReason =
  | 'fire'
  | 'disabled'
  | 'no_dream'
  | 'too_old'
  | 'relationship_type_opted_out'
  | 'memory_paused'
  | 'not_around'
  | 'busy'
  | 'typing'
  | 'quiet_hours'
  | 'outside_window'
  | 'event_follow_up_pending'
  | 'letter_pending'
  | 'bracket_pending'
  | 'bracket_too_recent'
  | 'other_open_recent'
  | 'recent_chat'
  | 'mentioned_recently'

export type DreamSurfacingDecision =
  | { shouldSurface: true; reason: 'fire'; minGapDays: number }
  | { shouldSurface: false; reason: Exclude<DreamSurfacingReason, 'fire'> }

export interface DreamSurfacingInput {
  enabled: boolean
  nowMs: number
  dream: Pick<DreamDiaryEntry, 'createdAt' | 'surfacedAt'> | null
  /** Most recent morning mention across the diary; null when never mentioned. */
  lastSurfacedAtMs?: number | null
  relationshipType: CompanionRelationshipType
  memoryPaused?: boolean
  frequency?: ProactiveFrequencyPreset
  quietStart?: number
  quietEnd?: number
  focusState?: FocusState
  busy?: boolean
  userTyping?: boolean
  bracketEnabled?: boolean
  lastMorningBracketFiredMs?: number | null
  eventFollowUpDue?: boolean
  letterDue?: boolean
  otherOpenClaimAtMs?: number | null
  recentChatActivity?: boolean
}

/** Gap between mentions for the selected proactive pace. */
export function dreamMentionGapDays(frequency: ProactiveFrequencyPreset = 'normal'): number {
  return frequency === 'low' ? DREAM_MENTION_QUIET_GAP_DAYS : DREAM_MENTION_GAP_DAYS
}

export function decideDreamSurfacing(input: DreamSurfacingInput): DreamSurfacingDecision {
  const skip = (reason: Exclude<DreamSurfacingReason, 'fire'>): DreamSurfacingDecision => ({
    shouldSurface: false,
    reason,
  })

  if (!input.enabled) return skip('disabled')
  if (!input.dream || input.dream.surfacedAt != null) return skip('no_dream')

  const createdAt = Date.parse(input.dream.createdAt)
  if (!Number.isFinite(createdAt)) return skip('no_dream')
  const age = input.nowMs - createdAt
  if (age < 0 || age > DREAM_MENTION_MAX_AGE_MS) return skip('too_old')

  if (input.relationshipType === 'quiet_companion') {
    return skip('relationship_type_opted_out')
  }
  if (input.memoryPaused === true) return skip('memory_paused')

  const focusState = input.focusState ?? 'active'
  if (focusState === 'away' || focusState === 'locked') return skip('not_around')
  if (input.busy === true) return skip('busy')
  if (input.userTyping === true) return skip('typing')

  const hour = new Date(input.nowMs).getHours()
  if (isQuietHour(hour, input.quietStart ?? 23, input.quietEnd ?? 8)) {
    return skip('quiet_hours')
  }
  if (hour < DREAM_MENTION_START_HOUR || hour >= DREAM_MENTION_END_HOUR) {
    return skip('outside_window')
  }

  // Priority on the same open: follow-up > letter > bracket > dream.
  if (input.eventFollowUpDue === true) return skip('event_follow_up_pending')
  if (input.letterDue === true) return skip('letter_pending')

  if (input.bracketEnabled) {
    const bracketFiredMs = input.lastMorningBracketFiredMs
    if (bracketFiredMs == null || !isSameLocalDay(bracketFiredMs, input.nowMs)) {
      return skip('bracket_pending')
    }
    if (input.nowMs - bracketFiredMs < DREAM_MENTION_AFTER_BRACKET_MS) {
      return skip('bracket_too_recent')
    }
  }

  if (input.recentChatActivity === true) return skip('recent_chat')
  if (
    input.otherOpenClaimAtMs != null
    && input.nowMs - input.otherOpenClaimAtMs < PROACTIVE_MIN_GAP_MS
  ) {
    return skip('other_open_recent')
  }

  const minGapDays = dreamMentionGapDays(input.frequency)
  if (
    input.lastSurfacedAtMs != null
    && input.nowMs - input.lastSurfacedAtMs < minGapDays * 24 * 60 * 60_000
  ) {
    return skip('mentioned_recently')
  }

  return { shouldSurface: true, reason: 'fire', minGapDays }
}
