import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadSettings, SETTINGS_UPDATED_EVENT } from '../src/lib/storage.ts'

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
