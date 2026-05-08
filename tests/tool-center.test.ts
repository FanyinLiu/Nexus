import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  resolveWebSearchProviderUpdate,
  resolveWebSearchProviderView,
} from '../src/features/tools/toolCenter.ts'

test('web search provider view resolves current provider and all choices', () => {
  const view = resolveWebSearchProviderView({
    toolWebSearchProviderId: 'duckduckgo',
  })

  assert.equal(view.provider.id, 'duckduckgo')
  assert.equal(view.providers.some((provider) => provider.id === 'brave'), true)
})

test('web search provider update keeps key on same provider and clears it when switching', () => {
  assert.deepEqual(
    resolveWebSearchProviderUpdate({
      toolWebSearchProviderId: 'brave',
      toolWebSearchApiBaseUrl: 'https://proxy.example.test/search',
      toolWebSearchApiKey: 'keep-me',
    }, 'brave'),
    {
      toolWebSearchProviderId: 'brave',
      toolWebSearchApiBaseUrl: 'https://proxy.example.test/search',
      toolWebSearchApiKey: 'keep-me',
    },
  )

  assert.deepEqual(
    resolveWebSearchProviderUpdate({
      toolWebSearchProviderId: 'brave',
      toolWebSearchApiBaseUrl: 'https://proxy.example.test/search',
      toolWebSearchApiKey: 'clear-me',
    }, 'duckduckgo'),
    {
      toolWebSearchProviderId: 'duckduckgo',
      toolWebSearchApiBaseUrl: '',
      toolWebSearchApiKey: '',
    },
  )
})
