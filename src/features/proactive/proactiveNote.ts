/**
 * Paper-note view rules for the pet's proactive inbox indicator.
 *
 * The note replaces the red unread dot: unseen entries become up to three
 * drawn sheets, important items may wiggle, and ordinary items may glance once
 * per half hour. All clocks and timers are injected so the renderer owns
 * scheduling while this module stays pure and testable.
 */

import type { DeliveryContext, ProactiveInboxEntry } from '../../../shared/proactiveDelivery.js'
import { clamp } from '../../lib/common.ts'

/** Never draw more than this many sheets, however long the inbox is. */
export const PROACTIVE_NOTE_MAX_SHEETS = 3

/** Three or more unseen ordinary entries turn the single note into a stack. */
export const PROACTIVE_NOTE_STACK_THRESHOLD = 3

/** Ordinary note: at most one glance per this interval. */
export const PROACTIVE_NOTE_GLANCE_THROTTLE_MS = 30 * 60 * 1000

/** Important note: at most one gentle wiggle per this interval. */
export const PROACTIVE_NOTE_WIGGLE_INTERVAL_MS = 10 * 60 * 1000

/** How long one wiggle lasts; kept well under a second to stay gentle. */
export const PROACTIVE_NOTE_WIGGLE_DURATION_MS = 900

/** How long one glance / hand-the-note-toward-you motion lasts. */
export const PROACTIVE_NOTE_GLANCE_DURATION_MS = 700

/** Delay that separates a notebook single click from a voice double click. */
export const PROACTIVE_NOTE_SINGLE_CLICK_DELAY_MS = 260

/** Imported models usually look fine with this beside-the-head anchor. */
const PROACTIVE_NOTE_DEFAULT_ANCHOR = { x: 0.7, y: 0.2 } as const

/** Keep the note inside the character box even for an out-of-range anchor. */
const PROACTIVE_NOTE_ANCHOR_MIN = 0.05
const PROACTIVE_NOTE_ANCHOR_MAX = 0.95

/**
 * Pending product decision; flip to true to keep one static note.
 *
 * The open question is whether a seen-but-unhandled actionable entry should
 * still show a motionless note. Today the answer is no: only unseen entries
 * draw the note.
 */
export const PROACTIVE_NOTE_KEEPS_SEEN_ACTIONABLE = false

/** How long an inbox entry can still surface as a note. */
const PROACTIVE_NOTE_WINDOW_MS = 15 * 24 * 60 * 60 * 1000

/** Sheet count is clipped to what the artwork can draw. */
type ProactiveNoteSheetCount = 0 | 1 | 2 | 3

/** The four note shapes; `none` means nothing is drawn. */
export type ProactiveNoteState = 'none' | 'one' | 'stack' | 'important'

/** `animated` false means the note may be drawn but must never move. */
export type ProactiveNoteView = {
  state: ProactiveNoteState
  sheets: ProactiveNoteSheetCount
  animated: boolean
}

/** Props the pet host hands to the stage note overlay. */
export type ProactiveNoteStageBinding = {
  view: ProactiveNoteView
  motion: 'glance' | 'wiggle' | null
  label: string
  onApproach: () => void
  onToggleNotebook: () => void
}

/** The model bits that decide where the note is drawn. */
type ProactiveNoteAnchorSource = {
  layout?: { noteAnchor?: { x: number; y: number } }
}

/**
 * Resolve the paper note's anchor for one model.
 *
 * Built-in models ship an anchor tuned to their head position; imported models
 * fall back to a generic beside-the-head point. Both axes are clamped so a bad
 * preset can never place the note outside the character stage box.
 *
 * @param model Model whose note anchor should be read.
 * @returns Anchor ratios in 0..1.
 */
export function resolveProactiveNoteAnchor(model: ProactiveNoteAnchorSource): {
  x: number
  y: number
} {
  const anchor = model.layout?.noteAnchor ?? PROACTIVE_NOTE_DEFAULT_ANCHOR
  return {
    x: clamp(anchor.x, PROACTIVE_NOTE_ANCHOR_MIN, PROACTIVE_NOTE_ANCHOR_MAX),
    y: clamp(anchor.y, PROACTIVE_NOTE_ANCHOR_MIN, PROACTIVE_NOTE_ANCHOR_MAX),
  }
}

/** The subset of an inbox entry the note rules need. */
export type ProactiveNoteEntry = Pick<
  ProactiveInboxEntry,
  'id' | 'status' | 'actions' | 'priority' | 'createdAt'
>

/** Options that narrow the inbox snapshot before it becomes a note. */
export type ProactiveNoteOptions = {
  /** Snoozed ids; a hidden entry never contributes a sheet. */
  hiddenIds?: readonly string[]
  /** Reference instant; callers in the app must pass their clock. */
  nowMs?: number
  /** Age cutoff for entries; defaults to 15 days. */
  windowMs?: number
  /** Overrides `PROACTIVE_NOTE_KEEPS_SEEN_ACTIONABLE` for one call. */
  keepSeenActionable?: boolean
}

function hasActions(entry: Pick<ProactiveInboxEntry, 'actions'>): boolean {
  return Array.isArray(entry.actions) && entry.actions.length > 0
}

function clipSheets(count: number): ProactiveNoteSheetCount {
  return Math.min(count, PROACTIVE_NOTE_MAX_SHEETS) as ProactiveNoteSheetCount
}

/**
 * Resolve what the note should look like for the current inbox snapshot.
 *
 * Old, hidden and non-unread entries are filtered first. Any unseen entry that
 * is high priority or actionable makes the note important, which wins over the
 * one/stack shapes. `nowMs` is required in practice; without it the batch is
 * treated as current instead of consulting the wall clock.
 *
 * @param entries Inbox entries to inspect.
 * @param options Hidden ids, clock, age window and seen-actionable override.
 * @returns The state, sheet count and whether the note may animate.
 */
