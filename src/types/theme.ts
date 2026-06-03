export type ThemeId =
  | 'nexus-default'
  | 'system-day'
  | 'warm-day'
  | 'soft'
  | 'high-contrast'
  | 'editorial'
  | 'system-dark'

export interface ThemeTokens {
  surface: string
  surfaceMuted: string
  surfaceGlass: string
  surfaceElevated: string
  textPrimary: string
  textMuted: string
  textSoft: string
  accent: string
  accentSoft: string
  accentHover: string
  border: string
  borderStrong: string
  shadow: string
  shadowAccent: string
}

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  tokens: ThemeTokens
}

export interface ThemeContextValue {
  themeId: ThemeId
  setTheme: (themeId: ThemeId) => void
  theme: ThemeDefinition
  availableThemes: ThemeDefinition[]
}
