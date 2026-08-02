import { createContext, useContext } from 'react'
import { AVAILABLE_LOCALES, getLocale, setLocale, t } from './runtime.ts'
import type { I18nContextValue } from '../types/i18n.ts'

export const I18nContext = createContext<I18nContextValue | null>(null)

export function useTranslation(): I18nContextValue {
  const context = useContext(I18nContext)

  if (context) {
    return context
  }

  return {
    locale: getLocale(),
    setLocale,
    t: (key, params) => t(key, params),
    availableLocales: AVAILABLE_LOCALES,
  }
}