export function resolveProactiveNoteView(
  entries: readonly ProactiveNoteEntry[],
  options: ProactiveNoteOptions = {},
): ProactiveNoteView {
  const hiddenIds = options.hiddenIds ?? []
  const windowMs = options.windowMs ?? PROACTIVE_NOTE_WINDOW_MS
  const keepSeenActionable = options.keepSeenActionable ?? PROACTIVE_NOTE_KEEPS_SEEN_ACTIONABLE
  const newestCreatedAt = entries.reduce(
    (newest, entry) => (entry.createdAt > newest ? entry.createdAt : newest),
    0,
  )
  const nowMs = options.nowMs ?? newestCreatedAt
  const oldestAllowed = nowMs - windowMs

  const visible = entries.filter(
    (entry) => !hiddenIds.includes(entry.id) && entry.createdAt >= oldestAllowed,
  )
  const unseen = visible.filter((entry) => entry.status === 'unread')
  const unseenCount = unseen.length

  if (unseenCount === 0) {
    const keepsSeenNote =
      keepSeenActionable &&
      visible.some((entry) => entry.status === 'read' && hasActions(entry))
    return keepsSeenNote
      ? { state: 'one', sheets: 1, animated: false }
      : { state: 'none', sheets: 0, animated: true }
  }

  const important = unseen.some((entry) => entry.priority === 'high' || hasActions(entry))
  if (important) {
    return { state: 'important', sheets: clipSheets(unseenCount), animated: true }
  }

  if (unseenCount >= PROACTIVE_NOTE_STACK_THRESHOLD) {
    return { state: 'stack', sheets: clipSheets(unseenCount), animated: true }
  }

  return { state: 'one', sheets: 1, animated: true }
}

/** Context subset that decides whether the note is allowed to move. */
export type ProactiveNoteMotionContext = Pick<
  DeliveryContext,
  'fullscreen' | 'systemDnd' | 'inQuietHours' | 'focusState'
>

/**
 * Whether the environment forbids note motion.
 *
 * The note still gets drawn; it simply makes zero motions while the user is
 * fullscreen, in DND/quiet hours, or away/locked.
 *
 * @param context Desktop delivery context.
 * @returns True when no glance or wiggle may play.
 */
export function isProactiveNoteMotionSuppressed(context: ProactiveNoteMotionContext): boolean {
  return (
    context.fullscreen ||
    context.systemDnd === true ||
    context.inQuietHours ||
    context.focusState === 'locked' ||
    context.focusState === 'away'
  )
}

type ProactiveNoteMotionInput = {
  nowMs: number
  view: ProactiveNoteView
  suppressed: boolean
}

/** Stateful timing gate owned by one mounted note. */
export type ProactiveNoteMotionGate = {
  /**
   * One pointer approach. Returns true when a glance should play now.
   */
  approach: (input: ProactiveNoteMotionInput) => boolean
  /**
   * One timer tick. Returns the wiggle duration to play, or 0 for no motion.
   */
  tick: (input: ProactiveNoteMotionInput) => number
  /** Clear every timing record, e.g. when the note is remounted. */
  reset: () => void
}

/**
 * Create the timing gate for note motions.
 *
 * The 30-minute glance budget is measured from the last glance that played,
 * whatever kind it was; suppressed or refused approaches leave it untouched.
 * Important notes themselves glance on every approach. Important wiggles wait
 * one full interval after the state was first observed, then repeat at most
 * once per interval. The gate never reads the clock.
 *
 * @returns Stateful gate driven entirely by the caller's timestamps.
 */
export function createProactiveNoteMotionGate(): ProactiveNoteMotionGate {
  let lastGlanceAtMs: number | null = null
  let importantSinceMs: number | null = null
  let lastWiggleAtMs: number | null = null

  function clearImportantTiming() {
    importantSinceMs = null
    lastWiggleAtMs = null
  }

  return {
    approach({ nowMs, view, suppressed }) {
      if (suppressed) return false
      if (view.state === 'none' || !view.animated) return false

      // Important notes glance on every approach; the shared clock only
      // throttles the ordinary one/stack shape below.
      if (view.state === 'important') {
        lastGlanceAtMs = nowMs
        return true
      }

      if (lastGlanceAtMs !== null && nowMs - lastGlanceAtMs < PROACTIVE_NOTE_GLANCE_THROTTLE_MS) {
        return false
      }
      lastGlanceAtMs = nowMs
      return true
    },

    tick({ nowMs, view, suppressed }) {
      if (view.state !== 'important' || !view.animated) {
        clearImportantTiming()
        return 0
      }

      if (importantSinceMs === null) importantSinceMs = nowMs
      if (suppressed) return 0
      if (nowMs - importantSinceMs < PROACTIVE_NOTE_WIGGLE_INTERVAL_MS) return 0
      if (lastWiggleAtMs !== null && nowMs - lastWiggleAtMs < PROACTIVE_NOTE_WIGGLE_INTERVAL_MS) {
        return 0
      }

      lastWiggleAtMs = nowMs
      return PROACTIVE_NOTE_WIGGLE_DURATION_MS
    },

    reset() {
      lastGlanceAtMs = null
      clearImportantTiming()
    },
  }
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
 * Only a left single click without dragging qualifies, and only while a note
 * is on screen. A double click stays the voice toggle.
 *
 * @param input Pointer button, drag state, click count and note state.
 * @returns True only for a plain left click on a visible note.
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
