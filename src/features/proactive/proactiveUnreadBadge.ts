/**
 * Red-dot label rules for the pet's proactive badge.
 *
 * The badge only needs three states — hidden, an exact count, and the "99+"
 * cap — so the mapping lives here and stays testable without a renderer.
 */

import { normalizeNonNegativeInteger } from '../../lib/normalize.ts'

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
