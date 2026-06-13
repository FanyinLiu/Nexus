import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveWebSearchApiKey } from '../src/lib/webSearchProviders.ts'

function settings(overrides: Record<string, unknown> = {}) {
  return {
    toolWebSearchProviderId: 'bing',
    toolWebSearchApiKey: '',
    textProviderProfiles: {},
    ...overrides,
  } as never
}

test('resolveWebSearchApiKey prefers the explicit search key when set', () => {
  assert.equal(
    resolveWebSearchApiKey(settings({ toolWebSearchProviderId: 'minimax', toolWebSearchApiKey: 'direct-key', textProviderProfiles: { minimax: { apiKey: 'model-key', apiBaseUrl: '', model: '' } } })),
    'direct-key',
  )
})

test('resolveWebSearchApiKey reuses the MiniMax model key when the search key is blank', () => {
  assert.equal(
    resolveWebSearchApiKey(settings({ toolWebSearchProviderId: 'minimax', textProviderProfiles: { minimax: { apiKey: 'token-plan-key', apiBaseUrl: '', model: '' } } })),
    'token-plan-key',
  )
})

test('resolveWebSearchApiKey does not borrow the MiniMax key for other providers', () => {
  assert.equal(
    resolveWebSearchApiKey(settings({ toolWebSearchProviderId: 'bing', textProviderProfiles: { minimax: { apiKey: 'token-plan-key', apiBaseUrl: '', model: '' } } })),
    '',
  )
})

test('resolveWebSearchApiKey returns empty when MiniMax is selected but unconfigured', () => {
  assert.equal(resolveWebSearchApiKey(settings({ toolWebSearchProviderId: 'minimax' })), '')
})
