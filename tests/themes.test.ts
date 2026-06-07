import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getSettingsThemeTone,
  SETTINGS_APPEARANCE_OPTIONS,
} from '../src/components/settingsDrawerSupport.ts'
import { applyThemeVariables, toCssVariables } from '../src/features/themes/cssVariables.ts'
import { getTheme, listThemes, resolveTheme } from '../src/features/themes/registry.ts'
import type { ThemeId } from '../src/types/theme.ts'

test('theme registry exposes unique ids and resolves unknown ids to the Nexus default', () => {
  const themes = listThemes()
  const ids = themes.map((theme) => theme.id)

  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('nexus-default'))
  assert.ok(ids.includes('system-dark'))
  assert.equal(getTheme('system-day')?.id, 'system-day')
  assert.equal(getTheme('missing' as ThemeId), null)
  assert.equal(resolveTheme('missing' as ThemeId).id, 'nexus-default')
})

test('theme registry returns defensive copies so callers cannot mutate global theme tokens', () => {
  const listed = listThemes()
  const originalCount = listed.length
  const originalSurface = resolveTheme('nexus-default').tokens.surface

  listed.push(resolveTheme('system-dark'))
  listed[0].tokens.surface = '#ff00ff'
  resolveTheme('nexus-default').tokens.accent = '#00ff00'

  assert.equal(listThemes().length, originalCount)
  assert.equal(resolveTheme('nexus-default').tokens.surface, originalSurface)
  assert.notEqual(resolveTheme('nexus-default').tokens.accent, '#00ff00')
})

test('settings appearance options expose only the effective drawer theme modes', () => {
  const optionThemeIds = SETTINGS_APPEARANCE_OPTIONS.map((option) => option.id)

  assert.deepEqual(optionThemeIds, ['system-dark', 'system-day', 'warm-day'])
  assert.deepEqual(SETTINGS_APPEARANCE_OPTIONS.map((option) => option.tone), ['night', 'day', 'warm-day'])
  assert.deepEqual(SETTINGS_APPEARANCE_OPTIONS.map((option) => option.labelKey), [
    'settings.appearance.night',
    'settings.appearance.day',
    'settings.appearance.warm_day',
  ])
  assert.equal(getSettingsThemeTone('editorial'), 'day')
  assert.equal(getSettingsThemeTone('nexus-default'), 'day')
  assert.equal(getSettingsThemeTone('soft'), 'day')
  assert.equal(getSettingsThemeTone('high-contrast'), 'day')
  assert.equal(getSettingsThemeTone('warm-day'), 'warm-day')
  assert.equal(getSettingsThemeTone('system-dark'), 'night')
})

test('toCssVariables maps every theme token to the expected CSS variable', () => {
  const theme = resolveTheme('nexus-default')
  const variables = toCssVariables(theme)

  assert.equal(variables['--color-surface'], theme.tokens.surface)
  assert.equal(variables['--color-surface-muted'], theme.tokens.surfaceMuted)
  assert.equal(variables['--color-surface-glass'], theme.tokens.surfaceGlass)
  assert.equal(variables['--color-surface-elevated'], theme.tokens.surfaceElevated)
  assert.equal(variables['--color-text-primary'], theme.tokens.textPrimary)
  assert.equal(variables['--color-text-muted'], theme.tokens.textMuted)
  assert.equal(variables['--color-text-soft'], theme.tokens.textSoft)
  assert.equal(variables['--color-accent'], theme.tokens.accent)
  assert.equal(variables['--color-accent-soft'], theme.tokens.accentSoft)
  assert.equal(variables['--color-accent-hover'], theme.tokens.accentHover)
  assert.equal(variables['--color-border'], theme.tokens.border)
  assert.equal(variables['--color-border-strong'], theme.tokens.borderStrong)
  assert.equal(variables['--color-shadow'], theme.tokens.shadow)
  assert.equal(variables['--color-shadow-accent'], theme.tokens.shadowAccent)
})

test('applyThemeVariables writes resolved variables to the target style', () => {
  const writes = new Map<string, string>()
  const target = {
    style: {
      setProperty(name: string, value: string) {
        writes.set(name, value)
      },
    },
  } as HTMLElement

  const theme = resolveTheme('system-dark')
  applyThemeVariables(theme, target)

  assert.equal(writes.get('--color-surface'), theme.tokens.surface)
  assert.equal(writes.get('--color-accent'), theme.tokens.accent)
  assert.equal(writes.size, Object.keys(toCssVariables(theme)).length)
})
