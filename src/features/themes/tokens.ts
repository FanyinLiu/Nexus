import type { ThemeTokens } from '../../types/theme'

// Liquid Glass day values — adopted from the standalone UI mock. Accent
// is iOS-26 violet; surface tokens stay light so the settings drawer and
// panel overlays still read correctly on light wallpapers.
export const defaultThemeTokens: ThemeTokens = {
  surface: 'rgba(255, 255, 255, 0.95)',
  surfaceMuted: 'rgba(248, 248, 248, 0.92)',
  surfaceGlass: 'rgba(255, 255, 255, 0.72)',
  surfaceElevated: 'rgba(255, 255, 255, 0.96)',
  textPrimary: '#1C1428',
  textMuted: '#4A3F52',
  textSoft: '#7A6F82',
  accent: '#A88BFF',
  accentSoft: 'rgba(168, 139, 255, 0.2)',
  accentHover: '#C8A6FF',
  border: 'rgba(28, 20, 40, 0.08)',
  borderStrong: 'rgba(28, 20, 40, 0.14)',
  shadow: 'rgba(28, 20, 40, 0.06)',
  shadowAccent: 'rgba(168, 139, 255, 0.14)',
}

// Liquid Glass night values — same accent, deep-violet surfaces.
export const systemDarkThemeTokens: ThemeTokens = {
  surface: 'rgba(40, 30, 55, 0.58)',
  surfaceMuted: 'rgba(40, 30, 55, 0.38)',
  surfaceGlass: 'rgba(55, 42, 75, 0.78)',
  surfaceElevated: 'rgba(55, 42, 75, 0.88)',
  textPrimary: '#F4EEFB',
  textMuted: '#C8BBD8',
  textSoft: '#8E82A3',
  accent: '#A88BFF',
  accentSoft: 'rgba(168, 139, 255, 0.2)',
  accentHover: '#C8A6FF',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  shadow: 'rgba(0, 0, 0, 0.3)',
  shadowAccent: 'rgba(168, 139, 255, 0.2)',
}
