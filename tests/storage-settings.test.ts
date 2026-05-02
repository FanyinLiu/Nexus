import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadSettings, SETTINGS_STORAGE_KEY } from '../src/lib/storage.ts'
import { commitSettingsUpdate } from '../src/app/store/commitSettingsUpdate.ts'

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

test('preserves volcengine-tts selection without migration', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      speechOutputProviderId: 'volcengine-tts',
      speechOutputApiBaseUrl: 'https://openspeech.bytedance.com/api',
      speechOutputApiKey: '1000:test-token',
      speechOutputModel: 'volcano_tts',
      speechOutputVoice: 'BV001_streaming',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.speechOutputProviderId, 'volcengine-tts')
  assert.equal(settings.speechOutputApiBaseUrl, 'https://openspeech.bytedance.com/api')
  assert.equal(settings.speechOutputApiKey, '1000:test-token')
  assert.equal(settings.speechOutputModel, 'volcano_tts')
  assert.equal(settings.speechOutputVoice, 'BV001_streaming')
})

test('preserves an explicit local sensevoice speech input selection on load', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      speechInputProviderId: 'local-sensevoice',
      speechInputApiBaseUrl: 'http://should-not-stick.example.com',
      speechInputApiKey: 'legacy-secret',
      speechInputModel: 'sensevoice-zh-en',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.speechInputProviderId, 'local-sensevoice')
  assert.equal(settings.speechInputApiBaseUrl, '')
  assert.equal(settings.speechInputApiKey, '')
  assert.equal(settings.speechInputModel, 'sensevoice-zh-en')
})

test('preserves the editorial theme selection on load', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      themeId: 'editorial',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.themeId, 'editorial')
})

test('commitSettingsUpdate persists settings changes and applies them in memory', async () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      continuousVoiceModeEnabled: false,
    }),
  })

  let appliedSettings = null as Awaited<ReturnType<typeof loadSettings>> | null

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
    },
    configurable: true,
    writable: true,
  })

  commitSettingsUpdate(
    (current) => ({
      ...current,
      continuousVoiceModeEnabled: true,
    }),
    (nextSettings) => {
      appliedSettings = nextSettings
    },
  )

  await Promise.resolve()

  assert.equal(appliedSettings?.continuousVoiceModeEnabled, true)
  assert.equal(
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').continuousVoiceModeEnabled,
    true,
  )
})

test('commitSettingsUpdate stores secret settings in vault and persists stripped settings', async () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      speechOutputApiKey: '',
    }),
  })

  let appliedSettings = null as Awaited<ReturnType<typeof loadSettings>> | null
  let storedVaultEntries: Record<string, string> | null = null

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      desktopPet: {
        vaultStore: async () => {},
        vaultStoreMany: async (entries: Record<string, string>) => {
          storedVaultEntries = entries
        },
        vaultRetrieveMany: async () => ({}),
      },
    },
    configurable: true,
    writable: true,
  })

  await commitSettingsUpdate(
    (current) => ({
      ...current,
      speechOutputApiKey: 'tts-secret',
    }),
    (nextSettings) => {
      appliedSettings = nextSettings
    },
  )

  assert.deepEqual(storedVaultEntries, {
    'settings:speechOutputApiKey': 'tts-secret',
  })
  assert.equal(appliedSettings?.speechOutputApiKey, 'tts-secret')
  assert.equal(
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').speechOutputApiKey,
    '',
  )
})

test('commitSettingsUpdate does not re-store vault refs as plaintext secrets', async () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      speechOutputApiKey: '',
    }),
  })

  let storedVaultEntries: Record<string, string> | null = null

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      desktopPet: {
        vaultStore: async () => {},
        vaultStoreMany: async (entries: Record<string, string>) => {
          storedVaultEntries = entries
        },
        vaultRetrieveMany: async () => ({}),
      },
    },
    configurable: true,
    writable: true,
  })

  await commitSettingsUpdate(
    (current) => ({
      ...current,
      speechOutputApiKey: 'nexus-vault-ref:already-issued',
    }),
    () => {},
  )

  assert.deepEqual(storedVaultEntries, null)
  assert.equal(
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').speechOutputApiKey,
    '',
  )
})
