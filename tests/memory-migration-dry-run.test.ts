import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildMemoryStorageMigrationDryRun,
  loadMemoryStorageMigrationDryRun,
} from '../src/lib/storage/memoryMigrationDryRun.ts'
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
    snapshot: () => Object.fromEntries(store.entries()),
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('memory migration dry-run reports empty storage without writing data', () => {
  const storage = installStorage()
  const before = storage.snapshot()

  const report = loadMemoryStorageMigrationDryRun({
    now: new Date('2026-06-19T12:00:00.000Z'),
  })

  assert.equal(report.status, 'empty')
  assert.equal(report.generatedAt, '2026-06-19T12:00:00.000Z')
  assert.equal(report.totals.longTermMemoryCount, 0)
  assert.equal(report.totals.dailyEntryCount, 0)
  assert.equal(report.migrationPlan.writeRecords, false)
  assert.equal(report.migrationPlan.nextStep, 'no-op')
  assert.deepEqual(storage.snapshot(), before)
  assert.ok(report.issues.some((item) => item.code === 'no-memory-data'))
})

test('memory migration dry-run summarizes memory storage without exposing content', () => {
  const report = buildMemoryStorageMigrationDryRun({
    longTermRaw: JSON.stringify([
      {
        id: 'secret-memory-id',
        content: 'private preference about evenings',
        category: 'preference',
        source: 'private source label',
        sourceRef: 'private-source-ref',
        kind: 'relationship',
        importance: 'pinned',
        relatedIds: ['related-secret-id'],
        enabled: false,
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    ]),
    legacyRaw: null,
    dailyRaw: JSON.stringify({
      '2026-06-02': [{
        id: 'secret-daily-id',
        day: '2026-06-02',
        role: 'user',
        content: 'private diary fragment',
        source: 'voice',
        createdAt: '2026-06-02T10:00:00.000Z',
      }],
    }),
  }, {
    now: '2026-06-19T12:00:00.000Z',
  })

  assert.equal(report.status, 'ready')
  assert.equal(report.source.longTerm.present, true)
  assert.equal(report.source.daily.present, true)
  assert.equal(report.totals.longTermMemoryCount, 1)
  assert.equal(report.totals.pausedLongTermMemoryCount, 1)
  assert.equal(report.totals.dailyDayCount, 1)
  assert.equal(report.totals.dailyEntryCount, 1)
  assert.equal(report.totals.voiceDailyEntryCount, 1)
  assert.equal(report.totals.categoryCounts.preference, 1)
  assert.equal(report.totals.kindCounts.relationship, 1)
  assert.equal(report.totals.importanceCounts.pinned, 1)
  assert.equal(report.migrationPlan.wouldCreateLongTermRecords, 1)
  assert.equal(report.migrationPlan.wouldCreateDailyEntryRecords, 1)
  assert.equal(report.migrationPlan.includesMemoryContent, false)
  assert.equal(report.migrationPlan.requiresUserConfirmation, true)

  const serialized = JSON.stringify(report)
  assert.equal(serialized.includes('private preference about evenings'), false)
  assert.equal(serialized.includes('private diary fragment'), false)
  assert.equal(serialized.includes('secret-memory-id'), false)
  assert.equal(serialized.includes('secret-daily-id'), false)
  assert.equal(serialized.includes('private source label'), false)
  assert.equal(serialized.includes('private-source-ref'), false)
  assert.equal(serialized.includes('related-secret-id'), false)
})

test('memory migration dry-run plans legacy memory only when current memory is absent', () => {
  const legacyOnly = buildMemoryStorageMigrationDryRun({
    longTermRaw: null,
    legacyRaw: JSON.stringify([
      {
        id: 'legacy-secret-id',
        content: 'legacy private memory',
        category: 'manual',
        source: 'manual',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ]),
    dailyRaw: null,
  })

  assert.equal(legacyOnly.migrationPlan.legacyMemoryWouldMigrate, true)
  assert.equal(legacyOnly.migrationPlan.legacyMemoryIgnoredBecauseCurrentExists, false)
  assert.equal(legacyOnly.totals.longTermMemoryCount, 1)
  assert.ok(legacyOnly.issues.some((item) => item.code === 'legacy-memory-would-migrate'))
  assert.equal(JSON.stringify(legacyOnly).includes('legacy private memory'), false)

  const currentAndLegacy = buildMemoryStorageMigrationDryRun({
    longTermRaw: JSON.stringify([
      {
        id: 'current-id',
        content: 'current private memory',
        category: 'goal',
        source: 'chat',
        createdAt: '2026-06-03T00:00:00.000Z',
      },
    ]),
    legacyRaw: JSON.stringify([
      {
        id: 'legacy-secret-id',
        content: 'legacy private memory',
        category: 'manual',
        source: 'manual',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ]),
    dailyRaw: null,
  })

  assert.equal(currentAndLegacy.migrationPlan.legacyMemoryWouldMigrate, false)
  assert.equal(currentAndLegacy.migrationPlan.legacyMemoryIgnoredBecauseCurrentExists, true)
  assert.equal(currentAndLegacy.totals.longTermMemoryCount, 1)
  assert.equal(currentAndLegacy.totals.categoryCounts.goal, 1)
})

test('memory migration dry-run reports malformed json and normalization losses', () => {
  const invalid = buildMemoryStorageMigrationDryRun({
    longTermRaw: '{not json',
    legacyRaw: null,
    dailyRaw: null,
  })

  assert.equal(invalid.status, 'blocked')
  assert.equal(invalid.migrationPlan.nextStep, 'repair-localStorage')
  assert.ok(invalid.issues.some((item) => item.code === 'long-term-json-invalid' && item.severity === 'error'))

  const normalized = buildMemoryStorageMigrationDryRun({
    longTermRaw: JSON.stringify([
      {
        id: 'keep',
        content: 'keep me',
        category: 'manual',
        source: 'chat',
        createdAt: '2026-06-03T00:00:00.000Z',
      },
      {
        id: 'drop',
        content: '',
        category: 'manual',
        source: 'chat',
        createdAt: '2026-06-03T00:00:00.000Z',
      },
    ]),
    legacyRaw: null,
    dailyRaw: JSON.stringify({
      '2026-06-03': [
        ...Array.from({ length: 17 }, (_, index) => ({
          id: `daily-${index}`,
          role: 'user',
          content: `daily ${index}`,
          source: 'chat',
          createdAt: `2026-06-03T00:00:${String(index).padStart(2, '0')}.000Z`,
        })),
        {
          id: 'drop-role',
          role: 'system',
          content: 'drop daily',
          source: 'chat',
          createdAt: '2026-06-03T00:00:20.000Z',
        },
      ],
    }),
  })

  assert.equal(normalized.status, 'needs_review')
  assert.equal(normalized.totals.longTermMemoryCount, 1)
  assert.equal(normalized.totals.dailyEntryCount, 16)
  assert.ok(normalized.issues.some((item) => item.code === 'long-term-normalized'))
  assert.ok(normalized.issues.some((item) => item.code === 'daily-normalized'))
  assert.ok(normalized.issues.some((item) => item.code === 'long-term-records-would-be-capped-or-dropped'))
  assert.ok(normalized.issues.some((item) => item.code === 'daily-records-would-be-capped-or-dropped'))
  assert.equal(JSON.stringify(normalized).includes('drop daily'), false)
})

test('memory migration dry-run loader reads the three known memory keys', () => {
  installStorage({
    [MEMORY_STORAGE_KEY]: JSON.stringify([{
      id: 'm1',
      content: 'long term memory',
      category: 'habit',
      source: 'chat',
      createdAt: '2026-06-01T00:00:00.000Z',
    }]),
    [LEGACY_MEMORY_STORAGE_KEY]: JSON.stringify([]),
    [DAILY_MEMORY_STORAGE_KEY]: JSON.stringify({
      '2026-06-01': [{
        id: 'd1',
        role: 'assistant',
        content: 'daily memory',
        source: 'chat',
        createdAt: '2026-06-01T01:00:00.000Z',
      }],
    }),
  })

  const report = loadMemoryStorageMigrationDryRun({
    now: '2026-06-19T12:00:00.000Z',
  })

  assert.equal(report.source.longTerm.key, MEMORY_STORAGE_KEY)
  assert.equal(report.source.legacyLongTerm.key, LEGACY_MEMORY_STORAGE_KEY)
  assert.equal(report.source.daily.key, DAILY_MEMORY_STORAGE_KEY)
  assert.equal(report.totals.longTermMemoryCount, 1)
  assert.equal(report.totals.dailyEntryCount, 1)
})
