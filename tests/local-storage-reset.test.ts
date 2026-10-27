import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { createLongTermMemoryFileStore } from '../electron/services/longTermMemoryFileStore.js'
import {
  __resetLongTermMemoryStoreForTests,
  hydrateLongTermMemoryStore,
  loadMemories,
  type LongTermMemoryBackend,
} from '../src/lib/storage/memory.ts'
import {
  AMBIENT_PRESENCE_STORAGE_KEY,
  CHAT_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  MEMORY_V1_BACKUP_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  PRESENCE_HISTORY_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import { resetLocalStorage } from '../src/lib/storage/localStorageReset.ts'
import { purgeClearedMemories } from '../src/lib/storage/purgeMemoryStores.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../src/lib/settingsMigrations.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const AT = '2026-10-20T00:00:00.000Z'
const SECRET = 'NEXUSLOCALRESET-9K-secret-memory'

const SETTINGS = JSON.stringify({
  uiLanguage: 'ja-JP',
  settingsSchemaVersion: 22,
  memoryEnabled: true,
  voiceEnabled: false,
  personaName: 'Klein Companion',
  companionName: 'Nexus',
})
const CHAT = JSON.stringify([{ id: 'chat-1', role: 'user', content: 'keep this chat' }])
const ONBOARDING = JSON.stringify({ completedAt: AT, firstConversationAt: AT })

function memory(id: string, content: string): MemoryItem {
  return {
    id,
    content,
    category: 'manual',
    source: 'manual',
    createdAt: AT,
    schemaVersion: 2,
    status: 'active',
    updatedAt: AT,
  }
}

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
    entries: () => Object.fromEntries(values),
  }
}

function installWindow(storage: ReturnType<typeof createStorage>, desktopPet: Record<string, unknown> = {}) {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: storage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: () => undefined,
      dispatchEvent: () => true,
      desktopPet,
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
}

function createBackend(filePath: string): LongTermMemoryBackend {
  const store = createLongTermMemoryFileStore({ filePath })
  return {
    load: () => store.load(),
    save: (memories) => store.save(memories),
    clear: () => store.clear(),
  }
}

