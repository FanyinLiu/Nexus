import { zhCNMessages } from './locales/zh-CN.ts'
import { toTraditional } from './opencc.ts'
import type {
  AppLocale,
  TranslationDictionary,
  TranslationKey,
  TranslationParams,
} from '../types/i18n'

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

export const AVAILABLE_LOCALES: AppLocale[] = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja',
  'ko',
]

const dictionaries: Partial<Record<AppLocale, TranslationDictionary>> = {
  'zh-CN': zhCNMessages,
}

let currentLocale: AppLocale = DEFAULT_LOCALE
const pendingLoads: Partial<Record<AppLocale, Promise<TranslationDictionary>>> = {}

const localeLoaders: Record<AppLocale, () => Promise<TranslationDictionary>> = {
  'zh-CN': async () => zhCNMessages,
  'zh-TW': async () => (await import('./locales/zh-TW.ts')).zhTWMessages,
  'en-US': async () => (await import('./locales/en.ts')).enMessages,
  ja: async () => (await import('./locales/ja.ts')).jaMessages,
  ko: async () => (await import('./locales/ko.ts')).koMessages,
}

function interpolateMessage(template: string, params?: TranslationParams) {
  if (!params) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`))
}

function resolveMessage(locale: AppLocale, key: TranslationKey) {
  const message = dictionaries[locale]?.[key]
  if (message) {
    return message
  }

  if (locale === 'zh-TW') {
    return toTraditional(zhCNMessages[key] ?? key)
  }

  return zhCNMessages[key] ?? key
}

export function normalizeLocale(value: unknown): AppLocale {
  switch (value) {
    case 'zh-TW':
    case 'en':
    case 'en-US':
    case 'ja':
    case 'ko':
      return value === 'en' ? 'en-US' : value
    case 'zh-CN':
    default:
      return DEFAULT_LOCALE
  }
}

export function getLocale() {
  return currentLocale
}

export function setLocale(locale: AppLocale) {
  currentLocale = normalizeLocale(locale)
}

export function getDictionary(locale: AppLocale = currentLocale) {
  return dictionaries[normalizeLocale(locale)] ?? zhCNMessages
}

export function hasKey(key: TranslationKey, locale: AppLocale = currentLocale) {
  const normalizedLocale = normalizeLocale(locale)
  return key in (dictionaries[normalizedLocale] ?? {}) || key in zhCNMessages
}

export function isLocaleLoaded(locale: AppLocale) {
  return Boolean(dictionaries[normalizeLocale(locale)])
}

export async function ensureLocaleLoaded(locale: AppLocale) {
  const normalizedLocale = normalizeLocale(locale)
  const existing = dictionaries[normalizedLocale]
  if (existing) {
    return existing
  }

  pendingLoads[normalizedLocale] ??= localeLoaders[normalizedLocale]()
    .then((dictionary) => {
      dictionaries[normalizedLocale] = dictionary
      return dictionary
    })
    .finally(() => {
      delete pendingLoads[normalizedLocale]
    })

  return pendingLoads[normalizedLocale]
}

export function t(
  key: TranslationKey,
  params?: TranslationParams,
  locale: AppLocale = currentLocale,
) {
  return interpolateMessage(resolveMessage(normalizeLocale(locale), key), params)
}
