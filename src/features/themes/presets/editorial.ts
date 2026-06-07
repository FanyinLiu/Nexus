import { defaultThemeTokens } from '../tokens.ts'
import type { ThemeDefinition } from '../../../types/theme'

export const editorialTheme: ThemeDefinition = {
  id: 'editorial',
  name: 'Editorial',
  description: 'Minimalist luxury aesthetic with serif typography and warm monochrome palette.',
  tokens: {
    ...defaultThemeTokens,
    surface: '#fafaf8',
    surfaceMuted: '#f4f3f0',
    surfaceGlass: 'rgba(250, 250, 248, 0.82)',
    surfaceElevated: '#ffffff',
    textPrimary: '#1a1a1a',
    textMuted: '#6b6b65',
    textSoft: '#9a9a92',
    accent: '#b8956a',
    accentSoft: 'rgba(184, 149, 106, 0.12)',
    accentHover: '#a5835a',
    border: 'rgba(26, 26, 26, 0.08)',
    borderStrong: 'rgba(26, 26, 26, 0.16)',
    shadow: 'rgba(26, 26, 26, 0.04)',
    shadowAccent: 'rgba(184, 149, 106, 0.1)',
  },
}
