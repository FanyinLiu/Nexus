// @ts-check
/**
 * Product rule for when a proactive inbox entry counts as read.
 *
 * PENDING PRODUCT CONFIRMATION: the table below is a deliberate product
 * decision, not an invariant. It is the single place to change it — the pet
 * overlay, the reminder strip and the OS-notification click all call this
 * function instead of re-implementing the rule.
 *
 * Rules:
 * - opening the overlay never marks anything read (`overlay_open` -> null);
 * - an entry with actions is read by `done`, `open` or `reply`; `snooze` and
 *   `expand` leave it unread;
 * - an entry without actions (a companionship capsule, or a high-priority
 *   line with no buttons) is read only by expanding its full text.
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
])

/**
 * @typedef {'overlay_open' | 'expand' | 'done' | 'open' | 'reply' | 'snooze'} ProactiveInboxInteraction
 */

/**
 * Next status after one interaction, or `null` when nothing should change.
 *
 * @param {{ actions?: readonly string[] } | null | undefined} entry
 * @param {string} interaction
 * @returns {'done' | null}
 */
export function inboxStatusAfterInteraction(entry, interaction) {
  if (!entry) return null
  if (interaction === 'overlay_open') return null

  const hasActions = Array.isArray(entry.actions) && entry.actions.length > 0
  if (hasActions) {
    return interaction === 'done' || interaction === 'open' || interaction === 'reply'
      ? 'done'
      : null
  }

  return interaction === 'expand' ? 'done' : null
}
