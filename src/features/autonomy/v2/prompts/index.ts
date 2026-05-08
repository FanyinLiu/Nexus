/**
 * Autonomy V2 decision-engine per-locale prompt dispatcher.
 *
 * All narrative text that the decision LLM reads is localized here. The
 * JSON response contract itself stays English across all locales — it
 * describes the schema the parser expects and changing any of those
 * keywords would break extraction. Only the prose around the contract,
 * plus the context-section labels, differ by language.
 */

import type { UiLanguage } from '../../../../types'
import { normalizeUiLanguage } from '../../../../lib/uiLanguage.ts'
import { zhCNDecisionPrompts } from './decision.zh-CN.ts'
import { zhTWDecisionPrompts } from './decision.zh-TW.ts'
import { enUSDecisionPrompts } from './decision.en-US.ts'
import { jaDecisionPrompts } from './decision.ja.ts'
import { koDecisionPrompts } from './decision.ko.ts'

export interface DecisionPromptStrings {
  responseContractBase: string
  /** Optional contract piece — surfaces the `idle_motion` action only
   *  when the engine has decided this tick is idle enough that a silent
   *  gesture would feel peripheral, not interruptive. */
  responseContractIdleMotion: string
  responseContractTail: string

  identityFallback: string
  signaturePhrasesHeader: string
  forbiddenPhrasesHeader: string
  toneHeader: string
  personaMemoryHeader: (memory: string) => string

  activityWindow: (level: string) => string
  relationshipLevel: (level: string) => string
  dayNames: string[]

  sectionNow: (params: {
    datetime: string
    dayName: string
    hour: number
    activityWindow: string
  }) => string
  sectionUserFocus: (params: {
    focusState: string
    idleSeconds: number
    idleTicks: number
    appTitle: string | null | undefined
    activityClass: string
    deepFocused: boolean
  }) => string
  sectionEngineSelf: (params: {
    phase: string
    emotionLine: string
    relLine: string
    relScore: number
    streak: number
    daysInteracted: number
  }) => string

  sectionRecentChatHeader: string
  recentChatUserLabel: string
  recentChatAssistantLabel: string

  sectionMemoriesHeader: string
  sectionRemindersHeader: string
  sectionGoalsHeader: string
  goalProgressLabel: string

  sectionLastUtteranceHeader: string
  sectionLastUtteranceTail: string

  forceSilentOverride: string

  retryHeader: string
  retryLine: (params: { rejectedText: string; reason: string }) => string
  retryTail: string

  finalQuestion: string

  /** Variety hint injected when analyzeRecentReplies finds repetition. */
  varietyHint: (params: {
    avoidOpenings: string[]
    avoidEndings: string[]
    lengthMonotone: boolean
    avoidPunctuation: string[]
  }) => string
}

const REGISTRY: Record<UiLanguage, DecisionPromptStrings> = {
  'zh-CN': zhCNDecisionPrompts,
  'zh-TW': zhTWDecisionPrompts,
  'en-US': enUSDecisionPrompts,
  ja: jaDecisionPrompts,
  ko: koDecisionPrompts,
}

export function getDecisionPromptStrings(
  language: UiLanguage | undefined,
): DecisionPromptStrings {
  return REGISTRY[normalizeUiLanguage(language)]
}
