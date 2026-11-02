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

export const PROACTIVE_INBOX_INTERACTIONS: readonly ProactiveInboxInteraction[]

/**
 * Next status after one interaction, or `null` when nothing should change.
 */
export function inboxStatusAfterInteraction(
  entry: { actions?: readonly string[] } | null | undefined,
  interaction: ProactiveInboxInteraction | string,
): 'done' | null
