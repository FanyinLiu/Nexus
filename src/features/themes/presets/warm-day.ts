import { defaultThemeTokens } from '../tokens'
import type { ThemeDefinition } from '../../../types/theme'

export const warmDayTheme: ThemeDefinition = {
  id: 'warm-day',
  name: 'Warm Day',
  description: 'Warm off-white day theme with a quiet clay accent.',
  tokens: {
    ...defaultThemeTokens,
    surface: 'rgba(255, 252, 247, 0.96)',
    surfaceMuted: 'rgba(246, 240, 231, 0.92)',
    surfaceGlass: 'rgba(255, 250, 242, 0.78)',
    surfaceElevated: 'rgba(255, 253, 249, 0.98)',
    textPrimary: '#241b16',
    textMuted: '#72645b',
    textSoft: '#a3958a',
    accent: '#c76645',
    accentSoft: 'rgba(199, 102, 69, 0.14)',
    accentHover: '#a95338',
    border: 'rgba(67, 49, 38, 0.1)',
    borderStrong: 'rgba(67, 49, 38, 0.18)',
    shadow: 'rgba(67, 49, 38, 0.08)',
    shadowAccent: 'rgba(199, 102, 69, 0.13)',
  },
}
