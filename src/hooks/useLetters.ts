/**
 * Live letter shelf for the V2 chat and the simple Memory page.
 *
 * Hooks own the subscription and read action; store decisions stay in
 * features/letter. The store dispatches LETTERS_UPDATED_EVENT after a save
 * or read, so an open chat notices a letter that arrived in the background.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LETTERS_UPDATED_EVENT,
  loadLetters,
  markLetterRead,
  type SavedLetter,
} from '../features/letter/letterStore.ts'
import { isLetterUnread } from '../features/letter/letterView.ts'

export function useLetters() {
  const [letters, setLetters] = useState<SavedLetter[]>(() => loadLetters())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined
    }
    const refresh = () => setLetters(loadLetters())
    window.addEventListener(LETTERS_UPDATED_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener(LETTERS_UPDATED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const unreadCount = useMemo(
    () => letters.filter(isLetterUnread).length,
    [letters],
  )
  const latestUnread = useMemo(
    () => letters.find(isLetterUnread) ?? null,
    [letters],
  )

  const markRead = useCallback((letterId: string) => {
    markLetterRead(letterId)
    setLetters(loadLetters())
  }, [])

  return { letters, unreadCount, latestUnread, markRead }
}
