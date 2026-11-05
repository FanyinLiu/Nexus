/**
 * Away-summary producer for the proactive router.
 *
 * The away scheduler fires after a long silence. Instead of always raising the
 * old "thinking of you" toast, it first counts the unread items the inbox has
 * collected since the user's last activity and, when there are some, sends one
 * count-only away summary through the router. The count is the whole payload:
 * no item title, body or fragment is ever read into the message, so a lock
 * screen can never leak what was noted.
 *
 * An away summary carries no action. `open` opens the chat panel, not the
 * inbox list where the noted items live, so it would not take the user to the
 * things being counted. With no actions the entry stays informational and is
 * not offered to the reminder strip.
 */

import type { ProactiveMessage } from '../../../shared/proactiveDelivery.js'

/** Upper bound mirrored by the delivery IPC schema and the toast copy layer. */
export const AWAY_SUMMARY_COUNT_MAX = 999

/** Minimal inbox row shape the counter reads; nothing else is touched. */
export interface AwaySummaryEntry {
  status: string
  source: string
  createdAt: number
}

/**
 * Count inbox entries worth announcing in an away summary.
 *
 * Only unread, non-away entries created at or after `sinceMs` count. Away
 * summaries are excluded so one summary can never include an earlier one. A
 * missing, non-finite or unparsable `sinceMs` counts nothing: an unknown
 * window must not announce the whole inbox. The result is capped at
 * `AWAY_SUMMARY_COUNT_MAX`.
 */
export function countAwaySummaryItems(
  entries: readonly AwaySummaryEntry[] | null | undefined,
  sinceMs: number,
): number {
  if (!Array.isArray(entries) || !Number.isFinite(sinceMs)) return 0

  let count = 0
  for (const entry of entries) {
    if (!entry) continue
    if (entry.status !== 'unread') continue
    if (entry.source === 'away') continue
    if (!Number.isFinite(entry.createdAt) || entry.createdAt < sinceMs) continue
    count += 1
    if (count >= AWAY_SUMMARY_COUNT_MAX) return AWAY_SUMMARY_COUNT_MAX
  }
  return count
}

export interface BuildAwaySummaryMessageInput {
  /** The localized away copy title, unchanged from the legacy toast. */
  title: string
  /** The localized away copy body, unchanged from the legacy toast. */
  body: string
  summaryCount: number
  /** Delivery instant; also the id suffix so each firing is its own entry. */
  firedAtMs: number
}

function normalizeSummaryCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(AWAY_SUMMARY_COUNT_MAX, Math.trunc(value)))
}

/**
 * Build the router message for one away summary.
 *
 * Title and body stay the legacy localized away copy so the inbox row and any
 * routed panel surface read exactly like the old ping; only the OS toast turns
 * `summaryCount` into its count sentence. The id carries the firing instant,
 * so a later away window creates a new entry instead of overwriting the last.
 */
export function buildAwaySummaryMessage({
  title,
  body,
  summaryCount,
  firedAtMs,
}: BuildAwaySummaryMessageInput): ProactiveMessage {
  return {
    id: `away:summary:${firedAtMs}`,
    source: 'away',
    kind: 'away',
    priority: 'normal',
    title,
    body,
    actions: [],
    createdAt: firedAtMs,
    summaryCount: normalizeSummaryCount(summaryCount),
  }
}
