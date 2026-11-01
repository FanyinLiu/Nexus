/**
 * Red-dot label rules for the pet's proactive badge.
 *
 * The badge only needs three states — hidden, an exact count, and the "99+"
 * cap — so the mapping lives here and stays testable without a renderer.
 * English is the only locale with a distinct singular form, so the label
 * helper picks the `_one` key for exactly one unread message.
 */

import { normalizeNonNegativeInteger } from '../../lib/normalize.ts'
import type { TranslationKey } from '../../types/i18n.ts'

/** Highest count shown as a number; anything above renders as "99+". */
export const PROACTIVE_UNREAD_BADGE_MAX = 99

/**
 * Badge text for a count. `null` means the dot is hidden: no unread messages
 * and a broken count are the same state for the user.
 *
 * @param {number} unreadCount
 * @returns {string | null}
 */
export function formatProactiveUnreadBadge(unreadCount: number): string | null {
  const count = normalizeNonNegativeInteger(unreadCount)
  if (count === 0) return null
  return count > PROACTIVE_UNREAD_BADGE_MAX ? `${PROACTIVE_UNREAD_BADGE_MAX}+` : String(count)
}

/**
 * Translation key for the accessible label. `_one` exists in every locale so
 * the key set stays parallel; non-English values repeat the plural text.
 *
 * @param {number} unreadCount
 * @returns {TranslationKey}
 */
export function proactiveUnreadBadgeLabelKey(unreadCount: number): TranslationKey {
  return normalizeNonNegativeInteger(unreadCount) === 1
    ? 'pet.proactive.unread_badge_one'
    : 'pet.proactive.unread_badge'
}
