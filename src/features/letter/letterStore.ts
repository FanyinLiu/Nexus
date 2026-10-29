/**
 * Persisted Sunday-letter store. Each generation lands as one
 * SavedLetter; the array is kept in localStorage and capped to
 * MAX_KEPT entries (~half a year of weekly letters) so a user's
 * letter shelf doesn't grow unbounded.
 *
 * Read state: a newly generated letter stores `readAt: null` (unread).
 * Legacy records have no field at all and are treated as already read, so
 * upgrading does not flood the chat with old letters. Writes dispatch
 * LETTERS_UPDATED_EVENT so an open chat or memory page refreshes.
 */

import { LETTER_STORE_STORAGE_KEY, readJson, writeJson } from '../../lib/storage/core.ts'
import { isLocalDayKey, isValidIsoTimestamp } from '../../lib/localDate.ts'
import { normalizeText } from '../../lib/normalize.ts'
import type { LetterContent } from './letterPromptBuilder.ts'
import type { UiLanguage } from '../../types'

export const LETTERS_UPDATED_EVENT = 'nexus:letters-updated'

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
  /**
   * ISO timestamp the person opened the letter. `null` means unread;
   * `undefined` is a legacy letter that predates read tracking.
   */
  readAt?: string | null
}

const MAX_KEPT = 26
const EMPTY: SavedLetter[] = []
const VALID_UI_LANGUAGES = new Set<UiLanguage>(['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'])
const LETTER_CONTENT_KEYS: ReadonlyArray<keyof LetterContent> = [
  'greeting',
  'summary',
  'suggestion',
  'intention',
  'experiment',
  'closing',
]

function normalizeLetterContent(value: unknown): LetterContent | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const out: Partial<LetterContent> = {}
  for (const key of LETTER_CONTENT_KEYS) {
    const normalized = normalizeText(obj[key])
    if (!normalized) return null
    out[key] = normalized
  }
  return out as LetterContent
}

function normalizeThemes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const themes = new Set<string>()
  for (const theme of value) {
    const normalized = normalizeText(theme)
    if (normalized) themes.add(normalized)
  }
  return [...themes].slice(0, 20)
}

function normalizeWeekDayCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(7, Math.max(0, Math.floor(value)))
}

function normalizeReadAt(value: unknown): string | null | undefined {
  if (value === null) return null
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !isValidIsoTimestamp(value)) return undefined
  return new Date(value).toISOString()
}

function emitLettersUpdated(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new Event(LETTERS_UPDATED_EVENT))
  } catch {
    // A non-DOM test double may not implement Event; the store still wrote.
  }
}

function normalizeSavedLetter(value: unknown): SavedLetter | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const id = normalizeText(obj.id)
  const letterDate = normalizeText(obj.letterDate)
  const createdAt = normalizeText(obj.createdAt)
  const personaId = normalizeText(obj.personaId)
  const content = normalizeLetterContent(obj.content)
  if (!id || !letterDate || !isLocalDayKey(letterDate)) return null
  if (!createdAt || !isValidIsoTimestamp(createdAt)) return null
  if (!personaId || !content) return null
  const uiLanguage = VALID_UI_LANGUAGES.has(obj.uiLanguage as UiLanguage)
    ? obj.uiLanguage as UiLanguage
    : 'zh-CN'
  const readAt = normalizeReadAt(obj.readAt)
  return {
    id,
    letterDate,
    createdAt,
    personaId,
    uiLanguage,
    content,
    weekDayCount: normalizeWeekDayCount(obj.weekDayCount),
    themes: normalizeThemes(obj.themes),
    ...(readAt !== undefined ? { readAt } : {}),
  }
}

function sortDedupeAndCap(letters: SavedLetter[]): SavedLetter[] {
  const sorted = [...letters].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const seenIds = new Set<string>()
  const seenDates = new Set<string>()
  const out: SavedLetter[] = []
  for (const letter of sorted) {
    if (seenIds.has(letter.id) || seenDates.has(letter.letterDate)) continue
    seenIds.add(letter.id)
    seenDates.add(letter.letterDate)
    out.push(letter)
    if (out.length >= MAX_KEPT) break
  }
  return out
}

