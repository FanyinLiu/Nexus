import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  findLetterByDate,
  getMostRecentLetterMs,
  loadLetters,
  saveLetter,
  type SavedLetter,
} from '../src/features/letter/letterStore.ts'
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
