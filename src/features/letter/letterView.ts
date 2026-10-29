/**
 * View helpers shared by the chat letter card, the memory-page shelf, and the
 * advanced Letters section. Pure so every surface renders the same order and
 * date label.
 */

import type { UiLanguage } from '../../types/i18n.ts'
import type { SavedLetter } from './letterStore.ts'

/** Long localized date for a letter's Sunday, falling back to the raw key. */
export function formatLetterDate(letterDate: string, language: UiLanguage): string {
  const timestamp = Date.parse(`${letterDate}T12:00:00`)
  if (!Number.isFinite(timestamp)) return letterDate
  return new Intl.DateTimeFormat(language === 'en-US' ? 'en-US' : language, {
    dateStyle: 'long',
  }).format(new Date(timestamp))
}

/** Paragraphs in reading order; empty fields are dropped defensively. */
export function letterParagraphs(letter: SavedLetter): string[] {
  return [
    letter.content.greeting,
    letter.content.summary,
    letter.content.suggestion,
    letter.content.intention,
    letter.content.experiment,
    letter.content.closing,
  ]
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function isLetterUnread(letter: SavedLetter): boolean {
  return letter.readAt === null
}

export function letterShelfSummary(letters: readonly SavedLetter[]): {
  count: number
  unreadCount: number
  latest: SavedLetter | null
} {
  return {
    count: letters.length,
    unreadCount: letters.filter(isLetterUnread).length,
    latest: letters[0] ?? null,
  }
}
