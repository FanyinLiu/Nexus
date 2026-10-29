import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  countUnreadLetters,
  createSavedLetter,
  findLetterByDate,
  getLatestUnreadLetter,
  getMostRecentLetterDate,
  getMostRecentLetterMs,
  loadLetters,
  markLetterRead,
  saveLetter,
  type SavedLetter,
} from '../src/features/letter/letterStore.ts'
import { letterShelfSummary } from '../src/features/letter/letterView.ts'
import { LETTER_STORE_STORAGE_KEY } from '../src/lib/storage/core.ts'

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
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: createLocalStorageMock(initial),
    },
    configurable: true,
    writable: true,
  })
}

function content(overrides: Partial<SavedLetter['content']> = {}): SavedLetter['content'] {
  return {
    greeting: 'Hello',
    summary: 'A short summary',
    suggestion: 'Try one small thing',
    intention: 'Rest',
    experiment: 'Take a walk',
    closing: 'See you soon',
    ...overrides,
  }
}

function letter(overrides: Partial<SavedLetter> = {}): SavedLetter {
  return {
    id: 'letter-a',
    letterDate: '2026-06-07',
    createdAt: '2026-06-07T12:00:00.000Z',
    personaId: 'xinghui',
    uiLanguage: 'en-US',
    content: content(),
    weekDayCount: 5,
    themes: ['project', 'rest'],
    ...overrides,
  }
}

test('loadLetters compacts malformed records and normalizes saved letters', () => {
  installStorage()
  const valid = letter({
    id: '  letter-live  ',
    letterDate: '2026-06-07',
    createdAt: '2026-06-07T12:00:00.000Z',
    personaId: '  xinghui  ',
    uiLanguage: 'eo' as never,
    content: content({ greeting: '  Hi there  ' }),
    weekDayCount: 12,
    themes: [' project ', '', 'project', ' rest '],
  })
  window.localStorage.setItem(LETTER_STORE_STORAGE_KEY, JSON.stringify([
    valid,
    { ...valid, id: 'bad-date', letterDate: '2026-02-30' },
    { ...valid, id: 'bad-created', createdAt: 'not-a-date' },
    { ...valid, id: 'bad-content', content: { ...content(), closing: '   ' } },
    { ...valid, id: 'bad-persona', personaId: '   ' },
  ]))

  const letters = loadLetters()

  assert.deepEqual(letters, [{
    id: 'letter-live',
    letterDate: '2026-06-07',
    createdAt: '2026-06-07T12:00:00.000Z',
    personaId: 'xinghui',
    uiLanguage: 'zh-CN',
    content: content({ greeting: 'Hi there' }),
    weekDayCount: 7,
    themes: ['project', 'rest'],
  }])
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem(LETTER_STORE_STORAGE_KEY) ?? '[]'),
    letters,
  )
})

test('saveLetter replaces an existing letter for the same date and caps history', () => {
  installStorage()
  for (let i = 0; i < 30; i += 1) {
    saveLetter(letter({
      id: `letter-${i}`,
      letterDate: `2026-05-${String(i + 1).padStart(2, '0')}`,
      createdAt: `2026-05-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`,
      content: content({ greeting: `Hello ${i}` }),
    }))
  }

  saveLetter(letter({
    id: 'replacement',
    letterDate: '2026-05-30',
    createdAt: '2026-06-01T12:00:00.000Z',
    content: content({ greeting: 'Replacement' }),
  }))

  const letters = loadLetters()
  assert.equal(letters.length, 26)
  assert.equal(letters[0]?.id, 'replacement')
  assert.equal(letters.filter((item) => item.letterDate === '2026-05-30').length, 1)
  assert.equal(findLetterByDate('2026-05-30')?.content.greeting, 'Replacement')
})

