import assert from 'node:assert/strict'
import test from 'node:test'
import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from '../src/lib/settingsMigrations.ts'

test('schema 22 maps a saved sprite or portrait selection to Live2D Mao', () => {
  const next = migrateSettings({
    settingsSchemaVersion: 21,
    petModelId: 'sprite-cat',
    companionInitiative: 'quiet',
    characterProfiles: [
      { id: 'a', petModelId: 'codex-duck' },
      { id: 'b', petModelId: 'portrait-puppet' },
      { id: 'c', petModelId: 'Qiyi' },
      { id: 'd', petModelId: 'sprite' },
      { id: 'e', petModelId: 'portrait_layered' },
      { id: 'f', petModelId: 'custom-portrait-puppet-pack' },
      { id: 'g', petModelId: 'codex' },
    ],
  }, 21)

  assert.equal(CURRENT_SETTINGS_SCHEMA_VERSION, 23)
  assert.equal(next.settingsSchemaVersion, 23)
  assert.equal(next.petModelId, 'mao')
  assert.equal(next.companionInitiative, 'quiet')
  assert.deepEqual(
    (next.characterProfiles as { petModelId: string }[]).map((profile) => profile.petModelId),
    ['mao', 'mao', 'mao', 'mao', 'mao', 'mao', 'mao'],
  )
})

test('schema 22 leaves built-in and imported Live2D models alone', () => {
  const next = migrateSettings({
    settingsSchemaVersion: 21,
    petModelId: 'haru',
    characterProfiles: [
      { petModelId: 'mao' },
      { petModelId: 'hiyori' },
      { petModelId: 'imported-custom' },
    ],
  }, 21)

  assert.equal(next.petModelId, 'haru')
  assert.deepEqual(
    (next.characterProfiles as { petModelId: string }[]).map((profile) => profile.petModelId),
    ['mao', 'hiyori', 'imported-custom'],
  )
})
