/**
 * Chat system-prompt dispatcher.
 *
 * Picks the right per-locale prompt strings for the requested UI language.
 * All narrative text is localized here; structural markers
 * (`<system-reminder>...</system-reminder>`) are preserved across locales
 * because the rest of the pipeline does regex matching on them.
 */

import type { UiLanguage } from '../../../types'
import { normalizeUiLanguage } from '../../../lib/uiLanguage.ts'
import { zhCNChatPrompts } from './systemPrompt.zh-CN.ts'
import { zhTWChatPrompts } from './systemPrompt.zh-TW.ts'
import { enUSChatPrompts } from './systemPrompt.en-US.ts'
import { jaChatPrompts } from './systemPrompt.ja.ts'
import { koChatPrompts } from './systemPrompt.ko.ts'
import type { ChatPromptStrings } from './types.ts'

export type { ChatPromptStrings } from './types.ts'

const REGISTRY: Record<UiLanguage, ChatPromptStrings> = {
  'zh-CN': zhCNChatPrompts,
  'zh-TW': zhTWChatPrompts,
  'en-US': enUSChatPrompts,
  ja: jaChatPrompts,
  ko: koChatPrompts,
}

export function getChatPromptStrings(language: UiLanguage | undefined): ChatPromptStrings {
  return REGISTRY[normalizeUiLanguage(language)]
}
