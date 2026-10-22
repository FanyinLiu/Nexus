/**
 * Maps the simple “how often she comes to you” choice onto the switches
 * that already drive presence, letters, and the agenda cap.
 *
 * Reading a draft never writes. A pace is applied only when the person
 * picks one. Anything that does not match a pace stays custom.
 *
 * Often turns the autonomy tick on. Idle ticks do not spend the daily
 * model budget, so that pace can stay on for the whole day.
 */

import type { CompanionInitiative } from '../../types/app.ts'
import type { ProactiveFrequencyPreset } from '../../types/proactive.ts'

export type InitiativeFlags = {
  autonomyEnabled: boolean
  proactivePresenceEnabled: boolean
  proactivePresenceIntervalMinutes: number
  proactiveAwayNotificationsEnabled: boolean
  proactiveBracketEnabled: boolean
  proactiveLetterEnabled: boolean
}

const SOMETIMES_INTERVAL_MINUTES = 25
const OFTEN_INTERVAL_MINUTES = 15

function flag(raw: Record<string, unknown>, key: keyof InitiativeFlags, fallback: boolean): boolean {
  const value = raw[key]
  return typeof value === 'boolean' ? value : fallback
}

function minutes(raw: Record<string, unknown>, fallback: number): number {
  const value = raw.proactivePresenceIntervalMinutes
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function agendaCap(raw: Record<string, unknown>): ProactiveFrequencyPreset {
  return raw.proactiveFrequency === 'low' ? 'low' : 'normal'
}

/**
 * Infer a pace from stored switches. Missing fields use the factory
 * defaults so an older file is not treated as a custom mix.
 */
export function inferCompanionInitiative(raw: object): CompanionInitiative {
  const source = raw as Record<string, unknown>
  const autonomyEnabled = flag(source, 'autonomyEnabled', false)
  const presence = flag(source, 'proactivePresenceEnabled', false)
  const interval = minutes(source, SOMETIMES_INTERVAL_MINUTES)
  const away = flag(source, 'proactiveAwayNotificationsEnabled', false)
  const bracket = flag(source, 'proactiveBracketEnabled', false)
  const letter = flag(source, 'proactiveLetterEnabled', false)

  if (!autonomyEnabled && !presence && !away && !bracket && !letter) return 'quiet'

  if (!autonomyEnabled && presence && interval === SOMETIMES_INTERVAL_MINUTES && !away && letter) {
    return 'sometimes'
  }

  // Tick on or off both read as often. Builds saved before the budget
  // fix stored this pace with the tick off; picking it again turns the
  // tick on. A different interval or cap stays custom.
  if (presence && interval === OFTEN_INTERVAL_MINUTES && away && letter && agendaCap(source) === 'normal') {
    return 'often'
  }

  return 'custom'
}

/**
 * Switches written when a person picks a pace. Unfinished-items stay as
 * they are; often only raises their daily cap. Quiet turns greetings off.
 * Sometimes leaves the autonomy tick off. Often turns it on.
 */
export function companionInitiativePatch(
  pace: Exclude<CompanionInitiative, 'custom'>,
): Partial<InitiativeFlags & { proactiveFrequency: ProactiveFrequencyPreset }> {
  if (pace === 'quiet') {
    return {
      autonomyEnabled: false,
      proactivePresenceEnabled: false,
      proactiveAwayNotificationsEnabled: false,
      proactiveBracketEnabled: false,
      proactiveLetterEnabled: false,
    }
  }
  if (pace === 'sometimes') {
    return {
      autonomyEnabled: false,
      proactivePresenceEnabled: true,
      proactivePresenceIntervalMinutes: SOMETIMES_INTERVAL_MINUTES,
      proactiveAwayNotificationsEnabled: false,
      proactiveLetterEnabled: true,
    }
  }
  return {
    autonomyEnabled: true,
    proactivePresenceEnabled: true,
    proactivePresenceIntervalMinutes: OFTEN_INTERVAL_MINUTES,
    proactiveAwayNotificationsEnabled: true,
    proactiveLetterEnabled: true,
    proactiveFrequency: 'normal',
  }
}
