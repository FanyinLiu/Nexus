/**
 * Pure speech rules for the pet's notebook.
 *
 * Three responsibilities stay separate so each is testable without a window:
 * remembering why the user came back, picking the opening line and deciding
 * whether speaking aloud is allowed, and turning rows into a short plan that a
 * host can narrate one step at a time.
 *
 * Privacy is a hard boundary: the return tracker only reads focus and
 * fullscreen, never typing or any other refused signal. The plan reads row
 * titles only — a letter speaks its fixed letter line, never its content.
 */

import type { TranslationKey } from '../../types/i18n.ts'

/** At most this many unseen rows are read aloud before the rest line. */
export const PROACTIVE_NOTEBOOK_SPEECH_MAX_ITEMS = 3

/** Why the user was away long enough for the notebook to hold unseen lines. */
export type ProactiveNotebookReturnReason = 'busy' | 'away' | null

/** Focus states the host may report; only away/locked affect speech. */
export type ProactiveNotebookFocusState = 'active' | 'idle' | 'away' | 'locked'

/** One monotonic context report. Refused signals (typing) are not part of it. */
export type ProactiveNotebookReturnInput = {
  fullscreen: boolean
  focusState: ProactiveNotebookFocusState
  hasUnseen: boolean
  /** Ids of the unseen rows visible at this observation. */
  unseenIds: readonly string[]
}

/** Remembers why the user was away while lines stayed unseen. */
export type ProactiveNotebookReturnTracker = {
  observe: (input: ProactiveNotebookReturnInput) => void
  reason: () => ProactiveNotebookReturnReason
  reset: () => void
}

/** Counts and return reason that choose the opening line. */
export type ProactiveNotebookOpeningInput = {
  unseenCount: number
  totalCount: number
  reason: ProactiveNotebookReturnReason
}

/** Context flags that decide whether the notebook may be spoken aloud. */
export type ProactiveNotebookReadAloudInput = {
  speechOutputEnabled: boolean
  fullscreen: boolean
  systemDnd: boolean | null
  inQuietHours: boolean
  screenSharing: boolean | null
  focusState: ProactiveNotebookFocusState
}

/** The smallest row shape the speech plan needs; bodies stay out of it. */
export type ProactiveNotebookSpeechRow = {
  id: string
  title: string
  unseen: boolean
  letter: boolean
}

/** Copy and row data for one spoken plan. */
export type ProactiveNotebookSpeechPlanInput = {
  openingText: string
  rows: readonly ProactiveNotebookSpeechRow[]
  spokenIds: ReadonlySet<string>
  letterText: string
  restText: string
}

/** One spoken step. `rowId` is null for the opening and the rest line. */
export type ProactiveNotebookSpeechStep = {
  rowId: string | null
  text: string
}

/** Injected speech engine and highlight callbacks. */
export type ProactiveNotebookNarratorDependencies = {
  speak: (text: string) => Promise<void>
  stop: () => void
  onSpeaking: (rowId: string | null) => void
  onSpoken: (rowId: string) => void
}

/** Sequential plan runner with a single interrupt boundary. */
export type ProactiveNotebookNarrator = {
  start: (plan: readonly ProactiveNotebookSpeechStep[]) => Promise<void>
  interrupt: () => void
  isActive: () => boolean
}

/**
 * Track why the user was away while new lines arrived.
 *
 * Only an unseen id that was not visible on the previous observation counts as
 * an arrival. An item that arrived while the user was present therefore cannot
 * make a later absence look like the reason. At the first observation the whole
 * unseen set counts as arrived, because there is no earlier baseline. Away wins
 * over busy even when both happened. A report with no unseen lines clears the
 * memory, so the next unseen batch starts from scratch.
 *
 * @returns {ProactiveNotebookReturnTracker}
 */
export function createProactiveNotebookReturnTracker(): ProactiveNotebookReturnTracker {
  let wasAway = false
  let wasBusy = false
  let previousUnseenIds = new Set<string>()

  function reset(): void {
    wasAway = false
    wasBusy = false
    previousUnseenIds = new Set()
  }

  function observe({
    fullscreen,
    focusState,
    hasUnseen,
    unseenIds,
  }: ProactiveNotebookReturnInput): void {
    if (!hasUnseen) {
      reset()
      return
    }

    const current = new Set(unseenIds)
    const arrivedNow = [...current].some((id) => !previousUnseenIds.has(id))
    if (arrivedNow) {
      if (focusState === 'away' || focusState === 'locked') wasAway = true
      if (fullscreen) wasBusy = true
    }
    previousUnseenIds = current
  }

  function reason(): ProactiveNotebookReturnReason {
    if (wasAway) return 'away'
    if (wasBusy) return 'busy'
    return null
  }

  return { observe, reason, reset }
}

