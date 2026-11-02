/**
 * Copy for OS notifications raised by the proactive sources.
 *
 * A lock screen is not a private surface: an OS toast must never carry memory
 * text, the user's own words, an errand prompt/result, or letter content. The
 * only exception is the agenda reminder, whose body is the first non-blank
 * line of the reminder's `what`, clipped to a short budget. In-app chat and
 * bubbles keep their own copy and do not go through this module.
 *
 * Every string here is a fixed localized line, resolved through the runtime
 * `t()` so non-hook code can build the same body the renderer would.
 */

import { normalizeLocale, t } from '../../i18n/runtime.ts'
import type { TranslationKey, UiLanguage } from '../../types'
import type { BracketCallback } from './bracketCopy.ts'

/** Longest agenda `what` the OS body may carry, counted in grapheme clusters. */
export const AGENDA_NOTIFICATION_WHAT_MAX = 20

/** Grapheme segmentation shared by every clip; the locale only affects word breaks. */
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Clip an agenda reminder's `what` for the OS body.
 *
 * Only the first non-blank line is eligible, so a multi-line memory can never
 * smuggle a later line onto the lock screen. Leading blank lines are skipped;
 * an all-blank value becomes an empty body. The line is trimmed before
 * counting so trailing whitespace never spends the budget. The cut is by
 * grapheme cluster, not UTF-16 unit or code point, so a user-perceived
 * character — an emoji ZWJ sequence, a flag, or a base letter plus its
 * combining mark — is one unit and is never cut. A single ellipsis marks
 * either a clipped line or any later non-blank line.
 */
export function truncateAgendaWhat(what: string): string {
  const lines = what.split(/\r\n|\n|\r/)
  const firstLineIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstLineIndex === -1) return ''
  const firstLine = lines[firstLineIndex].trim()
  const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(firstLine), (part) => part.segment)
  const clipped = graphemes.length > AGENDA_NOTIFICATION_WHAT_MAX
    ? graphemes.slice(0, AGENDA_NOTIFICATION_WHAT_MAX).join('')
    : firstLine
  const hasFollowingLine = lines
    .slice(firstLineIndex + 1)
    .some((line) => line.trim().length > 0)
  return graphemes.length > AGENDA_NOTIFICATION_WHAT_MAX || hasFollowingLine
    ? `${clipped}…`
    : clipped
}

export interface AgendaNotification {
  title: string
  body: string
}

/**
 * The agenda reminder's OS payload: the unchanged title plus only the clipped
 * first line of `what`. Place, time, later lines and outreach templates stay
 * out of the toast.
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
