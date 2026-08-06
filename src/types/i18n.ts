/**
 * i18n type contracts. The zh-CN reference dictionary owns the key set:
 * `TranslationKey` is derived from it via `keyof typeof zhCNMessages`, so
 * there is no hand-maintained union to drift. zh-CN namespace modules only
 * satisfy `Record<string, string>` — referencing `TranslationDictionary`
 * from the dictionary the key set is derived from would be a type cycle.
 * The other four locales keep `satisfies Partial<TranslationDictionary>` /
 * `satisfies TranslationDictionary`, so tsc pins them to the zh-CN key set;
 * adding a key means editing the zh-CN namespace module plus the matching
 * module of every other locale.
 */
import type { zhCNMessages } from '../i18n/locales/zh-CN/index.ts'

export type AppLocale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja' | 'ko'
export type UiLanguage = AppLocale

export type TranslationKey = keyof typeof zhCNMessages

type TranslationPrimitive = string | number | boolean | null | undefined

export type TranslationParams = Record<string, TranslationPrimitive>

export type TranslationDictionary = Record<TranslationKey, string>

export type Translator = (key: TranslationKey, params?: TranslationParams) => string

export interface I18nContextValue {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  t: Translator
  availableLocales: AppLocale[]
}
