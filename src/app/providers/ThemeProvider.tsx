import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getAnalyticsConsent, track } from '../../features/analytics'
import {
  applyThemeVariables,
  listThemes,
  resolveTheme,
  ThemeContext,
} from '../../features/themes'
import { getSettingsSnapshot, setSettingsSnapshot, subscribeToSettings } from '../store/settingsStore'
import type { ThemeContextValue, ThemeId } from '../../types/theme'

type ThemeProviderProps = {
  children: ReactNode
}

const DEFAULT_THEME_ID: ThemeId = 'nexus-default'

function normalizeThemeId(value: string | undefined): ThemeId {
  return resolveTheme((value ?? DEFAULT_THEME_ID) as ThemeId).id
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeHydratedRef = useRef(false)
  const [themeId, setThemeId] = useState<ThemeId>(() => normalizeThemeId(getSettingsSnapshot().themeId))
  const theme = useMemo(() => resolveTheme(themeId), [themeId])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      applyThemeVariables(theme)
      document.documentElement.dataset.theme = theme.id
    }
  }, [theme])

  useEffect(() => {
    if (!themeHydratedRef.current) {
      themeHydratedRef.current = true
      return
    }

    if (!getAnalyticsConsent()) {
      return
    }

    void track('settings.theme_changed', {
      themeId,
    })
  }, [themeId])

  useEffect(() => {
    return subscribeToSettings((settings) => {
      const nextThemeId = normalizeThemeId(settings.themeId)
      setThemeId((currentThemeId) => (
        currentThemeId === nextThemeId ? currentThemeId : nextThemeId
      ))
    })
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({
    themeId,
    setTheme: (nextThemeId) => {
      const normalizedThemeId = normalizeThemeId(nextThemeId)
      setThemeId(normalizedThemeId)

      const currentSettings = getSettingsSnapshot()
      if (currentSettings.themeId !== normalizedThemeId) {
        void setSettingsSnapshot({
          ...currentSettings,
          themeId: normalizedThemeId,
        })
      }
    },
    theme,
    availableThemes: listThemes(),
  }), [theme, themeId])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
