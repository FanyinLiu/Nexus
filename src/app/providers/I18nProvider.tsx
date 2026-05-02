import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getAnalyticsConsent, track } from '../../features/analytics'
import {
  AVAILABLE_LOCALES,
  I18nContext,
  ensureLocaleLoaded,
  isLocaleLoaded,
  normalizeLocale,
  setLocale as setGlobalLocale,
  t,
} from '../../i18n'
import { getSettingsSnapshot, subscribeToSettings } from '../store/settingsStore'
import type { AppLocale, I18nContextValue } from '../../types/i18n'

type I18nProviderProps = {
  children: ReactNode
}

export function I18nProvider({ children }: I18nProviderProps) {
  const localeHydratedRef = useRef(false)
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    const normalizedLocale = normalizeLocale(getSettingsSnapshot().uiLanguage)
    if (isLocaleLoaded(normalizedLocale)) {
      setGlobalLocale(normalizedLocale)
      return normalizedLocale
    }

    setGlobalLocale('zh-CN')
    return 'zh-CN'
  })

  const requestLocale = useCallback((nextLocale: AppLocale) => {
    const normalizedLocale = normalizeLocale(nextLocale)
    void ensureLocaleLoaded(normalizedLocale)
      .then(() => {
        setGlobalLocale(normalizedLocale)
        setLocaleState((currentLocale) => (
          currentLocale === normalizedLocale ? currentLocale : normalizedLocale
        ))
      })
      .catch((error) => {
        console.error('[i18n] Failed to load locale:', normalizedLocale, error)
      })
  }, [])

  useEffect(() => {
    setGlobalLocale(locale)

    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  useEffect(() => {
    if (!localeHydratedRef.current) {
      localeHydratedRef.current = true
      return
    }

    if (!getAnalyticsConsent()) {
      return
    }

    void track('settings.locale_changed', {
      locale,
    })
  }, [locale])

  useEffect(() => {
    return subscribeToSettings((settings) => {
      const nextLocale = normalizeLocale(settings.uiLanguage)
      requestLocale(nextLocale)
    })
  }, [requestLocale])

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: (nextLocale) => {
      const normalizedLocale = normalizeLocale(nextLocale)
      requestLocale(normalizedLocale)
    },
    t: (key, params) => t(key, params, locale),
    availableLocales: AVAILABLE_LOCALES,
  }), [locale, requestLocale])

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}
