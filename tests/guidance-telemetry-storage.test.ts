import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { GuidanceKind } from '../src/features/autonomy/guidanceTelemetry.ts'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
  clear() { this.data.clear() }
}

const storage = new MemoryStorage()

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: storage,
    addEventListener: () => {},
    removeEventListener: () => {},
    clearTimeout: () => {},
    setTimeout: () => 0,
  },
  configurable: true,
  writable: true,
})
;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined

const guidance = await import('../src/features/autonomy/guidanceTelemetry.ts')

const TELEMETRY_KEY = 'nexus:autonomy:guidance-telemetry'
const ANALYSIS_KEY = 'nexus:autonomy:guidance-analysis'
const NOW = Date.parse('2026-06-04T12:00:00Z')

beforeEach(() => {
  storage.clear()
})

test('normalizeGuidanceTelemetry filters malformed entries, stale entries, and future timestamps', () => {
  const normalized = guidance.normalizeGuidanceTelemetry([
    {
      ts: '2026-06-04T10:00:00Z',
      kind: 'affect:volatile',
      beforeValence: -0.25,
      extra: true,
    },
    {
      ts: '2026-06-04T11:00:00Z',
      kind: 'rupture:criticism',
      beforeValence: Number.NaN,
    },
    { ts: '2026-06-04T13:00:00Z', kind: 'affect:volatile' },
    { ts: '2025-05-01T00:00:00Z', kind: 'affect:volatile' },
    { ts: '2026-06-04T10:00:00Z', kind: 'unknown' },
    'bad',
  ], NOW)

  assert.deepEqual(normalized, [
    {
      ts: '2026-06-04T10:00:00.000Z',
      kind: 'affect:volatile',
      beforeValence: -0.25,
    },
    {
      ts: '2026-06-04T11:00:00.000Z',
      kind: 'rupture:criticism',
      beforeValence: null,
    },
  ])
})

test('loadGuidanceTelemetry compacts malformed persisted telemetry', () => {
  storage.setItem(TELEMETRY_KEY, JSON.stringify([
    { ts: new Date(Date.now() - 1_000).toISOString(), kind: 'affect:steady-warm', beforeValence: 0.4 },
    { ts: 'bad', kind: 'affect:steady-warm', beforeValence: 0.4 },
  ]))

  const loaded = guidance.loadGuidanceTelemetry()

  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].kind, 'affect:steady-warm')
  assert.deepEqual(JSON.parse(storage.getItem(TELEMETRY_KEY) ?? '[]'), loaded)
})

test('recordGuidanceFired sanitizes beforeValence and ignores invalid runtime kind', () => {
  guidance.recordGuidanceFired({
    kind: 'affect:stuck-low',
    beforeValence: Number.NaN,
    now: new Date('2026-06-04T12:00:00Z'),
  })
  guidance.recordGuidanceFired({
    kind: 'bad-kind' as GuidanceKind,
    beforeValence: 0.5,
    now: new Date('2026-06-04T13:00:00Z'),
  })
  guidance.recordGuidanceFired({
    kind: 'affect:volatile',
    beforeValence: 0.5,
    now: new Date('bad'),
  })

  assert.deepEqual(JSON.parse(storage.getItem(TELEMETRY_KEY) ?? '[]'), [{
    ts: '2026-06-04T12:00:00.000Z',
    kind: 'affect:stuck-low',
    beforeValence: null,
  }])
})

test('normalizeGuidanceAnalysisReport validates generatedAt and report fields', () => {
  const normalized = guidance.normalizeGuidanceAnalysisReport({
    generatedAt: '2026-06-04T10:00:00Z',
    windowDays: '30',
    perFireWindowHours: '6',
    byKind: [
      {
        kind: 'rupture:contempt',
        fireCount: '2.8',
        meanValenceBefore: -0.2,
        meanValenceAfter: 'bad',
        valenceDelta: 0.1,
        pairedFires: 2,
      },
      { kind: 'unknown', fireCount: 9 },
    ],
    bestPerformingKind: 'rupture:contempt',
    weakestKind: 'rupture:contempt',
  }, NOW)

  assert.deepEqual(normalized, {
    generatedAt: '2026-06-04T10:00:00.000Z',
    windowDays: 30,
    perFireWindowHours: 6,
    byKind: [{
      kind: 'rupture:contempt',
      fireCount: 2,
      meanValenceBefore: -0.2,
      meanValenceAfter: null,
      valenceDelta: 0.1,
      pairedFires: 2,
    }],
    bestPerformingKind: 'rupture:contempt',
    weakestKind: null,
  })

  assert.equal(guidance.normalizeGuidanceAnalysisReport({
    generatedAt: '2026-06-04T13:00:00Z',
    byKind: [],
  }, NOW), null)
})

test('loadGuidanceAnalysis clears future or malformed reports instead of skipping analysis forever', () => {
  storage.setItem(ANALYSIS_KEY, JSON.stringify({
    generatedAt: '2099-01-01T00:00:00Z',
    windowDays: 365,
    perFireWindowHours: 24,
    byKind: [],
    bestPerformingKind: null,
    weakestKind: null,
  }))

  assert.equal(guidance.loadGuidanceAnalysis(), null)
  assert.equal(JSON.parse(storage.getItem(ANALYSIS_KEY) ?? 'false'), null)
})

test('saveGuidanceAnalysis normalizes before persisting', () => {
  const generatedAt = new Date(Date.now() - 1_000).toISOString()

  guidance.saveGuidanceAnalysis({
    generatedAt,
    windowDays: Number.NaN,
    perFireWindowHours: -1,
    byKind: [{
      kind: 'affect:recent-drop',
      fireCount: Number.NaN,
      meanValenceBefore: Number.NaN,
      meanValenceAfter: 0.2,
      valenceDelta: Number.NaN,
      pairedFires: 1.9,
    }],
    bestPerformingKind: 'affect:recent-drop',
    weakestKind: 'affect:volatile',
  })

  const saved = JSON.parse(storage.getItem(ANALYSIS_KEY) ?? '{}')
  assert.equal(saved.windowDays, 365)
  assert.equal(saved.perFireWindowHours, 24)
  assert.deepEqual(saved.byKind, [{
    kind: 'affect:recent-drop',
    fireCount: 0,
    meanValenceBefore: null,
    meanValenceAfter: 0.2,
    valenceDelta: null,
    pairedFires: 1,
  }])
})
