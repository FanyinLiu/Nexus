/**
 * Copy for OS notifications raised by the proactive sources.
 *
 * A lock screen is not a private surface: an OS toast must never carry memory
 * text, the user's own words, an errand prompt/result, or letter content. The
 * only exception is the agenda reminder, whose body is the reminder's `what`
 * clipped to a short budget. In-app chat and bubbles keep their own copy and
 * do not go through this module.
 *
 * Every string here is a fixed localized line, resolved through the runtime
 * `t()` so non-hook code can build the same body the renderer would.
 */

import { normalizeLocale, t } from '../../i18n/runtime.ts'
import type { TranslationKey, UiLanguage } from '../../types'
import type { BracketCallback } from './bracketCopy.ts'

/** Longest agenda `what` the OS body may carry, counted in code points. */
export const AGENDA_NOTIFICATION_WHAT_MAX = 20

/**
 * Clip an agenda reminder's `what` for the OS body.
 *
 * Trimming happens first so trailing whitespace never counts toward the
 * budget. The cut is by Unicode code point, not UTF-16 unit, so an emoji or
 * any other astral character is never split into a lone surrogate.
 */
export function truncateAgendaWhat(what: string): string {
  const trimmed = what.trim()
  const codePoints = Array.from(trimmed)
  if (codePoints.length <= AGENDA_NOTIFICATION_WHAT_MAX) return trimmed
  return `${codePoints.slice(0, AGENDA_NOTIFICATION_WHAT_MAX).join('')}…`
}

export interface AgendaNotification {
  title: string
  body: string
}

/**
 * The agenda reminder's OS payload: the unchanged title plus only the clipped
 * `what`. Place, time and outreach templates stay out of the toast.
 */
export function buildAgendaNotification(input: { title: string; what: string }): AgendaNotification {
  return { title: input.title, body: truncateAgendaWhat(input.what) }
}

/** Which bracket content kind fired, if any. */
export type BracketNotificationKind = 'last_night' | 'today' | 'errand' | null

/**
 * Which fixed OS line the bracket toast should carry.
 *
 * An errand delivered this morning wins over any callback: it is the freshest
 * content, and its prompt/result must never reach the lock screen. Otherwise
 * the callback decides, and an open question keeps the caller's body.
 */
export function bracketNotificationKind(input: {
  errandDelivered: boolean
  callback: BracketCallback
}): BracketNotificationKind {
  if (input.errandDelivered) return 'errand'
  if (input.callback === 'evening') return 'last_night'
  if (input.callback === 'event') return 'today'
  return null
}

const BRACKET_BODY_KEYS: Record<Exclude<BracketNotificationKind, null>, TranslationKey> = {
  last_night: 'proactive.notify.bracket_last_night',
  today: 'proactive.notify.bracket_today',
  errand: 'proactive.notify.bracket_errand',
}

/**
 * The bracket OS body: a fixed line for the three content kinds, or the
 * caller's current body unchanged when no kind fired. The current body may
 * carry the previous evening's topic, so it is only used for the open-question
 * case where the callback was null.
 */
export function bracketNotificationBody(
  uiLanguage: UiLanguage,
  kind: BracketNotificationKind,
  currentBody: string,
): string {
  if (kind === null) return currentBody
  return t(BRACKET_BODY_KEYS[kind], undefined, normalizeLocale(uiLanguage))
}

/** The weekly letter's OS body; the letter text itself never reaches a toast. */
export function letterNotificationBody(uiLanguage: UiLanguage): string {
  return t('proactive.notify.letter_ready', undefined, normalizeLocale(uiLanguage))
}

/** The open-arc fallback OS body; the arc theme stays out of the toast. */
export function openArcFallbackNotificationBody(uiLanguage: UiLanguage): string {
  return t('proactive.notify.open_arc_fallback', undefined, normalizeLocale(uiLanguage))
}
