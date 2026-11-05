/**
 * Types for the cross-process proactive-inbox read rule.
 *
 * The rule itself lives only in `proactiveInboxReadRule.js` so main and the
 * renderer cannot drift; declarations mirror that module's JSDoc.
 */

export type ProactiveInboxInteraction =
  | 'overlay_open'
  | 'expand'
  | 'done'
  | 'open'
  | 'reply'
  | 'snooze'
  | 'notification_click'
  | 'expire'
  | 'notebook_seen'

export const PROACTIVE_INBOX_INTERACTIONS: readonly ProactiveInboxInteraction[]

/**
 * True when the entry is delivered as a letter that carries its own full
 * text, so reading it is the handling action.
 */
export function isProactiveLetterEntry(
  entry: { kind?: string, source?: string } | null | undefined,
): boolean

/**
 * Next status after one interaction, or `null` when nothing should change.
 */
export function inboxStatusAfterInteraction(
  entry: { actions?: readonly string[], kind?: string, source?: string } | null | undefined,
  interaction: ProactiveInboxInteraction | string,
): 'done' | 'read' | null
