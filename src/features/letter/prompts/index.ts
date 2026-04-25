/**
 * Sunday-letter prompt strings — per-locale dispatcher. Same pattern as
 * the V2 decision-engine prompts: the JSON contract stays English so
 * the parser doesn't have to translate, only the prose around it.
 */

import type { UiLanguage } from '../../../types'
import { normalizeUiLanguage } from '../../../lib/uiLanguage.ts'
import { zhCNLetterPrompts } from './letter.zh-CN.ts'
import { zhTWLetterPrompts } from './letter.zh-TW.ts'
import { enUSLetterPrompts } from './letter.en-US.ts'
import { jaLetterPrompts } from './letter.ja.ts'
import { koLetterPrompts } from './letter.ko.ts'

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

const REGISTRY: Record<UiLanguage, LetterPromptStrings> = {
  'zh-CN': zhCNLetterPrompts,
  'zh-TW': zhTWLetterPrompts,
  'en-US': enUSLetterPrompts,
  ja: jaLetterPrompts,
  ko: koLetterPrompts,
}

export function getLetterPromptStrings(
  language: UiLanguage | undefined,
): LetterPromptStrings {
  return REGISTRY[normalizeUiLanguage(language)]
}
