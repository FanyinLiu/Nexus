import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyConnectionTestRepairDraft,
  buildConnectionTestRepairAction,
} from '../src/features/models/connectionRepair.ts'
import type { AppSettings } from '../src/types/app.ts'

const baseSettings = {
  apiProviderId: 'deepseek',
  apiBaseUrl: 'https://wrong.example/v1',
  apiKey: 'secret-key',
  model: 'not-a-real-model',
  uiLanguage: 'en-US',
} as AppSettings

test('preflight repairs only patch endpoint/model and preserve API key', () => {
  const action = buildConnectionTestRepairAction({
    ok: false,
    status: 'misconfigured',
    repair: {
      apiBaseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    },
  }, baseSettings)

  assert.equal(typeof action?.label, 'string')
  assert.ok(action?.label)
  assert.deepEqual(action?.patch, {
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  })

  const repaired = applyConnectionTestRepairDraft(baseSettings, action!)
  assert.equal(repaired.apiKey, 'secret-key')
  assert.equal(repaired.apiBaseUrl, 'https://api.deepseek.com')
  assert.equal(repaired.model, 'deepseek-v4-flash')
})

test('DeepSeek post-test model mismatch can repair to the recommended default model', () => {
  const action = buildConnectionTestRepairAction({
    ok: false,
    status: 'model_missing',
  }, {
    ...baseSettings,
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'not-a-real-model',
  })

  assert.deepEqual(action?.patch, {
    model: 'deepseek-v4-flash',
  })
})

test('DeepSeek post-test misconfiguration repairs both endpoint and model when both are suspect', () => {
  const action = buildConnectionTestRepairAction({
    ok: false,
    status: 'misconfigured',
  }, baseSettings)

  assert.deepEqual(action?.patch, {
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  })
})

test('Ollama model_missing with discovered models switches to an installed local model', () => {
  const action = buildConnectionTestRepairAction({
    ok: false,
    status: 'model_missing',
    discoveredModels: [
      {
        id: 'llama3.2:3b',
        label: 'llama3.2:3b',
        providerId: 'ollama',
        source: 'ollama',
        capabilities: {
          runLocation: 'local',
          supportsTools: true,
          supportsVision: false,
          supportsSpeech: false,
          contextWindowTokens: null,
          requiresApiKey: false,
        },
      },
    ],
  }, {
    ...baseSettings,
    apiProviderId: 'ollama',
    apiBaseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: 'qwen3:8b',
  })

  assert.deepEqual(action?.patch, {
    model: 'llama3.2:3b',
  })
})

test('API key and custom-provider failures stay manual', () => {
  assert.equal(buildConnectionTestRepairAction({
    ok: false,
    status: 'needs_key',
  }, baseSettings), null)

  assert.equal(buildConnectionTestRepairAction({
    ok: false,
    status: 'model_missing',
  }, {
    ...baseSettings,
    apiProviderId: 'custom',
    apiBaseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
  }), null)
})
