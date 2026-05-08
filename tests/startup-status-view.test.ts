import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isDevPreviewOrigin,
  isPackagedOrigin,
  resolveStartupStatusSummary,
} from '../src/features/onboarding/startupStatusView.ts'
import { PET_MODEL_PRESETS } from '../src/features/pet/models.ts'
import type { AppSettings } from '../src/types/app.ts'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiKey: '',
    apiProviderId: 'ollama',
    continuousVoiceModeEnabled: false,
    model: 'qwen3:8b',
    speechInputEnabled: false,
    speechOutputEnabled: false,
    ...overrides,
  } as AppSettings
}

test('startup status identifies Nexus preview and packaged origins', () => {
  assert.equal(isDevPreviewOrigin('http://127.0.0.1:47821'), true)
  assert.equal(isDevPreviewOrigin('http://127.0.0.1:11434'), false)
  assert.equal(isPackagedOrigin('app://nexus/index.html'), true)
  assert.equal(isPackagedOrigin('https://example.com'), false)
})

test('startup status warns when the user opens the Ollama API URL', () => {
  const summary = resolveStartupStatusSummary({
    bridgeReady: false,
    origin: 'http://127.0.0.1:11434',
    petModel: PET_MODEL_PRESETS[0],
    settings: makeSettings(),
  })

  assert.equal(summary.items[0]?.id, 'preview')
  assert.equal(summary.items[0]?.status, 'warning')
  assert.equal(summary.items[0]?.detailKey, 'settings.startup_status.preview.ollama_api_warning')
})

test('startup status reports the common text path and bridge state separately', () => {
  const summary = resolveStartupStatusSummary({
    bridgeReady: true,
    origin: 'http://127.0.0.1:47821',
    petModel: PET_MODEL_PRESETS[0],
    settings: makeSettings(),
  })

  assert.equal(summary.warningCount, 0)
  assert.equal(summary.items.find((item) => item.id === 'bridge')?.status, 'ok')
  assert.equal(summary.items.find((item) => item.id === 'model')?.detailKey, 'settings.startup_status.model.ready')
})

test('startup status flags DeepSeek without an API key', () => {
  const summary = resolveStartupStatusSummary({
    bridgeReady: true,
    origin: 'http://127.0.0.1:47821',
    petModel: PET_MODEL_PRESETS[0],
    settings: makeSettings({
      apiProviderId: 'deepseek',
      model: 'deepseek-v4-flash',
    }),
  })

  const modelItem = summary.items.find((item) => item.id === 'model')
  assert.equal(modelItem?.status, 'warning')
  assert.equal(modelItem?.detailKey, 'settings.startup_status.model.deepseek_missing_key')
})
