import test from 'node:test'
import assert from 'node:assert/strict'

import {
  countModelCatalogEntries,
  createProviderDiscoveryErrorResult,
  getApiProviderPreset,
  getModelCatalogProviders,
  getProviderCredentialStatusClass,
  resolveActiveCatalogModelId,
  resolveActiveCatalogProvider,
  resolveActiveModelCapability,
  resolveProviderCredentialStatus,
  resolveProviderConnectionRequest,
  resolveProviderModelEntries,
} from '../src/features/models/index.ts'
import type {
  DiscoveredModel,
  ModelConnectionSettings,
} from '../src/features/models/index.ts'

const baseConnectionSettings: ModelConnectionSettings = {
  apiProviderId: 'deepseek',
  apiBaseUrl: 'https://api.deepseek.com',
  apiKey: 'current-key',
  model: 'deepseek-v4-flash',
  textProviderProfiles: {
    ollama: {
      apiBaseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'llama3.2:latest',
    },
    openai: {
      apiBaseUrl: 'https://proxy.example.test/v1',
      apiKey: 'stored-key',
      model: 'gpt-5.4-mini',
    },
  },
}

test('resolveProviderConnectionRequest uses the active draft for the selected provider', () => {
  const request = resolveProviderConnectionRequest(
    getApiProviderPreset('deepseek'),
    baseConnectionSettings,
  )

  assert.deepEqual(request, {
    providerId: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'current-key',
    model: 'deepseek-v4-flash',
  })
})

test('resolveProviderConnectionRequest normalizes active draft values before IPC', () => {
  const request = resolveProviderConnectionRequest(
    getApiProviderPreset('deepseek'),
    {
      ...baseConnectionSettings,
      apiProviderId: 'deepseek',
      apiBaseUrl: '   ',
      apiKey: '  current-key  ',
      model: '   ',
    },
  )

  assert.deepEqual(request, {
    providerId: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'current-key',
    model: 'deepseek-v4-flash',
  })
})

test('resolveProviderConnectionRequest uses stored profiles for inactive providers', () => {
  const request = resolveProviderConnectionRequest(
    getApiProviderPreset('openai'),
    baseConnectionSettings,
  )

  assert.deepEqual(request, {
    providerId: 'openai',
    baseUrl: 'https://proxy.example.test/v1',
    apiKey: 'stored-key',
    model: 'gpt-5.4-mini',
  })
})

test('resolveProviderConnectionRequest normalizes stored provider profiles', () => {
  const request = resolveProviderConnectionRequest(
    getApiProviderPreset('openai'),
    {
      ...baseConnectionSettings,
      textProviderProfiles: {
        openai: {
          apiBaseUrl: '  https://proxy.example.test/v1/  ',
          apiKey: '  stored-key  ',
          model: '   ',
        },
      },
    },
  )

  assert.deepEqual(request, {
    providerId: 'openai',
    baseUrl: 'https://proxy.example.test/v1/',
    apiKey: 'stored-key',
    model: 'gpt-5.5',
  })
})

test('resolveProviderConnectionRequest falls back to provider defaults without a stored profile', () => {
  const request = resolveProviderConnectionRequest(
    getApiProviderPreset('anthropic'),
    baseConnectionSettings,
  )

  assert.equal(request.providerId, 'anthropic')
  assert.equal(request.baseUrl, 'https://api.anthropic.com')
  assert.equal(request.apiKey, '')
  assert.equal(request.model, 'claude-sonnet-4-6')
})

test('resolveProviderCredentialStatus classifies current, available and missing-key providers', () => {
  assert.equal(
    resolveProviderCredentialStatus(
      getApiProviderPreset('deepseek'),
      baseConnectionSettings,
    ),
    'current',
  )
  assert.equal(
    resolveProviderCredentialStatus(
      getApiProviderPreset('anthropic'),
      {
        ...baseConnectionSettings,
        apiProviderId: 'anthropic',
        apiKey: '',
        model: 'claude-sonnet-4-6',
      },
    ),
    'current_needs_key',
  )
  assert.equal(
    resolveProviderCredentialStatus(
      getApiProviderPreset('openai'),
      baseConnectionSettings,
    ),
    'available',
  )
  assert.equal(
    resolveProviderCredentialStatus(
      getApiProviderPreset('anthropic'),
      baseConnectionSettings,
    ),
    'needs_key',
  )
  assert.equal(
    resolveProviderCredentialStatus(
      getApiProviderPreset('anthropic'),
      baseConnectionSettings,
      true,
    ),
    'available',
  )
})

