import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadSettings, saveSettings, SETTINGS_UPDATED_EVENT } from '../src/lib/storage.ts'

type LocalStorageMock = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createLocalStorageMock(initial: Record<string, string> = {}): LocalStorageMock {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installWindow(desktopPet: Record<string, unknown>) {
  const target = new EventTarget()
  const localStorage = createLocalStorageMock()
  const win = Object.assign(target, {
    localStorage,
    desktopPet,
  })
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  })
  return win as EventTarget & { localStorage: LocalStorageMock; desktopPet: Record<string, unknown> }
}

let importCounter = 0

async function importFreshSettingsStore() {
  importCounter += 1
  return import(`../src/app/store/settingsStore.ts?case=${importCounter}`)
}

function dispatchSettingsUpdated(target: EventTarget, detail: ReturnType<typeof loadSettings>) {
  class SettingsUpdatedEvent extends Event {
    readonly detail: ReturnType<typeof loadSettings>

    constructor() {
      super(SETTINGS_UPDATED_EVENT)
      this.detail = detail
    }
  }

  target.dispatchEvent(new SettingsUpdatedEvent())
}

async function flushAsyncHandlers() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('subscribeToSettings hydrates one settings update once for all subscribers', async () => {
  let retrieveCalls = 0
  const win = installWindow({
    vaultStore: async () => undefined,
    vaultRetrieveMany: async () => {
      retrieveCalls += 1
      return { 'settings:apiKey': 'hydrated-key' }
    },
  })
  const base = loadSettings()
  const store = await importFreshSettingsStore()
  const seen: string[] = []

  const unsubscribeA = store.subscribeToSettings((settings) => seen.push(`a:${settings.apiKey}`))
  const unsubscribeB = store.subscribeToSettings((settings) => seen.push(`b:${settings.apiKey}`))

  dispatchSettingsUpdated(win, base)
  await flushAsyncHandlers()

  assert.equal(retrieveCalls, 1)
  assert.deepEqual(seen.sort(), ['a:hydrated-key', 'b:hydrated-key'])

  unsubscribeA()
  unsubscribeB()
  dispatchSettingsUpdated(win, base)
  await flushAsyncHandlers()
  assert.equal(retrieveCalls, 1)
})

test('setSettingsSnapshot persists then hydrates and notifies through one local policy pipeline', async () => {
  let retrieveCalls = 0
  let policySyncCalls = 0
  const vaultWrites: Record<string, string> = {}
  const win = installWindow({
    vaultStore: async () => undefined,
    vaultStoreMany: async (entries: Record<string, string>) => {
      Object.assign(vaultWrites, entries)
    },
    vaultRetrieveMany: async () => {
      retrieveCalls += 1
      return { 'settings:apiKey': 'hydrated-key' }
    },
    externalActionPolicySync: async () => {
      policySyncCalls += 1
    },
  })
  const store = await importFreshSettingsStore()
  let customEventCalls = 0
  win.addEventListener(SETTINGS_UPDATED_EVENT, () => {
    customEventCalls += 1
  })
  const seen: Array<{ apiKey: string; notifications: boolean }> = []
  const unsubscribe = store.subscribeToSettings((settings) => {
    seen.push({
      apiKey: settings.apiKey,
      notifications: settings.autonomyNotificationsEnabled,
    })
  })

  const nextSettings = {
    ...loadSettings(),
    apiKey: 'local-secret',
    autonomyNotificationsEnabled: true,
  }
  await store.setSettingsSnapshot(nextSettings)

  assert.equal(customEventCalls, 0)
  assert.equal(retrieveCalls, 2)
  assert.equal(policySyncCalls, 1)
  assert.deepEqual(seen, [{ apiKey: 'hydrated-key', notifications: true }])
  assert.equal(vaultWrites['settings:apiKey'], 'local-secret')
  const persisted = JSON.parse(win.localStorage.getItem('nexus:settings') ?? '{}') as Record<string, unknown>
  assert.equal(persisted.apiKey, '')
  assert.equal(persisted.autonomyNotificationsEnabled, true)

  unsubscribe()
})

test('initializeSettingsWithVault shares concurrent vault hydration', async () => {
  let retrieveCalls = 0
  installWindow({
    vaultStore: async () => undefined,
    vaultRetrieveMany: async () => {
      retrieveCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { 'settings:apiKey': 'hydrated-key' }
    },
  })
  const store = await importFreshSettingsStore()

  const [first, second] = await Promise.all([
    store.initializeSettingsWithVault(),
    store.initializeSettingsWithVault(),
  ])

  assert.equal(retrieveCalls, 1)
  assert.equal(first.apiKey, 'hydrated-key')
  assert.equal(second.apiKey, 'hydrated-key')
})

