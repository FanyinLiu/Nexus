import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { loadSettings, SETTINGS_STORAGE_KEY, SETTINGS_UPDATED_EVENT } from '../src/lib/storage.ts'

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
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousBroadcastChannel = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel')
  const target = new EventTarget()
  const localStorage = createLocalStorageMock()
  const win = Object.assign(target, { localStorage, desktopPet })

  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: undefined,
    configurable: true,
    writable: true,
  })

  return {
    win: win as EventTarget & { localStorage: LocalStorageMock },
    restore() {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete (globalThis as { window?: unknown }).window
      if (previousBroadcastChannel) {
        Object.defineProperty(globalThis, 'BroadcastChannel', previousBroadcastChannel)
      } else {
        delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel
      }
    },
  }
}

let importCounter = 0

async function importFreshSettingsStore() {
  importCounter += 1
  return import(`../src/app/store/settingsStore.ts?concurrency=${importCounter}`)
}

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

test('identity no-op guard precedes persistence and therefore broadcast work', async () => {
  const source = await readFile(new URL('../src/app/store/settingsStore.ts', import.meta.url), 'utf8')
  const mutationSource = source.match(/async function runLocalSettingsMutation[\s\S]*?\n\}\n\nexport function updateSettingsSnapshot/)?.[0] ?? ''
  const guardStart = mutationSource.indexOf('Object.is(preflightNext, previous)')
  const saveStart = mutationSource.indexOf('saveSettings(')

  assert.match(mutationSource, /const preflightNext = updater\(previous\)[\s\S]*?if \(Object\.is\(preflightNext, previous\)\)[\s\S]*?onCommit\?\.\(previous\)[\s\S]*?return previous/)
  assert.ok(guardStart >= 0 && guardStart < saveStart)
})

test('identity no-op completes without persistence, hydration, policy, or notification work', async () => {
  let vaultWrites = 0
  let vaultReads = 0
  let policySyncs = 0
  const environment = installWindow({
    vaultStore: async () => undefined,
    vaultStoreMany: async () => { vaultWrites += 1 },
    vaultRetrieveMany: async () => {
      vaultReads += 1
      return {}
    },
    externalActionPolicySync: async () => { policySyncs += 1 },
  })

  try {
    let localWrites = 0
    const originalSetItem = environment.win.localStorage.setItem
    environment.win.localStorage.setItem = (key, value) => {
      localWrites += 1
      originalSetItem(key, value)
    }
    let customEventCalls = 0
    environment.win.addEventListener(SETTINGS_UPDATED_EVENT, () => { customEventCalls += 1 })

    const store = await importFreshSettingsStore()
    const seen: unknown[] = []
    const unsubscribe = store.subscribeToSettings((settings) => { seen.push(settings) })
    const previous = store.getSettingsSnapshot()
    const commits: unknown[] = []
    const result = await store.updateSettingsSnapshot(
      (current) => current,
      (committed) => { commits.push(committed) },
    )

    assert.strictEqual(result, previous)
    assert.strictEqual(store.getSettingsSnapshot(), previous)
    assert.deepEqual(commits, [previous])
    assert.deepEqual(seen, [])
    assert.equal(vaultWrites, 0)
    assert.equal(vaultReads, 0)
    assert.equal(localWrites, 0)
    assert.equal(customEventCalls, 0)
    assert.equal(policySyncs, 0)
    unsubscribe()
  } finally {
    environment.restore()
  }
})

