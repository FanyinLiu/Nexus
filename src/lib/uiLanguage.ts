import { AVAILABLE_LOCALES, normalizeLocale, t as translate } from '../i18n/index.ts'
import type { TranslationKey, TranslationParams, UiLanguage } from '../types'

export type LocalizedText = {
  'zh-CN': string
  'en-US': string
  'zh-TW'?: string
  ja?: string
  ko?: string
}

export const UI_LANGUAGE_OPTIONS: Array<{
  value: UiLanguage
  nativeLabel: string
  englishLabel: string
}> = AVAILABLE_LOCALES.map((locale) => {
  switch (locale) {
    case 'zh-CN':
      return {
        value: locale,
        nativeLabel: '简体中文',
        englishLabel: 'Simplified Chinese',
      }
    case 'zh-TW':
      return {
        value: locale,
        nativeLabel: '繁體中文',
        englishLabel: 'Traditional Chinese',
      }
    case 'ja':
      return {
        value: locale,
        nativeLabel: '日本語',
        englishLabel: 'Japanese',
      }
    case 'ko':
      return {
        value: locale,
        nativeLabel: '한국어',
        englishLabel: 'Korean',
      }
    case 'en-US':
    default:
      return {
        value: 'en-US',
        nativeLabel: 'English',
        englishLabel: 'English',
      }
  }
})

export function normalizeUiLanguage(value: unknown): UiLanguage {
  return normalizeLocale(value) as UiLanguage
}

export function isChineseUiLanguage(language: UiLanguage) {
  return language === 'zh-CN' || language === 'zh-TW'
}

export function resolveLocalizedText(language: UiLanguage, copy: LocalizedText) {
  const normalized = normalizeUiLanguage(language)

  switch (normalized) {
    case 'zh-TW':
      return copy['zh-TW'] ?? copy['zh-CN']
    case 'ja':
      return copy.ja ?? copy['en-US']
    case 'ko':
      return copy.ko ?? copy['en-US']
    case 'en-US':
      return copy['en-US']
    case 'zh-CN':
    default:
      return copy['zh-CN']
  }
}

export function pickUiText(language: UiLanguage, zhCN: string, enUS: string) {
  return isChineseUiLanguage(normalizeUiLanguage(language)) ? zhCN : enUS
}

export function pickTranslatedUiText(
  language: UiLanguage,
  key: TranslationKey,
  params?: TranslationParams,
) {
  return translate(key, params, normalizeUiLanguage(language))
}

type LocaleNameDefaults = { companionName: string; userName: string }

const LOCALE_NAME_DEFAULTS: Record<UiLanguage, LocaleNameDefaults> = {
  'zh-CN': { companionName: '星绘', userName: '主人' },
  'zh-TW': { companionName: '星繪', userName: '主人' },
  'en-US': { companionName: 'Nexus', userName: 'you' },
  ja: { companionName: 'ネクサス', userName: 'ご主人さま' },
  ko: { companionName: '넥서스', userName: '주인님' },
}

export function getDefaultCompanionName(language: UiLanguage): string {
  return LOCALE_NAME_DEFAULTS[normalizeUiLanguage(language)].companionName
}

export function getDefaultUserName(language: UiLanguage): string {
  return LOCALE_NAME_DEFAULTS[normalizeUiLanguage(language)].userName
}

export function isLocaleDefaultCompanionName(name: string): boolean {
  return Object.values(LOCALE_NAME_DEFAULTS).some((d) => d.companionName === name)
}

export function isLocaleDefaultUserName(name: string): boolean {
  return Object.values(LOCALE_NAME_DEFAULTS).some((d) => d.userName === name)
}

export function detectPreferredUiLanguage(): UiLanguage {
  if (typeof navigator === 'undefined') return 'zh-CN'
  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ].filter(Boolean) as string[]
  for (const raw of candidates) {
    const lower = raw.toLowerCase()
    if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-hant')) return 'zh-TW'
    if (lower.startsWith('zh')) return 'zh-CN'
    if (lower.startsWith('ja')) return 'ja'
    if (lower.startsWith('ko')) return 'ko'
    if (lower.startsWith('en')) return 'en-US'
  }
  return 'zh-CN'
}