export function loadLetters(): SavedLetter[] {
  if (typeof window === 'undefined') return EMPTY
  const raw = readJson<unknown>(LETTER_STORE_STORAGE_KEY, EMPTY)
  if (!Array.isArray(raw)) {
    writeJson(LETTER_STORE_STORAGE_KEY, EMPTY)
    return EMPTY
  }
  const normalized = sortDedupeAndCap(
    raw.map(normalizeSavedLetter).filter((item): item is SavedLetter => Boolean(item)),
  )
  if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
    writeJson(LETTER_STORE_STORAGE_KEY, normalized)
  }
  return normalized
}

/**
 * Build the row to persist only when the model returned a parsed letter.
 * Returning null is what keeps a failed generation from consuming the week:
 * there is no letter date for the scheduler to deduplicate against.
 */
export function createSavedLetter(input: {
  letterDate: string
  personaId: string
  uiLanguage: UiLanguage
  content: LetterContent | null
  weekDayCount: number
  themes: string[]
  createdAt?: string
}): SavedLetter | null {
  if (!input.content) return null
  return {
    id: `letter-${input.letterDate}-${Date.now()}`,
    letterDate: input.letterDate,
    createdAt: input.createdAt ?? new Date().toISOString(),
    personaId: input.personaId,
    uiLanguage: input.uiLanguage,
    content: input.content,
    weekDayCount: input.weekDayCount,
    themes: [...input.themes],
    readAt: null,
  }
}

export function saveLetter(letter: SavedLetter): void {
  const normalizedLetter = normalizeSavedLetter(letter)
  if (!normalizedLetter) return
  const existing = loadLetters()
  const previousForDate = existing.find((item) => item.letterDate === normalizedLetter.letterDate)
  // A retry that replaces the same week should not turn an already-read
  // letter back into an unread one.
  const letterToSave = normalizedLetter.readAt === null && previousForDate?.readAt
    ? { ...normalizedLetter, readAt: previousForDate.readAt }
    : normalizedLetter
  const next = sortDedupeAndCap([
    letterToSave,
    ...existing.filter((item) => item.id !== letterToSave.id && item.letterDate !== letterToSave.letterDate),
  ])
  writeJson(LETTER_STORE_STORAGE_KEY, next)
  emitLettersUpdated()
}

/** Mark one letter read. Returns the updated row, or null when it is gone. */
export function markLetterRead(letterId: string, readAtIso = new Date().toISOString()): SavedLetter | null {
  const at = normalizeReadAt(readAtIso)
  if (typeof at !== 'string') return null
  const all = loadLetters()
  const existing = all.find((letter) => letter.id === letterId)
  if (!existing) return null
  if (existing.readAt === at) return existing
  const updated: SavedLetter = { ...existing, readAt: at }
  const next = all.map((letter) => (letter.id === letterId ? updated : letter))
  writeJson(LETTER_STORE_STORAGE_KEY, next)
  emitLettersUpdated()
  return updated
}

export function findLetterByDate(letterDate: string): SavedLetter | null {
  return loadLetters().find((l) => l.letterDate === letterDate) ?? null
}

export function getMostRecentLetterMs(): number | null {
  const all = loadLetters()
  if (!all.length) return null
  const mostRecent = all.reduce((max, letter) => Math.max(max, Date.parse(letter.createdAt)), 0)
  return mostRecent > 0 ? mostRecent : null
}

/** Latest letter week (YYYY-MM-DD), used to enforce one letter per Sunday. */
export function getMostRecentLetterDate(): string | null {
  const all = loadLetters()
  if (!all.length) return null
  return all.reduce((max, letter) => (letter.letterDate > max ? letter.letterDate : max), '')
}

/** Newest unread letter, if any. Only the latest is surfaced in chat. */
export function getLatestUnreadLetter(): SavedLetter | null {
  return loadLetters().find((letter) => letter.readAt === null) ?? null
}

/** Number of unread letters for the memory-page shelf badge. */
export function countUnreadLetters(): number {
  return loadLetters().filter((letter) => letter.readAt === null).length
}
