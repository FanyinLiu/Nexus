import assert from 'node:assert/strict'
import { test } from 'node:test'

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
      if (peer === this) continue
      peer.onmessage?.({ data })
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }

  static reset() {
    FakeBroadcastChannel.channels.clear()
  }
}

function installWindow(
  desktopPet: Record<string, unknown>,
  { broadcastChannel = true }: { broadcastChannel?: boolean } = {},
) {
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
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: broadcastChannel ? FakeBroadcastChannel : undefined,
    configurable: true,
    writable: true,
  })
  return win
}

function dispatchNativeStorage(target: EventTarget, key: string) {
  const event = new Event('storage')
  Object.defineProperty(event, 'key', { value: key })
  target.dispatchEvent(event)
}

async function flushAsyncHandlers() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('BroadcastChannel mode ignores the duplicate native storage path', async () => {
  FakeBroadcastChannel.reset()
  let retrieveCalls = 0
  let policySyncCalls = 0
  const win = installWindow({
    vaultStore: async () => undefined,
    vaultRetrieveMany: async () => {
      retrieveCalls += 1
      return { 'settings:apiKey': 'hydrated-from-broadcast' }
    },
    externalActionPolicySync: async () => { policySyncCalls += 1 },
  })

  const store = await import('../src/app/store/settingsStore.ts?broadcast=1')
  const { loadSettings, SETTINGS_STORAGE_KEY } = await import('../src/lib/storage.ts')
  const seen: Array<{ notifications: boolean; apiKey: string }> = []
  const unsubscribe = store.subscribeToSettings((settings) => {
    seen.push({
      notifications: settings.autonomyNotificationsEnabled,
      apiKey: settings.apiKey,
    })
  })

  const snapshot = {
    ...loadSettings(),
    autonomyNotificationsEnabled: true,
  }
  win.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot))

  const peer = new BroadcastChannel('nexus-storage-sync')
  peer.postMessage({
    key: SETTINGS_STORAGE_KEY,
    value: snapshot,
    timestamp: Date.now(),
  })
  dispatchNativeStorage(win, SETTINGS_STORAGE_KEY)
  await flushAsyncHandlers()

  assert.equal(retrieveCalls, 1)
  assert.equal(policySyncCalls, 1)
  assert.deepEqual(seen, [{
    notifications: true,
    apiKey: 'hydrated-from-broadcast',
  }])

  unsubscribe()
  peer.close()
})

test('local settings save suppresses only the self CustomEvent and broadcasts once to peers', async () => {
  FakeBroadcastChannel.reset()
  let policySyncCalls = 0
  const win = installWindow({
    vaultStore: async () => undefined,
    vaultStoreMany: async () => undefined,
    vaultRetrieveMany: async () => ({ 'settings:apiKey': 'hydrated-local-save' }),
    externalActionPolicySync: async () => { policySyncCalls += 1 },
  })
  const store = await import('../src/app/store/settingsStore.ts?broadcast-local-save=1')
  const { loadSettings, SETTINGS_STORAGE_KEY, SETTINGS_UPDATED_EVENT } = await import('../src/lib/storage.ts')
  let customEventCalls = 0
  win.addEventListener(SETTINGS_UPDATED_EVENT, () => { customEventCalls += 1 })
  const seen: string[] = []
  const unsubscribe = store.subscribeToSettings((settings) => seen.push(settings.apiKey))
  const peer = new FakeBroadcastChannel('nexus-storage-sync')
  const peerMessages: unknown[] = []
  peer.onmessage = (event) => peerMessages.push(event.data)

  await store.setSettingsSnapshot({
    ...loadSettings(),
    apiKey: 'local-save-secret',
    autonomyNotificationsEnabled: true,
  })
  await flushAsyncHandlers()

  assert.equal(customEventCalls, 0)
  assert.equal(policySyncCalls, 1)
  assert.deepEqual(seen, ['hydrated-local-save'])
  assert.equal(peerMessages.length, 1)
  const message = peerMessages[0] as {
    key: string
    value: { apiKey?: string; autonomyNotificationsEnabled?: boolean }
  }
  assert.equal(message.key, SETTINGS_STORAGE_KEY)
  assert.equal(message.value.apiKey, '')
  assert.equal(message.value.autonomyNotificationsEnabled, true)

  unsubscribe()
  peer.close()
})

test('native storage mode hydrates and notifies when BroadcastChannel is unavailable', async () => {
  FakeBroadcastChannel.reset()
  let retrieveCalls = 0
  const win = installWindow({
    vaultStore: async () => undefined,
    vaultRetrieveMany: async () => {
      retrieveCalls += 1
      return { 'settings:apiKey': 'hydrated-from-storage' }
    },
  }, { broadcastChannel: false })
  const store = await import('../src/app/store/settingsStore.ts?native=1')
  const { loadSettings, SETTINGS_STORAGE_KEY } = await import('../src/lib/storage.ts')
  const seen: string[] = []
  const unsubscribe = store.subscribeToSettings((settings) => seen.push(settings.apiKey))
  const snapshot = loadSettings()
  win.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot))

  dispatchNativeStorage(win, SETTINGS_STORAGE_KEY)
  await flushAsyncHandlers()

  assert.equal(retrieveCalls, 1)
  assert.deepEqual(seen, ['hydrated-from-storage'])
  unsubscribe()
})

test('last settings subscriber removes the selected sync path before late events arrive', async () => {
  for (const broadcastChannel of [true, false]) {
    FakeBroadcastChannel.reset()
    const win = installWindow({
      vaultStore: async () => undefined,
      vaultRetrieveMany: async () => ({ 'settings:apiKey': 'should-not-arrive' }),
    }, { broadcastChannel })
    const store = await import(`../src/app/store/settingsStore.ts?cleanup=${broadcastChannel}`)
    const { loadSettings, SETTINGS_STORAGE_KEY } = await import('../src/lib/storage.ts')
    const seen: string[] = []
    const unsubscribe = store.subscribeToSettings((settings) => seen.push(settings.apiKey))
    unsubscribe()

    const snapshot = loadSettings()
    win.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot))
    if (broadcastChannel) {
      const peer = new BroadcastChannel('nexus-storage-sync')
      peer.postMessage({ key: SETTINGS_STORAGE_KEY, value: snapshot, timestamp: Date.now() })
      peer.close()
    } else {
      dispatchNativeStorage(win, SETTINGS_STORAGE_KEY)
    }
    await flushAsyncHandlers()

    assert.deepEqual(seen, [])
  }
})
