import assert from 'node:assert/strict'
import test from 'node:test'
import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from '../src/lib/settingsMigrations.ts'

test('schema 25 adds the backchannel switch off for older stores', () => {
  assert.equal(CURRENT_SETTINGS_SCHEMA_VERSION, 25)

  const next = migrateSettings({
    settingsSchemaVersion: 24,
    voiceInterruptionEnabled: true,
    model: 'qwen3:8b',
  }, 24)

  assert.equal(next.settingsSchemaVersion, 25)
  assert.equal(next.voiceBackchannelEnabled, false)
  assert.equal(next.voiceInterruptionEnabled, true)
  assert.equal(next.model, 'qwen3:8b')
})

test('schema 25 keeps an explicit backchannel choice and repairs junk', () => {
  const enabled = migrateSettings({
    settingsSchemaVersion: 24,
    voiceBackchannelEnabled: true,
  }, 24)
  assert.equal(enabled.voiceBackchannelEnabled, true)

  const repaired = migrateSettings({
    settingsSchemaVersion: 24,
    voiceBackchannelEnabled: 'yes',
  }, 24)
  assert.equal(repaired.voiceBackchannelEnabled, false)
})
