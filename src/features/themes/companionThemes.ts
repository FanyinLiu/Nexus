/**
 * The three companion looks. Each look has a light and a dark palette.
 * Screens read the CSS variables these palettes write — they do not
 * carry their own hex colors.
 *
 * Stored theme ids from older builds are mapped in
 * `mapStoredCompanionTheme`. Unknown values become the warm look so a
 * bad string cannot throw during load.
 */

import type {
  CompanionThemeId,
  ThemeColorScheme,
  ThemeDefinition,
  ThemeTokens,
} from '../../types/theme.ts'

/**
 * Body, chat, and cards share this stack in every look.
 * PingFang and Noto Sans CJK draw Latin and CJK from one face.
 * A Latin serif is not used here: without a CJK serif on the machine,
 * digits would be serif and the Chinese sans.
 */
const BODY_FONT_FAMILY = '"PingFang SC", system-ui, "Noto Sans CJK SC", "Noto Sans CJK", "Microsoft YaHei", "Noto Sans", "WenQuanYi Micro Hei", sans-serif'

export interface CompanionMetrics {
  radiusWindow: string
  radiusCard: string
  radiusControl: string
  shadowCard: string
  spacePage: string
  spaceStack: string
  typeTitle: string
  typeBody: string
  typeMeta: string
  fontWeight: string
  fontFamily: string
  motion: string
}

export interface CompanionAppearance {
  themeId: CompanionThemeId
  colorScheme: ThemeColorScheme
  tokens: ThemeTokens
  onAccent: string
  danger: string
  success: string
  warning: string
  bubbleUser: string
  bubbleUserInk: string
  bubbleAssistant: string
  bubbleAssistantInk: string
  posterSoul: string
  posterMemory: string
  posterInk: string
  cardBg: string
  cardFg: string
  cardMuted: string
  cardBorder: string
  blobPink: string
  blobBlue: string
  blobYellow: string
  metrics: CompanionMetrics
}

const WARM_METRICS: CompanionMetrics = {
  radiusWindow: '20px',
  radiusCard: '20px',
  radiusControl: '14px',
  shadowCard: '0 10px 26px rgba(78, 52, 36, 0.08)',
  spacePage: '16px',
  spaceStack: '12px',
  typeTitle: '17px',
  typeBody: '15px',
  typeMeta: '13px',
  fontWeight: '560',
  fontFamily: BODY_FONT_FAMILY,
  motion: '200ms',
}

const SYSTEM_METRICS: CompanionMetrics = {
  radiusWindow: '16px',
  radiusCard: '12px',
  radiusControl: '8px',
  shadowCard: '0 8px 24px rgba(0, 0, 0, 0.08)',
  spacePage: '12px',
  spaceStack: '8px',
  typeTitle: '15px',
  typeBody: '13px',
  typeMeta: '12px',
  fontWeight: '500',
  fontFamily: BODY_FONT_FAMILY,
  motion: '160ms',
}

const PLAYFUL_METRICS: CompanionMetrics = {
  radiusWindow: '22px',
  radiusCard: '22px',
  radiusControl: '16px',
  shadowCard: '0 5px 0 #F3C6D8',
  spacePage: '16px',
  spaceStack: '14px',
  typeTitle: '18px',
  typeBody: '16px',
  typeMeta: '13.5px',
  fontWeight: '650',
  fontFamily: BODY_FONT_FAMILY,
  motion: '320ms',
}

const WARM_LIGHT_TOKENS: ThemeTokens = {
  surface: '#F4EDE6',
  surfaceMuted: '#EFE4DA',
  surfaceGlass: 'rgba(255, 249, 243, 0.88)',
  surfaceElevated: '#FFF9F3',
  textPrimary: '#2E261F',
  textMuted: '#6F6258',
  textSoft: '#6F6258',
  accent: '#7A3228',
  accentSoft: 'rgba(122, 50, 40, 0.12)',
  accentHover: '#8E3A2E',
  border: 'rgba(78, 52, 36, 0.16)',
  borderStrong: 'rgba(78, 52, 36, 0.28)',
  shadow: 'rgba(78, 52, 36, 0.08)',
  shadowAccent: 'rgba(122, 50, 40, 0.16)',
}

const WARM_DARK_TOKENS: ThemeTokens = {
  surface: '#1A1614',
  surfaceMuted: '#221C19',
  surfaceGlass: 'rgba(38, 32, 28, 0.88)',
  surfaceElevated: '#26201C',
  textPrimary: '#F6EEE6',
  textMuted: '#C4B4A6',
  textSoft: '#C4B4A6',
  accent: '#E7B39A',
  accentSoft: 'rgba(231, 179, 154, 0.18)',
  accentHover: '#F0C4B0',
  border: '#3A312B',
  borderStrong: '#4A4038',
  shadow: 'rgba(0, 0, 0, 0.36)',
  shadowAccent: 'rgba(231, 179, 154, 0.2)',
}

