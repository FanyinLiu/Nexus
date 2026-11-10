import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadSettings, SETTINGS_STORAGE_KEY } from '../src/lib/storage.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../src/lib/settingsMigrations.ts'

// Typing awareness powers a global keyboard hook and feeds desktop typing
// state into proactive delivery, so it is a privacy switch: every path that
// does not store an explicit boolean must land on the factory default `false`.
// The default lives in the settings factory; these tests read it through
// loadSettings so changing that default to `true` is a visible behavior change.

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

function storeSettings(stored: Record<string, unknown>) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored))
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

test('fresh settings keep typing awareness off', () => {
  assert.equal(loadSettings().typingAwarenessEnabled, false)
})

test('a current-schema store without the typing key keeps typing awareness off', () => {
  storeSettings({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    companionName: '星绘',
  })

  assert.equal(loadSettings().typingAwarenessEnabled, false)
})

test('an older migrated store without the typing key keeps typing awareness off', () => {
  storeSettings({
    settingsSchemaVersion: 1,
    companionName: '星绘',
  })

  assert.equal(loadSettings().typingAwarenessEnabled, false)
})

test('a corrupt typing value does not opt the user in', () => {
  storeSettings({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    typingAwarenessEnabled: 'true',
  })

  assert.equal(loadSettings().typingAwarenessEnabled, false)
})

test('an explicit typing choice is preserved in both directions', () => {
  storeSettings({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    typingAwarenessEnabled: true,
  })
  assert.equal(loadSettings().typingAwarenessEnabled, true)

  storeSettings({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    typingAwarenessEnabled: false,
  })
  assert.equal(loadSettings().typingAwarenessEnabled, false)
})
