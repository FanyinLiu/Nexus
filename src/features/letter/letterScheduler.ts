/**
 * Sunday-letter fire scheduler — pure decision logic.
 *
 * The letter belongs to a Sunday slot: it is due at the local Sunday evening
 * hour, and if the app was closed then it is written on the next open. Only
 * the latest slot is considered, so a person who missed three weeks gets one
 * letter, not three. Sunday morning is intentionally quiet: the previous
 * slot is already in catch-up territory, but waiting for the current evening
 * avoids two letters landing on the same day.
 *
 * One letter per Sunday week is enforced by the stored `letterDate` of the
 * latest successful letter. Failures never update that date, so a failed LLM
 * call leaves the week available for the next tick.
 */

import { localDayKey, startOfLocalSunday } from '../../lib/localDate.ts'
import type { CompanionRelationshipType } from '../../types'

export type LetterDecision =
  | {
      shouldFire: true
      reason: 'fire'
      /** Local date (YYYY-MM-DD) of the Sunday this letter belongs to. */
      letterDate: string
      /** Local timestamp of the Sunday-evening deadline. */
      dueAtMs: number
      /** True when the app is opening after the slot instead of on Sunday evening. */
      catchUp: boolean
    }
  | {
      shouldFire: false
      reason:
        | 'disabled'
        | 'memory_paused'
        | 'outside_window'
        | 'already_fired_this_week'
        | 'relationship_type_opted_out'
    }

export interface LetterDecisionInput {
  enabled: boolean
  nowMs: number
  /** Latest successfully delivered letter date; failed attempts never set it. */
  lastLetterDate?: string | null
  /** Sunday-evening hour the letter becomes due. Defaults to 18 local. */
  window?: { startHour: number }
  relationshipType: CompanionRelationshipType
  /** Memory pause suppresses the letter and does not consume the week. */
  memoryPaused?: boolean
}

const DEFAULT_START_HOUR = 18
const SUNDAY = 0

/**
 * Latest Sunday-evening slot that is already due, or null on Sunday before
 * the evening hour. Only the latest slot is returned by design.
 */
export function resolveLetterSlot(
  nowMs: number,
  startHour = DEFAULT_START_HOUR,
): { dueAtMs: number; letterDate: string; catchUp: boolean } | null {
  const now = new Date(nowMs)
  const sundayStart = startOfLocalSunday(nowMs)
  const sunday = new Date(sundayStart)
  const dueAtMs = new Date(
    sunday.getFullYear(),
    sunday.getMonth(),
    sunday.getDate(),
    startHour,
    0,
    0,
    0,
  ).getTime()

  if (now.getDay() === SUNDAY && nowMs < dueAtMs) return null

  return {
    dueAtMs,
    letterDate: localDayKey(dueAtMs),
    catchUp: localDayKey(nowMs) !== localDayKey(dueAtMs),
  }
}

export function decideLetter(input: LetterDecisionInput): LetterDecision {
  if (!input.enabled) return { shouldFire: false, reason: 'disabled' }
  if (input.memoryPaused === true) return { shouldFire: false, reason: 'memory_paused' }
  if (input.relationshipType === 'quiet_companion') {
    return { shouldFire: false, reason: 'relationship_type_opted_out' }
  }

  const slot = resolveLetterSlot(input.nowMs, input.window?.startHour ?? DEFAULT_START_HOUR)
  if (!slot) return { shouldFire: false, reason: 'outside_window' }

  if (input.lastLetterDate && input.lastLetterDate >= slot.letterDate) {
    return { shouldFire: false, reason: 'already_fired_this_week' }
  }

  return { shouldFire: true, reason: 'fire', ...slot }
}
