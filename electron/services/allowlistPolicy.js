/**
 * Shared allowlist policy for messaging gateways (Telegram / Discord).
 *
 * Deny-by-default: an empty allowlist accepts NOBODY. The previous
 * behaviour (empty = accept all) meant a freshly configured bot was
 * open to any stranger who found it, since bot usernames are publicly
 * searchable and anyone can DM a bot.
 */

/**
 * @param {Set<unknown>} allowedIds
 * @param {unknown} senderId
 * @returns {boolean}
 */
export function isAllowedSender(allowedIds, senderId) {
  return allowedIds.size > 0 && allowedIds.has(senderId)
}