const SYSTEM_LIGHT_TOKENS: ThemeTokens = {
  surface: '#F2F2F7',
  surfaceMuted: '#E5E5EA',
  surfaceGlass: 'rgba(246, 246, 248, 0.72)',
  surfaceElevated: '#FFFFFF',
  textPrimary: '#1D1D1F',
  textMuted: '#6E6E73',
  textSoft: '#6E6E73',
  accent: '#0066CC',
  accentSoft: 'rgba(0, 102, 204, 0.12)',
  accentHover: '#0057AD',
  border: 'rgba(60, 60, 67, 0.16)',
  borderStrong: 'rgba(60, 60, 67, 0.29)',
  shadow: 'rgba(0, 0, 0, 0.08)',
  shadowAccent: 'rgba(0, 102, 204, 0.16)',
}

const SYSTEM_DARK_TOKENS: ThemeTokens = {
  surface: '#1C1C1E',
  surfaceMuted: '#2C2C2E',
  surfaceGlass: 'rgba(44, 44, 46, 0.78)',
  surfaceElevated: '#2C2C2E',
  textPrimary: '#F5F5F7',
  textMuted: '#AEAEB2',
  textSoft: '#AEAEB2',
  accent: '#0066CC',
  accentSoft: 'rgba(10, 132, 255, 0.2)',
  accentHover: '#0A84FF',
  border: 'rgba(255, 255, 255, 0.12)',
  borderStrong: 'rgba(255, 255, 255, 0.2)',
  shadow: 'rgba(0, 0, 0, 0.36)',
  shadowAccent: 'rgba(10, 132, 255, 0.22)',
}

const PLAYFUL_LIGHT_TOKENS: ThemeTokens = {
  surface: '#FFF7FB',
  surfaceMuted: '#FFE8F2',
  surfaceGlass: 'rgba(255, 255, 255, 0.82)',
  surfaceElevated: '#FFFFFF',
  textPrimary: '#3A2C38',
  textMuted: '#6B5562',
  textSoft: '#6B5562',
  accent: '#B4235A',
  accentSoft: 'rgba(180, 35, 90, 0.12)',
  accentHover: '#9C1C4C',
  border: 'rgba(180, 35, 90, 0.16)',
  borderStrong: 'rgba(180, 35, 90, 0.28)',
  shadow: 'rgba(180, 35, 90, 0.08)',
  shadowAccent: 'rgba(180, 35, 90, 0.16)',
}

const PLAYFUL_DARK_TOKENS: ThemeTokens = {
  surface: '#241824',
  surfaceMuted: '#322434',
  surfaceGlass: 'rgba(50, 36, 52, 0.82)',
  surfaceElevated: '#322434',
  textPrimary: '#FFEAF3',
  textMuted: '#E2C4D2',
  textSoft: '#E2C4D2',
  accent: '#FF8FB8',
  accentSoft: 'rgba(255, 143, 184, 0.18)',
  accentHover: '#FFB3D0',
  border: 'rgba(255, 143, 184, 0.22)',
  borderStrong: 'rgba(255, 143, 184, 0.36)',
  shadow: 'rgba(0, 0, 0, 0.36)',
  shadowAccent: 'rgba(255, 143, 184, 0.2)',
}

function appearance(
  themeId: CompanionThemeId,
  colorScheme: ThemeColorScheme,
  tokens: ThemeTokens,
  metrics: CompanionMetrics,
  extras: Omit<CompanionAppearance, 'themeId' | 'colorScheme' | 'tokens' | 'metrics'>,
): CompanionAppearance {
  return { themeId, colorScheme, tokens, metrics, ...extras }
}

