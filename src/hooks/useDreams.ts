/**
 * Live dream diary for the memory timeline.
 *
 * The store owns parsing, dedupe, and persistence; this hook only mirrors the
 * list and exposes a delete action. The store dispatches DREAMS_UPDATED_EVENT
 * after a write, so a dream written by the background scheduler appears in an
 * already-open timeline without a refresh.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  DREAMS_UPDATED_EVENT,
  deleteDream,
  loadDreams,
} from '../features/dream/dreamDiaryStore.ts'
import type { DreamDiaryEntry } from '../types'

export function useDreams() {
  const [dreams, setDreams] = useState<DreamDiaryEntry[]>(() => loadDreams())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined
    }
    const refresh = () => setDreams(loadDreams())
    window.addEventListener(DREAMS_UPDATED_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener(DREAMS_UPDATED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const remove = useCallback((entryId: string) => {
    deleteDream(entryId)
    setDreams(loadDreams())
  }, [])

  return { dreams, remove }
}
