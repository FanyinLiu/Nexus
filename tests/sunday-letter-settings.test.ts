import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadSettings, SETTINGS_STORAGE_KEY } from '../src/lib/storage.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../src/lib/settingsMigrations.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
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

function store(settings: Record<string, unknown>) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    ...settings,
  }))
}

test('fresh settings have the Sunday letter on by default', () => {
  const settings = loadSettings()

  assert.equal(settings.proactiveLetterEnabled, true)
  assert.equal(settings.proactiveLetterChoice, 'auto')
})

test('an untouched legacy store gets the default-on letter without a schema bump', () => {
  store({
    companionInitiative: 'quiet',
    proactiveLetterEnabled: false,
  })

  const settings = loadSettings()

  assert.equal(settings.settingsSchemaVersion, CURRENT_SETTINGS_SCHEMA_VERSION)
  assert.equal(settings.proactiveLetterEnabled, true)
  assert.equal(settings.proactiveLetterChoice, 'auto')
})

test('an explicit letter off choice survives reload', () => {
  store({
    companionInitiative: 'quiet',
    proactiveLetterEnabled: false,
    proactiveLetterChoice: 'off',
  })

  const settings = loadSettings()

  assert.equal(settings.proactiveLetterEnabled, false)
  assert.equal(settings.proactiveLetterChoice, 'off')
})

test('an explicit letter on choice survives a stored legacy false', () => {
  store({
    companionInitiative: 'sometimes',
    proactiveLetterEnabled: false,
    proactiveLetterChoice: 'on',
  })

  const settings = loadSettings()

  assert.equal(settings.proactiveLetterEnabled, true)
  assert.equal(settings.proactiveLetterChoice, 'on')
})

test('the old Sometimes letter switch off stays off without an explicit choice', () => {
  store({
    companionInitiative: 'sometimes',
    proactiveLetterEnabled: false,
  })

  const settings = loadSettings()

  assert.equal(settings.proactiveLetterEnabled, false)
})