const APPEARANCES: Record<CompanionThemeId, Record<ThemeColorScheme, CompanionAppearance>> = {
  warm: {
    light: appearance('warm', 'light', WARM_LIGHT_TOKENS, WARM_METRICS, {
      onAccent: '#FFF8F3',
      danger: '#8E3A2E',
      success: '#2F6A5E',
      warning: '#8A5A22',
      bubbleUser: '#2F6A5E',
      bubbleUserInk: '#FFF9F3',
      bubbleAssistant: '#EFE4DA',
      bubbleAssistantInk: '#2E261F',
      posterSoul: '#244850',
      posterMemory: '#7A3228',
      posterInk: '#FFF8F3',
      cardBg: '#FFF9F3',
      cardFg: '#2E261F',
      cardMuted: '#6F6258',
      cardBorder: 'rgba(78, 52, 36, 0.16)',
      blobPink: 'rgba(231, 168, 136, 0.35)',
      blobBlue: 'rgba(127, 168, 174, 0.28)',
      blobYellow: 'rgba(232, 196, 138, 0.35)',
    }),
    dark: appearance('warm', 'dark', WARM_DARK_TOKENS, {
      ...WARM_METRICS,
      shadowCard: '0 10px 26px rgba(0, 0, 0, 0.36)',
    }, {
      onAccent: '#2E261F',
      danger: '#F0A598',
      success: '#8FCBB8',
      warning: '#E6C48A',
      bubbleUser: '#E7B39A',
      bubbleUserInk: '#2E261F',
      bubbleAssistant: '#322822',
      bubbleAssistantInk: '#F6EEE6',
      posterSoul: '#3E6E76',
      posterMemory: '#A34E3E',
      posterInk: '#FFF8F3',
      cardBg: '#322822',
      cardFg: '#F6EEE6',
      cardMuted: '#C4B4A6',
      cardBorder: '#3A312B',
      blobPink: 'rgba(163, 78, 62, 0.35)',
      blobBlue: 'rgba(62, 110, 118, 0.3)',
      blobYellow: 'rgba(138, 90, 34, 0.28)',
    }),
  },
  system: {
    light: appearance('system', 'light', SYSTEM_LIGHT_TOKENS, SYSTEM_METRICS, {
      onAccent: '#FFFFFF',
      danger: '#C41E16',
      success: '#248A3D',
      warning: '#8A5A00',
      bubbleUser: '#0066CC',
      bubbleUserInk: '#FFFFFF',
      bubbleAssistant: '#F2F2F7',
      bubbleAssistantInk: '#1D1D1F',
      posterSoul: '#1D4F91',
      posterMemory: '#0E6B3C',
      posterInk: '#FFFFFF',
      cardBg: '#FFFFFF',
      cardFg: '#1D1D1F',
      cardMuted: '#6E6E73',
      cardBorder: 'rgba(60, 60, 67, 0.16)',
      blobPink: 'rgba(0, 0, 0, 0)',
      blobBlue: 'rgba(0, 0, 0, 0)',
      blobYellow: 'rgba(0, 0, 0, 0)',
    }),
    dark: appearance('system', 'dark', SYSTEM_DARK_TOKENS, {
      ...SYSTEM_METRICS,
      shadowCard: '0 8px 24px rgba(0, 0, 0, 0.36)',
    }, {
      onAccent: '#FFFFFF',
      danger: '#FF6961',
      success: '#32D74B',
      warning: '#FFD60A',
      bubbleUser: '#0066CC',
      bubbleUserInk: '#FFFFFF',
      bubbleAssistant: '#3A3A3C',
      bubbleAssistantInk: '#F5F5F7',
      posterSoul: '#004F99',
      posterMemory: '#0E6B3C',
      posterInk: '#FFFFFF',
      cardBg: '#3A3A3C',
      cardFg: '#F5F5F7',
      cardMuted: '#AEAEB2',
      cardBorder: 'rgba(255, 255, 255, 0.12)',
      blobPink: 'rgba(0, 0, 0, 0)',
      blobBlue: 'rgba(0, 0, 0, 0)',
      blobYellow: 'rgba(0, 0, 0, 0)',
    }),
  },
  playful: {
    light: appearance('playful', 'light', PLAYFUL_LIGHT_TOKENS, PLAYFUL_METRICS, {
      onAccent: '#FFFFFF',
      danger: '#B4235A',
      success: '#1F7A58',
      warning: '#8A5A00',
      bubbleUser: '#B4235A',
      bubbleUserInk: '#FFFFFF',
      bubbleAssistant: '#FFE8F2',
      bubbleAssistantInk: '#3A2C38',
      posterSoul: '#5B3F86',
      posterMemory: '#B4235A',
      posterInk: '#FFFFFF',
      cardBg: '#FFFFFF',
      cardFg: '#3A2C38',
      cardMuted: '#6B5562',
      cardBorder: 'rgba(180, 35, 90, 0.16)',
      blobPink: 'rgba(255, 214, 232, 0.95)',
      blobBlue: 'rgba(215, 239, 255, 0.95)',
      blobYellow: 'rgba(255, 243, 196, 0.95)',
    }),
    dark: appearance('playful', 'dark', PLAYFUL_DARK_TOKENS, {
      ...PLAYFUL_METRICS,
      shadowCard: '0 5px 0 #5A3048',
    }, {
      onAccent: '#3A2C38',
      danger: '#FF8FB8',
      success: '#8FCBB8',
      warning: '#FFE08A',
      bubbleUser: '#FF8FB8',
      bubbleUserInk: '#3A2C38',
      bubbleAssistant: '#3E2C40',
      bubbleAssistantInk: '#FFEAF3',
      posterSoul: '#5B3F86',
      posterMemory: '#9C1C4C',
      posterInk: '#FFF7FB',
      cardBg: '#3E2C40',
      cardFg: '#FFEAF3',
      cardMuted: '#E2C4D2',
      cardBorder: 'rgba(255, 143, 184, 0.28)',
      blobPink: 'rgba(226, 91, 138, 0.28)',
      blobBlue: 'rgba(61, 143, 212, 0.24)',
      blobYellow: 'rgba(226, 163, 37, 0.2)',
    }),
  },
}