test('getMostRecentLetterMs scans valid letters instead of trusting storage order', () => {
  installStorage({
    [LETTER_STORE_STORAGE_KEY]: JSON.stringify([
      letter({
        id: 'older',
        letterDate: '2026-06-07',
        createdAt: '2026-06-07T12:00:00.000Z',
      }),
      letter({
        id: 'newer',
        letterDate: '2026-06-14',
        createdAt: '2026-06-14T12:00:00.000Z',
      }),
    ]),
  })

  assert.equal(getMostRecentLetterMs(), Date.parse('2026-06-14T12:00:00.000Z'))
})

test('saveLetter ignores invalid records without corrupting existing storage', () => {
  installStorage()
  saveLetter(letter())
  saveLetter(letter({ id: 'bad', letterDate: '2026-13-01' }))

  assert.deepEqual(loadLetters().map((item) => item.id), ['letter-a'])
})

test('new letters are unread; legacy letters are treated as already read', () => {
  installStorage()
  saveLetter(letter({ id: 'new', letterDate: '2026-06-14', readAt: null }))
  window.localStorage.setItem(LETTER_STORE_STORAGE_KEY, JSON.stringify([
    ...JSON.parse(window.localStorage.getItem(LETTER_STORE_STORAGE_KEY) ?? '[]'),
    {
      ...letter({ id: 'legacy', letterDate: '2026-06-07' }),
    },
  ]))

  const letters = loadLetters()
  assert.equal(letters.find((item) => item.id === 'new')?.readAt, null)
  assert.equal(letters.find((item) => item.id === 'legacy')?.readAt, undefined)
  assert.equal(getLatestUnreadLetter()?.id, 'new')
  assert.equal(countUnreadLetters(), 1)
  const summary = letterShelfSummary(letters)
  assert.equal(summary.count, 2)
  assert.equal(summary.unreadCount, 1)
})

test('markLetterRead records the timestamp and drops the unread badge', () => {
  installStorage()
  saveLetter(letter({ id: 'unread', readAt: null }))
  const at = '2026-06-08T09:30:00.000Z'

  const updated = markLetterRead('unread', at)

  assert.equal(updated?.readAt, at)
  assert.equal(getLatestUnreadLetter(), null)
  assert.equal(countUnreadLetters(), 0)
  assert.equal(loadLetters()[0]?.readAt, at)
})

test('a same-week rewrite preserves an existing read timestamp', () => {
  installStorage()
  saveLetter(letter({ id: 'first', readAt: null }))
  markLetterRead('first', '2026-06-08T09:30:00.000Z')

  saveLetter(letter({
    id: 'rewrite',
    createdAt: '2026-06-08T10:00:00.000Z',
    readAt: null,
  }))

  assert.equal(loadLetters()[0]?.id, 'rewrite')
  assert.equal(loadLetters()[0]?.readAt, '2026-06-08T09:30:00.000Z')
})

test('a failed generation does not create a letter date and leaves the week available', () => {
  installStorage()
  const failed = createSavedLetter({
    letterDate: '2026-06-07',
    personaId: 'xinghui',
    uiLanguage: 'zh-CN',
    content: null,
    weekDayCount: 4,
    themes: ['project'],
  })
  assert.equal(failed, null)
  assert.equal(getMostRecentLetterDate(), null)

  const ok = createSavedLetter({
    letterDate: '2026-06-07',
    personaId: 'xinghui',
    uiLanguage: 'zh-CN',
    content: content(),
    weekDayCount: 4,
    themes: ['project'],
  })
  assert.ok(ok)
  saveLetter(ok)
  assert.equal(getMostRecentLetterDate(), '2026-06-07')
  assert.equal(loadLetters()[0]?.readAt, null)
})

test('getMostRecentLetterDate returns the newest Sunday key', () => {
  installStorage({
    [LETTER_STORE_STORAGE_KEY]: JSON.stringify([
      letter({ id: 'newer', letterDate: '2026-06-14', createdAt: '2026-06-14T12:00:00.000Z' }),
      letter({ id: 'older', letterDate: '2026-06-07', createdAt: '2026-06-07T12:00:00.000Z' }),
    ]),
  })

  assert.equal(getMostRecentLetterDate(), '2026-06-14')
})
