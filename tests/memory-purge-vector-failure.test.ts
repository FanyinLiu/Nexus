import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clearLogs,
  getLogEntries,
  setConsolePassthrough,
} from '../src/lib/logger.ts'
import {
  purgeClearedMemories,
  purgeDeletedMemory,
} from '../src/lib/storage/purgeMemoryStores.ts'
import type { MemoryItem } from '../src/types/memory.ts'

setConsolePassthrough(false)

const AT = '2026-10-16T03:00:00.000Z'

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mem-vector-failure',
    content: 'vector failure marker',
    category: 'manual',
    source: 'manual',
    createdAt: AT,
    ...overrides,
  }
}

function installStorage(bridge: Record<string, unknown>) {
  const storage = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() },
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
  }
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      desktopPet: bridge,
    },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('a failed clear-all vector wipe is logged and reaches the caller', async () => {
  installStorage({
    memoryVectorClear: async () => {
      throw new Error('vector clear secret')
    },
  })
  clearLogs()
  try {
    await assert.rejects(
      () => purgeClearedMemories([], {}, AT),
      /vector clear secret/,
    )

    const warnings = getLogEntries({ level: 'warn' })
    assert.ok(warnings.some((entry) => entry.message === 'memory vector clear failed'))
    assert.equal(JSON.stringify(warnings).includes('vector clear secret'), false)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('a failed single-memory vector delete is logged without rejecting the background purge', async () => {
  installStorage({
    memoryVectorRemove: async () => {
      throw new Error('vector remove secret')
    },
  })
  clearLogs()
  try {
    purgeDeletedMemory(memory(), AT)
    await new Promise((resolve) => setImmediate(resolve))

    const warnings = getLogEntries({ level: 'warn' })
    assert.ok(warnings.some((entry) => entry.message === 'memory vector remove failed'))
    assert.equal(JSON.stringify(warnings).includes('vector remove secret'), false)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})
