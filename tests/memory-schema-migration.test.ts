import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MEMORY_STORAGE_KEY,
  MEMORY_V1_BACKUP_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import {
  loadMemories,
  normalizeMemoryItemsForStorage,
} from '../src/lib/storage/memory.ts'

function installStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

const v1 = {
  id: 'legacy-1',
  content: 'I live in Shanghai',
  category: 'profile',
  source: 'chat',
  createdAt: '2026-04-01T00:00:00.000Z',
  importance: 'normal',
  lastUsedAt: '2026-05-01T00:00:00.000Z',
  decayedAt: '2026-06-01T00:00:00.000Z',
  supersededBy: 'newer-1',
  supersededAt: '2026-06-02T00:00:00.000Z',
}

test('v1 memories migrate to v2 without dropping fields and stay idempotent', () => {
  const once = normalizeMemoryItemsForStorage([v1, { id: 'bad', content: '', category: 'manual', source: 'manual', createdAt: '2026-04-01T00:00:00.000Z' }])
  const twice = normalizeMemoryItemsForStorage(once)
  assert.equal(once.length, 1)
  assert.deepEqual(twice, once)
  const row = once[0]!
  assert.equal(row.id, 'legacy-1')
  assert.equal(row.content, 'I live in Shanghai')
  assert.equal(row.category, 'profile')
  assert.equal(row.source, 'chat')
  assert.equal(row.importance, 'normal')
  assert.equal(row.schemaVersion, 2)
  assert.equal(row.status, 'superseded')
  assert.equal(row.supersededBy, 'newer-1')
  assert.equal(row.decayedAt, '2026-06-01T00:00:00.000Z')
  assert.equal(row.updatedAt, '2026-05-01T00:00:00.000Z')
  assert.equal(row.createdAt, '2026-04-01T00:00:00.000Z')
})

test('manual rows become user-confirmed and pending supersession stays active', () => {
  const [manual, pending] = normalizeMemoryItemsForStorage([
    {
      id: 'hand',
      content: 'Remember this name',
      category: 'manual',
      source: 'manual',
      createdAt: '2026-04-01T00:00:00.000Z',
    },
    {
      id: 'pend',
      content: 'Maybe I like tea',
      category: 'preference',
      source: 'chat',
      createdAt: '2026-04-01T00:00:00.000Z',
      supersededBy: 'other',
      supersededPending: true,
    },
  ])
  assert.equal(manual?.userConfirmed, true)
  assert.equal(manual?.status, 'active')
  assert.equal(pending?.status, 'active')
  assert.equal(pending?.supersededBy, 'other')
  assert.equal(pending?.supersededPending, true)
})

test('loadMemories reads a raw v1 blob as v2 without creating a backup key', () => {
  const raw = JSON.stringify([v1])
  const storage = installStorage({ [MEMORY_STORAGE_KEY]: raw })
  try {
    const first = loadMemories()
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)
    assert.equal(first[0]?.schemaVersion, 2)
    assert.equal(first[0]?.content, 'I live in Shanghai')
    const second = loadMemories()
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)
    assert.deepEqual(second, first)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('a corrupt long-term blob is not backed up and does not erase the key', () => {
  const storage = installStorage({ [MEMORY_STORAGE_KEY]: '{not-json' })
  try {
    assert.deepEqual(loadMemories(), [])
    assert.equal(storage.getItem(MEMORY_V1_BACKUP_STORAGE_KEY), null)
    assert.equal(storage.getItem(MEMORY_STORAGE_KEY), '{not-json')
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})
