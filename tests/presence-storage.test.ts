import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  loadAmbientPresence,
  loadLastProactivePresenceAt,
  loadPresenceActivityAt,
  loadPresenceHistory,
  normalizeAmbientPresenceState,
  normalizePresenceHistory,
  savePresenceActivityAt,
  savePresenceHistory,
} from '../src/lib/storage/presence.ts'
import {
  AMBIENT_PRESENCE_STORAGE_KEY,
  LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY,
  PRESENCE_ACTIVITY_AT_STORAGE_KEY,
  PRESENCE_HISTORY_STORAGE_KEY,
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
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('normalizeAmbientPresenceState trims text, normalizes dates, and rejects expired state', () => {
  const active = normalizeAmbientPresenceState({
    text: '  hello   there  ',
    createdAt: '2026-06-04T00:00:00Z',
    expiresAt: '2026-06-04T00:01:00Z',
  }, Date.parse('2026-06-04T00:00:30Z'))

  assert.deepEqual(active, {
    text: 'hello there',
    createdAt: '2026-06-04T00:00:00.000Z',
    expiresAt: '2026-06-04T00:01:00.000Z',
  })
  assert.equal(normalizeAmbientPresenceState(active, Date.parse('2026-06-04T00:02:00Z')), null)
  assert.equal(normalizeAmbientPresenceState({ text: '', createdAt: active.createdAt, expiresAt: active.expiresAt }), null)
})

test('loadAmbientPresence removes malformed or expired persisted state', () => {
  const storage = installStorage({
    [AMBIENT_PRESENCE_STORAGE_KEY]: JSON.stringify({
      text: 'expired',
      createdAt: '2026-06-04T00:00:00Z',
      expiresAt: '2026-06-04T00:00:01Z',
    }),
  })

  assert.equal(loadAmbientPresence(), null)
  assert.equal(storage.getItem(AMBIENT_PRESENCE_STORAGE_KEY), null)
})

test('loadPresenceActivityAt and last proactive timestamp normalize bad values', () => {
  const storage = installStorage({
    [PRESENCE_ACTIVITY_AT_STORAGE_KEY]: JSON.stringify('2026-06-04T00:00:00Z'),
    [LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY]: JSON.stringify(Number.NaN),
  })

  assert.equal(loadPresenceActivityAt(), Date.parse('2026-06-04T00:00:00Z'))
  assert.equal(loadLastProactivePresenceAt(), 0)
  assert.equal(JSON.parse(storage.getItem(PRESENCE_ACTIVITY_AT_STORAGE_KEY) ?? '0'), Date.parse('2026-06-04T00:00:00Z'))
  assert.equal(JSON.parse(storage.getItem(LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY) ?? '-1'), 0)

  savePresenceActivityAt(Number.NaN)
  assert.ok(Number.isFinite(JSON.parse(storage.getItem(PRESENCE_ACTIVITY_AT_STORAGE_KEY) ?? 'null')))
})

test('normalizePresenceHistory filters malformed entries and caps history', () => {
  const history = normalizePresenceHistory([
    { text: '  first   line ', category: 'time', createdAt: '2026-06-04T00:00:00Z' },
    { text: 'bad category', category: 'other', createdAt: '2026-06-04T00:00:00Z' },
    { text: '', category: 'time', createdAt: '2026-06-04T00:00:00Z' },
    { text: 'bad date', category: 'time', createdAt: 'nope' },
    ...Array.from({ length: 10 }, (_, index) => ({
      text: `line ${index}`,
      category: 'memory',
      createdAt: new Date(Date.parse('2026-06-04T00:00:00Z') + index).toISOString(),
    })),
  ])

  assert.equal(history.length, 6)
  assert.deepEqual(history[0], {
    text: 'first line',
    category: 'time',
    createdAt: '2026-06-04T00:00:00.000Z',
  })
  assert.equal(history.at(-1)?.text, 'line 4')
})

test('loadPresenceHistory writes normalized history back to storage', () => {
  const storage = installStorage({
    [PRESENCE_HISTORY_STORAGE_KEY]: JSON.stringify([
      { text: '  hello ', category: 'neutral', createdAt: '2026-06-04T00:00:00Z' },
      { text: 'drop', category: 'bad', createdAt: '2026-06-04T00:00:00Z' },
    ]),
  })

  const history = loadPresenceHistory()

  assert.deepEqual(history, [{
    text: 'hello',
    category: 'neutral',
    createdAt: '2026-06-04T00:00:00.000Z',
  }])
  assert.deepEqual(JSON.parse(storage.getItem(PRESENCE_HISTORY_STORAGE_KEY) ?? '[]'), history)
})

test('savePresenceHistory normalizes before persisting', () => {
  const storage = installStorage()

  savePresenceHistory([
    { text: ' keep ', category: 'recent', createdAt: '2026-06-04T00:00:00Z' },
    { text: '', category: 'recent', createdAt: '2026-06-04T00:00:00Z' },
  ])

  assert.deepEqual(JSON.parse(storage.getItem(PRESENCE_HISTORY_STORAGE_KEY) ?? '[]'), [{
    text: 'keep',
    category: 'recent',
    createdAt: '2026-06-04T00:00:00.000Z',
  }])
})
