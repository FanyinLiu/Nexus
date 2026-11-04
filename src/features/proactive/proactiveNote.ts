/**
 * Unread-view rules for the pet's proactive notebook.
 *
 * The notebook indicator needs one pure answer: whether the notebook currently
 * holds unseen entries. That answer decides whether a plain stage click opens
 * the notebook. All clocks are injected so this module stays pure and testable.
 */

import type { ProactiveInboxEntry } from '../../../shared/proactiveDelivery.js'

/** Delay that separates a notebook single click from a voice double click. */
export const PROACTIVE_NOTE_SINGLE_CLICK_DELAY_MS = 260

/** How long an inbox entry can still count as unseen. */
const PROACTIVE_NOTE_WINDOW_MS = 15 * 24 * 60 * 60 * 1000

/** `none` means a click does nothing special; `unread` means it opens the notebook. */
export type ProactiveNoteState = 'none' | 'unread'

/** The unread view the notebook host and the stage click rule share. */
export type ProactiveNoteView = {
  state: ProactiveNoteState
}

/** Props the pet host hands to the stage for the click rule. */
export type ProactiveNoteStageBinding = {
  view: ProactiveNoteView
  onToggleNotebook: () => void
}

/** The subset of an inbox entry the unread rule needs. */
export type ProactiveNoteEntry = Pick<ProactiveInboxEntry, 'id' | 'status' | 'createdAt'>

/** Options that narrow the inbox snapshot before it becomes an unread view. */
export type ProactiveNoteOptions = {
  /** Snoozed ids; a hidden entry never counts as unseen. */
  hiddenIds?: readonly string[]
  /** Reference instant; callers in the app must pass their clock. */
  nowMs?: number
  /** Age cutoff for entries; defaults to 15 days. */
  windowMs?: number
}

/**
 * Resolve whether the notebook holds unseen entries.
 *
 * Hidden, old and non-unread entries are filtered first. The state carries no
 * count or shape: only "none" versus "unread" matters to the click rule.
 * `nowMs` is required in practice; without it the batch is treated as current
 * instead of consulting the wall clock.
 *
 * @param entries Inbox entries to inspect.
 * @param options Hidden ids, clock and age window.
 * @returns `unread` when at least one unseen entry remains, otherwise `none`.
 */
export function resolveProactiveNoteView(
  entries: readonly ProactiveNoteEntry[],
  options: ProactiveNoteOptions = {},
): ProactiveNoteView {
  const hiddenIds = options.hiddenIds ?? []
  const windowMs = options.windowMs ?? PROACTIVE_NOTE_WINDOW_MS
  const newestCreatedAt = entries.reduce(
    (newest, entry) => (entry.createdAt > newest ? entry.createdAt : newest),
    0,
  )
  const nowMs = options.nowMs ?? newestCreatedAt
  const oldestAllowed = nowMs - windowMs

  const hasUnseen = entries.some(
    (entry) =>
      !hiddenIds.includes(entry.id)
      && entry.createdAt >= oldestAllowed
      && entry.status === 'unread',
  )
  return { state: hasUnseen ? 'unread' : 'none' }
}

type ProactiveNoteStageClickInput = {
  noteState: ProactiveNoteState
  button: number
  dragged: boolean
  clickCount: number
}

/**
 * Whether a stage click should open the notebook.
 *
 * Only a left single click without dragging qualifies, and only while there
 * are unread notebook items. A double click stays the voice toggle.
 *
 * @param input Pointer button, drag state, click count and unread state.
 * @returns True only for a plain left click while unseen items exist.
 */
export function shouldOpenNotebookOnStageClick(input: ProactiveNoteStageClickInput): boolean {
  return (
    input.noteState !== 'none' &&
    input.button === 0 &&
    !input.dragged &&
    input.clickCount === 1
  )
}

type ProactiveNoteSingleClickTimers = {
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (handle: number) => void
}

/** Click disambiguator owned by one mounted stage. */
export type ProactiveNoteSingleClickGate = {
  /** Schedule a single click; a newer click replaces the pending one. */
  click: (run: () => void) => void
  /** Cancel the pending single click so the double click wins. */
  doubleClick: () => void
  /** Drop the pending timer; later clicks are ignored. */
  dispose: () => void
}

/**
 * Create the click/double-click disambiguator for the stage.
 *
 * A single click waits `delayMs` before opening the notebook. A double click
 * inside that window cancels the waiting run, so toggling voice can never also
 * open the notebook. Timers are injected to keep the gate testable.
 *
 * @param options Timer host and the double-click window.
 * @returns The gate for one mounted stage.
 */
export function createSingleClickGate({
  delayMs = PROACTIVE_NOTE_SINGLE_CLICK_DELAY_MS,
  setTimeout,
  clearTimeout,
}: ProactiveNoteSingleClickTimers & { delayMs?: number }): ProactiveNoteSingleClickGate {
  let pending: number | null = null
  let disposed = false

  function cancelPending() {
    if (pending === null) return
    clearTimeout(pending)
    pending = null
  }

  return {
    click(run) {
      if (disposed) return
      // Keep at most one pending run: the latest click is the one that counts.
      cancelPending()
      pending = setTimeout(() => {
        pending = null
        run()
      }, delayMs)
    },

    doubleClick() {
      if (disposed) return
      cancelPending()
    },

    dispose() {
      disposed = true
      cancelPending()
    },
  }
}
