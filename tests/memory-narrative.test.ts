import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  NARRATIVE_STORAGE_KEY,
  formatNarrativeForPrompt,
  loadNarrative,
  rebuildNarrative,
  saveNarrative,
  type NarrativeSnapshot,
} from '../src/features/memory/narrativeMemory.ts'
import type { MemoryItem } from '../src/types/memory.ts'

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

function memory(overrides: Partial<MemoryItem> & { id: string; content: string }): MemoryItem {
  return {
    category: 'project',
    source: 'chat',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as MemoryItem
}

test('loadNarrative compacts malformed threads and normalizes fields', () => {
  const storage = installStorage()
  const liveThread = {
    id: ' thread-live ',
    title: '  Launch thread  ',
    memoryIds: [' a ', 'b', 'a', ''],
    summary: '  first step -> second step  ',
    startedAt: '2026-06-01T00:00:00.000Z',
    lastUpdatedAt: '2026-06-03T00:00:00.000Z',
    dreamTouchCount: 2.9,
  }
  storage.setItem(NARRATIVE_STORAGE_KEY, JSON.stringify({
    generatedAt: 'not-a-date',
    threads: [
      liveThread,
      { ...liveThread, id: 'bad-started', startedAt: 'not-a-date' },
      { ...liveThread, id: 'bad-memory-ids', memoryIds: ['only-one'] },
      { ...liveThread, id: 'bad-summary', summary: '   ' },
    ],
  }))

  const snapshot = loadNarrative()

  assert.deepEqual(snapshot, {
    generatedAt: '',
    threads: [{
      id: 'thread-live',
      title: 'Launch thread',
      memoryIds: ['a', 'b'],
      summary: 'first step -> second step',
      startedAt: '2026-06-01T00:00:00.000Z',
      lastUpdatedAt: '2026-06-03T00:00:00.000Z',
      dreamTouchCount: 2,
    }],
  })
  assert.deepEqual(JSON.parse(storage.getItem(NARRATIVE_STORAGE_KEY) ?? '{}'), snapshot)
})

test('saveNarrative normalizes and caps stored snapshots', () => {
  const storage = installStorage()
  const snapshot: NarrativeSnapshot = {
    generatedAt: '2026-06-04T00:00:00.000Z',
    threads: Array.from({ length: 20 }, (_, index) => ({
      id: `thread-${index}`,
      title: `Thread ${index}`,
      memoryIds: [`a-${index}`, `b-${index}`],
      summary: `Summary ${index}`,
      startedAt: '2026-06-01T00:00:00.000Z',
      lastUpdatedAt: `2026-06-${String((index % 9) + 1).padStart(2, '0')}T00:00:00.000Z`,
      dreamTouchCount: index,
    })),
  }

  saveNarrative(snapshot)

  const stored = JSON.parse(storage.getItem(NARRATIVE_STORAGE_KEY) ?? '{}') as NarrativeSnapshot
  assert.equal(stored.threads.length, 15)
  assert.equal(stored.generatedAt, '2026-06-04T00:00:00.000Z')
  assert.ok(
    Date.parse(stored.threads[0]!.lastUpdatedAt) >= Date.parse(stored.threads[1]!.lastUpdatedAt),
    'threads should be sorted by recency',
  )
})

test('formatNarrativeForPrompt does not surface malformed time text', () => {
  installStorage({
    [NARRATIVE_STORAGE_KEY]: JSON.stringify({
      generatedAt: '2026-06-04T00:00:00.000Z',
      threads: [{
        id: 'bad',
        title: 'Bad',
        memoryIds: ['a', 'b'],
        summary: 'Should be dropped',
        startedAt: 'not-a-date',
        lastUpdatedAt: '2026-06-03T00:00:00.000Z',
        dreamTouchCount: 1,
      }],
    }),
  })

  assert.equal(formatNarrativeForPrompt(), '')
})

test('rebuildNarrative builds related-memory threads and preserves touch count', () => {
  const storage = installStorage()
  storage.setItem(NARRATIVE_STORAGE_KEY, JSON.stringify({
    generatedAt: '2026-06-02T00:00:00.000Z',
    threads: [{
      id: 'existing-thread',
      title: 'Existing',
      memoryIds: ['a', 'b'],
      summary: 'Old summary',
      startedAt: '2026-06-01T00:00:00.000Z',
      lastUpdatedAt: '2026-06-02T00:00:00.000Z',
      dreamTouchCount: 4,
    }],
  }))

  const snapshot = rebuildNarrative([
    memory({
      id: 'a',
      content: 'First launch note',
      createdAt: '2026-06-01T00:00:00.000Z',
      relatedIds: ['b'],
    }),
    memory({
      id: 'b',
      content: 'Second launch note',
      createdAt: '2026-06-02T00:00:00.000Z',
      lastUsedAt: '2026-06-03T00:00:00.000Z',
      relatedIds: ['a'],
    }),
    memory({
      id: 'c',
      content: 'Unrelated one-off',
      createdAt: '2026-06-04T00:00:00.000Z',
    }),
  ])

  assert.equal(snapshot.threads.length, 1)
  assert.equal(snapshot.threads[0]?.id, 'existing-thread')
  assert.equal(snapshot.threads[0]?.dreamTouchCount, 5)
  assert.deepEqual(snapshot.threads[0]?.memoryIds, ['a', 'b'])
  assert.match(formatNarrativeForPrompt(), /First launch note/)
})
