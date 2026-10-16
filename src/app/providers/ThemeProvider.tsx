import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getAnalyticsConsent, track } from '../../features/analytics'
import {
  applyCompanionVariables,
  applyThemeVariables,
  getCompanionAppearance,
  isCompanionThemeId,
  listThemes,
  resolveTheme,
  ThemeContext,
  toCompanionThemeDefinition,
} from '../../features/themes'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { getSettingsSnapshot, subscribeToSettings, updateSettingsSnapshot } from '../store/settingsStore.ts'
import type { ThemeColorScheme, ThemeContextValue, ThemeId } from '../../types/theme.ts'

type ThemeProviderProps = {
  children: ReactNode
}

const DEFAULT_THEME_ID: ThemeId = 'warm'

function normalizeThemeId(value: string | undefined): ThemeId {
  return resolveTheme((value ?? DEFAULT_THEME_ID) as ThemeId).id
}

function normalizeColorScheme(value: string | undefined): ThemeColorScheme {
  return value === 'dark' ? 'dark' : 'light'
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeHydratedRef = useRef(false)
  const [themeId, setThemeId] = useState<ThemeId>(() => normalizeThemeId(getSettingsSnapshot().themeId))
  const [colorScheme, setColorScheme] = useState<ThemeColorScheme>(() => (
    normalizeColorScheme(getSettingsSnapshot().themeColorScheme)
  ))
  const theme = useMemo(() => {
    if (!isCompanionThemeId(themeId)) return resolveTheme(themeId)
    return toCompanionThemeDefinition(getCompanionAppearance(themeId, colorScheme))
  }, [colorScheme, themeId])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    applyThemeVariables(theme, root)
    if (isCompanionThemeId(theme.id)) {
      applyCompanionVariables(getCompanionAppearance(theme.id, colorScheme), root)
      root.dataset.companionTheme = theme.id
      root.dataset.colorScheme = colorScheme
    } else {
      delete root.dataset.companionTheme
      delete root.dataset.colorScheme
    }
    root.dataset.theme = theme.id
  }, [colorScheme, theme])

  useEffect(() => {
    const applyVibrancy = window.desktopPet?.setSystemVibrancy
    if (!applyVibrancy) return
    void applyVibrancy(themeId === 'system').catch((error) => {
      console.error('[ThemeProvider] Failed to update vibrancy:', getRedactedLogErrorMessage(error))
    })
  }, [themeId])

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
      colorScheme,
    })
  }, [colorScheme, themeId])

  useEffect(() => {
    return subscribeToSettings((settings) => {
      const nextThemeId = normalizeThemeId(settings.themeId)
      const nextScheme = normalizeColorScheme(settings.themeColorScheme)
      setThemeId((currentThemeId) => (
        currentThemeId === nextThemeId ? currentThemeId : nextThemeId
      ))
      setColorScheme((currentScheme) => (
        currentScheme === nextScheme ? currentScheme : nextScheme
      ))
    })
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({
    themeId,
    colorScheme,
    previewTheme: (nextThemeId) => {
      setThemeId(normalizeThemeId(nextThemeId))
    },
    previewCompanionAppearance: (selection) => {
      setThemeId(normalizeThemeId(selection.themeId))
      setColorScheme(normalizeColorScheme(selection.colorScheme))
    },
    setTheme: (nextThemeId) => {
      const normalizedThemeId = normalizeThemeId(nextThemeId)
      setThemeId(normalizedThemeId)

      void updateSettingsSnapshot((currentSettings) => (
        currentSettings.themeId === normalizedThemeId
          ? currentSettings
          : { ...currentSettings, themeId: normalizedThemeId }
      )).catch((error) => {
        console.error('[ThemeProvider] Failed to persist theme:', getRedactedLogErrorMessage(error))
      })
    },
    theme,
    availableThemes: listThemes(),
  }), [colorScheme, theme, themeId])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
