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
import type { DecisionPromptStrings } from './types.ts'

export type { DecisionPromptStrings } from './types.ts'

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
