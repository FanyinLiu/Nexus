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
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: FakeBroadcastChannel,
    configurable: true,
    writable: true,
  })
}

async function flushAsyncHandlers() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('subscribeToSettings observes cross-window settings broadcasts', async () => {
  FakeBroadcastChannel.reset()
  installWindow({
    vaultStore: async () => undefined,
    vaultRetrieveMany: async () => ({
      'settings:apiKey': 'hydrated-from-broadcast',
    }),
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

  const peer = new BroadcastChannel('nexus-storage-sync')
  peer.postMessage({
    key: SETTINGS_STORAGE_KEY,
    value: {
      ...loadSettings(),
      autonomyNotificationsEnabled: true,
    },
    timestamp: Date.now(),
  })
  await flushAsyncHandlers()

  assert.deepEqual(seen, [{
    notifications: true,
    apiKey: 'hydrated-from-broadcast',
  }])

  unsubscribe()
  peer.close()
})
