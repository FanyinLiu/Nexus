/**
 * Sunday-letter prompt string contract.
 * Kept separate from the locale dispatcher so per-locale files can import
 * the type without forming a cycle through index.ts.
 */

export interface LetterPromptStrings {
  taskFraming: string
  signaturePhrasesHeader: string
  toneHeader: string
  responseContract: string

  sectionWeekHeader: (isoDate: string, weekDayCount: number) => string
  sectionThemesHeader: string
  sectionHighlightsHeader: string
  sectionStressorsHeader: string
  sectionReflectionsHeader: string
  sectionMilestonesHeader: string

  finalInstruction: string
}
