import type { ThemeTokens } from '../../types/theme'

// Default theme — neutral surfaces, violet accent ONLY. The previous
// pass tinted everything violet which read as "purple-saturated" and
// strained eyes; surface tokens are back to neutral so the violet only
// shows up where it earns its weight (primary button, link, scrollbar).
export const defaultThemeTokens: ThemeTokens = {
  surface: 'rgba(255, 255, 255, 0.95)',
  surfaceMuted: 'rgba(248, 248, 248, 0.92)',
  surfaceGlass: 'rgba(255, 255, 255, 0.72)',
  surfaceElevated: 'rgba(255, 255, 255, 0.96)',
  textPrimary: '#1a1a1a',
  textMuted: '#6b6b6b',
  textSoft: '#a0a0a0',
  accent: '#A88BFF',
  accentSoft: 'rgba(168, 139, 255, 0.2)',
  accentHover: '#C8A6FF',
  border: 'rgba(200, 200, 200, 0.3)',
  borderStrong: 'rgba(180, 180, 180, 0.45)',
  shadow: 'rgba(0, 0, 0, 0.08)',
  shadowAccent: 'rgba(168, 139, 255, 0.14)',
}

export const systemBlackThemeTokens: ThemeTokens = {
  surface: '#0b0c0e',
  surfaceMuted: '#111216',
  surfaceGlass: 'rgba(11, 12, 14, 0.86)',
  surfaceElevated: '#17181c',
  textPrimary: '#f3f4f6',
  textMuted: '#a3a8b1',
  textSoft: '#6f747d',
  accent: '#6f9cff',
  accentSoft: 'rgba(111, 156, 255, 0.18)',
  accentHover: '#8bb0ff',
  border: 'rgba(255, 255, 255, 0.12)',
  borderStrong: 'rgba(255, 255, 255, 0.2)',
  shadow: 'rgba(0, 0, 0, 0.42)',
  shadowAccent: 'rgba(111, 156, 255, 0.16)',
}

// system-dark — neutral dark surfaces, same violet accent.
export const systemDarkThemeTokens: ThemeTokens = {
  surface: 'rgba(30, 24, 34, 0.96)',
  surfaceMuted: 'rgba(40, 32, 44, 0.94)',
  surfaceGlass: 'rgba(36, 28, 40, 0.78)',
  surfaceElevated: 'rgba(48, 38, 52, 0.96)',
  textPrimary: '#ede4ef',
  textMuted: '#9a8e9e',
  textSoft: '#6e626e',
  accent: '#A88BFF',
  accentSoft: 'rgba(168, 139, 255, 0.2)',
  accentHover: '#C8A6FF',
  border: 'rgba(100, 100, 100, 0.35)',
  borderStrong: 'rgba(140, 140, 140, 0.4)',
  shadow: 'rgba(0, 0, 0, 0.2)',
  shadowAccent: 'rgba(168, 139, 255, 0.14)',
}