/**
 * Opening line for the notebook. Empty and seen-only notes answer first, then
 * a single unseen line, then the return reason; everything else is generic.
 *
 * @param {ProactiveNotebookOpeningInput} input
 * @returns {TranslationKey}
 */
export function selectProactiveNotebookOpeningKey(
  input: ProactiveNotebookOpeningInput,
): TranslationKey {
  if (input.totalCount <= 0) return 'pet.proactive.notebook_opening_empty'
  if (input.unseenCount <= 0) return 'pet.proactive.notebook_opening_seen_only'
  if (input.unseenCount === 1) return 'pet.proactive.notebook_opening_one'
  if (input.reason === 'away') return 'pet.proactive.notebook_opening_away'
  if (input.reason === 'busy') return 'pet.proactive.notebook_opening_busy'
  return 'pet.proactive.notebook_opening_generic'
}

/**
 * Whether the notebook may read itself aloud. Unknown DND or screen-sharing
 * state does not block: only a positive report means the moment is private.
 *
 * @param {ProactiveNotebookReadAloudInput} input
 * @returns {boolean}
 */
export function canReadProactiveNotebookAloud(input: ProactiveNotebookReadAloudInput): boolean {
  if (!input.speechOutputEnabled) return false
  if (input.fullscreen) return false
  if (input.systemDnd === true) return false
  if (input.inQuietHours) return false
  if (input.screenSharing === true) return false
  if (input.focusState === 'locked' || input.focusState === 'away') return false
  return true
}

/**
 * Turn the notebook into a short spoken plan: the opening line, at most three
 * unseen rows that were never spoken, then the rest line when more remain.
 * Letters speak the fixed letter line so their title and content stay private.
 *
 * @param {ProactiveNotebookSpeechPlanInput} input
 * @returns {ProactiveNotebookSpeechStep[]}
 */
export function buildProactiveNotebookSpeechPlan(
  input: ProactiveNotebookSpeechPlanInput,
): ProactiveNotebookSpeechStep[] {
  const pending = input.rows.filter((row) => row.unseen && !input.spokenIds.has(row.id))
  const selected = pending.slice(0, PROACTIVE_NOTEBOOK_SPEECH_MAX_ITEMS)
  const plan: ProactiveNotebookSpeechStep[] = [{ rowId: null, text: input.openingText }]
  for (const row of selected) {
    plan.push({ rowId: row.id, text: row.letter ? input.letterText : row.title })
  }
  if (pending.length > PROACTIVE_NOTEBOOK_SPEECH_MAX_ITEMS) {
    plan.push({ rowId: null, text: input.restText })
  }
  return plan
}

/**
 * Narrate plans sequentially with an injectable speech engine.
 *
 * Rejections end the current plan without throwing; an interrupt invalidates
 * the running plan so no later step resumes, while a subsequent `start` works
 * normally. The caller owns `spokenIds`, so an interrupted row is read again
 * only if the caller reports it as spoken.
 *
 * @param {ProactiveNotebookNarratorDependencies} deps
 * @returns {ProactiveNotebookNarrator}
 */
export function createProactiveNotebookNarrator(
  deps: ProactiveNotebookNarratorDependencies,
): ProactiveNotebookNarrator {
  let active = false
  let runToken = 0

  function finish(): void {
    active = false
    deps.onSpeaking(null)
  }

  function interrupt(): void {
    if (!active) return
    active = false
    runToken += 1
    deps.stop()
    deps.onSpeaking(null)
  }

  async function start(plan: readonly ProactiveNotebookSpeechStep[]): Promise<void> {
    if (active) interrupt()
    const token = ++runToken
    active = true

    for (const step of plan) {
      if (!active || token !== runToken) return
      deps.onSpeaking(step.rowId)
      try {
        await deps.speak(step.text)
      } catch {
        if (token === runToken) finish()
        return
      }
      if (!active || token !== runToken) return
      if (step.rowId !== null) deps.onSpoken(step.rowId)
    }

    if (!active || token !== runToken) return
    finish()
  }

  return {
    start,
    interrupt,
    isActive: () => active,
  }
}
