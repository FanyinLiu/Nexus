import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  __resetLongTermMemoryStoreForTests,
  hydrateLongTermMemoryStore,
  installLongTermMemoryQuitFlush,
  loadMemories,
  saveMemories,
  type LongTermMemoryBackend,
} from '../src/lib/storage/memory.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const AT = '2026-10-20T00:00:00.000Z'

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

function createStorage() {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => { values.clear() },
  }
}

function installWindow(storage: ReturnType<typeof createStorage>, desktopPet: Record<string, unknown>) {
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

test('the quit flush handler drains a pending debounced save and acks', async () => {
  __resetLongTermMemoryStoreForTests()
  try {
    const saves: MemoryItem[][] = []
    let acks = 0
    let flushListener: (() => void | Promise<void>) | null = null
    const backend: LongTermMemoryBackend = {
      load: async () => ({ exists: true, memories: [] }),
      save: async (memories) => { saves.push(memories) },
      clear: async () => ({ ok: true }),
    }
    const storage = createStorage()
    installWindow(storage, {
      onMemoryFlushRequest: (listener: () => void | Promise<void>) => {
        flushListener = listener
        return () => { flushListener = null }
      },
      memoryFlushComplete: async () => {
        acks += 1
        return { ok: true }
      },
    })
    await hydrateLongTermMemoryStore({ backend })
    installLongTermMemoryQuitFlush()

    saveMemories([memory('m1', 'first value')])
    saveMemories([memory('m2', 'latest value')])
    assert.equal(saves.length, 0, 'the debounce timer has not fired yet')
    assert.ok(flushListener, 'the renderer subscribed to the quit request')

    await flushListener!()

    assert.equal(acks, 1)
    assert.equal(saves.length, 1)
    assert.deepEqual(saves[0]?.map((row) => row.id), ['m2'])
    assert.deepEqual(loadMemories().map((row) => row.id), ['m2'])
  } finally {
    __resetLongTermMemoryStoreForTests()
    delete (globalThis as { window?: unknown }).window
  }
})
