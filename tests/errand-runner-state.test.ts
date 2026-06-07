import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  ERRAND_RUNNER_STATE_STORAGE_KEY,
} from '../src/lib/storage.ts'
import {
  readErrandRunnerState,
  normalizeErrandRunnerState,
  writeErrandRunnerState,
} from '../src/features/agent/errandRunnerState.ts'
import type { ErrandRunnerState } from '../src/features/agent/errandPolicy.ts'

type LocalStorageMock = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createLocalStorageMock(initial: Record<string, string> = {}): LocalStorageMock {
  const store = new Map(Object.entries(initial))

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) ?? null : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: createLocalStorageMock(),
    },
    configurable: true,
    writable: true,
  })
})

test('readErrandRunnerState: returns empty object for non-object payloads', () => {
  const localStorage = createLocalStorageMock({
    [ERRAND_RUNNER_STATE_STORAGE_KEY]: JSON.stringify(['not-an-object']),
  })
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  assert.deepEqual(readErrandRunnerState(), {})
  assert.deepEqual(JSON.parse(localStorage.getItem(ERRAND_RUNNER_STATE_STORAGE_KEY) ?? '{}'), {})
})

test('readErrandRunnerState: keeps valid timestamps and run count', () => {
  const localStorage = createLocalStorageMock({
    [ERRAND_RUNNER_STATE_STORAGE_KEY]: JSON.stringify({
      lastRunAt: '2026-05-01T05:10:00.000Z',
      nightStartedAt: '2026-04-30T22:00:00.000Z',
      ranThisNight: 3,
    }),
  })
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  assert.deepEqual(readErrandRunnerState(), {
    lastRunAt: '2026-05-01T05:10:00.000Z',
    nightStartedAt: '2026-04-30T22:00:00.000Z',
    ranThisNight: 3,
  })
})

test('normalizeErrandRunnerState: accepts numeric run counts but keeps timestamps ISO-only', () => {
  assert.deepEqual(normalizeErrandRunnerState({
    lastRunAt: Date.parse('2026-05-01T05:10:00Z'),
    nightStartedAt: '2026-04-30T22:00:00Z',
    ranThisNight: '2.9',
  }), {
    nightStartedAt: '2026-04-30T22:00:00.000Z',
    ranThisNight: 2,
  })
})

test('readErrandRunnerState: drops invalid timestamps and clamps run count', () => {
  const localStorage = createLocalStorageMock({
    [ERRAND_RUNNER_STATE_STORAGE_KEY]: JSON.stringify({
      lastRunAt: 'not-a-date',
      nightStartedAt: 12345,
      ranThisNight: -2.7,
    }),
  })
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  assert.deepEqual(readErrandRunnerState(), {
    ranThisNight: 0,
  })
  assert.deepEqual(JSON.parse(localStorage.getItem(ERRAND_RUNNER_STATE_STORAGE_KEY) ?? '{}'), {
    ranThisNight: 0,
  })
})

test('writeErrandRunnerState: persists payload under errand runner key', () => {
  const localStorage = createLocalStorageMock()
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  writeErrandRunnerState({
    nightStartedAt: '2026-04-30T22:00:00.000Z',
    lastRunAt: '2026-05-01T05:10:00.000Z',
    ranThisNight: 2,
  })

  assert.deepEqual(
    JSON.parse(localStorage.getItem(ERRAND_RUNNER_STATE_STORAGE_KEY) ?? '{}'),
    {
      nightStartedAt: '2026-04-30T22:00:00.000Z',
      lastRunAt: '2026-05-01T05:10:00.000Z',
      ranThisNight: 2,
    },
  )
})

test('writeErrandRunnerState: normalizes payload before persisting', () => {
  const localStorage = createLocalStorageMock()
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  writeErrandRunnerState({
    nightStartedAt: 'bad',
    lastRunAt: '2026-05-01T05:10:00Z',
    ranThisNight: Number.NaN,
  } as ErrandRunnerState)

  assert.deepEqual(
    JSON.parse(localStorage.getItem(ERRAND_RUNNER_STATE_STORAGE_KEY) ?? '{}'),
    {
      lastRunAt: '2026-05-01T05:10:00.000Z',
    },
  )
})
