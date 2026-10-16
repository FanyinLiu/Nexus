import type { CompanionAppearance } from './companionThemes.ts'
import type { ThemeDefinition, ThemeTokens } from '../../types/theme.ts'

type CssVariableRecord = Record<`--color-${string}`, string>

const TOKEN_TO_VARIABLE: Array<[keyof ThemeTokens, `--color-${string}`]> = [
  ['surface', '--color-surface'],
  ['surfaceMuted', '--color-surface-muted'],
  ['surfaceGlass', '--color-surface-glass'],
  ['surfaceElevated', '--color-surface-elevated'],
  ['textPrimary', '--color-text-primary'],
  ['textMuted', '--color-text-muted'],
  ['textSoft', '--color-text-soft'],
  ['accent', '--color-accent'],
  ['accentSoft', '--color-accent-soft'],
  ['accentHover', '--color-accent-hover'],
  ['border', '--color-border'],
  ['borderStrong', '--color-border-strong'],
  ['shadow', '--color-shadow'],
  ['shadowAccent', '--color-shadow-accent'],
]

export function toCssVariables(theme: ThemeDefinition): CssVariableRecord {
  const result = {} as CssVariableRecord
  for (const [tokenKey, cssVariable] of TOKEN_TO_VARIABLE) {
    result[cssVariable] = theme.tokens[tokenKey]
  }
  return result
}

export function applyThemeVariables(
  theme: ThemeDefinition,
  target: HTMLElement = document.documentElement,
) {
  const variables = toCssVariables(theme)
  for (const [name, value] of Object.entries(variables)) {
    target.style.setProperty(name, value)
  }
}

/**
 * Writes the companion token layer. Component CSS reads these names
 * and does not keep its own palette.
 */
export function applyCompanionVariables(
  appearance: CompanionAppearance,
  target: HTMLElement = document.documentElement,
) {
  const { metrics } = appearance
  const variables: Record<string, string> = {
    '--color-on-accent': appearance.onAccent,
    '--color-danger': appearance.danger,
    '--color-success': appearance.success,
    '--color-warning': appearance.warning,
    '--nx-bubble-user': appearance.bubbleUser,
    '--nx-bubble-user-ink': appearance.bubbleUserInk,
    '--nx-bubble-assistant': appearance.bubbleAssistant,
    '--nx-bubble-assistant-ink': appearance.bubbleAssistantInk,
    '--nx-poster-soul': appearance.posterSoul,
    '--nx-poster-memory': appearance.posterMemory,
    '--nx-poster-ink': appearance.posterInk,
    '--nx-card-bg': appearance.cardBg,
    '--nx-card-fg': appearance.cardFg,
    '--nx-card-muted': appearance.cardMuted,
    '--nx-card-border': appearance.cardBorder,
    '--nx-card-radius': metrics.radiusCard,
    '--nx-card-shadow': metrics.shadowCard,
    '--nx-radius-window': metrics.radiusWindow,
    '--nx-radius-card': metrics.radiusCard,
    '--nx-radius-control': metrics.radiusControl,
    '--nx-shadow-card': metrics.shadowCard,
    '--nx-space-page': metrics.spacePage,
    '--nx-space-stack': metrics.spaceStack,
    '--nx-type-title': metrics.typeTitle,
    '--nx-type-body': metrics.typeBody,
    '--nx-type-meta': metrics.typeMeta,
    '--nx-font-weight': metrics.fontWeight,
    '--nx-font-family': metrics.fontFamily,
    '--nx-motion': metrics.motion,
    '--nx-blob-pink': appearance.blobPink,
    '--nx-blob-blue': appearance.blobBlue,
    '--nx-blob-yellow': appearance.blobYellow,
    '--nx-color-scheme': appearance.colorScheme,
    '--nx-scrim': appearance.colorScheme === 'dark'
      ? 'color-mix(in srgb, var(--color-surface) 28%, black)'
      : 'color-mix(in srgb, var(--color-text-primary) 70%, var(--color-surface))',
  }
  for (const [name, value] of Object.entries(variables)) {
    target.style.setProperty(name, value)
  }
}
