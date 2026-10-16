/**
 * Maps the simple “how often she comes to you” choice onto the switches
 * that already drive presence, letters, and the autonomy tick.
 *
 * Reading a draft never writes. A pace is applied only when the person
 * picks one. Anything that does not match a pace stays custom.
 */

import type { CompanionInitiative } from '../../types/app.ts'

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

  if (autonomyEnabled && presence && interval === OFTEN_INTERVAL_MINUTES && away && letter) {
    return 'often'
  }

  return 'custom'
}

/**
 * Switches written when a person picks a pace. Unfinished-items and
 * morning/evening greetings are left alone except on quiet, which turns
 * greetings off. Sometimes deliberately leaves the autonomy tick off.
 */
export function companionInitiativePatch(
  pace: Exclude<CompanionInitiative, 'custom'>,
): Partial<InitiativeFlags> {
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
  }
}
