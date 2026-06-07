import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  loadAutonomyGoals,
  loadAwayLastFiredMs,
  loadBracketState,
  normalizeAutonomyGoals,
  normalizeAwayLastFiredMs,
  normalizeBracketState,
  recordBracketFire,
  saveAutonomyGoals,
  saveAwayLastFiredMs,
} from '../src/lib/storage/autonomy.ts'
import {
  AUTONOMY_GOALS_STORAGE_KEY,
  PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY,
  PROACTIVE_BRACKET_STATE_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import type { Goal } from '../src/types'

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
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('normalizeAutonomyGoals filters malformed goals and compacts recoverable fields', () => {
  const goals = normalizeAutonomyGoals([
    {
      id: ' g1 ',
      title: '  ship   audit ',
      description: '  release   pass ',
      status: 'unknown',
      progress: 220,
      subtasks: [
        { id: ' s1 ', title: '  verify ', done: true },
        { id: 's2', title: '', done: true },
        { id: 's3', title: 'fix', done: 'yes' },
      ],
      deadline: '2026-06-05',
      createdAt: 'bad',
      updatedAt: '2026-06-04T08:00:00Z',
      completedAt: '2026-06-04T09:00:00Z',
    },
    { id: 'missing title', title: '   ' },
    'bad',
  ], Date.parse('2026-06-04T10:00:00Z'))

  assert.deepEqual(goals, [{
    id: 'g1',
    title: 'ship audit',
    description: 'release pass',
    status: 'active',
    progress: 100,
    subtasks: [
      { id: 's1', title: 'verify', done: true },
      { id: 's3', title: 'fix', done: false },
    ],
    deadline: '2026-06-05T00:00:00.000Z',
    createdAt: '2026-06-04T10:00:00.000Z',
    updatedAt: '2026-06-04T08:00:00.000Z',
  }])
})

test('loadAutonomyGoals writes normalized goal snapshots back to storage', () => {
  const storage = installStorage({
    [AUTONOMY_GOALS_STORAGE_KEY]: JSON.stringify([
      {
        id: 'g1',
        title: ' keep ',
        status: 'completed',
        progress: '75',
        subtasks: [],
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
        completedAt: '2026-06-03T00:00:00Z',
        extra: 'drop',
      },
      { id: 'drop', title: '' },
    ]),
  })

  const goals = loadAutonomyGoals()

  assert.deepEqual(goals, [{
    id: 'g1',
    title: 'keep',
    status: 'completed',
    progress: 75,
    subtasks: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    completedAt: '2026-06-03T00:00:00.000Z',
  }])
  assert.deepEqual(JSON.parse(storage.getItem(AUTONOMY_GOALS_STORAGE_KEY) ?? '[]'), goals)
})

test('saveAutonomyGoals normalizes before persisting', () => {
  const storage = installStorage()

  saveAutonomyGoals([{
    id: 'g1',
    title: ' persisted ',
    status: 'paused',
    progress: -5,
    subtasks: [],
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  } as Goal])

  assert.deepEqual(JSON.parse(storage.getItem(AUTONOMY_GOALS_STORAGE_KEY) ?? '[]'), [{
    id: 'g1',
    title: 'persisted',
    status: 'paused',
    progress: 0,
    subtasks: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }])
})

test('normalizeBracketState and recordBracketFire sanitize scheduler timestamps', () => {
  assert.deepEqual(normalizeBracketState({
    lastMorningFiredMs: '2026-06-04T08:00:00Z',
    lastEveningFiredMs: Number.NaN,
  }), {
    lastMorningFiredMs: Date.parse('2026-06-04T08:00:00Z'),
    lastEveningFiredMs: null,
  })

  assert.deepEqual(recordBracketFire({
    lastMorningFiredMs: -1,
    lastEveningFiredMs: 2,
  }, 'morning', Date.parse('2026-06-04T09:00:00Z')), {
    lastMorningFiredMs: Date.parse('2026-06-04T09:00:00Z'),
    lastEveningFiredMs: 2,
  })
})

test('loadBracketState compacts malformed persisted scheduler state', () => {
  const storage = installStorage({
    [PROACTIVE_BRACKET_STATE_STORAGE_KEY]: JSON.stringify({
      lastMorningFiredMs: 'bad',
      lastEveningFiredMs: '2026-06-04T21:00:00Z',
      extra: true,
    }),
  })

  const state = loadBracketState()

  assert.deepEqual(state, {
    lastMorningFiredMs: null,
    lastEveningFiredMs: Date.parse('2026-06-04T21:00:00Z'),
  })
  assert.deepEqual(JSON.parse(storage.getItem(PROACTIVE_BRACKET_STATE_STORAGE_KEY) ?? '{}'), state)
})

test('away last-fired storage accepts finite timestamps and compacts bad values', () => {
  const storage = installStorage({
    [PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY]: JSON.stringify('2026-06-04T12:00:00Z'),
  })

  assert.equal(normalizeAwayLastFiredMs('12345'), 12345)
  assert.equal(loadAwayLastFiredMs(), Date.parse('2026-06-04T12:00:00Z'))
  assert.equal(JSON.parse(storage.getItem(PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY) ?? 'null'), Date.parse('2026-06-04T12:00:00Z'))

  saveAwayLastFiredMs(Number.NaN)
  assert.equal(JSON.parse(storage.getItem(PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY) ?? '-1'), null)
})
