// @ts-check
/**
 * OS-notification copy for routed proactive inbox entries.
 *
 * The toast is the most exposed surface — a lock screen or a nearby bystander
 * can read it — so it carries only the entry title. An away summary adds one
 * number: how many items were noted while the user was away; a summary with
 * zero items has nothing to announce and yields no toast at all. The entry body
 * and fullBody never travel here. A capsule's `publicCopy` keeps its existing
 * title + opener pair.
 */

import { translateMainMessage } from './mainMessages.js'

/** @typedef {import('../shared/proactiveDelivery.js').ProactiveMessage} ProactiveMessage */

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function validSummaryCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Build the title/body pair for one proactive OS notification. `null` means the
 * entry raises no toast: an away summary with nothing noted has no sentence to
 * show and "0 things" must never reach a lock screen.
 *
 * @param {ProactiveMessage} message
 * @param {string} locale
 * @returns {{ title: string, body?: string } | null}
 */
export function buildProactiveNotificationCopy(message, locale) {
  const publicCopy = message.publicCopy
  if (publicCopy) {
    return { title: publicCopy.title, body: publicCopy.body }
  }

  if (message.source === 'away') {
    const count = validSummaryCount(message.summaryCount)
    if (count === 0) return null
    if (count !== null) {
      return {
        title: message.title,
        body: count === 1
          ? translateMainMessage('proactiveNotification.awaySummary.one', { n: count }, locale)
          : translateMainMessage('proactiveNotification.awaySummary.other', { n: count }, locale),
      }
    }
  }

  return { title: message.title }
}
