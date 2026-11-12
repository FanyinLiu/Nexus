import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SETTINGS_STORAGE_KEY } from '../src/lib/storage/core.ts'
import { loadSettings } from '../src/lib/storage/settings.ts'

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
}

test('a fresh install keeps external-link confirmation on', () => {
  installStorage()
  assert.equal(loadSettings().toolOpenExternalRequiresConfirmation, true)
})

test('an older store without the preference keeps confirmation on', () => {
  installStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 23,
      companionName: 'X',
    }),
  })
  assert.equal(loadSettings().toolOpenExternalRequiresConfirmation, true)
})

test('a saved off choice for external-link confirmation is respected', () => {
  installStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 23,
      toolOpenExternalRequiresConfirmation: false,
    }),
  })
  assert.equal(loadSettings().toolOpenExternalRequiresConfirmation, false)
})
