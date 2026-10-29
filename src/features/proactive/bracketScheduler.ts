// Pure decision logic for the daily morning/evening bracket — paired
// prompts that bookend the day. Morning is the first time the user shows
// up after 05:00; evening is a short check-in that also asks about
// tomorrow. The next morning can quote the previous evening.
//
// Gates mirror the proactive agenda: memory pause, busy/typing/fullscreen,
// quiet hours, and higher-priority opens. Decision logic stays here so the
// hook only owns timers and delivery.

import { isSameLocalDay } from '../../lib/localDate.ts'
import { isQuietHour, PROACTIVE_MIN_GAP_MS } from '../autonomy/proactiveBudget.ts'
import type { FocusState } from '../../types/autonomy.ts'
import type { CompanionRelationshipType } from '../../types'

type BracketKind = 'morning' | 'evening'

export type BracketDecision =
  | { shouldFire: true; bracket: BracketKind; reason: 'fire' }
  | {
      shouldFire: false
      reason:
        | 'disabled'
        | 'outside_windows'
        | 'morning_already_fired_today'
        | 'evening_already_fired_today'
        | 'too_close_to_other_bracket'
        | 'relationship_type_opted_out'
        | 'memory_paused'
        | 'busy'
        | 'typing'
        | 'fullscreen'
        | 'not_around'
        | 'quiet_hours'
        | 'recent_chat'
        | 'event_follow_up_pending'
        | 'letter_pending'
        | 'other_open_recent'
    }

export interface BracketDecisionInput {
  enabled: boolean
  nowMs: number
  /** Most recent fire timestamps, null if never fired this device. */
  lastMorningFiredMs: number | null
  lastEveningFiredMs: number | null
  /**
   * Inclusive start, exclusive end. Morning starts at 05:00 so the first
   * open of an early day still counts; it closes at noon.
   * Defaults: morning 05-12, evening 20-23.
   */
  morningWindow?: { startHour: number; endHour: number }
  eveningWindow?: { startHour: number; endHour: number }
  /** Minimum gap (hours) between morning and evening of the same day. */
  minGapHours?: number
  /** Quiet-companion default opts out; set to override per-relationship behaviour. */
  relationshipType: CompanionRelationshipType
  /** Pausing memory also pauses a ritual that may quote it. */
  memoryPaused?: boolean
  busy?: boolean
  userTyping?: boolean
  fullscreen?: boolean
  focusState?: FocusState
  quietStart?: number
  quietEnd?: number
  /** An event follow-up (or any agenda item) is ready at this open. */
  eventFollowUpDue?: boolean
  /** A Sunday letter is due now or was already delivered today. */
  letterDue?: boolean
  /** The user said something in the last few minutes. */
  recentChatActivity?: boolean
  /** Last time any other proactive open spoke; avoids stacking. */
  lastOpenClaimAtMs?: number | null
  openClaimWindowMinutes?: number
}

const DEFAULT_MORNING = { startHour: 5, endHour: 12 }
const DEFAULT_EVENING = { startHour: 20, endHour: 23 }
const DEFAULT_MIN_GAP_HOURS = 6
const DEFAULT_OPEN_CLAIM_WINDOW_MINUTES = PROACTIVE_MIN_GAP_MS / 60_000

function isInWindow(nowMs: number, window: { startHour: number; endHour: number }): boolean {
  const hour = new Date(nowMs).getHours()
  return hour >= window.startHour && hour < window.endHour
}

function firedToday(nowMs: number, firedMs: number | null): boolean {
  return firedMs != null && isSameLocalDay(nowMs, firedMs)
}

export function decideBracket(input: BracketDecisionInput): BracketDecision {
  if (!input.enabled) return { shouldFire: false, reason: 'disabled' }
  if (input.relationshipType === 'quiet_companion') {
    return { shouldFire: false, reason: 'relationship_type_opted_out' }
  }
  if (input.memoryPaused === true) return { shouldFire: false, reason: 'memory_paused' }
  if (input.busy === true) return { shouldFire: false, reason: 'busy' }
  if (input.userTyping === true) return { shouldFire: false, reason: 'typing' }
  if (input.fullscreen === true) return { shouldFire: false, reason: 'fullscreen' }
  if (input.focusState === 'away' || input.focusState === 'locked') {
    return { shouldFire: false, reason: 'not_around' }
  }
  if (
    input.quietStart != null
    && input.quietEnd != null
    && isQuietHour(new Date(input.nowMs).getHours(), input.quietStart, input.quietEnd)
  ) {
    return { shouldFire: false, reason: 'quiet_hours' }
  }

  const morning = input.morningWindow ?? DEFAULT_MORNING
  const evening = input.eveningWindow ?? DEFAULT_EVENING
  const minGapMs = (input.minGapHours ?? DEFAULT_MIN_GAP_HOURS) * 60 * 60_000

  const inMorning = isInWindow(input.nowMs, morning)
  const inEvening = isInWindow(input.nowMs, evening)
  if (!inMorning && !inEvening) {
    return { shouldFire: false, reason: 'outside_windows' }
  }

  if (inMorning) {
    if (firedToday(input.nowMs, input.lastMorningFiredMs)) {
      return { shouldFire: false, reason: 'morning_already_fired_today' }
    }
    if (
      input.lastEveningFiredMs != null
      && input.nowMs - input.lastEveningFiredMs < minGapMs
    ) {
      return { shouldFire: false, reason: 'too_close_to_other_bracket' }
    }
  } else {
    if (firedToday(input.nowMs, input.lastEveningFiredMs)) {
      return { shouldFire: false, reason: 'evening_already_fired_today' }
    }
    if (
      input.lastMorningFiredMs != null
      && input.nowMs - input.lastMorningFiredMs < minGapMs
    ) {
      return { shouldFire: false, reason: 'too_close_to_other_bracket' }
    }
  }

  // Priority on the same open: a due follow-up beats a letter, and both
  // beat the bracket. Returning here leaves the bracket eligible later.
  if (input.eventFollowUpDue === true) {
    return { shouldFire: false, reason: 'event_follow_up_pending' }
  }
  if (input.letterDue === true) {
    return { shouldFire: false, reason: 'letter_pending' }
  }
  if (input.recentChatActivity === true) {
    return { shouldFire: false, reason: 'recent_chat' }
  }
  const claimWindowMs = (input.openClaimWindowMinutes ?? DEFAULT_OPEN_CLAIM_WINDOW_MINUTES) * 60_000
  if (
    input.lastOpenClaimAtMs != null
    && input.nowMs - input.lastOpenClaimAtMs < claimWindowMs
  ) {
    return { shouldFire: false, reason: 'other_open_recent' }
  }

  return { shouldFire: true, bracket: inMorning ? 'morning' : 'evening', reason: 'fire' }
}
