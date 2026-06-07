import { createContext, useContext } from 'react'
import type { ThemeContextValue } from '../../types/theme'
import { listThemes, resolveTheme } from './registry.ts'

const fallbackTheme = resolveTheme('nexus-default')

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)

  if (context) {
    return context
  }

  return {
    themeId: fallbackTheme.id,
    setTheme: () => undefined,
    previewTheme: () => undefined,
    theme: fallbackTheme,
    availableThemes: listThemes(),
  }
}
