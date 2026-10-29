/**
 * Weekly-letter preference resolution.
 *
 * The letter used to be a side effect of the companionship pace, and the
 * stored `proactiveLetterEnabled` flag could be false simply because the
 * person never had an independent switch. This module separates an explicit
 * on/off choice from the legacy switch value so installing the new default
 * does not overwrite a choice someone actually made.
 *
 * `auto` means "no explicit letter choice was recorded". For a legacy store
 * the only visible letter switch lived in the Sometimes/Often pace block, so
 * a stored false there is treated as an explicit off. A false stored under
 * Quiet/Custom (where the switch was unreachable) stays auto and turns on.
 */

export const PROACTIVE_LETTER_CHOICES = ['auto', 'on', 'off'] as const

export type ProactiveLetterChoice = (typeof PROACTIVE_LETTER_CHOICES)[number]

/** Normalize an untyped stored value into a known choice. */
export function normalizeProactiveLetterChoice(value: unknown): ProactiveLetterChoice {
  return value === 'on' || value === 'off' ? value : 'auto'
}

export interface ProactiveLetterPreferenceInput {
  /** Explicit choice written by the dedicated switch, when present. */
  choice?: unknown
  /** Legacy stored switch value. */
  storedEnabled?: unknown
  /** Legacy pace recorded before the independent switch existed. */
  companionInitiative?: unknown
}

/**
 * Effective switch value. Explicit choices always win; otherwise the letter
 * defaults on, except for the legacy Sometimes/Often false that the old UI
 * did expose as a real switch.
 */
export function resolveProactiveLetterEnabled(input: ProactiveLetterPreferenceInput): boolean {
  const choice = normalizeProactiveLetterChoice(input.choice)
  if (choice === 'on') return true
  if (choice === 'off') return false
  if (input.storedEnabled === true) return true
  if (input.companionInitiative === 'sometimes' || input.companionInitiative === 'often') {
    return false
  }
  return true
}
