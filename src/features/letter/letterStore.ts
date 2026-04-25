/**
 * Persisted Sunday-letter store. Each generation lands as one
 * SavedLetter; the array is kept in localStorage and capped to
 * MAX_KEPT entries (~6 months of weekly letters) so a user's
 * letter shelf doesn't grow unbounded.
 */

import { LETTER_STORE_STORAGE_KEY, readJson, writeJson } from '../../lib/storage'
import type { LetterContent } from './letterPromptBuilder.ts'
import type { UiLanguage } from '../../types'

export interface SavedLetter {
  id: string
  /** ISO date string of the Sunday this letter is dated to (YYYY-MM-DD). */
  letterDate: string
  /** ISO timestamp the letter was generated. */
  createdAt: string
  personaId: string
  uiLanguage: UiLanguage
  content: LetterContent
  /** Snapshot of the data the letter was generated from — useful for "why this letter?" UI. */
  weekDayCount: number
  themes: string[]
}

const MAX_KEPT = 32
const EMPTY: SavedLetter[] = []

export function loadLetters(): SavedLetter[] {
  return readJson<SavedLetter[]>(LETTER_STORE_STORAGE_KEY, EMPTY)
}

export function saveLetter(letter: SavedLetter): void {
  const existing = loadLetters()
  const next = [letter, ...existing].slice(0, MAX_KEPT)
  writeJson(LETTER_STORE_STORAGE_KEY, next)
}

export function findLetterByDate(letterDate: string): SavedLetter | null {
  return loadLetters().find((l) => l.letterDate === letterDate) ?? null
}

export function getMostRecentLetterMs(): number | null {
  const all = loadLetters()
  if (!all.length) return null
  const t = Date.parse(all[0].createdAt)
  return Number.isFinite(t) ? t : null
}
