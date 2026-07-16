import assert from 'node:assert/strict'
import { test } from 'node:test'

type LocalStorageMock = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createLocalStorageMock(): LocalStorageMock {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: (key) => { values.delete(key) },
    clear: () => { values.clear() },
  }
}

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()

  readonly name: string
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(name: string) {
    this.name = name
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set()
    peers.add(this)
    FakeBroadcastChannel.channels.set(name, peers)
  }

  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data })
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }

  static reset() {
    FakeBroadcastChannel.channels.clear()
  }
}

class FakeWebLocks {
  active = 0
  maxActive = 0
  private tail: Promise<void> = Promise.resolve()

  request<T>(name: string, work: () => Promise<T> | T): Promise<T> {
    assert.equal(name, 'nexus:settings:mutation')
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    return previous.then(async () => {
      this.active += 1
      this.maxActive = Math.max(this.maxActive, this.active)
      try {
        return await work()
      } finally {
        this.active -= 1
        release()
      }
    })
  }
}

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

function installEnvironment(lock: FakeWebLocks, vaultSecret = '') {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousBroadcastChannel = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel')
  const localStorage = createLocalStorageMock()
  const target = new EventTarget()
  const win = Object.assign(target, {
    localStorage,
    desktopPet: {
      vaultStore: async () => undefined,
      vaultStoreMany: async () => undefined,
      vaultRetrieveMany: async () => ({ 'settings:apiKey': vaultSecret }),
    },
  })

  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks: lock },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: FakeBroadcastChannel,
    configurable: true,
    writable: true,
  })

  return {
    win: win as EventTarget & {
      localStorage: LocalStorageMock
      desktopPet: {
        vaultStore: () => Promise<void>
        vaultStoreMany: (entries: Record<string, string>) => Promise<void>
        vaultRetrieveMany: () => Promise<Record<string, string>>
      }
    },
    restore() {
      FakeBroadcastChannel.reset()
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete (globalThis as { window?: unknown }).window
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
      else delete (globalThis as { navigator?: unknown }).navigator
      if (previousBroadcastChannel) {
        Object.defineProperty(globalThis, 'BroadcastChannel', previousBroadcastChannel)
      } else {
        delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel
      }
    },
  }
}

let importCounter = 0

async function importFreshStore() {
  importCounter += 1
  const store = await import(`../src/app/store/settingsStore.ts?cross-window=${importCounter}`)
  const storage = await import('../src/lib/storage.ts')
  return { store, storage }
}

