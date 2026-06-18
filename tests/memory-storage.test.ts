import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildMemoryOwnershipEvidenceReport,
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
      sourceRef: ' chat:message-42 ',
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
    sourceRef: 'chat:message-42',
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
      {
        id: 'd1',
        day: 'ignored',
        role: 'user',
        content: '  user note  ',
        source: 'voice',
        sourceRef: ' voice:msg-1 ',
        createdAt: '2026-06-04T00:00:00Z',
      },
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
    sourceRef: 'voice:msg-1',
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

test('buildMemoryOwnershipEvidenceReport summarizes memory control coverage without private content', () => {
  const memories = normalizeMemoryItemsForStorage([
    {
      id: 'private-long-term-1',
      content: 'private preference content',
      category: 'preference',
      source: 'chat',
      createdAt: '2026-06-16T10:00:00Z',
      importance: 'pinned',
      sourceRef: 'chat:private-message-1',
    },
    {
      id: 'private-reflection-1',
      content: 'private reflection content',
      category: 'feedback',
      source: 'dream',
      createdAt: '2026-06-16T11:00:00Z',
      enabled: false,
      importance: 'reflection',
      reflectionTopic: 'private-topic',
      sourceRef: 'arc:private-arc-1',
    },
  ])
  const daily = normalizeDailyMemoryStore({
    '2026-06-16': [
      {
        id: 'private-daily-1',
        role: 'user',
        content: 'private diary content',
        source: 'voice',
        sourceRef: 'voice:private-voice-1',
        createdAt: '2026-06-16T12:00:00Z',
      },
    ],
  })

  const report = buildMemoryOwnershipEvidenceReport(memories, daily, '2026-06-16T13:00:00Z')
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))
  const json = JSON.stringify(report)

  assert.equal(report.gate, 'memory-ownership-observability')
  assert.equal(report.generatedAt, '2026-06-16T13:00:00.000Z')
  assert.equal(report.longTermCount, 2)
  assert.equal(report.dailyEntryCount, 1)
  assert.equal(report.relationshipInsightCount, 1)
  assert.equal(report.pinnedCount, 1)
  assert.equal(report.recallPausedCount, 1)
  assert.equal(report.sourceRefCount, 3)
  assert.equal(report.sourceRefCoverage, 1)
  assert.equal(report.openableSourceRefCount, 3)
  assert.deepEqual(report.sourceKindCounts, { arc: 1, chat: 1, voice: 1 })
  assert.equal(checks.get('has-long-term-memories'), true)
  assert.equal(checks.get('has-daily-entries'), true)
  assert.equal(checks.get('has-relationship-reflection-lane'), true)
  assert.equal(checks.get('has-openable-source-refs'), true)
  assert.equal(checks.get('has-recall-governance'), true)
  assert.equal(checks.get('has-editable-data'), true)
  assert.equal(report.qualityIssueCount, 0)
  assert.equal(
    /private preference content|private reflection content|private diary content|private-message-1|private-arc-1|private-voice-1|private-topic/.test(json),
    false,
  )
})

test('buildMemoryOwnershipEvidenceReport keeps missing ownership evidence explicit', () => {
  const report = buildMemoryOwnershipEvidenceReport([], {}, 'bad-date')
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))

  assert.equal(report.longTermCount, 0)
  assert.equal(report.dailyEntryCount, 0)
  assert.equal(report.sourceRefCoverage, 0)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'no-long-term-memories'), true)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'no-source-refs'), true)
  assert.equal(checks.get('has-long-term-memories'), false)
  assert.equal(checks.get('has-daily-entries'), false)
  assert.equal(checks.get('has-editable-data'), false)
  assert.equal(Number.isFinite(Date.parse(report.generatedAt)), true)
})
