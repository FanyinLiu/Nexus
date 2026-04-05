import { defaultThemeTokens } from '../tokens'
import type { ThemeDefinition } from '../../../types/theme'

export const editorialTheme: ThemeDefinition = {
  id: 'editorial',
  name: 'Editorial',
  description: 'Minimalist luxury aesthetic with serif typography and warm monochrome palette.',
  tokens: {
    ...defaultThemeTokens,
    surface: '#fafaf8',
    surfaceMuted: '#f4f3f0',
    textPrimary: '#1a1a1a',
    textMuted: '#6b6b65',
    accent: '#b8956a',
    accentSoft: 'rgba(184, 149, 106, 0.12)',
    border: 'rgba(26, 26, 26, 0.08)',
    shadow: 'rgba(26, 26, 26, 0.04)',
  },
}
