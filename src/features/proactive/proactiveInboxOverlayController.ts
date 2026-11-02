/**
 * State machine behind the pet's inbox overlay.
 *
 * The controller is a tiny external store: the React hook only subscribes and
 * renders, while every interaction goes through the shared read rule so the
 * overlay, the reminder strip and an OS-notification click agree on the unread
 * count. It is intentionally free of React, `window` and real timers; the
 * bridge and the clock are injected, which is what makes the done/snooze/open
 * behaviour testable without a DOM.
 *
 * The overlay shows every entry from the last 30 days, including read/done
 * rows, and the injected clock owns that boundary. Opening it refreshes the
 * list but never changes a status; an action-less row expanded to "done" stays
 * expanded until collapse/close; snooze keeps the entry unread and hides it
 * only for this app session.
 */

import type {
  ProactiveDeliveryPayload,
  ProactiveInboxSnapshot,
  ProactiveMessage,
} from '../../../shared/proactiveDelivery.js'
import { inboxStatusAfterInteraction } from '../../../shared/proactiveInboxReadRule.js'
import type { Logger } from '../../lib/logger.ts'
import { normalizeNonNegativeInteger } from '../../lib/normalize.ts'
import {
  proactiveMessageFromInboxEntry,
  selectProactiveInboxEntries,
  toProactiveInboxRow,
  type ProactiveInboxEntryView,
  type ProactiveInboxRow,
  type ProactiveInboxRowAction,
} from './proactiveInboxOverlay.ts'
import {
  createProactiveInboxSnoozeScheduler,
  type ProactiveInboxSnoozeDependencies,
} from './proactiveInboxSnooze.ts'

export type ProactiveInboxOverlayView = {
  open: boolean
  unreadCount: number
  rows: ProactiveInboxRow[]
  expandedId: string | null
}

export type ProactiveInboxOverlayBridge = {
  list: () => Promise<ProactiveInboxSnapshot>
  update: (id: string, status: 'done') => Promise<{ updated: boolean; unreadCount: number }>
  deliver: (payload: ProactiveDeliveryPayload) => Promise<unknown>
  openConversation: () => void | Promise<void>
}

export type ProactiveInboxOverlayDependencies = {
  bridge: ProactiveInboxOverlayBridge
  buildDeliveryPayload: (message: ProactiveMessage) => Promise<ProactiveDeliveryPayload>
  logger: Pick<Logger, 'warn'>
  setTimeout: ProactiveInboxSnoozeDependencies['setTimeout']
  clearTimeout: ProactiveInboxSnoozeDependencies['clearTimeout']
  /** Injectable clock for the 30-day window; defaults to `Date.now`. */
  nowMs?: () => number
  /** Safety bound on rendered rows; defaults to the store's own maximum. */
  maxRows?: number
}

/**
 * Create one controller per mounted pet window. Call `dispose` on unmount so
 * pending snooze timers cannot fire after the host is gone.
 */
