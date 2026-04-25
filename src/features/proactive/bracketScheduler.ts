// Pure decision logic for the daily morning/evening bracket — paired
// prompts that bookend the day. Morning asks one open question; evening
// asks two ("highlight" + "stressful"). The next morning quotes the
// previous evening's gist back to the user. Mirrors the awayScheduler
// pattern: pure function, unit-testable without IPC or storage.

export type BracketKind = 'morning' | 'evening'

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
    }

export type BracketRelationshipType = 'open_ended' | 'friend' | 'mentor' | 'quiet_companion'

export interface BracketDecisionInput {
  enabled: boolean
  nowMs: number
  /** Most recent fire timestamps, null if never fired this device. */
  lastMorningFiredMs: number | null
  lastEveningFiredMs: number | null
  /** Inclusive start, exclusive end. Defaults: morning 7-10, evening 21-23. */
  morningWindow?: { startHour: number; endHour: number }
  eveningWindow?: { startHour: number; endHour: number }
  /** Minimum gap (hours) between morning and evening of the same day. */
  minGapHours?: number
  /** Quiet-companion default opts out; set to override per-relationship behaviour. */
  relationshipType: BracketRelationshipType
}

const DEFAULT_MORNING = { startHour: 7, endHour: 10 }
const DEFAULT_EVENING = { startHour: 21, endHour: 23 }
const DEFAULT_MIN_GAP_HOURS = 6

function localDayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function isInWindow(nowMs: number, window: { startHour: number; endHour: number }): boolean {
  const hour = new Date(nowMs).getHours()
  return hour >= window.startHour && hour < window.endHour
}

function firedToday(nowMs: number, firedMs: number | null): boolean {
  if (firedMs == null) return false
  return localDayKey(nowMs) === localDayKey(firedMs)
}

export function decideBracket(input: BracketDecisionInput): BracketDecision {
  if (!input.enabled) return { shouldFire: false, reason: 'disabled' }
  if (input.relationshipType === 'quiet_companion') {
    return { shouldFire: false, reason: 'relationship_type_opted_out' }
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
    return { shouldFire: true, bracket: 'morning', reason: 'fire' }
  }

  if (firedToday(input.nowMs, input.lastEveningFiredMs)) {
    return { shouldFire: false, reason: 'evening_already_fired_today' }
  }
  if (
    input.lastMorningFiredMs != null
    && input.nowMs - input.lastMorningFiredMs < minGapMs
  ) {
    return { shouldFire: false, reason: 'too_close_to_other_bracket' }
  }
  return { shouldFire: true, bracket: 'evening', reason: 'fire' }
}
