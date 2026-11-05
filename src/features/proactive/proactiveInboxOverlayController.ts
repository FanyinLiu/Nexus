/**
 * State machine behind the pet's notebook (the former inbox overlay).
 *
 * The controller is a tiny external store: the React hook only subscribes and
 * renders, while every interaction goes through the shared read rule so the
 * notebook, the reminder strip and an OS-notification click agree on what is
 * unseen and what is handled. It is intentionally free of React, `window` and
 * real timers; the bridge and the clock are injected, which is what makes the
 * seen/handled/snooze/open behaviour testable without a DOM.
 *
 * The notebook shows every entry from the last 15 days, including read/done
 * rows, and the injected clock owns that boundary. Opening refreshes the list
 * and freezes the display order: rows that become seen or handled while it
 * stays open keep their slot, and entries that arrive later go on top. Seen
 * (`read`/`done`/`dismissed`) and handled (`done`/`dismissed`) are separate
 * layers, so a letter can be seen without being opened. Snooze keeps the entry
 * unread and hides it only for this app session.
 *
 * The unread view reads the same snapshot through `resolveProactiveNoteView`,
 * while the opening line and the frozen unseen ids feed the notebook's speech
 * rules.
 */

import type {
  ProactiveDeliveryPayload,
  ProactiveInboxSnapshot,
  ProactiveMessage,
} from '../../../shared/proactiveDelivery.js'
import { inboxStatusAfterInteraction } from '../../../shared/proactiveInboxReadRule.js'
import type { TranslationKey } from '../../types/i18n.ts'
import type { Logger } from '../../lib/logger.ts'
import { normalizeNonNegativeInteger } from '../../lib/normalize.ts'
import {
  proactiveMessageFromInboxEntry,
  selectProactiveInboxEntries,
  toProactiveInboxRow,
  proactiveNotebookDividerIndex,
  type ProactiveInboxEntryView,
  type ProactiveInboxRow,
  type ProactiveInboxRowAction,
} from './proactiveInboxOverlay.ts'
import {
  resolveProactiveNoteView,
  type ProactiveNoteView,
} from './proactiveNote.ts'
import {
  createProactiveInboxSnoozeScheduler,
  type ProactiveInboxSnoozeDependencies,
} from './proactiveInboxSnooze.ts'
import {
  selectProactiveNotebookOpeningKey,
  type ProactiveNotebookReturnReason,
} from './proactiveNotebookSpeech.ts'

/** Statuses the notebook can write through the bridge. */
export type ProactiveInboxUpdateStatus = 'done' | 'read'

export type ProactiveInboxOverlayView = {
  open: boolean
  unreadCount: number
  rows: ProactiveInboxRow[]
  expandedId: string | null
  /** Unread state derived from the same entries; snoozed rows are hidden. */
  note: ProactiveNoteView
  /** Opening line for the notebook; computed once per opening. */
  openingKey: TranslationKey
  /** Ids that were unseen when the notebook opened, in display order. */
  openingUnseenIds: string[]
  /** First handled row at open time when an unhandled row sits above it. */
  dividerBeforeId: string | null
  /** Row currently being narrated, or null when speech is idle. */
  speakingId: string | null
}

/** Why the notebook was opened; feeds the opening line only. */
export type ProactiveNotebookOpenOptions = {
  reason?: ProactiveNotebookReturnReason
}

export type ProactiveInboxOverlayBridge = {
  list: () => Promise<ProactiveInboxSnapshot>
  update: (
    id: string,
    status: ProactiveInboxUpdateStatus,
  ) => Promise<{ updated: boolean; unreadCount: number }>
  deliver: (payload: ProactiveDeliveryPayload) => Promise<unknown>
  openConversation: () => void | Promise<void>
}

export type ProactiveInboxOverlayDependencies = {
  bridge: ProactiveInboxOverlayBridge
  buildDeliveryPayload: (message: ProactiveMessage) => Promise<ProactiveDeliveryPayload>
  logger: Pick<Logger, 'warn'>
  setTimeout: ProactiveInboxSnoozeDependencies['setTimeout']
  clearTimeout: ProactiveInboxSnoozeDependencies['clearTimeout']
  /** Injectable clock for the 15-day window and the unread view; defaults to `Date.now`. */
  nowMs?: () => number
  /** Safety bound on rendered rows; defaults to the store's own maximum. */
  maxRows?: number
}

