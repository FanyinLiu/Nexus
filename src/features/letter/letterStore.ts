/**
 * Persisted Sunday-letter store. Each generation lands as one
 * SavedLetter; the array is kept in localStorage and capped to
 * MAX_KEPT entries (~half a year of weekly letters) so a user's
 * letter shelf doesn't grow unbounded.
 */

import { LETTER_STORE_STORAGE_KEY, readJson, writeJson } from '../../lib/storage/core.ts'
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

function isValidIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function isValidLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

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

function normalizeSavedLetter(value: unknown): SavedLetter | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const id = normalizeText(obj.id)
  const letterDate = normalizeText(obj.letterDate)
  const createdAt = normalizeText(obj.createdAt)
  const personaId = normalizeText(obj.personaId)
  const content = normalizeLetterContent(obj.content)
  if (!id || !letterDate || !isValidLocalDate(letterDate)) return null
  if (!createdAt || !isValidIsoTimestamp(createdAt)) return null
  if (!personaId || !content) return null
  const uiLanguage = VALID_UI_LANGUAGES.has(obj.uiLanguage as UiLanguage)
    ? obj.uiLanguage as UiLanguage
    : 'zh-CN'
  return {
    id,
    letterDate,
    createdAt,
    personaId,
    uiLanguage,
    content,
    weekDayCount: normalizeWeekDayCount(obj.weekDayCount),
    themes: normalizeThemes(obj.themes),
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

export function saveLetter(letter: SavedLetter): void {
  const normalizedLetter = normalizeSavedLetter(letter)
  if (!normalizedLetter) return
  const existing = loadLetters()
  const next = sortDedupeAndCap([
    normalizedLetter,
    ...existing.filter((item) => item.id !== normalizedLetter.id && item.letterDate !== normalizedLetter.letterDate),
  ])
  writeJson(LETTER_STORE_STORAGE_KEY, next)
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
