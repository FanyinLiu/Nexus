/**
 * Sunday-letter fire scheduler — pure decision logic. Same shape as
 * bracketScheduler / awayScheduler so it can be unit-tested without
 * IPC, storage, or timers.
 *
 * Fires once per Sunday inside an evening window (default 18-22
 * local) when the user hasn't already received this week's letter
 * AND the relationship type doesn't opt out. The 3-active-days gate
 * is applied separately by the aggregator — this scheduler only
 * decides "is now the moment to *try* generating one?".
 */

import { isSameLocalWeek } from '../../lib/localDate.ts'
import type { CompanionRelationshipType } from '../../types'

export type LetterDecision =
  | { shouldFire: true; reason: 'fire' }
  | {
      shouldFire: false
      reason:
        | 'disabled'
        | 'not_sunday'
        | 'outside_window'
        | 'already_fired_this_week'
        | 'relationship_type_opted_out'
    }

export interface LetterDecisionInput {
  enabled: boolean
  nowMs: number
  /** Last successful letter generation timestamp; null if never. */
  lastFiredMs: number | null
  /** Inclusive start hour, exclusive end. Defaults to 18-22 local. */
  window?: { startHour: number; endHour: number }
  relationshipType: CompanionRelationshipType
}

const DEFAULT_WINDOW = { startHour: 18, endHour: 22 }
const SUNDAY = 0

export function decideLetter(input: LetterDecisionInput): LetterDecision {
  if (!input.enabled) return { shouldFire: false, reason: 'disabled' }
  if (input.relationshipType === 'quiet_companion') {
    return { shouldFire: false, reason: 'relationship_type_opted_out' }
  }

  const now = new Date(input.nowMs)
  if (now.getDay() !== SUNDAY) {
    return { shouldFire: false, reason: 'not_sunday' }
  }

  const window = input.window ?? DEFAULT_WINDOW
  const hour = now.getHours()
  if (hour < window.startHour || hour >= window.endHour) {
    return { shouldFire: false, reason: 'outside_window' }
  }

  if (input.lastFiredMs != null && isSameLocalWeek(input.nowMs, input.lastFiredMs)) {
    return { shouldFire: false, reason: 'already_fired_this_week' }
  }

  return { shouldFire: true, reason: 'fire' }
}
