import assert from 'node:assert/strict'
import test from 'node:test'
import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from '../src/lib/settingsMigrations.ts'

test('schema 24 drops the unused agent iteration cap and persona chat flag', () => {
  assert.equal(CURRENT_SETTINGS_SCHEMA_VERSION, 24)
  const next = migrateSettings({
    settingsSchemaVersion: 23,
    agentMaxIterations: 12,
    profilePersonaInChatEnabled: false,
    companionInitiative: 'often',
    model: 'qwen3:8b',
  }, 23)

  assert.equal(next.settingsSchemaVersion, 24)
  assert.equal('agentMaxIterations' in next, false)
  assert.equal('profilePersonaInChatEnabled' in next, false)
  assert.equal(next.companionInitiative, 'often')
  assert.equal(next.model, 'qwen3:8b')
})

test('schema 24 keeps unrelated settings when earlier migrations also run', () => {
  const next = migrateSettings({
    settingsSchemaVersion: 22,
    agentMaxIterations: 4,
    profilePersonaInChatEnabled: true,
    memoryEmbeddingModel: 'local-hash-v1',
  }, 22)

  assert.equal(next.settingsSchemaVersion, 24)
  assert.equal(next.memoryEmbeddingModel, 'auto')
  assert.equal('agentMaxIterations' in next, false)
  assert.equal('profilePersonaInChatEnabled' in next, false)
})
