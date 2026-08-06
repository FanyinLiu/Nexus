import type { TranslationKey } from '../types/i18n.ts'
import { zhCNMessages } from './locales/zh-CN/index.ts'

/**
 * Runtime translation-key list, derived from the zh-CN reference dictionary.
 *
 * zh-CN is the single source of truth for the key set: each namespace module
 * is `as const satisfies Partial<TranslationDictionary>` and the assembled
 * dictionary is `satisfies TranslationDictionary`, so tsc itself guarantees
 * the key set equals the TranslationKey union in both directions. There is
 * deliberately no generated mirror file to keep in sync.
 */
export const translationKeys = Object.keys(zhCNMessages).sort() as TranslationKey[]