test('local persisted hydration failure resolves with the authoritative next settings', async () => {
  const errors: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => { errors.push(args) }
  let policySyncCalls = 0
  let vaultReads = 0
  const environment = installWindow({
    vaultStore: async () => undefined,
    vaultStoreMany: async () => undefined,
    vaultRetrieveMany: async () => {
      vaultReads += 1
      if (vaultReads === 1) return {}
      throw new Error('vaultRetrieve settings:apiKey token=local-secret at /Users/klein/private.json')
    },
    externalActionPolicySync: async () => { policySyncCalls += 1 },
  })

  try {
    const store = await importFreshSettingsStore()
    const seen: string[] = []
    const unsubscribe = store.subscribeToSettings((settings) => { seen.push(settings.apiKey) })
    const nextSettings = {
      ...loadSettings(),
      apiKey: 'authoritative-secret',
      companionName: 'authoritative next',
    }

    const result = await store.setSettingsSnapshot(nextSettings)

    assert.equal(result.apiKey, 'authoritative-secret')
    assert.equal(store.getSettingsSnapshot().apiKey, 'authoritative-secret')
    assert.deepEqual(seen, ['authoritative-secret'])
    assert.equal(policySyncCalls, 1)
    assert.equal(vaultReads, 2)
    assert.equal(JSON.parse(environment.win.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').apiKey, '')
    assert.equal(errors.length, 1)
    const serializedErrors = JSON.stringify(errors)
    assert.doesNotMatch(serializedErrors, /local-secret/)
    assert.doesNotMatch(serializedErrors, /authoritative-secret/)

    unsubscribe()
  } finally {
    console.error = originalError
    environment.restore()
  }
})

test('pre-mutation latest vault hydration failure aborts without side effects', async () => {
  let vaultWrites = 0
  let vaultReads = 0
  let policySyncs = 0
  const environment = installWindow({
    vaultStore: async () => undefined,
    vaultStoreMany: async () => { vaultWrites += 1 },
    vaultRetrieveMany: async () => {
      vaultReads += 1
      throw new Error('vaultRetrieve settings:apiKey token=preflight-secret at /Users/klein/private.json')
    },
    externalActionPolicySync: async () => { policySyncs += 1 },
  })

  try {
    let localWrites = 0
    const originalSetItem = environment.win.localStorage.setItem
    environment.win.localStorage.setItem = (key, value) => {
      localWrites += 1
      originalSetItem(key, value)
    }
    const store = await importFreshSettingsStore()
    const seen: unknown[] = []
    const unsubscribe = store.subscribeToSettings((settings) => { seen.push(settings) })
    const previous = store.getSettingsSnapshot()

    await assert.rejects(
      store.updateSettingsSnapshot((current) => ({ ...current, companionName: 'must not save' })),
      /vaultRetrieve settings:apiKey token=preflight-secret/,
    )

    assert.strictEqual(store.getSettingsSnapshot(), previous)
    assert.equal(vaultReads, 1)
    assert.equal(vaultWrites, 0)
    assert.equal(localWrites, 0)
    assert.equal(policySyncs, 0)
    assert.deepEqual(seen, [])
    unsubscribe()
  } finally {
    environment.restore()
  }
})

test('settings mutation and subscriber finish while permission policy IPC is still pending', async () => {
  let policyStarted = 0
  const environment = installWindow({
    vaultStore: async () => undefined,
    vaultRetrieveMany: async () => ({}),
    externalActionPolicySync: async () => {
      policyStarted += 1
      await new Promise<void>(() => undefined)
    },
  })

  try {
    const store = await importFreshSettingsStore()
    const seen: string[] = []
    const unsubscribe = store.subscribeToSettings((settings) => { seen.push(settings.companionName) })
    const nextSettings = { ...loadSettings(), companionName: 'saved before policy' }

    const result = await store.setSettingsSnapshot(nextSettings)

    assert.equal(result.companionName, 'saved before policy')
    assert.deepEqual(seen, ['saved before policy'])
    assert.equal(policyStarted, 1)
    unsubscribe()
  } finally {
    environment.restore()
  }
})

test('permission policy rejection is caught and redacted after settings commit', async () => {
  const errors: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => { errors.push(args) }
  const environment = installWindow({
    vaultStore: async () => undefined,
    vaultRetrieveMany: async () => ({}),
    externalActionPolicySync: async () => {
      throw new Error('permission token=policy-secret at /Users/klein/private.json')
    },
  })

  try {
    const store = await importFreshSettingsStore()
    const unsubscribe = store.subscribeToSettings(() => undefined)
    await store.setSettingsSnapshot({ ...loadSettings(), companionName: 'policy failure' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(errors.length, 1)
    const serializedErrors = JSON.stringify(errors)
    assert.doesNotMatch(serializedErrors, /policy-secret/)
    assert.doesNotMatch(serializedErrors, /\/Users\/klein/)
    assert.match(serializedErrors, /token=\*\*\*/)
    unsubscribe()
  } finally {
    console.error = originalError
    environment.restore()
  }
})

test('permission policy drain sends the latest commit after a slow earlier sync', async () => {
  const firstPolicy = deferred()
  const policyModes: string[] = []
  let policyCalls = 0
  const environment = installWindow({
    vaultStore: async () => undefined,
    vaultRetrieveMany: async () => ({}),
    externalActionPolicySync: async (payload: { policies: { telegram: { mode: string } } }) => {
      policyCalls += 1
      policyModes.push(payload.policies.telegram.mode)
      if (policyCalls === 1) await firstPolicy.promise
    },
  })

  try {
    const store = await importFreshSettingsStore()
    await store.setSettingsSnapshot({ ...loadSettings(), telegramPermissionMode: 'confirm' })

    const second = store.setSettingsSnapshot({ ...loadSettings(), telegramPermissionMode: 'auto' })
    await second
    assert.equal(policyCalls, 1)

    firstPolicy.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(policyModes, ['confirm', 'auto'])
  } finally {
    environment.restore()
  }
})

test('functional mutations serialize latest state across a delayed first vault write', async () => {
  const firstVaultWrite = deferred()
  let vaultWriteCalls = 0
  const environment = installWindow({
    vaultStore: async () => undefined,
    vaultStoreMany: async () => {
      vaultWriteCalls += 1
      if (vaultWriteCalls === 1) await firstVaultWrite.promise
    },
    vaultRetrieveMany: async () => ({ 'settings:apiKey': 'hydrated-secret' }),
  })

  try {
    const store = await importFreshSettingsStore()
    const seen: Array<{ companionName: string; userName: string }> = []
    const unsubscribe = store.subscribeToSettings((settings) => {
      seen.push({ companionName: settings.companionName, userName: settings.userName })
    })
    let secondUpdaterStarted = false
    const first = store.updateSettingsSnapshot((current) => ({
      ...current,
      apiKey: 'first-secret',
      companionName: 'first mutation',
    }))
    const second = store.updateSettingsSnapshot((current) => {
      secondUpdaterStarted = true
      return { ...current, userName: 'second mutation' }
    })

    for (let index = 0; index < 8; index += 1) await Promise.resolve()
    assert.equal(vaultWriteCalls, 1)
    assert.equal(secondUpdaterStarted, false)
    firstVaultWrite.release()
    await Promise.all([first, second])

    const finalSettings = store.getSettingsSnapshot()
    const persisted = JSON.parse(environment.win.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    assert.equal(finalSettings.companionName, 'first mutation')
    assert.equal(finalSettings.userName, 'second mutation')
    assert.equal(finalSettings.apiKey, 'hydrated-secret')
    assert.equal(persisted.companionName, 'first mutation')
    assert.equal(persisted.userName, 'second mutation')
    assert.equal(persisted.apiKey, '')
    assert.equal(seen.length, 2)
    assert.equal(seen[0].companionName, 'first mutation')
    assert.equal(seen[1].userName, 'second mutation')
    unsubscribe()
  } finally {
    environment.restore()
  }
})

test('a rejected mutation does not poison the queued tail', async () => {
  let vaultWriteCalls = 0
  const environment = installWindow({
    vaultStore: async () => undefined,
    vaultStoreMany: async () => {
      vaultWriteCalls += 1
      throw new Error('first vault write failed')
    },
    vaultRetrieveMany: async () => ({}),
  })

  try {
    const store = await importFreshSettingsStore()
    const seen: string[] = []
    const unsubscribe = store.subscribeToSettings((settings) => { seen.push(settings.userName) })
    const first = store.updateSettingsSnapshot((current) => ({
      ...current,
      apiKey: 'rejected-secret',
      companionName: 'must not commit',
    }))
    const second = store.updateSettingsSnapshot((current) => ({
      ...current,
      userName: 'tail survives',
    }))

    await assert.rejects(first, /first vault write failed/)
    const result = await second

    assert.equal(vaultWriteCalls, 1)
    assert.equal(result.userName, 'tail survives')
    assert.equal(store.getSettingsSnapshot().companionName, loadSettings().companionName)
    assert.equal(store.getSettingsSnapshot().userName, 'tail survives')
    assert.deepEqual(seen, ['tail survives'])
    unsubscribe()
  } finally {
    environment.restore()
  }
})
