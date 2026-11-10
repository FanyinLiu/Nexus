import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  stripInternalSettingsFields,
} from '../src/lib/storage.ts'
import { buildFirstRunQaReport } from '../src/features/onboarding/firstRunQaReport.ts'
import { clearLogs, createLogger, exportLogs } from '../src/lib/logger.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../src/lib/settingsMigrations.ts'
import type { AppSettings } from '../src/types/app.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
    removeItem(key: string) {
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

test('only saveSettings creates a new settings revision and reload carries it', () => {
  const initial = loadSettings()
  assert.equal(initial.settingsRevision, 0)

  saveSettings({ ...initial, companionName: 'Nexus One' }, { silent: true })
  const afterFirst = loadSettings()
  assert.equal(afterFirst.settingsRevision, 1)

  // Hydration-style copies keep the loaded revision.
  assert.equal({ ...afterFirst, apiKey: 'hydrated-in-memory' }.settingsRevision, 1)

  saveSettings({ ...afterFirst, companionName: 'Nexus Two' }, { silent: true })
  assert.equal(loadSettings().settingsRevision, 2)

  const raw = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as {
    settingsRevision?: number
  }
  assert.equal(raw.settingsRevision, 2)
})

test('legacy settings without a revision load as revision zero', () => {
  window.localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      companionName: 'Legacy',
    }),
  )

  const settings = loadSettings()
  assert.equal(settings.settingsRevision, 0)
  assert.equal(settings.companionName, 'Legacy')
})

test('settingsRevision is excluded from exportable settings, QA reports, and log exports', () => {
  const settings = {
    settingsRevision: 42,
    companionName: 'Nexus',
  } as AppSettings

  assert.equal('settingsRevision' in stripInternalSettingsFields(settings), false)
  assert.doesNotMatch(JSON.stringify(stripInternalSettingsFields(settings)), /settingsRevision/)

  const report = buildFirstRunQaReport({
    summary: { items: [], warningCount: 0 },
    generatedAt: '2026-11-10T00:00:00.000Z',
  })
  assert.doesNotMatch(JSON.stringify(report), /settingsRevision/)

  clearLogs()
  createLogger('revision-privacy-test').info('settings snapshot', {
    settings,
    settingsRevision: 42,
  })
  const exported = exportLogs({ module: 'revision-privacy-test' })
  assert.ok(exported.length > 0)
  assert.doesNotMatch(exported, /settingsRevision/)
  assert.doesNotMatch(exported, /Nexus/)
  clearLogs()
})
