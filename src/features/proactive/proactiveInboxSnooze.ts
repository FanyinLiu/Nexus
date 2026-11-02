/**
 * Renderer-session snooze timers for inbox overlay rows.
 *
 * "Later 10 minutes" leaves the stored status untouched (the badge stays) and
 * only hides the row here. When the timer fires the caller re-delivers the
 * entry through the existing router bridge; the inbox upsert keeps its unread
 * status, so the row returns and the user can act on it again.
 *
 * The timers are deliberately in-memory: like the reminder strip's snooze, a
 * snooze does not survive an app restart. Timers are injected so the module is
 * testable with a fake clock and so the caller can cancel one when the entry
 * becomes done or dismissed elsewhere.
 */

import type { ProactiveInboxEntry } from '../../../shared/proactiveDelivery.js'
import type { ProactiveInboxEntryView } from './proactiveInboxOverlay.ts'

/** Same duration the reminder strip uses. */
export const PROACTIVE_INBOX_SNOOZE_MS = 10 * 60_000

/** Opaque handle so the caller can supply Node, DOM or fake timers. */
export type ProactiveInboxSnoozeTimerHandle = unknown

export type ProactiveInboxSnoozeDependencies = {
  setTimeout: (callback: () => void, ms: number) => ProactiveInboxSnoozeTimerHandle
  clearTimeout: (handle: ProactiveInboxSnoozeTimerHandle) => void
  onDeliver: (entry: ProactiveInboxEntryView) => void
  snoozeMs?: number
}

/**
 * Create one scheduler per overlay mount. Cancelling is idempotent and a
 * timer that already fired can no longer cancel its (now finished) delivery.
 */
export function createProactiveInboxSnoozeScheduler({
  setTimeout,
  clearTimeout,
  onDeliver,
  snoozeMs = PROACTIVE_INBOX_SNOOZE_MS,
}: ProactiveInboxSnoozeDependencies) {
  const pending = new Map<string, {
    handle: ProactiveInboxSnoozeTimerHandle
    entry: ProactiveInboxEntryView
  }>()

  function cancel(id: string): void {
    const item = pending.get(id)
    if (!item) return
    pending.delete(id)
    clearTimeout(item.handle)
  }

  function snooze(entry: ProactiveInboxEntryView): void {
    cancel(entry.id)
    const snapshot: ProactiveInboxEntryView = { ...entry }
    const handle = setTimeout(() => {
      const current = pending.get(entry.id)
      if (!current) return
      pending.delete(entry.id)
      onDeliver(current.entry)
    }, snoozeMs)
    pending.set(entry.id, { handle, entry: snapshot })
  }

  /**
   * Drop timers whose entry disappeared, or was handled elsewhere (strip,
   * OS notification, another window) while the overlay was open or closed.
   */
  function reconcile(entries: readonly ProactiveInboxEntry[]): void {
    if (pending.size === 0) return
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    for (const id of [...pending.keys()]) {
      const entry = byId.get(id)
      if (!entry || entry.status === 'done' || entry.status === 'dismissed') cancel(id)
    }
  }

  function isSnoozed(id: string): boolean {
    return pending.has(id)
  }

  function snoozedIds(): string[] {
    return [...pending.keys()]
  }

  function dispose(): void {
    for (const id of [...pending.keys()]) cancel(id)
  }

  return { snooze, cancel, reconcile, isSnoozed, snoozedIds, dispose }
}

export type ProactiveInboxSnoozeScheduler = ReturnType<typeof createProactiveInboxSnoozeScheduler>
