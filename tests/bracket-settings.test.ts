import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadSettings, saveSettings } from '../src/lib/storage/settings.ts'
import { SETTINGS_STORAGE_KEY } from '../src/lib/storage/core.ts'
import {
  companionInitiativePatch,
  inferCompanionInitiative,
} from '../src/features/settingsSimplify/companionInitiative.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage, dispatchEvent: () => true },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('a fresh install defaults the daily bracket on', () => {
  installStorage()
  assert.equal(loadSettings().proactiveBracketEnabled, true)
})

test('an absent key on an older store gets the light default', () => {
  installStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 23,
      companionName: 'X',
    }),
  })
  assert.equal(loadSettings().proactiveBracketEnabled, true)
})

test('a saved off choice is respected and survives a save round trip', () => {
  installStorage({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 23,
      proactiveBracketEnabled: false,
    }),
  })
  const saved = loadSettings()
  assert.equal(saved.proactiveBracketEnabled, false)

  saveSettings({ ...saved, proactiveBracketEnabled: false }, { silent: true })
  assert.equal(loadSettings().proactiveBracketEnabled, false)
})

test('an explicit on choice survives a save round trip', () => {
  installStorage()
  const saved = loadSettings()
  saveSettings({ ...saved, proactiveBracketEnabled: true }, { silent: true })
  assert.equal(loadSettings().proactiveBracketEnabled, true)
})

test('the bracket toggle does not make a saved pace read as custom', () => {
  const factory = {
    autonomyEnabled: false,
    proactivePresenceEnabled: false,
    proactivePresenceIntervalMinutes: 25,
    proactiveAwayNotificationsEnabled: false,
    proactiveBracketEnabled: true,
    proactiveLetterEnabled: false,
  }
  assert.equal(inferCompanionInitiative(factory), 'quiet')
  assert.equal(companionInitiativePatch('quiet').proactiveBracketEnabled, false)
  assert.equal(companionInitiativePatch('sometimes').proactiveBracketEnabled, true)
  assert.equal(companionInitiativePatch('often').proactiveBracketEnabled, true)
})