test('getProviderCredentialStatusClass maps provider credential states to UI classes', () => {
  assert.equal(getProviderCredentialStatusClass('current'), 'is-current')
  assert.equal(getProviderCredentialStatusClass('available'), 'is-available')
  assert.equal(getProviderCredentialStatusClass('needs_key'), 'is-missing')
  assert.equal(getProviderCredentialStatusClass('current_needs_key'), 'is-missing')
})

test('model catalog uses discovered models ahead of preset models', () => {
  const ollama = getApiProviderPreset('ollama')
  const discoveredModel: DiscoveredModel = {
    id: 'qwen3:14b',
    label: 'qwen3:14b',
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
  }

  assert.deepEqual(
    resolveProviderModelEntries(ollama, { ollama: [discoveredModel] }),
    [discoveredModel],
  )

  const providers = getModelCatalogProviders('common', 'deepseek', { ollama: [discoveredModel] })
  const catalogOllama = providers.find((provider) => provider.id === 'ollama')

  assert.equal(catalogOllama?.catalogModelEntries[0]?.id, 'qwen3:14b')
  assert.equal(countModelCatalogEntries(providers) > 0, true)
})

test('active catalog helpers prefer tab selection, then current provider, then first provider', () => {
  const providers = getModelCatalogProviders('common', 'deepseek', {})

  assert.equal(
    resolveActiveCatalogProvider(providers, {
      catalogProviderId: 'ollama',
      selectedProviderId: 'deepseek',
    }).id,
    'ollama',
  )
  assert.equal(
    resolveActiveCatalogProvider(providers, {
      catalogProviderId: 'missing',
      selectedProviderId: 'deepseek',
    }).id,
    'deepseek',
  )
})

test('active model helpers keep the selected model for the current provider', () => {
  const providers = getModelCatalogProviders('common', 'deepseek', {})
  const deepseek = resolveActiveCatalogProvider(providers, {
    catalogProviderId: 'deepseek',
    selectedProviderId: 'deepseek',
  })
  const ollama = resolveActiveCatalogProvider(providers, {
    catalogProviderId: 'ollama',
    selectedProviderId: 'deepseek',
  })

  assert.equal(
    resolveActiveCatalogModelId(deepseek, {
      selectedProviderId: 'deepseek',
      selectedModel: 'deepseek-reasoner',
    }),
    'deepseek-reasoner',
  )
  assert.equal(
    resolveActiveCatalogModelId(ollama, {
      selectedProviderId: 'deepseek',
      selectedModel: 'deepseek-reasoner',
    }),
    'qwen3:8b',
  )
})

test('resolveActiveModelCapability falls back to provider capability heuristics', () => {
  const providers = getModelCatalogProviders('common', 'deepseek', {})
  const deepseek = resolveActiveCatalogProvider(providers, {
    catalogProviderId: 'deepseek',
    selectedProviderId: 'deepseek',
  })

  assert.equal(
    resolveActiveModelCapability(deepseek, 'deepseek-v4-pro').contextWindowTokens,
    1_000_000,
  )
})

test('createProviderDiscoveryErrorResult normalizes thrown errors into health state', () => {
  const result = createProviderDiscoveryErrorResult({
    providerId: 'ollama',
    error: new Error('connect ECONNREFUSED 127.0.0.1:11434'),
    recommendation: 'Start Ollama and refresh again.',
    checkedAt: '2026-05-08T00:00:00.000Z',
  })

  assert.deepEqual(result, {
    ok: false,
    providerId: 'ollama',
    status: 'unreachable',
    message: 'connect ECONNREFUSED 127.0.0.1:11434',
    recommendation: 'Start Ollama and refresh again.',
    discoveredModels: [],
    checkedAt: '2026-05-08T00:00:00.000Z',
  })
})
