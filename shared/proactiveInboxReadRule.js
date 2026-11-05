// @ts-check
/**
 * Product rule for when a proactive inbox entry counts as seen or handled.
 *
 * The table below is product-confirmed. It is the single place to change it —
 * the pet overlay, the notebook, the reminder strip and the OS-notification
 * click all call this function instead of re-implementing the rule.
 *
 * Two layers matter to the reading surfaces:
 * - "seen" means status `read` or `done`: the entry no longer counts as new
 *   and the note never shows it again, but it may still need a decision;
 * - "handled" means status `done` or `dismissed`: the entry moves below the
 *   notebook divider and leaves the active area.
 *
 * Rules:
 * - opening the overlay never changes anything (`overlay_open` -> null);
 * - `done`, `open` and `reply` mark every entry `done`, including entries
 *   with no actions and letters;
 * - `snooze` and the strip's own `expire` leave the entry unread, and an
 *   unknown interaction is a no-op (`null`);
 * - `notebook_seen` marks a letter/capsule `read` (only its full text can
 *   handle it) and an actionable entry `read` (done/open/reply still decide
 *   it); a no-action line becomes `done`, because being seen is all it needs;
 * - `expand` marks a letter/capsule `done` regardless of actions — the full
 *   text is the whole content — and marks any other no-action entry `done`;
 *   a non-letter entry with actions stays unchanged (`null`);
 * - a notification click never counts for a capsule: a capsule letter only
 *   counts once its full text is expanded. A notification click on an entry
 *   with no actions marks it `done`; on an entry with actions it marks it
 *   `read` (seen, not handled), and done/open/reply later complete it.
 *
 * The function is pure and shared by main and renderer so a strip action and
 * a notebook scroll can never disagree about what is still new.
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
  'notebook_seen',
])

/**
 * @typedef {'overlay_open' | 'expand' | 'done' | 'open' | 'reply' | 'snooze' | 'notification_click' | 'expire' | 'notebook_seen'} ProactiveInboxInteraction
 */

/**
 * True when the entry is delivered as a letter that carries its own full
 * text, so reading it is the handling action. `kind` is the renderer-facing
 * marker on capsules while `source` covers the router-side delivery.
 *
 * @param {{ kind?: string, source?: string } | null | undefined} entry
 * @returns {boolean}
 */
export function isProactiveLetterEntry(entry) {
  if (!entry) return false
  return entry.kind === 'capsule' || entry.source === 'capsule' || entry.source === 'letter'
}

/**
 * Next status after one interaction, or `null` when nothing should change.
 *
 * @param {{ actions?: readonly string[], kind?: string, source?: string } | null | undefined} entry
 * @param {string} interaction
 * @returns {'done' | 'read' | null}
 */
export function inboxStatusAfterInteraction(entry, interaction) {
  if (!entry) return null
  if (interaction === 'overlay_open') return null
  if (interaction === 'done' || interaction === 'open' || interaction === 'reply') return 'done'
  if (interaction === 'snooze') return null

  const hasActions = Array.isArray(entry.actions) && entry.actions.length > 0
  if (interaction === 'expand') {
    // The full letter is the whole content, so expanding it finishes the
    // entry even when it also offers buttons.
    if (isProactiveLetterEntry(entry)) return 'done'
    return hasActions ? null : 'done'
  }
  if (interaction === 'notebook_seen') {
    // Visibility alone can only settle a line that never asked for a decision.
    if (isProactiveLetterEntry(entry)) return 'read'
    return hasActions ? 'read' : 'done'
  }
  if (interaction !== 'notification_click') return null

  // A capsule letter counts only when its full text is expanded; a toast click
  // never stands in for reading the letter.
  if (entry.kind === 'capsule') return null
  return hasActions ? 'read' : 'done'
}
