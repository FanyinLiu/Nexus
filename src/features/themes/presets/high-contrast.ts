import { defaultThemeTokens } from '../tokens.ts'
import type { ThemeDefinition } from '../../../types/theme'

export const highContrastTheme: ThemeDefinition = {
  id: 'high-contrast',
  name: 'High Contrast',
  description: 'Accessibility-oriented theme with stronger contrast and borders.',
  tokens: {
    ...defaultThemeTokens,
    surface: '#ffffff',
    surfaceMuted: '#f0f0f0',
    surfaceGlass: 'rgba(255, 255, 255, 0.96)',
    surfaceElevated: '#ffffff',
    textPrimary: '#000000',
    textMuted: '#222222',
    textSoft: '#444444',
    accent: '#000000',
    accentSoft: 'rgba(0, 0, 0, 0.18)',
    accentHover: '#1a1a1a',
    border: '#000000',
    borderStrong: '#000000',
    shadow: 'rgba(0, 0, 0, 0.18)',
    shadowAccent: 'rgba(0, 0, 0, 0.24)',
  },
}
