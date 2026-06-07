import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  __resetUserAffectCache,
  captureUserAffectSample,
  loadUserAffectHistory,
  loadUserAffectWindow,
} from '../src/features/autonomy/userAffectTimeline.ts'
import { USER_AFFECT_HISTORY_STORAGE_KEY } from '../src/lib/storage/core.ts'

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
  __resetUserAffectCache()
  return localStorage
}

test('loadUserAffectHistory compacts malformed samples and normalizes values', () => {
  const longNote = ` ${'x'.repeat(140)} `
  const storage = installStorage()
  storage.setItem(USER_AFFECT_HISTORY_STORAGE_KEY, JSON.stringify([
    {
      ts: '2026-06-03T00:00:00.000Z',
      valence: 2,
      arousal: -1,
      source: 'text_signal',
      confidence: 1.5,
      note: longNote,
    },
    {
      ts: '2026-06-01T00:00:00.000Z',
      valence: -0.2,
      arousal: 0.4,
      source: 'voice_prosody',
      confidence: 0.6,
    },
    { ts: 'not-a-date', valence: 0, arousal: 0, source: 'text_signal', confidence: 0.5 },
    { ts: '2026-06-02T00:00:00.000Z', valence: 0, arousal: 0, source: 'bad', confidence: 0.5 },
    { ts: '2026-06-02T00:00:00.000Z', valence: Number.NaN, arousal: 0, source: 'text_signal', confidence: 0.5 },
  ]))

  const samples = loadUserAffectHistory()

  assert.deepEqual(samples.map((sample) => sample.ts), [
    '2026-06-01T00:00:00.000Z',
    '2026-06-03T00:00:00.000Z',
  ])
  assert.equal(samples[1]?.valence, 1)
  assert.equal(samples[1]?.arousal, 0)
  assert.equal(samples[1]?.confidence, 1)
  assert.equal(samples[1]?.note?.length, 120)
  assert.deepEqual(JSON.parse(storage.getItem(USER_AFFECT_HISTORY_STORAGE_KEY) ?? '[]'), samples)
})

test('loadUserAffectWindow returns samples inside the requested window', () => {
  installStorage({
    [USER_AFFECT_HISTORY_STORAGE_KEY]: JSON.stringify([
      { ts: '2026-05-01T00:00:00.000Z', valence: 0.1, arousal: 0.2, source: 'text_signal', confidence: 0.5 },
      { ts: '2026-06-03T00:00:00.000Z', valence: 0.2, arousal: 0.3, source: 'relationship', confidence: 0.4 },
    ]),
  })

  const samples = loadUserAffectWindow(7, new Date('2026-06-04T00:00:00.000Z'))

  assert.deepEqual(samples.map((sample) => sample.source), ['relationship'])
})

test('captureUserAffectSample clamps values and deduplicates rapid same-source samples', () => {
  installStorage()

  const first = captureUserAffectSample({
    valence: -2,
    arousal: 2,
    source: 'text_signal',
    confidence: Number.NaN,
    note: '  user said thanks  ',
  }, new Date('2026-06-04T00:00:00.000Z'))
  const duplicate = captureUserAffectSample({
    valence: 0.5,
    arousal: 0.5,
    source: 'text_signal',
    confidence: 0.9,
  }, new Date('2026-06-04T00:00:10.000Z'))
  const differentSource = captureUserAffectSample({
    valence: 0.5,
    arousal: 0.5,
    source: 'voice_prosody',
    confidence: 0.9,
  }, new Date('2026-06-04T00:00:20.000Z'))

  assert.equal(first?.valence, -1)
  assert.equal(first?.arousal, 1)
  assert.equal(first?.confidence, 0)
  assert.equal(first?.note, '  user said thanks  ')
  assert.equal(duplicate, null)
  assert.ok(differentSource)
  assert.equal(loadUserAffectHistory().length, 2)
})
