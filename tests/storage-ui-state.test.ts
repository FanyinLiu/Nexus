import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  loadDebugConsoleEvents,
  normalizeDebugConsoleEvents,
  saveDebugConsoleEvents,
} from '../src/lib/storage/debugConsole.ts'
import {
  loadLorebookEntries,
  normalizeLorebookEntries,
  saveLorebookEntries,
} from '../src/lib/storage/lorebooks.ts'
import {
  loadOnboardingCompleted,
  normalizeOnboardingState,
  saveOnboardingCompleted,
} from '../src/lib/storage/onboarding.ts'
import {
  CHAT_STORAGE_KEY,
  DEBUG_CONSOLE_EVENTS_STORAGE_KEY,
  LOREBOOK_ENTRIES_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
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
      setTimeout: (callback: () => void) => {
        callback()
        return 1
      },
      clearTimeout: () => {},
    },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('normalizeDebugConsoleEvents filters malformed entries and preserves autonomy source', () => {
  assert.deepEqual(normalizeDebugConsoleEvents([
    {
      id: ' e1 ',
      source: 'autonomy',
      title: '  Tick  fired ',
      detail: '  decision\nmade ',
      tone: 'warning',
      createdAt: '2026-06-04T09:00:00Z',
      relatedTaskId: ' task-1 ',
      extra: true,
    },
    { id: 'bad', title: '', detail: 'x', createdAt: '2026-06-04T09:00:00Z' },
    { id: 'bad-date', title: 'x', detail: 'x', createdAt: 'not-a-date' },
    'bad',
  ]), [{
    id: 'e1',
    source: 'autonomy',
    title: 'Tick fired',
    detail: 'decision\nmade',
    tone: 'warning',
    createdAt: '2026-06-04T09:00:00.000Z',
    relatedTaskId: 'task-1',
  }])
})

test('loadDebugConsoleEvents handles non-array storage and writes compacted events', () => {
  const storage = installStorage({
    [DEBUG_CONSOLE_EVENTS_STORAGE_KEY]: JSON.stringify([
      {
        id: 'e1',
        source: 'unknown',
        title: ' keep ',
        detail: ' detail ',
        tone: 'loud',
        createdAt: '2026-06-04T09:00:00Z',
      },
    ]),
  })

  const events = loadDebugConsoleEvents()

  assert.deepEqual(events, [{
    id: 'e1',
    source: 'system',
    title: 'keep',
    detail: 'detail',
    tone: 'info',
    createdAt: '2026-06-04T09:00:00.000Z',
  }])
  assert.deepEqual(JSON.parse(storage.getItem(DEBUG_CONSOLE_EVENTS_STORAGE_KEY) ?? '[]'), events)

  storage.setItem(DEBUG_CONSOLE_EVENTS_STORAGE_KEY, JSON.stringify({ wrong: true }))
  assert.deepEqual(loadDebugConsoleEvents(), [])
  assert.deepEqual(JSON.parse(storage.getItem(DEBUG_CONSOLE_EVENTS_STORAGE_KEY) ?? '[]'), [])
})

test('saveDebugConsoleEvents normalizes before debounced persistence', () => {
  const storage = installStorage()

  saveDebugConsoleEvents([{
    id: ' e1 ',
    source: 'voice',
    title: ' hello ',
    detail: ' there ',
    tone: 'success',
    createdAt: '2026-06-04T09:00:00Z',
  }])

  assert.deepEqual(JSON.parse(storage.getItem(DEBUG_CONSOLE_EVENTS_STORAGE_KEY) ?? '[]'), [{
    id: 'e1',
    source: 'voice',
    title: 'hello',
    detail: 'there',
    tone: 'success',
    createdAt: '2026-06-04T09:00:00.000Z',
  }])
})

test('normalizeOnboardingState requires a real completion timestamp', () => {
  assert.deepEqual(normalizeOnboardingState({ completedAt: '2026-06-04T09:00:00Z' }), {
    completedAt: '2026-06-04T09:00:00.000Z',
  })
  assert.equal(normalizeOnboardingState({ completedAt: 'yes' }), null)
  assert.equal(normalizeOnboardingState(true), null)
})

test('loadOnboardingCompleted compacts valid state and removes invalid explicit state', () => {
  const storage = installStorage({
    [ONBOARDING_STORAGE_KEY]: JSON.stringify({ completedAt: '2026-06-04T09:00:00Z', extra: true }),
  })

  assert.equal(loadOnboardingCompleted(), true)
  assert.deepEqual(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}'), {
    completedAt: '2026-06-04T09:00:00.000Z',
  })

  storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ completedAt: 'yes' }))
  assert.equal(loadOnboardingCompleted(), false)
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), null)

  storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ completedAt: 'yes' }))
  storage.setItem(CHAT_STORAGE_KEY, JSON.stringify([]))
  assert.equal(loadOnboardingCompleted(), true)
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), null)
})

test('saveOnboardingCompleted writes or removes the explicit completion flag', () => {
  const storage = installStorage()

  saveOnboardingCompleted(true)
  assert.equal(normalizeOnboardingState(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}')) !== null, true)

  saveOnboardingCompleted(false)
  assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), null)
})

test('normalizeLorebookEntries keeps drafts but stabilizes malformed fields and duplicate ids', () => {
  const entries = normalizeLorebookEntries([
    {
      id: ' l1 ',
      label: '  Mom  facts ',
      keywords: [' 妈妈 ', '妈妈', 'Mom'],
      content: '  Shanghai\nteacher ',
      enabled: 'yes',
      priority: '3.7',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: 'bad',
      extra: true,
    },
    {
      id: 'l1',
      label: '',
      keywords: [],
      content: '',
      enabled: false,
      priority: Number.NaN,
      createdAt: 'bad',
    },
    {
      label: 'missing id',
      keywords: ['key'],
      content: 'content',
    },
    {},
  ], Date.parse('2026-06-04T09:00:00Z'))

  assert.deepEqual(entries[0], {
    id: 'l1',
    label: 'Mom facts',
    keywords: ['妈妈', 'Mom'],
    content: 'Shanghai\nteacher',
    enabled: true,
    priority: 4,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  })
  assert.equal(entries[1].id, 'l1-2')
  assert.equal(entries[1].enabled, false)
  assert.equal(entries[2].id.startsWith('lorebook-'), true)
  assert.equal(entries.length, 3)
})

test('loadLorebookEntries and saveLorebookEntries persist normalized snapshots', () => {
  const storage = installStorage({
    [LOREBOOK_ENTRIES_STORAGE_KEY]: JSON.stringify([
      {
        id: 'l1',
        label: ' keep ',
        keywords: [' key ', 'KEY'],
        content: ' content ',
        enabled: true,
        priority: '2',
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
      },
      { wrong: true },
    ]),
  })

  const entries = loadLorebookEntries()

  assert.deepEqual(entries, [{
    id: 'l1',
    label: 'keep',
    keywords: ['key'],
    content: 'content',
    enabled: true,
    priority: 2,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  }])
  assert.deepEqual(JSON.parse(storage.getItem(LOREBOOK_ENTRIES_STORAGE_KEY) ?? '[]'), entries)

  saveLorebookEntries([{
    id: ' l2 ',
    label: '',
    keywords: [],
    content: '',
    enabled: true,
    priority: -1.2,
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
  }])
  assert.deepEqual(JSON.parse(storage.getItem(LOREBOOK_ENTRIES_STORAGE_KEY) ?? '[]'), [{
    id: 'l2',
    label: '',
    keywords: [],
    content: '',
    enabled: true,
    priority: -1,
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
  }])
})