async function flushMicrotasks(count = 12) {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

function dispatchSettingsUpdated(target: EventTarget, detail: unknown) {
  class SettingsUpdatedEvent extends Event {
    readonly detail: unknown

    constructor() {
      super('nexus:settings-updated')
      this.detail = detail
    }
  }

  target.dispatchEvent(new SettingsUpdatedEvent())
}

test('two renderer stores serialize draft mutations under the shared Web Lock', async () => {
  const lock = new FakeWebLocks()
  const firstHydration = deferred()
  let retrieveCalls = 0
  const environment = installEnvironment(lock)
  const retrieve = async () => {
    retrieveCalls += 1
    if (retrieveCalls === 1) await firstHydration.promise
    return {}
  }
  environment.win.desktopPet.vaultRetrieveMany = retrieve

  try {
    const { store: petStore, storage } = await importFreshStore()
    const { store: panelStore } = await importFreshStore()
    const baseline = storage.loadSettings()
    const petDraft = { ...baseline, companionName: 'Pet update' }
    const panelDraft = { ...baseline, userName: 'Panel update' }
    const petMutation = petStore.updateSettingsFromDraft(baseline, petDraft)
    const panelMutation = panelStore.updateSettingsFromDraft(baseline, panelDraft)

    await flushMicrotasks()
    assert.equal(lock.maxActive, 1)
    firstHydration.release()
    await Promise.all([petMutation, panelMutation])

    const persisted = storage.loadSettings()
    assert.equal(persisted.companionName, 'Pet update')
    assert.equal(persisted.userName, 'Panel update')
    assert.equal(panelStore.getSettingsSnapshot().companionName, 'Pet update')
    assert.equal(panelStore.getSettingsSnapshot().userName, 'Panel update')
  } finally {
    environment.restore()
  }
})

test('a stale draft rebases only its changed top-level field', async () => {
  const environment = installEnvironment(new FakeWebLocks())

  try {
    const { store, storage } = await importFreshStore()
    const baseline = storage.loadSettings()
    await store.updateSettingsSnapshot((current) => ({ ...current, companionName: 'fresh A' }))

    const staleDraft = { ...baseline, userName: 'stale draft B' }
    const committed = await store.updateSettingsFromDraft(baseline, staleDraft)

    assert.equal(committed.companionName, 'fresh A')
    assert.equal(committed.userName, 'stale draft B')
    assert.equal(storage.loadSettings().companionName, 'fresh A')
    assert.equal(storage.loadSettings().userName, 'stale draft B')
  } finally {
    environment.restore()
  }
})

test('callback, subscriber, return, and snapshot share one committed hydrated object', async () => {
  const environment = installEnvironment(new FakeWebLocks(), 'hydrated-secret')

  try {
    const { store } = await importFreshStore()
    const observed: unknown[] = []
    const unsubscribe = store.subscribeToSettings((settings) => { observed.push(settings) })
    let callbackValue: unknown

    const returned = await store.updateSettingsSnapshot(
      (current) => ({ ...current, companionName: 'four-way committed' }),
      (committed) => { callbackValue = committed },
    )
    const snapshot = store.getSettingsSnapshot()

    assert.equal(observed.length, 1)
    assert.strictEqual(callbackValue, returned)
    assert.strictEqual(observed[0], returned)
    assert.strictEqual(snapshot, returned)
    assert.equal(returned.apiKey, 'hydrated-secret')
    unsubscribe()
  } finally {
    environment.restore()
  }
})

test('non-noop mutation hydrates a secret changed by another renderer', async () => {
  const lock = new FakeWebLocks()
  let vaultSecret = 'old-secret'
  const environment = installEnvironment(lock, vaultSecret)
  let retrieveCalls = 0
  environment.win.desktopPet.vaultRetrieveMany = async () => {
    retrieveCalls += 1
    return { 'settings:apiKey': vaultSecret }
  }

  try {
    const { store } = await importFreshStore()
    await store.updateSettingsSnapshot((current) => ({ ...current, companionName: 'before rotation' }))
    assert.equal(store.getSettingsSnapshot().apiKey, 'old-secret')

    vaultSecret = 'new-secret'
    const committed = await store.updateSettingsSnapshot((current) => ({
      ...current,
      userName: 'after rotation',
    }))

    assert.equal(committed.apiKey, 'new-secret')
    assert.equal(store.getSettingsSnapshot().apiKey, 'new-secret')
    assert.equal(retrieveCalls, 4)
  } finally {
    environment.restore()
  }
})

test('late stale BroadcastChannel value cannot roll back a newer local commit', async () => {
  const environment = installEnvironment(new FakeWebLocks())

  try {
    const { store, storage } = await importFreshStore()
    const baseline = storage.loadSettings()
    const seen: string[] = []
    const unsubscribe = store.subscribeToSettings((settings) => { seen.push(settings.companionName) })
    const first = { ...baseline, companionName: 'A' }
    await store.setSettingsSnapshot(first)
    const second = { ...first, companionName: 'B' }
    await store.setSettingsSnapshot(second)

    const peer = new FakeBroadcastChannel('nexus-storage-sync')
    peer.postMessage({
      key: storage.SETTINGS_STORAGE_KEY,
      value: first,
      timestamp: Date.now() - 1,
    })
    peer.close()
    await flushMicrotasks()

    assert.equal(store.getSettingsSnapshot().companionName, 'B')
    assert.equal(storage.loadSettings().companionName, 'B')
    assert.equal(seen.at(-1), 'B')
    assert.ok(seen.every((value) => value !== 'A' || seen.indexOf(value) === 0))
    unsubscribe()
  } finally {
    environment.restore()
  }
})

test('queued stale CustomEvent is re-read after the local commit and cannot roll back state', async () => {
  const lock = new FakeWebLocks()
  const allowVaultWrite = deferred()
  const vaultWriteStarted = deferred()
  let storedApiKey = ''
  const environment = installEnvironment(lock)
  environment.win.desktopPet.vaultStoreMany = async (entries) => {
    storedApiKey = entries['settings:apiKey'] ?? storedApiKey
    vaultWriteStarted.release()
    await allowVaultWrite.promise
  }
  environment.win.desktopPet.vaultRetrieveMany = async () => ({
    'settings:apiKey': storedApiKey,
  })

  try {
    const { store, storage } = await importFreshStore()
    const seen: string[] = []
    const unsubscribe = store.subscribeToSettings((settings) => { seen.push(settings.companionName) })
    const baseline = storage.loadSettings()
    const mutation = store.setSettingsSnapshot({
      ...baseline,
      apiKey: 'committed-secret',
      companionName: 'committed value',
    })

    await vaultWriteStarted.promise
    dispatchSettingsUpdated(environment.win, {
      ...baseline,
      apiKey: 'stale-secret',
      companionName: 'stale event detail',
    })
    allowVaultWrite.release()
    await mutation
    await flushMicrotasks()

    assert.equal(lock.maxActive, 1)
    assert.equal(storage.loadSettings().companionName, 'committed value')
    assert.equal(store.getSettingsSnapshot().companionName, 'committed value')
    assert.ok(seen.length > 0)
    assert.ok(seen.every((value) => value === 'committed value'))
    unsubscribe()
  } finally {
    environment.restore()
  }
})

test('external sync waits for the shared lock before reading local and vault state', async () => {
  const lock = new FakeWebLocks()
  const allowVaultWrite = deferred()
  const vaultWriteStarted = deferred()
  let storedApiKey = ''
  const environment = installEnvironment(lock)
  environment.win.desktopPet.vaultStoreMany = async (entries) => {
    storedApiKey = entries['settings:apiKey'] ?? storedApiKey
    vaultWriteStarted.release()
    await allowVaultWrite.promise
  }
  environment.win.desktopPet.vaultRetrieveMany = async () => ({
    'settings:apiKey': storedApiKey,
  })

  try {
    const { store: writer, storage } = await importFreshStore()
    const { store: reader } = await importFreshStore()
    const seen: Array<{ companionName: string; apiKey: string }> = []
    const unsubscribe = reader.subscribeToSettings((settings) => {
      seen.push({ companionName: settings.companionName, apiKey: settings.apiKey })
    })
    const baseline = storage.loadSettings()
    const mutation = writer.setSettingsSnapshot({
      ...baseline,
      apiKey: 'new-secret',
      companionName: 'new local value',
    })

    await vaultWriteStarted.promise
    dispatchSettingsUpdated(environment.win, {
      ...baseline,
      apiKey: 'stale-detail',
      companionName: 'stale detail',
    })
    await flushMicrotasks()
    assert.deepEqual(seen, [])
    assert.equal(lock.maxActive, 1)

    allowVaultWrite.release()
    await mutation
    await flushMicrotasks()

    assert.equal(reader.getSettingsSnapshot().companionName, 'new local value')
    assert.equal(reader.getSettingsSnapshot().apiKey, 'new-secret')
    assert.ok(seen.length > 0)
    assert.ok(seen.every((value) => (
      value.companionName === 'new local value' && value.apiKey === 'new-secret'
    )))
    unsubscribe()
  } finally {
    environment.restore()
  }
})

test('first migration and a normal mutation share the lock and preserve both fields', async () => {
  const lock = new FakeWebLocks()
  const environment = installEnvironment(lock)
  let storedApiKey = ''
  environment.win.desktopPet.vaultStoreMany = async (entries) => {
    storedApiKey = entries['settings:apiKey'] ?? storedApiKey
  }
  environment.win.desktopPet.vaultRetrieveMany = async () => ({
    'settings:apiKey': storedApiKey,
  })

  try {
    const { store: storageStore, storage } = await importFreshStore()
    const baseline = storage.loadSettings()
    environment.win.localStorage.setItem(
      storage.SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...baseline, apiKey: 'legacy-secret', companionName: 'legacy value' }),
    )
    const { store: normalStore } = await importFreshStore()

    const [migrated, committed] = await Promise.all([
      storageStore.initializeSettingsWithVault(),
      normalStore.updateSettingsSnapshot((current) => ({
        ...current,
        userName: 'normal mutation',
      })),
    ])

    assert.equal(lock.maxActive, 1)
    assert.equal(migrated.apiKey, 'legacy-secret')
    assert.equal(committed.apiKey, 'legacy-secret')
    assert.equal(committed.userName, 'normal mutation')
    assert.equal(storage.loadSettings().apiKey, '')
    assert.equal(storage.loadSettings().userName, 'normal mutation')
  } finally {
    environment.restore()
  }
})

test('failed plaintext migration remains retryable', async () => {
  const environment = installEnvironment(new FakeWebLocks())
  let storedApiKey = ''
  let migrationAttempts = 0
  environment.win.desktopPet.vaultStoreMany = async (entries) => {
    migrationAttempts += 1
    if (migrationAttempts === 1) throw new Error('migration vault unavailable')
    storedApiKey = entries['settings:apiKey'] ?? storedApiKey
  }
  environment.win.desktopPet.vaultRetrieveMany = async () => ({
    'settings:apiKey': storedApiKey,
  })

  try {
    const { store, storage } = await importFreshStore()
    const baseline = storage.loadSettings()
    environment.win.localStorage.setItem(
      storage.SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...baseline, apiKey: 'retryable-secret' }),
    )

    await assert.rejects(store.initializeSettingsWithVault(), /migration vault unavailable/)
    const retried = await store.initializeSettingsWithVault()

    assert.equal(migrationAttempts, 2)
    assert.equal(retried.apiKey, 'retryable-secret')
    assert.equal(storage.loadSettings().apiKey, '')
  } finally {
    environment.restore()
  }
})
