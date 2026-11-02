// @ts-check
/**
 * Button labels for the reminder strip, localized in the main process.
 *
 * The strip page is a static, sandboxed page with no translation runtime, so
 * the router's strip outlet fills these labels once per delivery. The snooze
 * label deliberately names the fixed ten-minute delay decided for M1.
 */

import { readMainUiLocale, translateMainMessage } from './mainMessages.js'

/** @typedef {import('./services/reminderStripQueue.js').ReminderStripLabels} ReminderStripLabels */

/**
 * @param {unknown} [locale] Explicit locale for tests; omitted means the
 *   current UI language.
 * @returns {ReminderStripLabels}
 */
export function buildReminderStripLabels(locale) {
  const resolved = locale ?? readMainUiLocale()
  return {
    done: translateMainMessage('reminderStrip.done', undefined, resolved),
    snooze: translateMainMessage('reminderStrip.snooze', undefined, resolved),
    open: translateMainMessage('reminderStrip.open', undefined, resolved),
  }
}
