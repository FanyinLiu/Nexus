import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadSettings, saveSettings, SETTINGS_UPDATED_EVENT } from '../src/lib/storage.ts'
import {
  dehydrateSettingsKeys,
  hydrateSettingsKeys,
} from '../src/lib/keyVaultBridge.ts'
import { syncExternalActionPolicyToMain } from '../src/features/integrations/externalActionPolicySync.ts'

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

type VaultSpies = {
  retrieveCalls: number
  storeCalls: number
  policyCalls: number
}

function installWindow(isPanelWindow: boolean, options: { failVault?: boolean } = {}) {
  const spies: VaultSpies = { retrieveCalls: 0, storeCalls: 0, policyCalls: 0 }
  const target = new EventTarget()
  const win = Object.assign(target, {
    localStorage: createLocalStorageMock(),
    desktopPet: {
      isPanelWindow: async () => isPanelWindow,
      vaultStore: async () => undefined,
      vaultStoreMany: async () => {
        spies.storeCalls += 1
      },
      vaultRetrieveMany: async () => {
        spies.retrieveCalls += 1
        if (options.failVault) throw new Error('IPC rejected: panel capability is unavailable to pet window')
        return { 'settings:apiKey': 'hydrated-key' }
      },
      externalActionPolicySync: async () => {
        spies.policyCalls += 1
      },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  })
  return { win, spies }
}

let importCounter = 0

async function importFreshSettingsStore() {
  importCounter += 1
  return import(`../src/app/store/settingsStore.ts?pet-case=${importCounter}`)
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

test('pet window vault helpers never issue panel-only IPC', async () => {
  const { spies } = installWindow(false)
  const base = loadSettings()

  const hydrated = await hydrateSettingsKeys({
    ...base,
    apiKey: 'nexus-vault-ref:opaque',
  })
  assert.equal(hydrated.apiKey, 'nexus-vault-ref:opaque')

  const dehydrated = await dehydrateSettingsKeys({
    ...base,
    apiKey: 'plaintext-secret',
  })
  assert.equal(dehydrated.apiKey, 'plaintext-secret')

  await syncExternalActionPolicyToMain(base)

  assert.deepEqual(spies, {
    retrieveCalls: 0,
    storeCalls: 0,
    policyCalls: 0,
  })
})

test('panel window keeps vault hydration, dehydration, and policy sync', async () => {
  const { spies } = installWindow(true)
  const base = loadSettings()

  const hydrated = await hydrateSettingsKeys(base)
  assert.equal(hydrated.apiKey, 'hydrated-key')

  const dehydrated = await dehydrateSettingsKeys({
    ...base,
    apiKey: 'plaintext-secret',
  })
  assert.equal(dehydrated.apiKey, '')
  assert.equal(spies.storeCalls, 1)

  await syncExternalActionPolicyToMain(base)
  assert.equal(spies.retrieveCalls, 1)
  assert.equal(spies.policyCalls, 1)
})

test('onboarding-finish settings broadcast reaches the pet without panel IPC', async () => {
  const { win, spies } = installWindow(false)
  const errorCalls: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => { errorCalls.push(args) }

  try {
    const base = loadSettings()
    const completed = {
      ...base,
      userName: 'Mao User',
      companionName: 'Mao',
    }
    const store = await importFreshSettingsStore()
    const seen: Array<{ userName: string; companionName: string }> = []
    const unsubscribe = store.subscribeToSettings((settings) => {
      seen.push({
        userName: settings.userName,
        companionName: settings.companionName,
      })
    })

    saveSettings(completed, { silent: true })
    dispatchSettingsUpdated(win, completed)
    await flushAsyncHandlers()

    assert.deepEqual(seen, [{ userName: 'Mao User', companionName: 'Mao' }])
    assert.deepEqual(spies, {
      retrieveCalls: 0,
      storeCalls: 0,
      policyCalls: 0,
    })
    assert.deepEqual(errorCalls, [])

    unsubscribe()
  } finally {
    console.error = originalError
  }
})

test('pet settings save completes even when the vault would reject', async () => {
  const { spies } = installWindow(false, { failVault: true })
  const store = await importFreshSettingsStore()
  const base = loadSettings()

  const committed = await store.setSettingsSnapshot({
    ...base,
    userName: 'Pet Window User',
  })

  assert.equal(committed.userName, 'Pet Window User')
  assert.deepEqual(spies, {
    retrieveCalls: 0,
    storeCalls: 0,
    policyCalls: 0,
  })
})
