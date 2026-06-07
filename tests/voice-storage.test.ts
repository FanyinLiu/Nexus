import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  loadVoicePipelineState,
  loadVoiceTrace,
  normalizeVoicePipelineState,
  normalizeVoiceTrace,
} from '../src/lib/storage/voice.ts'
import {
  VOICE_PIPELINE_STORAGE_KEY,
  VOICE_TRACE_STORAGE_KEY,
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

test('normalizeVoicePipelineState sanitizes persisted pipeline shape', () => {
  const normalized = normalizeVoicePipelineState({
    step: 'bad-step',
    transcript: ` ${'x'.repeat(2100)} `,
    detail: '',
    updatedAt: 'not-a-date',
  })

  assert.equal(normalized.step, 'idle')
  assert.equal(normalized.transcript.length, 2000)
  assert.ok(normalized.detail.length > 0)
  assert.equal(normalized.updatedAt, '')
})

test('loadVoicePipelineState writes normalized pipeline back to storage', () => {
  const storage = installStorage({
    [VOICE_PIPELINE_STORAGE_KEY]: JSON.stringify({
      step: 'recognized',
      transcript: '  hello   world  ',
      detail: '  heard   text  ',
      updatedAt: '2026-06-04T00:00:00Z',
    }),
  })

  const state = loadVoicePipelineState()

  assert.deepEqual(state, {
    step: 'recognized',
    transcript: 'hello world',
    detail: 'heard text',
    updatedAt: '2026-06-04T00:00:00.000Z',
  })
  assert.deepEqual(JSON.parse(storage.getItem(VOICE_PIPELINE_STORAGE_KEY) ?? '{}'), state)
})

test('normalizeVoiceTrace filters malformed entries, normalizes tone/date, and caps entries', () => {
  const trace = normalizeVoiceTrace([
    {
      id: ' ',
      title: '  first  ',
      detail: '  detail   one  ',
      tone: 'warning',
      createdAt: 'bad-date',
    },
    { id: 'bad-title', title: '', detail: 'drop', tone: 'info', createdAt: '2026-06-04T00:00:00Z' },
    { id: 'bad-detail', title: 'drop', detail: '', tone: 'info', createdAt: '2026-06-04T00:00:00Z' },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `id-${index}`,
      title: `title ${index}`,
      detail: `detail ${index}`,
      tone: 'success',
      createdAt: new Date(1780531200000 + index).toISOString(),
    })),
  ])

  assert.equal(trace.length, 8)
  assert.equal(trace[0]?.id, 'voice-trace-recovered-0-0')
  assert.equal(trace[0]?.title, 'first')
  assert.equal(trace[0]?.detail, 'detail one')
  assert.equal(trace[0]?.tone, 'info')
  assert.equal(trace[0]?.createdAt, '1970-01-01T00:00:00.000Z')
  assert.equal(trace.at(-1)?.id, 'id-6')
})

test('loadVoiceTrace writes normalized trace back to storage', () => {
  const storage = installStorage({
    [VOICE_TRACE_STORAGE_KEY]: JSON.stringify([
      { id: 'trace-1', title: '  Started ', detail: '  OK ', tone: 'error', createdAt: '2026-06-04T00:00:00Z' },
      { id: 'trace-2', title: 'Drop', detail: '', tone: 'info', createdAt: '2026-06-04T00:00:00Z' },
    ]),
  })

  const trace = loadVoiceTrace()

  assert.deepEqual(trace, [{
    id: 'trace-1',
    title: 'Started',
    detail: 'OK',
    tone: 'error',
    createdAt: '2026-06-04T00:00:00.000Z',
  }])
  assert.deepEqual(JSON.parse(storage.getItem(VOICE_TRACE_STORAGE_KEY) ?? '[]'), trace)
})
