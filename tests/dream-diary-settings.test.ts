import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadSettings, saveSettings } from '../src/lib/storage/settings.ts'
import { SETTINGS_STORAGE_KEY } from '../src/lib/storage/core.ts'

function installStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage, dispatchEvent: () => true },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('a fresh install keeps the dream diary on', () => {
  installStorage()
  assert.equal(loadSettings().dreamDiaryEnabled, true)
})

test('an older store without the key gets the sensible default', () => {
  installStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 23,
      companionName: 'X',
    }),
  })
  assert.equal(loadSettings().dreamDiaryEnabled, true)
})

test('an explicit off choice is respected and survives a save round trip', () => {
  installStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 23,
      dreamDiaryEnabled: false,
    }),
  })
  const loaded = loadSettings()
  assert.equal(loaded.dreamDiaryEnabled, false)

  saveSettings({ ...loaded, dreamDiaryEnabled: false }, { silent: true })
  assert.equal(loadSettings().dreamDiaryEnabled, false)
})

test('an explicit on choice survives a save round trip', () => {
  installStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 23,
      dreamDiaryEnabled: true,
    }),
  })
  const loaded = loadSettings()
  saveSettings({ ...loaded, dreamDiaryEnabled: true }, { silent: true })
  assert.equal(loadSettings().dreamDiaryEnabled, true)
})