test('subscribeToSettings fans out a single vault hydration failure', async () => {
  let retrieveCalls = 0
  const originalError = console.error
  const errorCalls: unknown[][] = []
  console.error = (...args: unknown[]) => { errorCalls.push(args) }
  try {
    const win = installWindow({
      vaultStore: async () => undefined,
      vaultRetrieveMany: async () => {
        retrieveCalls += 1
        throw new Error('failed for settings:apiKey token=xai-abcdefghijklmnop at /Users/klein/private.json')
      },
    })
    const base = loadSettings()
    const store = await importFreshSettingsStore()
    const seen: string[] = []

    store.subscribeToSettings((settings) => seen.push(`a:${settings.apiKey}`))
    store.subscribeToSettings((settings) => seen.push(`b:${settings.apiKey}`))

    dispatchSettingsUpdated(win, base)
    await flushAsyncHandlers()

    assert.equal(retrieveCalls, 1)
    assert.equal(errorCalls.length, 1)
    const serializedError = JSON.stringify(errorCalls)
    assert.doesNotMatch(serializedError, /settings:apiKey/)
    assert.doesNotMatch(serializedError, /xai-abcdefghijklmnop/)
    assert.doesNotMatch(serializedError, /\/Users\/klein/)
    assert.match(serializedError, /token=\*\*\*/)
    assert.match(serializedError, /~\/private\.json/)
    assert.deepEqual(seen.sort(), ['a:', 'b:'])
  } finally {
    console.error = originalError
  }
})

test('microphone-denial revert persists the switches without reading or writing the vault', async () => {
  let retrieveCalls = 0
  let storeCalls = 0
  let vaultExhausted = false
  const vaultEntries: Record<string, string> = {}
  installWindow({
    vaultStore: async () => undefined,
    vaultStoreMany: async (entries: Record<string, string>) => {
      storeCalls += 1
      if (vaultExhausted) throw new Error('vault store-many failed')
      Object.assign(vaultEntries, entries)
    },
    vaultRetrieveMany: async (slots: string[]) => {
      retrieveCalls += 1
      if (vaultExhausted) {
        throw new Error(
          'vault retrieve-many rate-limited: more than 6 bulk operations in 60s — '
          + 'looks like programmatic enumeration. Check the audit log.',
        )
      }
      const values: Record<string, string> = {}
      for (const slot of slots) {
        if (vaultEntries[slot]) values[slot] = vaultEntries[slot]
      }
      return values
    },
  })
  saveSettings({
    ...loadSettings(),
    speechInputEnabled: true,
    speechOutputEnabled: true,
    apiKey: 'sk-unit-secret',
    companionName: 'steady-companion',
  })
  const store = await importFreshSettingsStore()
  const hydrated = await store.initializeSettingsWithVault()
  assert.equal(hydrated.apiKey, 'sk-unit-secret')

  // The permission prompt is refused while the bulk-read budget is spent.
  vaultExhausted = true
  retrieveCalls = 0
  storeCalls = 0
  const nextDraft = {
    ...hydrated,
    speechInputEnabled: false,
    speechOutputEnabled: false,
    apiKey: 'sk-draft-plaintext',
    companionName: 'draft-companion',
  }
  const committed = await store.updateSettingsFromDraft(
    hydrated,
    nextDraft,
    undefined,
    { vaultFree: true },
  )

  assert.equal(retrieveCalls, 0)
  assert.equal(storeCalls, 0)
  assert.equal(committed.speechInputEnabled, false)
  assert.equal(committed.speechOutputEnabled, false)
  assert.equal(committed.apiKey, 'sk-unit-secret')
  // Only the voice toggles move; the denial must not persist other draft edits.
  assert.equal(committed.companionName, 'steady-companion')
  const persisted = loadSettings()
  assert.equal(persisted.speechInputEnabled, false)
  assert.equal(persisted.speechOutputEnabled, false)
  assert.equal(persisted.apiKey, '')
  assert.equal(persisted.companionName, 'steady-companion')
  assert.equal(store.getSettingsSnapshot().apiKey, 'sk-unit-secret')
})
