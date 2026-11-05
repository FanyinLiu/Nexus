import { useCallback, useEffect, useRef } from 'react'

import type { DeliveryContext } from '../../shared/proactiveDelivery.js'
import type { ProactiveInboxRow } from '../features/proactive/proactiveInboxOverlay.ts'
import {
  buildProactiveNotebookSpeechPlan,
  canReadProactiveNotebookAloud,
  createProactiveNotebookNarrator,
  type ProactiveNotebookNarrator,
  type ProactiveNotebookSpeechRow,
} from '../features/proactive/proactiveNotebookSpeech.ts'
import type { AppSettings } from '../types/index.ts'

export type UseProactiveNotebookNarrationOptions = {
  open: boolean
  rows: readonly ProactiveInboxRow[]
  openingUnseenIds: readonly string[]
  openingText: string
  letterText: string
  restText: string
  settings: Pick<AppSettings, 'speechOutputEnabled'>
  /** null until the environment is known; null means stay silent. */
  context: DeliveryContext | null
  speak: (text: string) => Promise<void>
  stop: () => void
  setSpeakingId: (id: string | null) => void
}

export type UseProactiveNotebookNarrationResult = {
  /** Stop the current plan and clear the highlighted row. */
  interrupt: () => void
}

/**
 * Narrate the unseen rows captured when the notebook opened.
 *
 * The pure speech module decides whether reading aloud is allowed and which
 * rows fit the plan; this hook only runs the plan once per opening, remembers
 * every id already spoken for the session and forwards the highlighted row to
 * the controller. Closing the notebook, calling `interrupt` and unmounting all
 * stop speech through the same narrator boundary.
 */
export function useProactiveNotebookNarration({
  open,
  rows,
  openingUnseenIds,
  openingText,
  letterText,
  restText,
  settings,
  context,
  speak,
  stop,
  setSpeakingId,
}: UseProactiveNotebookNarrationOptions): UseProactiveNotebookNarrationResult {
  const spokenIdsRef = useRef<Set<string>>(new Set())
  const wasOpenRef = useRef(false)
  const speakRef = useRef(speak)
  const stopRef = useRef(stop)
  const setSpeakingIdRef = useRef(setSpeakingId)
  const narratorRef = useRef<ProactiveNotebookNarrator | null>(null)

  useEffect(() => {
    speakRef.current = speak
    stopRef.current = stop
    setSpeakingIdRef.current = setSpeakingId
  }, [setSpeakingId, speak, stop])

  useEffect(() => {
    const narrator = createProactiveNotebookNarrator({
      speak: (text) => speakRef.current(text),
      stop: () => stopRef.current(),
      onSpeaking: (rowId) => setSpeakingIdRef.current(rowId),
      onSpoken: (rowId) => {
        spokenIdsRef.current.add(rowId)
      },
    })
    narratorRef.current = narrator
    return () => {
      narrator.interrupt()
      if (narratorRef.current === narrator) narratorRef.current = null
    }
  }, [])

  const interrupt = useCallback(() => {
    narratorRef.current?.interrupt()
  }, [])

  useEffect(() => {
    const narrator = narratorRef.current
    if (!narrator) return

    if (!open) {
      if (wasOpenRef.current) narrator.interrupt()
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true

    if (!context) return
    if (!canReadProactiveNotebookAloud({
      speechOutputEnabled: settings.speechOutputEnabled,
      fullscreen: context.fullscreen,
      systemDnd: context.systemDnd,
      inQuietHours: context.inQuietHours,
      screenSharing: null,
      focusState: context.focusState,
    })) {
      return
    }

    const openingIds = new Set(openingUnseenIds)
    // Membership in `openingUnseenIds` is the snapshot: a row that was marked
    // seen a moment later is still one of the lines this opening offered.
    const speechRows: ProactiveNotebookSpeechRow[] = rows
      .filter((row) => openingIds.has(row.id))
      .map((row) => ({
        id: row.id,
        title: row.title,
        unseen: true,
        letter: row.letter,
      }))
    const plan = buildProactiveNotebookSpeechPlan({
      openingText,
      rows: speechRows,
      spokenIds: spokenIdsRef.current,
      letterText,
      restText,
    })
    void narrator.start(plan)
  }, [context, letterText, open, openingText, openingUnseenIds, restText, rows, settings])

  return { interrupt }
}
