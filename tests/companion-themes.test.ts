import assert from 'node:assert/strict'
import test from 'node:test'

import { applyCompanionVariables, applyThemeVariables } from '../src/features/themes/cssVariables.ts'
import {
  COMPANION_THEME_IDS,
  companionTextPairs,
  contrastRatio,
  getCompanionAppearance,
  mapStoredCompanionTheme,
} from '../src/features/themes/companionThemes.ts'
import { migrateSettings } from '../src/lib/settingsMigrations.ts'

test('companion theme migration maps stock, custom, and unknown values without throwing', () => {
  const stock = migrateSettings({ settingsSchemaVersion: 15, themeId: 'nexus-default' }, 15)
  assert.equal(stock.themeId, 'warm')
  assert.equal(stock.themeColorScheme, 'light')
  assert.equal(stock.settingsSchemaVersion, 20)

  const warmDay = migrateSettings({ settingsSchemaVersion: 15, themeId: 'warm-day' }, 15)
  assert.equal(warmDay.themeId, 'warm')
  assert.equal(warmDay.themeColorScheme, 'light')

  const night = migrateSettings({ settingsSchemaVersion: 15, themeId: 'system-dark' }, 15)
  assert.equal(night.themeId, 'system')
  assert.equal(night.themeColorScheme, 'dark')

  const black = migrateSettings({ settingsSchemaVersion: 15, themeId: 'system-black' }, 15)
  assert.equal(black.themeId, 'system')
  assert.equal(black.themeColorScheme, 'dark')

  const editorial = migrateSettings({ settingsSchemaVersion: 15, themeId: 'editorial' }, 15)
  assert.equal(editorial.themeId, 'playful')

  const reserved = migrateSettings({ settingsSchemaVersion: 16, themeId: 'soft' }, 16)
  assert.equal(reserved.themeId, 'warm')
  assert.equal(reserved.settingsSchemaVersion, 20)

  assert.doesNotThrow(() => mapStoredCompanionTheme('not-a-theme', { bad: true }))
  assert.deepEqual(mapStoredCompanionTheme('not-a-theme', { bad: true }), {
    themeId: 'warm',
    colorScheme: 'light',
  })
  assert.deepEqual(mapStoredCompanionTheme('playful', 'dark'), {
    themeId: 'playful',
    colorScheme: 'dark',
  })
})

test('body text uses one sans stack in every companion look', () => {
  const families = COMPANION_THEME_IDS.map((themeId) => (
    getCompanionAppearance(themeId, 'light').metrics.fontFamily
  ))
  assert.equal(new Set(families).size, 1)
  assert.match(families[0], /PingFang SC/)
  assert.match(families[0], /system-ui/)
  const faces = families[0].split(',').map((face) => face.trim().replaceAll('"', ''))
  assert.ok(faces.every((face) => face === 'sans-serif' || !/serif|Iowan|Palatino|Songti|Avenir/i.test(face)))
})

test('switching companion looks changes tokens for light and dark', () => {
  const warmLight = getCompanionAppearance('warm', 'light')
  const warmDark = getCompanionAppearance('warm', 'dark')
  const systemLight = getCompanionAppearance('system', 'light')
  const playfulDark = getCompanionAppearance('not-a-theme', 'dark')

  assert.notEqual(warmLight.tokens.textPrimary, warmDark.tokens.textPrimary)
  assert.notEqual(warmLight.tokens.surface, systemLight.tokens.surface)
  assert.equal(playfulDark.themeId, 'warm')
  assert.equal(warmLight.metrics.radiusCard, '20px')
  assert.equal(systemLight.metrics.radiusCard, '12px')
  assert.equal(getCompanionAppearance('playful', 'light').metrics.radiusCard, '22px')

  for (const themeId of COMPANION_THEME_IDS) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const appearance = getCompanionAppearance(themeId, colorScheme)
      for (const [foreground, background] of companionTextPairs(appearance)) {
        const ratio = contrastRatio(foreground, background)
        assert.ok(
          ratio >= 4.5,
          `${themeId} ${colorScheme} ${foreground} on ${background} is ${ratio.toFixed(2)}`,
        )
      }
    }
  }
})

test('applyCompanionVariables writes the card and scheme tokens', () => {
  const writes = new Map<string, string>()
  const target = {
    style: {
      setProperty(name: string, value: string) {
        writes.set(name, value)
      },
    },
  } as HTMLElement
  const appearance = getCompanionAppearance('system', 'dark')
  applyThemeVariables({
    id: 'system',
    name: 'system',
    description: 'system',
    tokens: appearance.tokens,
  }, target)
  applyCompanionVariables(appearance, target)

  assert.equal(writes.get('--color-text-primary'), appearance.tokens.textPrimary)
  assert.equal(writes.get('--nx-card-bg'), appearance.cardBg)
  assert.equal(writes.get('--nx-card-radius'), appearance.metrics.radiusCard)
  assert.equal(writes.get('--nx-poster-soul'), appearance.posterSoul)
  assert.equal(writes.get('--nx-color-scheme'), 'dark')
  assert.match(String(writes.get('--nx-scrim')), /color-mix\(in srgb, var\(--color-surface\)/)
  assert.notEqual(writes.get('--color-surface'), getCompanionAppearance('system', 'light').tokens.surface)
})
