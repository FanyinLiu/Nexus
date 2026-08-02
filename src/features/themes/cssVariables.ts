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
