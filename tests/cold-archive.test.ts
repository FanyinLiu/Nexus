import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ARCHIVE_STORAGE_KEY,
  archiveMemories,
  getArchiveStats,
  loadArchive,
  restoreFromArchive,
  saveArchive,
  searchArchive,
} from '../src/features/memory/coldArchive.ts'
import type { ArchivedMemory, MemoryItem } from '../src/types/memory.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

function archived(overrides: Partial<ArchivedMemory> = {}): ArchivedMemory {
  return {
    id: 'archived-a',
    content: 'Remember the launch checklist',
    category: 'project',
    source: 'chat',
    createdAt: '2026-05-01T00:00:00.000Z',
    archivedAt: '2026-06-01T00:00:00.000Z',
    finalScore: 0.12,
    importance: 'low',
    ...overrides,
  }
}

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'memory-a',
    content: 'Old low importance note',
    category: 'project',
    source: 'chat',
    createdAt: '2026-01-01T00:00:00.000Z',
    importance: 'low',
    importanceScore: 0.01,
    ...overrides,
  }
}

test('loadArchive compacts malformed entries and normalizes fields', () => {
  const storage = installStorage()
  const live = {
    id: ' archived-live ',
    content: '  Launch checklist  ',
    category: 'project',
    source: ' chat ',
    createdAt: '2026-05-01T00:00:00.000Z',
    archivedAt: '2026-06-01T00:00:00.000Z',
    finalScore: -0.2,
    importance: 'unknown',
    clusterId: ' cluster-a ',
  }
  storage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify([
    live,
    { ...live, id: 'bad-created', createdAt: 'not-a-date' },
    { ...live, id: 'bad-archived', archivedAt: 'not-a-date' },
    { ...live, id: 'bad-category', category: 'unknown' },
    { ...live, id: 'bad-content', content: '   ' },
  ]))

  const archive = loadArchive()

  assert.deepEqual(archive, [{
    id: 'archived-live',
    content: 'Launch checklist',
    category: 'project',
    source: 'chat',
    createdAt: '2026-05-01T00:00:00.000Z',
    archivedAt: '2026-06-01T00:00:00.000Z',
    finalScore: 0,
    clusterId: 'cluster-a',
  }])
  assert.deepEqual(JSON.parse(storage.getItem(ARCHIVE_STORAGE_KEY) ?? '[]'), archive)
})

test('saveArchive sorts by archivedAt, de-dupes ids, and caps stored archive', () => {
  installStorage()
  saveArchive([
    archived({ id: 'same', archivedAt: '2026-06-01T00:00:00.000Z', content: 'older same' }),
    archived({ id: 'same', archivedAt: '2026-06-03T00:00:00.000Z', content: 'newer same' }),
    ...Array.from({ length: 520 }, (_, index) => archived({
      id: `memory-${index}`,
      archivedAt: `2026-05-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      content: `content ${index}`,
    })),
  ])

  const archive = loadArchive()
  assert.equal(archive.length, 500)
  assert.equal(archive[0]?.id, 'same')
  assert.equal(archive[0]?.content, 'newer same')
  assert.ok(
    Date.parse(archive[0]!.archivedAt) >= Date.parse(archive[1]!.archivedAt),
    'archive should be sorted newest first',
  )
})

test('searchArchive rejects blank queries and normalizes limits', () => {
  installStorage()
  saveArchive([
    archived({ id: 'a', content: 'alpha launch note' }),
    archived({ id: 'b', content: 'beta launch note', archivedAt: '2026-06-02T00:00:00.000Z' }),
  ])

  assert.deepEqual(searchArchive('   '), [])
  assert.deepEqual(searchArchive('launch', 0), [])
  assert.deepEqual(searchArchive('launch', -1), [])
  assert.deepEqual(searchArchive('launch', 1).map((item) => item.id), ['b'])
})

test('restoreFromArchive removes the archived entry and returns an active memory shape', () => {
  installStorage()
  saveArchive([archived({ id: 'restore-me', importance: 'low' })])

  const result = restoreFromArchive('restore-me')

  assert.equal(result.restored?.id, 'restore-me')
  assert.equal(result.restored?.importance, 'low')
  assert.equal(result.restored?.importanceScore, 0.5)
  assert.deepEqual(loadArchive(), [])
})

test('archiveMemories removes candidates from active memories and replaces existing archive ids', () => {
  installStorage()
  saveArchive([archived({
    id: 'memory-a',
    content: 'old archive copy',
    archivedAt: '2026-05-01T00:00:00.000Z',
  })])

  const candidate = memory({ id: 'memory-a', content: 'new archived copy' })
  const keep = memory({ id: 'memory-b', content: 'keep active' })
  const result = archiveMemories([candidate, keep], [candidate], new Map([['memory-a', 'cluster-x']]))

  assert.deepEqual(result.active.map((item) => item.id), ['memory-b'])
  assert.equal(result.newlyArchived.length, 1)
  const archive = loadArchive()
  assert.equal(archive.length, 1)
  assert.equal(archive[0]?.content, 'new archived copy')
  assert.equal(archive[0]?.clusterId, 'cluster-x')
})

test('getArchiveStats reports oldest and newest from normalized archive order', () => {
  installStorage()
  saveArchive([
    archived({ id: 'old', archivedAt: '2026-05-01T00:00:00.000Z' }),
    archived({ id: 'new', archivedAt: '2026-06-01T00:00:00.000Z' }),
  ])

  assert.deepEqual(getArchiveStats(), {
    count: 2,
    oldestAt: '2026-05-01T00:00:00.000Z',
    newestAt: '2026-06-01T00:00:00.000Z',
  })
})
