import { softTheme } from './presets/soft.ts'
import { editorialTheme } from './presets/editorial.ts'
import { highContrastTheme } from './presets/high-contrast.ts'
import { nexusDefaultTheme } from './presets/nexus-default.ts'
import { systemBlackTheme } from './presets/system-black.ts'
import { systemDarkTheme } from './presets/system-dark.ts'
import { systemDayTheme } from './presets/system-day.ts'
import { warmDayTheme } from './presets/warm-day.ts'
import type { ThemeDefinition, ThemeId } from '../../types/theme'

const themeMap: Record<ThemeId, ThemeDefinition> = {
  'nexus-default': nexusDefaultTheme,
  soft: softTheme,
  'high-contrast': highContrastTheme,
  editorial: editorialTheme,
  'system-black': systemBlackTheme,
  'system-day': systemDayTheme,
  'warm-day': warmDayTheme,
  'system-dark': systemDarkTheme,
}

function cloneThemeDefinition(theme: ThemeDefinition): ThemeDefinition {
  return {
    ...theme,
    tokens: { ...theme.tokens },
  }
}

export const themeRegistry = Object.freeze(Object.values(themeMap).map(cloneThemeDefinition))

export function listThemes() {
  return themeRegistry.map(cloneThemeDefinition)
}

export function getTheme(themeId: ThemeId) {
  const theme = themeMap[themeId]
  return theme ? cloneThemeDefinition(theme) : null
}

export function resolveTheme(themeId: ThemeId) {
  return getTheme(themeId) ?? cloneThemeDefinition(nexusDefaultTheme)
}
