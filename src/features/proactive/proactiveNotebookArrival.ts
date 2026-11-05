/**
 * Arrival speech rules for the pet's notebook.
 *
 * When unseen notebook ids grow, the pet says one short line in her normal
 * bubble. This module tracks which ids were already announced so a batch is
 * spoken at most once, and decides whether the moment is quiet (typing,
 * notebook open, fullscreen, DND, quiet hours) or covered elsewhere
 * (away/locked: the return greeting reports the count instead).
 *
 * The tracker is pure: the host supplies the wall clock-driven typing signal
 * and the environment snapshot. Consuming a batch while away marks it handled
 * so the same lines are never spoken twice.
 */

import type { DeliveryContext, FocusState } from '../../../shared/proactiveDelivery.js'
import type { TranslationKey } from '../../types/i18n.ts'

/** The typing signal is time-based, so the host re-checks on this interval. */
export const PROACTIVE_NOTEBOOK_ARRIVAL_RECHECK_MS = 2_500

/** Environment flags that decide whether the arrival line may be spoken now. */
export type ProactiveNotebookArrivalContext = Pick<
  DeliveryContext,
  'fullscreen' | 'systemDnd' | 'inQuietHours' | 'focusState'
>

/** One observation of the notebook and the surrounding moment. */
export type ProactiveNotebookArrivalInput = {
  /** Ids of every unseen row currently visible (snoozed rows are absent). */
  unseenIds: readonly string[]
  /** True while the notebook panel itself is open. */
  open: boolean
  /** Focus state used when the environment snapshot has not arrived yet. */
  focusState: FocusState
  /** null until the environment is known; null never speaks. */
  context: ProactiveNotebookArrivalContext | null
  /** Composer or opted-in desktop typing, via `isUserTypingAnywhere`. */
  userTyping: boolean
}

/** What the host should do after one observation. */
export type ProactiveNotebookArrivalDecision =
  | { kind: 'announce'; key: TranslationKey }
  | { kind: 'handled' }
  | { kind: 'wait' }
  | { kind: 'idle' }

/** Stateful batch memory owned by one mounted pet window. */
export type ProactiveNotebookArrivalTracker = {
  /** Observe the notebook once; announce or remember the current batch. */
  observe: (input: ProactiveNotebookArrivalInput) => ProactiveNotebookArrivalDecision
}

function isAwayOrLocked(focusState: FocusState): boolean {
  return focusState === 'away' || focusState === 'locked'
}

/**
 * Create the arrival tracker for one pet window.
 *
 * The first observation counts every unseen id as a new arrival: at startup a
 * row the user has not seen in this session is still new to the pet, so it is
 * announced once. Later observations compare against the announced set, which
 * is why an unchanged batch stays silent. Away/locked consumes the batch
 * because the return greeting already reports it; typing, an open notebook,
 * fullscreen, DND and quiet hours keep the batch pending for a later re-check.
 *
 * @returns A tracker whose only state is the announced id set.
 */
export function createProactiveNotebookArrivalTracker(): ProactiveNotebookArrivalTracker {
  let announcedIds = new Set<string>()

  function markHandled(current: ReadonlySet<string>): void {
    for (const id of current) announcedIds.add(id)
  }

  return {
    observe(input) {
      const current = new Set(input.unseenIds)
      if (current.size === 0) {
        // A cleared notebook starts a new session: the next batch is new.
        announcedIds = new Set()
        return { kind: 'idle' }
      }

      const freshIds = [...current].filter((id) => !announcedIds.has(id))
      if (freshIds.length === 0) return { kind: 'idle' }

      const focusState = input.context?.focusState ?? input.focusState
      if (isAwayOrLocked(focusState)) {
        markHandled(current)
        return { kind: 'handled' }
      }

      if (
        input.userTyping
        || input.open
        || !input.context
        || input.context.fullscreen
        || input.context.systemDnd === true
        || input.context.inQuietHours
      ) {
        return { kind: 'wait' }
      }

      markHandled(current)
      return {
        kind: 'announce',
        key: freshIds.length === 1
          ? 'pet.proactive.notebook_arrived_one'
          : 'pet.proactive.notebook_arrived_many',
      }
    },
  }
}
