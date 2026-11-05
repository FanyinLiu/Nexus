/**
 * Reminder strip switch contract (settings schema 26).
 *
 * The former `PROACTIVE_STRIP_ENABLED` constant is a persisted setting now:
 * defaults/load/migrations, renderer context builders, main re-route
 * preferences, the pure router, and the settings surface all have to agree.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, ProactiveDeliveryPreferences } from '../shared/proactiveDelivery.js'
import { createProactiveDeliveryContextProvider } from '../electron/services/proactiveDeliveryContext.js'
import {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  migrateSettings,
} from '../src/lib/settingsMigrations.ts'
import { loadSettings } from '../src/lib/storage/settings.ts'
import { SETTINGS_STORAGE_KEY } from '../src/lib/storage/core.ts'
import {
  buildReminderDeliveryContext,
  buildReminderDeliveryPreferences,
} from '../src/features/reminders/proactiveMessage.ts'
import type { AppSettings } from '../src/types/index.ts'

const NOW = new Date(2026, 0, 2, 14, 0, 0).getTime()

function makeContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
    ...overrides,
  }
}

function makePreferences(overrides: Partial<ProactiveDeliveryPreferences> = {}): ProactiveDeliveryPreferences {
  return {
    quietStart: 23,
    quietEnd: 8,
    desktopAwarenessAllowed: false,
    awayNotificationsEnabled: false,
    stripEnabled: true,
    ...overrides,
  }
}

function installSettingsWindow(stored: Record<string, unknown>): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const values = new Map<string, string>([[SETTINGS_STORAGE_KEY, JSON.stringify(stored)]])
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value) },
        removeItem: (key: string) => { values.delete(key) },
        clear: () => { values.clear() },
      },
    },
    configurable: true,
    writable: true,
  })
  return () => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete (globalThis as { window?: unknown }).window
  }
}

// ── Schema and defaults ─────────────────────────────────────────────────────

test('schema 26 is current and migrations default the strip on', () => {
  assert.equal(CURRENT_SETTINGS_SCHEMA_VERSION, 26)

  const next = migrateSettings({
    settingsSchemaVersion: 25,
    companionName: 'Nexus',
    proactiveAwayNotificationsEnabled: false,
    proactiveQuietHoursStart: 22,
  }, 25)

  assert.equal(next.settingsSchemaVersion, 26)
  assert.equal(next.proactiveReminderStripEnabled, true)
  assert.equal(next.companionName, 'Nexus')
  assert.equal(next.proactiveAwayNotificationsEnabled, false)
  assert.equal(next.proactiveQuietHoursStart, 22)
})

test('schema 26 keeps every unrelated value from an old config', () => {
  const next = migrateSettings({
    settingsSchemaVersion: 24,
    themeId: 'night',
    proactiveLetterChoice: 'on',
    mcpServers: [{ id: 'one', label: 'One', command: 'node', args: [], enabled: true }],
    memoryDailyRecallCount: 6,
  }, 24)

  assert.equal(next.settingsSchemaVersion, 26)
  assert.equal(next.proactiveReminderStripEnabled, true)
  assert.equal(next.themeId, 'night')
  assert.equal(next.proactiveLetterChoice, 'on')
  assert.deepEqual(next.mcpServers, [{ id: 'one', label: 'One', command: 'node', args: [], enabled: true }])
  assert.equal(next.memoryDailyRecallCount, 6)
})

test('the loaded default is on and a stored false stays off', (t) => {
  const restoreDefault = installSettingsWindow({ settingsSchemaVersion: 25, companionName: 'Nexus' })
  t.after(restoreDefault)
  assert.equal(loadSettings().proactiveReminderStripEnabled, true)

  const restoreOff = installSettingsWindow({
    settingsSchemaVersion: 26,
    companionName: 'Nexus',
    proactiveReminderStripEnabled: false,
  })
  t.after(restoreOff)
  assert.equal(loadSettings().proactiveReminderStripEnabled, false)
})

// ── Renderer context and preferences ────────────────────────────────────────

test('the renderer context and preferences carry the saved switch', () => {
  const settings = {
    proactiveQuietHoursStart: 23,
    proactiveQuietHoursEnd: 8,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    proactiveAwayNotificationsEnabled: false,
    proactiveReminderStripEnabled: false,
  } as AppSettings

  const context = buildReminderDeliveryContext({
    focusState: 'active',
    quietStart: settings.proactiveQuietHoursStart,
    quietEnd: settings.proactiveQuietHoursEnd,
    awayNotificationsEnabled: false,
    stripEnabled: settings.proactiveReminderStripEnabled,
    now: NOW,
  })
  assert.equal(context.stripEnabled, false)
  assert.equal(buildReminderDeliveryPreferences(settings).stripEnabled, false)
})

// ── Pure router and main re-route context ───────────────────────────────────

test('the router sends actionable messages to the strip only when the switch is on', () => {
  const actionable = { actions: ['done'] }

  assert.equal(routeDelivery(actionable, makeContext()).rule, 3)
  assert.deepEqual(routeDelivery(actionable, makeContext()).outlets, ['inbox', 'strip'])
  assert.equal(routeDelivery(actionable, makeContext({ stripEnabled: false })).rule, 4)
  assert.deepEqual(
    routeDelivery(actionable, makeContext({ stripEnabled: false })).outlets,
    ['inbox', 'bubble'],
  )
})

test('main keeps the strip on when it has no preferences and follows a sent false', async () => {
  const withoutPreferences = createProactiveDeliveryContextProvider({
    isPanelFocused: () => false,
    getFocusState: () => 'active',
    getActiveWindow: async () => null,
    getPreferences: () => null,
    now: () => NOW,
  })
  assert.equal((await withoutPreferences.getDeliveryContext()).stripEnabled, true)

  const withPreferences = createProactiveDeliveryContextProvider({
    isPanelFocused: () => false,
    getFocusState: () => 'active',
    getActiveWindow: async () => null,
    getPreferences: () => makePreferences({ stripEnabled: false }),
    now: () => NOW,
  })
  assert.equal((await withPreferences.getDeliveryContext()).stripEnabled, false)

  const unknownField = createProactiveDeliveryContextProvider({
    isPanelFocused: () => false,
    getFocusState: () => 'active',
    getActiveWindow: async () => null,
    getPreferences: () => makePreferences({ stripEnabled: undefined }),
    now: () => NOW,
  })
  assert.equal((await unknownField.getDeliveryContext()).stripEnabled, true)
})

test('the old strip constant is gone from the shared contract', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'shared', 'proactiveDelivery.js'),
    'utf8',
  )
  assert.equal(source.includes('PROACTIVE_STRIP_ENABLED'), false)
})
