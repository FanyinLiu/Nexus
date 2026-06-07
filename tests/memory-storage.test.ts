import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  loadDailyMemories,
  loadMemories,
  normalizeDailyMemoryStore,
  normalizeMemoryItemsForStorage,
} from '../src/lib/storage/memory.ts'
import {
  DAILY_MEMORY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
} from '../src/lib/storage/core.ts'

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
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('normalizeMemoryItemsForStorage sanitizes rich memory metadata and dedupes ids', () => {
  const memories = normalizeMemoryItemsForStorage([
    {
      id: ' same ',
      content: '  remember this  ',
      category: 'bad',
      source: '',
      kind: 'bad',
      enabled: 'yes',
      createdAt: '2026-06-04T00:00:00Z',
      lastUsedAt: 'bad',
      importance: 'pinned',
      importanceScore: 9,
      recallCount: -2,
      lastRecalledAt: '2026-06-04T01:00:00Z',
      relatedIds: [' a ', 'a', '', 'b'],
      emotionSnapshot: { energy: 2, warmth: -1, curiosity: 0.5, concern: Number.NaN },
      emotionalValence: 'bad',
      significance: 2,
      reflectionTopic: ` ${'topic '.repeat(40)} `,
      reflectionConfidence: -1,
    },
    {
      id: 'same',
      content: 'duplicate should drop',
      category: 'manual',
      source: 'manual',
      createdAt: '2026-06-04T02:00:00Z',
    },
    { id: 'bad-content', content: '', category: 'manual', source: 'manual', createdAt: '2026-06-04T00:00:00Z' },
  ])

  assert.equal(memories.length, 1)
  assert.deepEqual(memories[0], {
    id: 'same',
    content: 'remember this',
    category: 'manual',
    source: 'storage',
    enabled: true,
    createdAt: '2026-06-04T00:00:00.000Z',
    importance: 'pinned',
    importanceScore: 2,
    recallCount: 0,
    lastRecalledAt: '2026-06-04T01:00:00.000Z',
    relatedIds: ['a', 'b'],
    significance: 1,
    reflectionTopic: 'topic topic topic topic topic topic topic topic topic topic topic topic topic topic topic topic topic topic topic topic',
    reflectionConfidence: 0,
  })
})

test('loadMemories compacts current store and writes normalized values back', () => {
  const storage = installStorage({
    [MEMORY_STORAGE_KEY]: JSON.stringify([
      { id: 'm1', content: '  memory  ', category: 'goal', source: 'chat', createdAt: '2026-06-04T00:00:00Z' },
      { id: 'bad', content: 42, category: 'manual', source: 'manual', createdAt: '2026-06-04T00:00:00Z' },
    ]),
  })

  const memories = loadMemories()

  assert.deepEqual(memories, [{
    id: 'm1',
    content: 'memory',
    category: 'goal',
    source: 'chat',
    enabled: true,
    createdAt: '2026-06-04T00:00:00.000Z',
  }])
  assert.deepEqual(JSON.parse(storage.getItem(MEMORY_STORAGE_KEY) ?? '[]'), memories)
})

test('loadMemories migrates sanitized legacy memories when current store is empty', () => {
  const storage = installStorage({
    [LEGACY_MEMORY_STORAGE_KEY]: JSON.stringify([
      { id: 'legacy-1', content: 'legacy memory', category: 'preference', source: 'chat', createdAt: '2026-06-04T00:00:00Z' },
      { id: 'legacy-bad', content: '', category: 'manual', source: 'manual', createdAt: '2026-06-04T00:00:00Z' },
    ]),
  })

  const memories = loadMemories()

  assert.equal(memories.length, 1)
  assert.equal(memories[0]?.id, 'legacy-1')
  assert.deepEqual(JSON.parse(storage.getItem(MEMORY_STORAGE_KEY) ?? '[]'), memories)
})

test('normalizeDailyMemoryStore repairs day keys, filters entries, and caps per day', () => {
  const store = normalizeDailyMemoryStore({
    'bad-day': [
      { id: 'd1', day: 'ignored', role: 'user', content: '  user note  ', source: 'voice', createdAt: '2026-06-04T00:00:00Z' },
      { id: 'drop-role', role: 'system', content: 'drop', source: 'chat', createdAt: '2026-06-04T00:00:00Z' },
    ],
    '2026-06-04': Array.from({ length: 20 }, (_, index) => ({
      id: `id-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `entry ${index}`,
      source: 'chat',
      createdAt: `2026-06-04T00:00:${String(index).padStart(2, '0')}Z`,
    })),
  })

  assert.equal(Object.keys(store).length, 1)
  assert.equal(store['2026-06-04']?.length, 16)
  assert.deepEqual(store['2026-06-04']?.find((entry) => entry.id === 'd1'), {
    id: 'd1',
    day: '2026-06-04',
    role: 'user',
    content: 'user note',
    source: 'voice',
    createdAt: '2026-06-04T00:00:00.000Z',
  })
  assert.deepEqual(store['2026-06-04']?.find((entry) => entry.id === 'id-0'), {
    id: 'id-0',
    day: '2026-06-04',
    role: 'user',
    content: 'entry 0',
    source: 'chat',
    createdAt: '2026-06-04T00:00:00.000Z',
  })
})

test('loadDailyMemories writes normalized daily store back to storage', () => {
  const storage = installStorage({
    [DAILY_MEMORY_STORAGE_KEY]: JSON.stringify({
      '2026-06-04': [
        { id: 'd1', role: 'assistant', content: '  answer  ', source: 'bad', createdAt: '2026-06-04T00:00:00Z' },
        { id: 'd2', role: 'assistant', content: '', source: 'chat', createdAt: '2026-06-04T00:00:00Z' },
      ],
    }),
  })

  const daily = loadDailyMemories()

  assert.deepEqual(daily, {
    '2026-06-04': [{
      id: 'd1',
      day: '2026-06-04',
      role: 'assistant',
      content: 'answer',
      source: 'chat',
      createdAt: '2026-06-04T00:00:00.000Z',
    }],
  })
  assert.deepEqual(JSON.parse(storage.getItem(DAILY_MEMORY_STORAGE_KEY) ?? '{}'), daily)
})
