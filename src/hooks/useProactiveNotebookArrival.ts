import { useCallback, useEffect, useRef } from 'react'

import type { DeliveryContext, FocusState } from '../../shared/proactiveDelivery.js'
import {
  createProactiveNotebookArrivalTracker,
  PROACTIVE_NOTEBOOK_ARRIVAL_RECHECK_MS,
  type ProactiveNotebookArrivalTracker,
} from '../features/proactive/proactiveNotebookArrival.ts'
import { isUserTypingAnywhere } from '../features/autonomy/userTyping.ts'
import type { TranslationKey } from '../types/i18n.ts'

/** Inputs the pet window supplies once per notebook snapshot. */
export type UseProactiveNotebookArrivalOptions = {
  /** Ids of the unseen rows currently visible in the notebook. */
  unseenIds: readonly string[]
  /** True while the notebook panel is open. */
  open: boolean
  /** null until the environment snapshot is known; null stays silent. */
  context: DeliveryContext | null
  /** Focus fallback used before the environment snapshot arrives. */
  focusState: FocusState
  settings: { typingAwarenessEnabled: boolean }
  /** Speak and show one short line in the normal pet bubble. */
  announce: (key: TranslationKey) => void
}

/**
 * React owner of the notebook arrival line.
 *
 * The pure tracker decides whether a new batch should be announced; this hook
 * only supplies the typing signal, re-checks every few seconds while typing or
 * another quiet rule delays the line, and forwards the chosen key. Re-checking
 * is what lets a batch announced after typing stops stay silent once the same
 * ids have been marked handled.
 */
export function useProactiveNotebookArrival({
  unseenIds,
  open,
  context,
  focusState,
  settings,
  announce,
}: UseProactiveNotebookArrivalOptions): void {
  const trackerRef = useRef<ProactiveNotebookArrivalTracker | null>(null)
  if (trackerRef.current === null) {
    trackerRef.current = createProactiveNotebookArrivalTracker()
  }
  const announceRef = useRef(announce)
  const latestRef = useRef({ unseenIds, open, context, focusState, settings })

  useEffect(() => {
    announceRef.current = announce
  }, [announce])

  const check = useCallback(() => {
    const tracker = trackerRef.current
    if (!tracker) return
    const latest = latestRef.current
    const decision = tracker.observe({
      unseenIds: latest.unseenIds,
      open: latest.open,
      context: latest.context,
      focusState: latest.focusState,
      userTyping: isUserTypingAnywhere(latest.settings),
    })
    if (decision.kind === 'announce') announceRef.current(decision.key)
  }, [])

  useEffect(() => {
    latestRef.current = { unseenIds, open, context, focusState, settings }
    check()
  }, [check, unseenIds, open, context, focusState, settings])

  useEffect(() => {
    if (unseenIds.length === 0) return undefined
    // Typing is a timestamp, not a React state change, so a periodic re-check
    // is the only way to speak the pending batch after the keys go quiet.
    const timer = window.setInterval(check, PROACTIVE_NOTEBOOK_ARRIVAL_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [check, unseenIds.length])
}