test('migration moves MEMORY_STORAGE_KEY into the file store and keeps settings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-migrate-'))
  __resetLongTermMemoryStoreForTests()
  try {
    const filePath = path.join(dir, 'memory', 'long-term-memory.json')
    const store = createLongTermMemoryFileStore({ filePath })
    const storage = createStorage({
      [SETTINGS_STORAGE_KEY]: SETTINGS,
      [CHAT_STORAGE_KEY]: CHAT,
      [ONBOARDING_STORAGE_KEY]: ONBOARDING,
      [MEMORY_STORAGE_KEY]: JSON.stringify([memory('m1', SECRET)]),
      [MEMORY_V1_BACKUP_STORAGE_KEY]: JSON.stringify([memory('m1', SECRET)]),
    })
    installWindow(storage)
    let resetCalls = 0
    const resetBridge = {
      memoryResetLocalStorage: async () => {
        resetCalls += 1
        storage.clear()
        return { ok: true }
      },
    }

    await hydrateLongTermMemoryStore({ backend: createBackend(filePath), resetBridge })

    assert.deepEqual(loadMemories().map((row) => row.content), [SECRET])
    assert.equal((await store.load()).exists, true)
    assert.equal(resetCalls, 1)
    assert.equal(storage.getItem(MEMORY_STORAGE_KEY), null)
    assert.equal(storage.getItem(LEGACY_MEMORY_STORAGE_KEY), null)
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)
    assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
    assert.equal(storage.getItem(CHAT_STORAGE_KEY), CHAT)
    assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), ONBOARDING)
  } finally {
    delete (globalThis as { window?: unknown }).window
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('migration falls back to the legacy key and removes every memory key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-legacy-'))
  __resetLongTermMemoryStoreForTests()
  try {
    const filePath = path.join(dir, 'memory', 'long-term-memory.json')
    const store = createLongTermMemoryFileStore({ filePath })
    const storage = createStorage({
      [SETTINGS_STORAGE_KEY]: SETTINGS,
      [LEGACY_MEMORY_STORAGE_KEY]: JSON.stringify([memory('legacy-1', SECRET)]),
      [MEMORY_V1_BACKUP_STORAGE_KEY]: JSON.stringify([memory('legacy-1', SECRET)]),
    })
    installWindow(storage)
    let resetCalls = 0

    await hydrateLongTermMemoryStore({
      backend: createBackend(filePath),
      resetBridge: {
        memoryResetLocalStorage: async () => {
          resetCalls += 1
          storage.clear()
          return { ok: true }
        },
      },
    })

    assert.deepEqual(loadMemories().map((row) => row.id), ['legacy-1'])
    assert.equal((await store.load()).memories.length, 1)
    assert.equal(resetCalls, 1)
    assert.equal(storage.getItem(LEGACY_MEMORY_STORAGE_KEY), null)
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)
    assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
  } finally {
    delete (globalThis as { window?: unknown }).window
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('a failed migration save leaves localStorage untouched and skips the reset', async () => {
  __resetLongTermMemoryStoreForTests()
  try {
    const memoryBlob = JSON.stringify([memory('m1', SECRET)])
    const storage = createStorage({
      [SETTINGS_STORAGE_KEY]: SETTINGS,
      [CHAT_STORAGE_KEY]: CHAT,
      [MEMORY_STORAGE_KEY]: memoryBlob,
      [MEMORY_V1_BACKUP_STORAGE_KEY]: memoryBlob,
    })
    installWindow(storage)
    let resetCalls = 0
    const backend: LongTermMemoryBackend = {
      load: async () => ({ exists: false, memories: [] }),
      save: async () => { throw new Error('disk full') },
      clear: async () => ({ ok: true }),
    }

    await hydrateLongTermMemoryStore({
      backend,
      resetBridge: {
        memoryResetLocalStorage: async () => {
          resetCalls += 1
          storage.clear()
          return { ok: true }
        },
      },
    })

    assert.equal(resetCalls, 0)
    assert.equal(storage.getItem(MEMORY_STORAGE_KEY), memoryBlob)
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), memoryBlob)
    assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
    assert.equal(storage.getItem(CHAT_STORAGE_KEY), CHAT)
    assert.deepEqual(loadMemories().map((row) => row.content), [SECRET])
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('an existing file wins over leftover localStorage memory keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-file-wins-'))
  __resetLongTermMemoryStoreForTests()
  try {
    const filePath = path.join(dir, 'memory', 'long-term-memory.json')
    const store = createLongTermMemoryFileStore({ filePath })
    await store.save([memory('file-1', 'file wins')])
    const storage = createStorage({
      [SETTINGS_STORAGE_KEY]: SETTINGS,
      [MEMORY_STORAGE_KEY]: JSON.stringify([memory('stale-1', SECRET)]),
    })
    installWindow(storage)
    let resetCalls = 0

    await hydrateLongTermMemoryStore({
      backend: createBackend(filePath),
      resetBridge: {
        memoryResetLocalStorage: async () => {
          resetCalls += 1
          storage.clear()
          return { ok: true }
        },
      },
    })

    assert.deepEqual(loadMemories().map((row) => row.id), ['file-1'])
    assert.equal(resetCalls, 1)
    assert.equal(storage.getItem(MEMORY_STORAGE_KEY), null)
    assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
  } finally {
    delete (globalThis as { window?: unknown }).window
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt file is backed up and never overwritten with an empty store during hydration', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-corrupt-hydrate-'))
  __resetLongTermMemoryStoreForTests()
  try {
    const filePath = path.join(dir, 'memory', 'long-term-memory.json')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, `[{"content":"${SECRET}"`, 'utf8')
    const storage = createStorage({ [SETTINGS_STORAGE_KEY]: SETTINGS })
    installWindow(storage)
    let resetCalls = 0

    await hydrateLongTermMemoryStore({
      backend: createBackend(filePath),
      resetBridge: {
        memoryResetLocalStorage: async () => {
          resetCalls += 1
          storage.clear()
          return { ok: true }
        },
      },
    })

    assert.deepEqual(loadMemories(), [])
    assert.equal(resetCalls, 0)
    assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
    await assert.rejects(() => fs.access(filePath))
    const entries = await fs.readdir(path.dirname(filePath))
    assert.equal(entries.filter((name) => name.startsWith('long-term-memory.corrupt-')).length, 1)
  } finally {
    delete (globalThis as { window?: unknown }).window
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('clear-all deletes the file, resets localStorage, and keeps settings byte-for-byte', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-clear-all-'))
  __resetLongTermMemoryStoreForTests()
  try {
    const filePath = path.join(dir, 'memory', 'long-term-memory.json')
    const store = createLongTermMemoryFileStore({ filePath })
    await store.save([memory('m1', SECRET)])
    const storage = createStorage({
      [SETTINGS_STORAGE_KEY]: SETTINGS,
      [CHAT_STORAGE_KEY]: CHAT,
      [ONBOARDING_STORAGE_KEY]: ONBOARDING,
      [MEMORY_STORAGE_KEY]: JSON.stringify([memory('m1', SECRET)]),
      [MEMORY_V1_BACKUP_STORAGE_KEY]: JSON.stringify([memory('m1', SECRET)]),
    })
    let resetCalls = 0
    const vectorCalls: string[][] = []
    installWindow(storage, {
      memoryResetLocalStorage: async () => {
        resetCalls += 1
        storage.clear()
        return { ok: true }
      },
      memoryVectorClear: async (payload?: { needles?: string[] }) => {
        vectorCalls.push(payload?.needles ?? [])
        return { ok: true, removed: 0, localDataCleared: true }
      },
    })
    await hydrateLongTermMemoryStore({ backend: createBackend(filePath) })
    resetCalls = 0

    await purgeClearedMemories([memory('m1', SECRET)], {}, AT)

    assert.deepEqual(await store.load(), { exists: false, memories: [] })
    assert.deepEqual(loadMemories(), [])
    assert.equal(resetCalls, 1)
    assert.equal(vectorCalls.length, 1)
    assert.equal(storage.getItem(MEMORY_STORAGE_KEY), null)
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)
    assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
    assert.equal(storage.getItem(CHAT_STORAGE_KEY), CHAT)
    assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), ONBOARDING)
  } finally {
    delete (globalThis as { window?: unknown }).window
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('a v1-shaped blob never creates the backup key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-no-backup-'))
  __resetLongTermMemoryStoreForTests()
  try {
    const storage = createStorage({
      [MEMORY_STORAGE_KEY]: JSON.stringify([{
        id: 'legacy-1',
        content: 'I live in Shanghai',
        category: 'profile',
        source: 'chat',
        createdAt: '2026-04-01T00:00:00.000Z',
      }]),
    })
    installWindow(storage)

    assert.equal(loadMemories().length, 1)
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)

    const filePath = path.join(dir, 'memory', 'long-term-memory.json')
    await hydrateLongTermMemoryStore({
      backend: createBackend(filePath),
      resetBridge: {
        memoryResetLocalStorage: async () => {
          storage.clear()
          return { ok: true }
        },
      },
    })
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)
    assert.equal(loadMemories().length, 1)
  } finally {
    delete (globalThis as { window?: unknown }).window
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('reset restores the snapshot even when the bridge fails', async () => {
  const storage = createStorage({
    [SETTINGS_STORAGE_KEY]: SETTINGS,
    [MEMORY_STORAGE_KEY]: JSON.stringify([memory('m1', SECRET)]),
  })
  const result = await resetLocalStorage({
    storage: storage as unknown as Storage,
    bridge: {
      memoryResetLocalStorage: async () => {
        throw new Error('bridge unavailable')
      },
    },
    flush: () => true,
  })

  assert.equal(result.ok, false)
  assert.equal(result.resetCalled, false)
  assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
  assert.equal(storage.getItem(MEMORY_STORAGE_KEY), null)
})

test('resetLocalStorage removes presence keys and never writes them back', async () => {
  const storage = createStorage({
    [SETTINGS_STORAGE_KEY]: SETTINGS,
    [CHAT_STORAGE_KEY]: CHAT,
    [MEMORY_STORAGE_KEY]: JSON.stringify([memory('m1', SECRET)]),
    [AMBIENT_PRESENCE_STORAGE_KEY]: JSON.stringify({
      text: `you told me ${SECRET}`,
      createdAt: AT,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    [PRESENCE_HISTORY_STORAGE_KEY]: JSON.stringify([
      { text: `remember ${SECRET}`, category: 'memory', createdAt: AT },
    ]),
  })
  let resetCalls = 0

  const result = await resetLocalStorage({
    storage: storage as unknown as Storage,
    bridge: {
      memoryResetLocalStorage: async () => {
        resetCalls += 1
        return { ok: true }
      },
    },
    flush: () => true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.resetCalled, true)
  assert.equal(resetCalls, 1)
  assert.equal(storage.getItem(AMBIENT_PRESENCE_STORAGE_KEY), null)
  assert.equal(storage.getItem(PRESENCE_HISTORY_STORAGE_KEY), null)
  assert.equal(storage.getItem(MEMORY_STORAGE_KEY), null)
  assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
  assert.equal(storage.getItem(CHAT_STORAGE_KEY), CHAT)
})

test('migration hydration drops presence keys along with the memory keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-presence-'))
  __resetLongTermMemoryStoreForTests()
  try {
    const filePath = path.join(dir, 'memory', 'long-term-memory.json')
    const store = createLongTermMemoryFileStore({ filePath })
    const storage = createStorage({
      [SETTINGS_STORAGE_KEY]: SETTINGS,
      [MEMORY_STORAGE_KEY]: JSON.stringify([memory('m1', SECRET)]),
      [MEMORY_V1_BACKUP_STORAGE_KEY]: JSON.stringify([memory('m1', SECRET)]),
      [AMBIENT_PRESENCE_STORAGE_KEY]: JSON.stringify({
        text: `you told me ${SECRET}`,
        createdAt: AT,
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
      [PRESENCE_HISTORY_STORAGE_KEY]: JSON.stringify([
        { text: `remember ${SECRET}`, category: 'memory', createdAt: AT },
      ]),
    })
    installWindow(storage)

    await hydrateLongTermMemoryStore({
      backend: createBackend(filePath),
      resetBridge: {
        memoryResetLocalStorage: async () => {
          storage.clear()
          return { ok: true }
        },
      },
    })

    assert.deepEqual(loadMemories().map((row) => row.content), [SECRET])
    assert.equal((await store.load()).exists, true)
    assert.equal(storage.getItem(AMBIENT_PRESENCE_STORAGE_KEY), null)
    assert.equal(storage.getItem(PRESENCE_HISTORY_STORAGE_KEY), null)
    assert.equal(storage.getItem(MEMORY_STORAGE_KEY), null)
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)
    assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), SETTINGS)
  } finally {
    delete (globalThis as { window?: unknown }).window
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('CURRENT_SETTINGS_SCHEMA_VERSION stays 23', () => {
  assert.equal(CURRENT_SETTINGS_SCHEMA_VERSION, 23)
})