export function createProactiveInboxOverlayController({
  bridge,
  buildDeliveryPayload,
  logger,
  setTimeout,
  clearTimeout,
  nowMs = Date.now,
  maxRows,
}: ProactiveInboxOverlayDependencies) {
  let entries: ProactiveInboxEntryView[] = []
  let unreadCount = 0
  let isOpen = false
  let expandedId: string | null = null
  /** Expanded action-less row that the read rule just marked done. */
  let pinnedReadId: string | null = null
  let disposed = false
  let refreshSequence = 0
  let snapshot: ProactiveInboxOverlayView = {
    open: false,
    unreadCount: 0,
    rows: [],
    expandedId: null,
  }

  const listeners = new Set<() => void>()

  const snooze = createProactiveInboxSnoozeScheduler({
    setTimeout,
    clearTimeout,
    onDeliver: (entry) => {
      void deliverSnoozed(entry)
    },
  })

  function buildView(): ProactiveInboxOverlayView {
    const rows = selectProactiveInboxEntries(entries, {
      hiddenIds: snooze.snoozedIds(),
      nowMs: nowMs(),
      ...(maxRows !== undefined ? { limit: maxRows } : {}),
    }).map(toProactiveInboxRow)
    return {
      open: isOpen,
      unreadCount,
      rows,
      expandedId,
    }
  }

  function emit(): void {
    snapshot = buildView()
    for (const listener of listeners) listener()
  }

  function applySnapshot(next: ProactiveInboxSnapshot): void {
    entries = Array.isArray(next.entries)
      ? next.entries as ProactiveInboxEntryView[]
      : []
    unreadCount = normalizeNonNegativeInteger(next.unreadCount)

    snooze.reconcile(entries)

    if (pinnedReadId) {
      const pinned = entries.find((entry) => entry.id === pinnedReadId)
      if (!pinned || pinned.status !== 'done') {
        if (expandedId === pinnedReadId) expandedId = null
        pinnedReadId = null
      }
    }

    if (expandedId && expandedId !== pinnedReadId) {
      // Read rows can stay expanded too; only a removed entry collapses.
      const expanded = entries.find((entry) => entry.id === expandedId)
      if (!expanded) expandedId = null
    }

    emit()
  }

  /** Pull the full inbox. Concurrent pushes are ordered by a sequence number. */
  async function refresh(): Promise<void> {
    const sequence = ++refreshSequence
    try {
      const next = await bridge.list()
      if (disposed || sequence !== refreshSequence) return
      applySnapshot(next)
    } catch {
      logger.warn('proactive inbox overlay refresh failed', { errorPresent: true })
    }
  }

  async function setEntryDone(entry: ProactiveInboxEntryView): Promise<boolean> {
    try {
      const result = await bridge.update(entry.id, 'done')
      if (result.updated) {
        entries = entries.map((item) => (
          item.id === entry.id ? { ...item, status: 'done' } : item
        ))
        unreadCount = normalizeNonNegativeInteger(result.unreadCount)
      }
      snooze.cancel(entry.id)
      emit()
      return true
    } catch {
      logger.warn('proactive inbox overlay status update failed', { errorPresent: true })
      return false
    }
  }

  async function deliverSnoozed(entry: ProactiveInboxEntryView): Promise<void> {
    // The scheduler dropped the timer first, so this also unhides the row.
    emit()
    try {
      const payload = await buildDeliveryPayload(proactiveMessageFromInboxEntry(entry))
      await bridge.deliver(payload)
    } catch {
      logger.warn('proactive inbox snooze re-delivery failed', { errorPresent: true })
    }
  }

  function clearRowState(id: string): void {
    if (expandedId === id) expandedId = null
    if (pinnedReadId === id) pinnedReadId = null
  }

  async function open(): Promise<void> {
    if (disposed) return
    isOpen = true
    emit()
    await refresh()
  }

  function close(): void {
    if (!isOpen) return
    isOpen = false
    expandedId = null
    pinnedReadId = null
    emit()
  }

  async function toggle(): Promise<void> {
    if (isOpen) {
      close()
      return
    }
    await open()
  }

  async function toggleRow(id: string): Promise<void> {
    const entry = entries.find((item) => item.id === id)
    if (!entry) return

    if (expandedId === id) {
      expandedId = null
      if (pinnedReadId === id) pinnedReadId = null
      emit()
      return
    }

    expandedId = id
    pinnedReadId = null
    emit()

    if (entry.status !== 'unread') return
    if (inboxStatusAfterInteraction(entry, 'expand') !== 'done') return

    // Keep the row visible while the user reads the text that just marked it
    // read; collapse or overlay close releases the pin.
    pinnedReadId = id
    const updated = await setEntryDone(entry)
    if (!updated && pinnedReadId === id) {
      pinnedReadId = null
      emit()
    }
  }

  async function runAction(id: string, action: ProactiveInboxRowAction): Promise<void> {
    const entry = entries.find((item) => item.id === id)
    if (!entry) return

    if (action === 'snooze') {
      if (inboxStatusAfterInteraction(entry, 'snooze') !== null) return
      clearRowState(id)
      snooze.snooze(entry)
      emit()
      return
    }

    if (action === 'open' || action === 'reply') {
      try {
        await bridge.openConversation()
      } catch {
        logger.warn('proactive inbox open conversation failed', { errorPresent: true })
      }
    }

    // A read row keeps its Open button, but its status is already final.
    if (entry.status !== 'unread') return
    if (inboxStatusAfterInteraction(entry, action) !== 'done') return
    clearRowState(id)
    await setEntryDone(entry)
  }

  function getSnapshot(): ProactiveInboxOverlayView {
    return snapshot
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function dispose(): void {
    disposed = true
    snooze.dispose()
    listeners.clear()
  }

  return {
    getSnapshot,
    subscribe,
    refresh,
    open,
    close,
    toggle,
    toggleRow,
    runAction,
    dispose,
  }
}

export type ProactiveInboxOverlayController = ReturnType<typeof createProactiveInboxOverlayController>
