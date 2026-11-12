import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beforeEach, test } from 'node:test'

import { loadSettings, SETTINGS_STORAGE_KEY } from '../src/lib/storage.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../src/lib/settingsMigrations.ts'

// Typing awareness powers a global keyboard hook and feeds desktop typing
// state into proactive delivery, so it is a privacy switch: every path that
// does not store an explicit boolean must land on `false`.
//
// Two separate guards are pinned here because they fail independently:
//   1. the declared factory default (a store-wide flip to `true` would make
//      every future fallback opt the user in), and
//   2. loadSettings' missing/corrupt path, which today hard-codes
//      `stored.typingAwarenessEnabled === true` and must keep doing so even
//      if the factory default ever changes.
//
// The factory object is not exported, and changing src/ product code is out
// of scope for this test-only change, so guard 1 reads the declared literal
// from the source file. This is an intentional storage-contract/privacy
// assertion, not a style check.

const SETTINGS_FACTORY_SOURCE = readFileSync(
  new URL('../src/lib/storage/settings.ts', import.meta.url),
  'utf8',
)

function factoryDefaultBlock(): string {
  const start = SETTINGS_FACTORY_SOURCE.indexOf('const defaultSettings: AppSettings = {')
  const end = SETTINGS_FACTORY_SOURCE.indexOf('const VALID_PERMISSION_MODES', start)
  assert.ok(
    start >= 0 && end > start,
    'the settings factory object literal must remain locatable',
  )
  return SETTINGS_FACTORY_SOURCE.slice(start, end)
}

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

test('the settings factory declares typing awareness off', () => {
  const declared = [...factoryDefaultBlock().matchAll(
    /^\s*typingAwarenessEnabled:\s*(true|false),$/gm,
  )]

  assert.equal(declared.length, 1, 'the factory object must declare typing awareness once')
  assert.equal(
    declared[0][1],
    'false',
    'flipping the factory default on would opt fresh and fallback settings into the keyboard hook',
  )
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

test('unparsable stored settings do not opt the user in', () => {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, '{"typingAwarenessEnabled":true')
  const originalError = console.error
  console.error = () => undefined
  try {
    assert.equal(loadSettings().typingAwarenessEnabled, false)
  } finally {
    console.error = originalError
  }
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
