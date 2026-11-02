// @ts-check
/**
 * Product rule for when a proactive inbox entry counts as read.
 *
 * The table below is product-confirmed. It is the single place to change it —
 * the pet overlay, the reminder strip and the OS-notification click all call
 * this function instead of re-implementing the rule.
 *
 * Rules:
 * - opening the overlay never changes anything (`overlay_open` -> null);
 * - `done`, `open` and `reply` mark every entry `done`, including entries
 *   with no actions and capsules;
 * - `snooze` and the strip's own `expire` leave the entry unread, and an
 *   unknown interaction is a no-op (`null`);
 * - `expand` marks an entry with no actions `done` (including capsules) and
 *   leaves an entry with actions unchanged (`null`);
 * - a notification click never counts for a capsule: a capsule letter only
 *   counts once its full text is expanded. A notification click on an entry
 *   with no actions marks it `done`; on an entry with actions it marks it
 *   `read` (seen, not handled), and done/open/reply later complete it.
 *
 * The function is pure and shared by main and renderer so a strip action and
 * an overlay click can never disagree about the unread count.
 */

/** Every interaction the inbox surfaces can report. */
export const PROACTIVE_INBOX_INTERACTIONS = Object.freeze([
  'overlay_open',
  'expand',
  'done',
  'open',
  'reply',
  'snooze',
  'notification_click',
  'expire',
])

/**
 * @typedef {'overlay_open' | 'expand' | 'done' | 'open' | 'reply' | 'snooze' | 'notification_click' | 'expire'} ProactiveInboxInteraction
 */

/**
 * Next status after one interaction, or `null` when nothing should change.
 *
 * @param {{ actions?: readonly string[], kind?: string } | null | undefined} entry
 * @param {string} interaction
 * @returns {'done' | 'read' | null}
 */
export function inboxStatusAfterInteraction(entry, interaction) {
  if (!entry) return null
  if (interaction === 'overlay_open') return null
  if (interaction === 'done' || interaction === 'open' || interaction === 'reply') return 'done'
  if (interaction === 'snooze') return null

  const hasActions = Array.isArray(entry.actions) && entry.actions.length > 0
  if (interaction === 'expand') return hasActions ? null : 'done'
  if (interaction !== 'notification_click') return null

  // A capsule letter counts only when its full text is expanded; a toast click
  // never stands in for reading the letter.
  if (entry.kind === 'capsule') return null
  return hasActions ? 'read' : 'done'
}
