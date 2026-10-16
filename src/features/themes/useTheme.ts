import { createContext, useContext } from 'react'
import type { ThemeContextValue } from '../../types/theme.ts'
import { listThemes, resolveTheme } from './registry.ts'

const fallbackTheme = resolveTheme('warm')

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)

  if (context) {
    return context
  }

  return {
    themeId: fallbackTheme.id,
    colorScheme: 'light',
    setTheme: () => undefined,
    previewTheme: () => undefined,
    previewCompanionAppearance: () => undefined,
    theme: fallbackTheme,
    availableThemes: listThemes(),
  }
}