const EMPTY_NOTE: ProactiveNoteView = Object.freeze({
  state: 'none',
})

const EMPTY_OPENING_KEY = selectProactiveNotebookOpeningKey({
  unseenCount: 0,
  totalCount: 0,
  reason: null,
})

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
  /** Row index the expanded row keeps until it collapses, so reading does not reorder it. */
  let expandedIndex: number | null = null
  /** Expanded action-less row that the read rule just marked done. */
  let pinnedReadId: string | null = null
  /** Display order frozen when the notebook opened; new ids go on top. */
  let frozenOrder: string[] | null = null
  let openingKey: TranslationKey = EMPTY_OPENING_KEY
  let openingUnseenIds: string[] = []
  let dividerBeforeId: string | null = null
  let speakingId: string | null = null
  let disposed = false
  let refreshSequence = 0
  /** In-flight `notebook_seen` writes, so duplicate reports cannot double-write. */
  const seenRequests = new Set<string>()
  let snapshot: ProactiveInboxOverlayView = {
    open: false,
    unreadCount: 0,
    rows: [],
    expandedId: null,
    note: EMPTY_NOTE,
    openingKey: EMPTY_OPENING_KEY,
    openingUnseenIds: [],
    dividerBeforeId: null,
    speakingId: null,
  }

  const listeners = new Set<() => void>()

  const snooze = createProactiveInboxSnoozeScheduler({
    setTimeout,
    clearTimeout,
    onDeliver: (entry) => {
      void deliverSnoozed(entry)
    },
  })

  /** Rows in the notebook's selection order, before the frozen order is applied. */
  function baseRows(): ProactiveInboxRow[] {
    return selectProactiveInboxEntries(entries, {
      hiddenIds: snooze.snoozedIds(),
      nowMs: nowMs(),
      ...(maxRows !== undefined ? { limit: maxRows } : {}),
    }).map(toProactiveInboxRow)
  }

  /**
   * Keep the order captured at open time. Ids the notebook has never shown
   * (entries delivered while it is open) lead the list; frozen rows follow in
   * their opening order even after they become seen or handled.
   */
  function applyFrozenOrder(rows: ProactiveInboxRow[]): ProactiveInboxRow[] {
    if (!frozenOrder) return rows
    const rank = new Map(frozenOrder.map((id, index) => [id, index]))
    const fresh: ProactiveInboxRow[] = []
    const frozen: ProactiveInboxRow[] = []
    for (const row of rows) {
      if (rank.has(row.id)) frozen.push(row)
      else fresh.push(row)
    }
    frozen.sort((left, right) => (
      (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0)
    ))
    return [...fresh, ...frozen]
  }

  function buildView(): ProactiveInboxOverlayView {
    const rows = applyFrozenOrder(baseRows())
    if (expandedId && expandedIndex !== null) {
      // Reading a row must not move it under the pointer: keep it where it was
      // when it expanded, and let it fall back into the normal order on collapse.
      const current = rows.findIndex((row) => row.id === expandedId)
      if (current >= 0) {
        const [row] = rows.splice(current, 1)
        const target = Math.min(Math.max(0, expandedIndex), rows.length)
        rows.splice(target, 0, row)
      }
    }
    return {
      open: isOpen,
      unreadCount,
      rows,
      expandedId,
      note: resolveProactiveNoteView(entries, {
        hiddenIds: snooze.snoozedIds(),
        nowMs: nowMs(),
      }),
      openingKey,
      openingUnseenIds: [...openingUnseenIds],
      dividerBeforeId,
      speakingId,
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
        if (expandedId === pinnedReadId) {
          expandedId = null
          expandedIndex = null
        }
        pinnedReadId = null
      }
    }

    if (expandedId && expandedId !== pinnedReadId) {
      // Read rows can stay expanded too; only a removed entry collapses.
      const expanded = entries.find((entry) => entry.id === expandedId)
      if (!expanded) {
        expandedId = null
        expandedIndex = null
      }
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

  /**
   * Write one `notebook_seen` status without emitting. The caller emits once
   * after the whole batch settles; a failure keeps the stored status untouched.
   */
  async function markEntrySeen(
    entry: ProactiveInboxEntryView,
    status: ProactiveInboxUpdateStatus,
  ): Promise<void> {
    try {
      const result = await bridge.update(entry.id, status)
      if (result.updated) {
        entries = entries.map((item) => (
          item.id === entry.id ? { ...item, status } : item
        ))
        unreadCount = normalizeNonNegativeInteger(result.unreadCount)
      }
    } catch {
      logger.warn('proactive notebook seen update failed', { errorPresent: true })
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
    if (expandedId === id) {
      expandedId = null
      expandedIndex = null
    }
    if (pinnedReadId === id) pinnedReadId = null
  }

  /**
   * Open the notebook, refresh it and freeze the order the user is about to
   * read. The opening line, unseen ids and divider are captured here so later
   * `markSeen` calls cannot change what this opening offered.
   */
  async function open(options: ProactiveNotebookOpenOptions = {}): Promise<void> {
    if (disposed) return
    // A new open is a new reading session; freeze again from the refreshed order.
    frozenOrder = null
    isOpen = true
    emit()
    await refresh()
    if (disposed || !isOpen) return

    const rows = applyFrozenOrder(baseRows())
    frozenOrder = rows.map((row) => row.id)
    openingUnseenIds = rows.filter((row) => row.unseen).map((row) => row.id)
    openingKey = selectProactiveNotebookOpeningKey({
      unseenCount: openingUnseenIds.length,
      totalCount: rows.length,
      reason: options.reason ?? null,
    })
    const dividerIndex = proactiveNotebookDividerIndex(rows)
    dividerBeforeId = dividerIndex >= 0 ? rows[dividerIndex].id : null
    emit()
  }

  function close(): void {
    if (!isOpen) return
    isOpen = false
    frozenOrder = null
    openingUnseenIds = []
    dividerBeforeId = null
    speakingId = null
    expandedId = null
    expandedIndex = null
    pinnedReadId = null
    emit()
  }

  async function toggle(options?: ProactiveNotebookOpenOptions): Promise<void> {
    if (isOpen) {
      close()
      return
    }
    await open(options)
  }

  async function toggleRow(id: string): Promise<void> {
    const entry = entries.find((item) => item.id === id)
    if (!entry) return

    if (expandedId === id) {
      expandedId = null
      expandedIndex = null
      if (pinnedReadId === id) pinnedReadId = null
      emit()
      return
    }

    // Remember the slot before the read rule can move the row into the read
    // section, so an expanded row never jumps while the user is reading it.
    const index = applyFrozenOrder(baseRows()).findIndex((row) => row.id === id)
    expandedId = id
    expandedIndex = index >= 0 ? index : null
    pinnedReadId = null
    emit()

    if (entry.status === 'done' || entry.status === 'dismissed') return
    if (inboxStatusAfterInteraction(entry, 'expand') !== 'done') return

    // Keep the row visible while the user reads the text that just marked it
    // read; collapse or notebook close releases the pin.
    pinnedReadId = id
    const updated = await setEntryDone(entry)
    if (!updated && pinnedReadId === id) {
      pinnedReadId = null
      emit()
    }
  }

  /**
   * Mark visible rows seen through the shared rule. Only an unread entry can
   * move, and each id is written at most once per batch (or while an earlier
   * write is still in flight). One emit follows every settled update.
   */
  async function markSeen(ids: readonly string[]): Promise<void> {
    if (!isOpen || disposed) return

    const requested = new Set<string>()
    const pending: Promise<void>[] = []
    for (const id of ids) {
      if (requested.has(id) || seenRequests.has(id)) continue
      requested.add(id)
      const entry = entries.find((item) => item.id === id)
      if (!entry || entry.status !== 'unread') continue
      const next = inboxStatusAfterInteraction(entry, 'notebook_seen')
      if (!next) continue
      seenRequests.add(id)
      pending.push(
        markEntrySeen(entry, next).finally(() => {
          seenRequests.delete(id)
        }),
      )
    }

    if (pending.length === 0) return
    await Promise.all(pending)
    emit()
  }

  function setSpeakingId(id: string | null): void {
    if (speakingId === id) return
    speakingId = id
    emit()
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

    // Done/dismissed rows keep their Open button, but their status is final.
    // A `read` row is seen, not handled, so done/open/reply can still finish it.
    if (entry.status === 'done' || entry.status === 'dismissed') return
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
    frozenOrder = null
    seenRequests.clear()
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
    markSeen,
    setSpeakingId,
    runAction,
    dispose,
  }
}

export type ProactiveInboxOverlayController = ReturnType<typeof createProactiveInboxOverlayController>
