import assert from 'node:assert/strict'
import test from 'node:test'
import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from '../src/lib/settingsMigrations.ts'

const behaviorKeys = [
  'autonomyEnabled',
  'proactivePresenceEnabled',
  'proactivePresenceIntervalMinutes',
  'proactiveAwayNotificationsEnabled',
  'proactiveBracketEnabled',
  'proactiveLetterEnabled',
  'proactiveAgendaEnabled',
  'autonomyQuietHoursStart',
  'autonomyQuietHoursEnd',
  'proactiveQuietHoursStart',
  'proactiveQuietHoursEnd',
  'toolWebSearchEnabled',
  'toolWeatherEnabled',
  'speechRecognitionLang',
  'speechSynthesisLang',
  'themeId',
  'themeColorScheme',
] as const

test('schema 15 migrates to the current schema and records quiet without rewriting stored switches', () => {
  const stored = {
    settingsSchemaVersion: 15,
    themeId: 'warm-day',
    autonomyEnabled: false,
    proactivePresenceEnabled: false,
    proactivePresenceIntervalMinutes: 25,
    proactiveAwayNotificationsEnabled: false,
    proactiveBracketEnabled: false,
    proactiveLetterEnabled: false,
    autonomyQuietHoursStart: 22,
    autonomyQuietHoursEnd: 6,
    proactiveQuietHoursStart: 21,
    proactiveQuietHoursEnd: 9,
    speechRecognitionLang: 'ja-JP',
    speechSynthesisLang: 'en-US',
    toolWebSearchEnabled: true,
    toolWeatherEnabled: false,
  }
  const next = migrateSettings(stored, 15)
  assert.equal(next.settingsSchemaVersion, CURRENT_SETTINGS_SCHEMA_VERSION)
  assert.equal(CURRENT_SETTINGS_SCHEMA_VERSION, 22)
  assert.equal(next.companionInitiative, 'quiet')
  assert.equal(next.themeId, 'warm')
  assert.equal(next.autonomyQuietHoursEnd, 6)
  assert.equal(next.proactiveQuietHoursEnd, 9)
  assert.equal(next.speechRecognitionLang, 'ja-JP')
  assert.equal(next.toolWebSearchEnabled, true)
  assert.equal(next.toolWeatherEnabled, false)
  assert.equal(next.proactiveLetterEnabled, false)
})

test('schema 15 with a custom pace stays custom and keeps the interval', () => {
  const stored = {
    settingsSchemaVersion: 15,
    themeId: 'editorial',
    autonomyEnabled: false,
    proactivePresenceEnabled: true,
    proactivePresenceIntervalMinutes: 10,
    proactiveAwayNotificationsEnabled: false,
    proactiveBracketEnabled: false,
    proactiveLetterEnabled: false,
  }
  const next = migrateSettings(stored, 15)
  assert.equal(next.companionInitiative, 'custom')
  assert.equal(next.proactivePresenceIntervalMinutes, 10)
  assert.equal(next.themeId, 'playful')
  assert.equal(next.autonomyEnabled, false)
})

test('schema 20 with the autonomy tick on stays custom and does not clear that tick', () => {
  const stored = {
    settingsSchemaVersion: 20,
    themeId: 'system',
    themeColorScheme: 'dark',
    autonomyEnabled: true,
    proactivePresenceEnabled: true,
    proactivePresenceIntervalMinutes: 10,
    proactiveAwayNotificationsEnabled: true,
    proactiveBracketEnabled: true,
    proactiveLetterEnabled: true,
    proactiveAgendaEnabled: false,
  }
  const before = Object.fromEntries(behaviorKeys.map((key) => [key, stored[key as keyof typeof stored]]))
  const next = migrateSettings(stored, 20)
  assert.equal(next.settingsSchemaVersion, CURRENT_SETTINGS_SCHEMA_VERSION)
  assert.equal(next.companionInitiative, 'custom')
  assert.equal(next.themeId, 'system')
  assert.equal(next.themeColorScheme, 'dark')
  assert.equal(next.autonomyEnabled, true)
  assert.equal(next.proactiveBracketEnabled, true)
  assert.equal(next.proactiveAgendaEnabled, false)
  for (const key of behaviorKeys) {
    if (stored[key as keyof typeof stored] === undefined) continue
    assert.equal(next[key], before[key], key)
  }
})

test('schema 20 often shape that already had the tick stays often and keeps it', () => {
  const stored = {
    settingsSchemaVersion: 20,
    autonomyEnabled: true,
    proactivePresenceEnabled: true,
    proactivePresenceIntervalMinutes: 15,
    proactiveAwayNotificationsEnabled: true,
    proactiveLetterEnabled: true,
    proactiveFrequency: 'normal',
  }
  const next = migrateSettings(stored, 20)
  assert.equal(next.companionInitiative, 'often')
  assert.equal(next.autonomyEnabled, true)
})

test('schema 20 without the autonomy tick records often and leaves the tick off', () => {
  const stored = {
    settingsSchemaVersion: 20,
    themeId: 'warm',
    themeColorScheme: 'light',
    autonomyEnabled: false,
    proactivePresenceEnabled: true,
    proactivePresenceIntervalMinutes: 15,
    proactiveAwayNotificationsEnabled: true,
    proactiveBracketEnabled: false,
    proactiveLetterEnabled: true,
    proactiveFrequency: 'normal',
    proactiveAgendaEnabled: false,
  }
  const next = migrateSettings(stored, 20)
  assert.equal(next.companionInitiative, 'often')
  assert.equal(next.autonomyEnabled, false)
  assert.equal(next.proactiveFrequency, 'normal')
  assert.equal(next.proactiveAgendaEnabled, false)
})

test('schema 21 is left in place when migrated again', () => {
  const stored = {
    settingsSchemaVersion: 21,
    companionInitiative: 'custom',
    themeId: 'warm',
    themeColorScheme: 'light',
    autonomyEnabled: false,
    proactivePresenceEnabled: false,
    proactiveLetterEnabled: false,
  }
  const next = migrateSettings(stored, 21)
  assert.equal(next.companionInitiative, 'custom')
  assert.equal(next.themeId, 'warm')
})