export const COMPANION_THEME_IDS: readonly CompanionThemeId[] = ['warm', 'system', 'playful']

export const warmTheme: ThemeDefinition = {
  id: 'warm',
  name: 'Warm companion',
  description: 'Default warm companion look.',
  tokens: WARM_LIGHT_TOKENS,
}

export const systemTheme: ThemeDefinition = {
  id: 'system',
  name: 'System look',
  description: 'Translucent system look. macOS supplies real vibrancy.',
  tokens: SYSTEM_LIGHT_TOKENS,
}

export const playfulTheme: ThemeDefinition = {
  id: 'playful',
  name: 'A little character',
  description: 'Rounder, brighter companion look.',
  tokens: PLAYFUL_LIGHT_TOKENS,
}

/** True when the id is one of the three selectable companion looks. */
export function isCompanionThemeId(value: string): value is CompanionThemeId {
  return value === 'warm' || value === 'system' || value === 'playful'
}

/**
 * Map a stored theme id onto a companion look.
 * Stock and unknown values become warm. A look the user actually picked
 * (warm day, a system tone, editorial, soft, high contrast) keeps the
 * closest of the three looks. Legacy night and black tones keep dark.
 */
export function mapStoredCompanionTheme(themeId: unknown, colorScheme: unknown): {
  themeId: CompanionThemeId
  colorScheme: ThemeColorScheme
} {
  const explicitScheme = colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : null
  switch (themeId) {
    case 'warm':
    case 'system':
    case 'playful':
      return { themeId, colorScheme: explicitScheme ?? 'light' }
    case 'warm-day':
    case 'soft':
      return { themeId: 'warm', colorScheme: 'light' }
    case 'editorial':
      return { themeId: 'playful', colorScheme: 'light' }
    case 'system-day':
    case 'high-contrast':
      return { themeId: 'system', colorScheme: 'light' }
    case 'system-dark':
    case 'system-black':
      return { themeId: 'system', colorScheme: 'dark' }
    default:
      return { themeId: 'warm', colorScheme: explicitScheme ?? 'light' }
  }
}

/** Palette for a look and scheme. Unknown ids fall back to warm light. */
export function getCompanionAppearance(themeId: unknown, colorScheme: unknown): CompanionAppearance {
  const mapped = mapStoredCompanionTheme(themeId, colorScheme)
  return APPEARANCES[mapped.themeId][mapped.colorScheme]
}

/** Theme definition whose tokens match the active scheme, for the CSS writer. */
export function toCompanionThemeDefinition(appearance: CompanionAppearance): ThemeDefinition {
  return {
    id: appearance.themeId,
    name: appearance.themeId,
    description: appearance.themeId,
    tokens: appearance.tokens,
  }
}

function channelByte(hex: string, index: number): number {
  return Number.parseInt(hex.slice(index, index + 2), 16)
}

/** sRGB relative luminance for a #RRGGBB color. */
export function relativeLuminance(color: string): number {
  const hex = color.replace('#', '')
  const bytes = hex.length === 3
    ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
    : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
  const linear = bytes.map((part) => {
    const value = channelByte(part, 0) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** WCAG contrast ratio. Both colors must be hex. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

/** Body, button, bubble, and card pairs that must stay at WCAG AA. */
export function companionTextPairs(appearance: CompanionAppearance): Array<[string, string]> {
  return [
    [appearance.tokens.textPrimary, appearance.tokens.surface],
    [appearance.tokens.textPrimary, appearance.tokens.surfaceElevated],
    [appearance.tokens.textMuted, appearance.tokens.surface],
    [appearance.tokens.textMuted, appearance.tokens.surfaceElevated],
    [appearance.onAccent, appearance.tokens.accent],
    [appearance.bubbleUserInk, appearance.bubbleUser],
    [appearance.bubbleAssistantInk, appearance.bubbleAssistant],
    [appearance.cardFg, appearance.cardBg],
    [appearance.cardMuted, appearance.cardBg],
    [appearance.posterInk, appearance.posterSoul],
    [appearance.posterInk, appearance.posterMemory],
  ]
}
