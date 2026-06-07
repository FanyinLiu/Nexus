import { defaultThemeTokens } from '../tokens.ts'
import type { ThemeDefinition } from '../../../types/theme'

export const softTheme: ThemeDefinition = {
  id: 'soft',
  name: 'Soft',
  description: 'Soft blue companion styling.',
  tokens: {
    ...defaultThemeTokens,
    accent: '#5a8acc',
    accentSoft: 'rgba(90, 138, 204, 0.16)',
    accentHover: '#4a74b5',
    shadowAccent: 'rgba(90, 138, 204, 0.18)',
  },
}
