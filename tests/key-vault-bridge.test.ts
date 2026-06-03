import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadSettings } from '../src/lib/storage.ts'
import {
  displaySecretInputValue,
  isVaultRefString,
  migrateKeysToVault,
} from '../src/lib/keyVaultBridge.ts'

type LocalStorageMock = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createLocalStorageMock(initial: Record<string, string> = {}): LocalStorageMock {
  const store = new Map(Object.entries(initial))

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) ?? null : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: createLocalStorageMock(),
    },
    configurable: true,
    writable: true,
  })
})

test('isVaultRefString identifies vault refs', () => {
  assert.equal(isVaultRefString('nexus-vault-ref:abc123'), true)
  assert.equal(isVaultRefString('sk-test-123'), false)
  assert.equal(isVaultRefString(''), false)
})

test('displaySecretInputValue hides vault ref tokens in input fields', () => {
  assert.equal(displaySecretInputValue('nexus-vault-ref:opaque-token'), '')
  assert.equal(displaySecretInputValue('plain-api-key'), 'plain-api-key')
  assert.equal(displaySecretInputValue(undefined), '')
})

test('migrateKeysToVault skips existing vault refs when backfilling secrets', async () => {
  let storedVaultEntries: Record<string, string> | null = null
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: createLocalStorageMock(),
      desktopPet: {
        vaultStore: async () => {},
        vaultStoreMany: async (entries: Record<string, string>) => {
          storedVaultEntries = entries
        },
      },
    },
    configurable: true,
    writable: true,
  })

  const base = loadSettings()
  const migrated = await migrateKeysToVault({
    ...base,
    apiKey: 'nexus-vault-ref:already-stored',
    speechInputApiKey: 'speech-input-secret',
    screenVlmApiKey: 'vlm-secret',
    toolWebSearchApiKey: 'nexus-vault-ref:web-search',
  })

  assert.deepEqual(storedVaultEntries, {
    'settings:speechInputApiKey': 'speech-input-secret',
    'settings:screenVlmApiKey': 'vlm-secret',
  })
  assert.equal(migrated.apiKey, '')
  assert.equal(migrated.speechInputApiKey, '')
  assert.equal(migrated.screenVlmApiKey, '')
  assert.equal(migrated.toolWebSearchApiKey, '')
})
