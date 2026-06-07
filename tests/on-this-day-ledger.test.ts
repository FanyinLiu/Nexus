import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  __resetOnThisDayLedger,
  loadOnThisDayLedger,
  normalizeOnThisDayLedger,
  recordOnThisDayFired,
} from '../src/features/memory/onThisDayLedger.ts'
import { MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY } from '../src/lib/storage/core.ts'

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: createLocalStorageMock(),
      addEventListener: () => {},
    },
    configurable: true,
    writable: true,
  })
})

test('normalizeOnThisDayLedger trims ids, normalizes timestamps, and drops stale entries', () => {
  const nowMs = Date.parse('2026-06-04T00:00:00Z')

  assert.deepEqual(normalizeOnThisDayLedger({
    ' memory-1 ': '2026-06-03T12:00:00Z',
    memory2: Date.parse('2026-06-02T12:00:00Z'),
    '': '2026-06-03T12:00:00Z',
    invalid: 'bad-date',
    old: '2025-01-01T00:00:00Z',
    future: '2026-06-05T00:00:00Z',
  }, nowMs), {
    'memory-1': '2026-06-03T12:00:00.000Z',
    memory2: '2026-06-02T12:00:00.000Z',
  })
})

test('loadOnThisDayLedger compacts malformed persisted ledger', () => {
  const localStorage = createLocalStorageMock({
    [MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY]: JSON.stringify({
      ' keep ': '2026-06-03T12:00:00Z',
      drop: 'bad',
      old: '2025-01-01T00:00:00Z',
    }),
  })
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const ledger = loadOnThisDayLedger(Date.parse('2026-06-04T00:00:00Z'))

  assert.deepEqual(ledger, {
    keep: '2026-06-03T12:00:00.000Z',
  })
  assert.deepEqual(JSON.parse(localStorage.getItem(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY) ?? '{}'), ledger)
})

test('recordOnThisDayFired ignores blank ids and invalid timestamps', () => {
  recordOnThisDayFired('  ', '2026-06-04T00:00:00Z')
  recordOnThisDayFired('memory-1', 'bad')

  assert.equal(window.localStorage.getItem(MEMORY_ON_THIS_DAY_FIRED_STORAGE_KEY), null)

  recordOnThisDayFired(' memory-1 ', '2026-06-04T00:00:00Z')
  assert.deepEqual(loadOnThisDayLedger(Date.parse('2026-06-04T00:00:00Z')), {
    'memory-1': '2026-06-04T00:00:00.000Z',
  })
})

test('__resetOnThisDayLedger clears the persisted ledger', () => {
  recordOnThisDayFired('memory-1', '2026-06-04T00:00:00Z')
  __resetOnThisDayLedger()

  assert.deepEqual(loadOnThisDayLedger(Date.parse('2026-06-04T00:00:00Z')), {})
})
