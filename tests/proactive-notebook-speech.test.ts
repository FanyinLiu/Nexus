import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildProactiveNotebookSpeechPlan,
  canReadProactiveNotebookAloud,
  createProactiveNotebookNarrator,
  createProactiveNotebookReturnTracker,
  selectProactiveNotebookOpeningKey,
  PROACTIVE_NOTEBOOK_SPEECH_MAX_ITEMS,
  type ProactiveNotebookSpeechRow,
  type ProactiveNotebookSpeechStep,
} from '../src/features/proactive/proactiveNotebookSpeech.ts'

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function speechRow(overrides: Partial<ProactiveNotebookSpeechRow> & { id: string }): ProactiveNotebookSpeechRow {
  return {
    title: `Title ${overrides.id}`,
    unseen: true,
    letter: false,
    ...overrides,
  }
}

test('the opening line answers empty, seen-only, one, away, busy and generic in that order', () => {
  assert.equal(
    selectProactiveNotebookOpeningKey({ unseenCount: 0, totalCount: 0, reason: 'away' }),
    'pet.proactive.notebook_opening_empty',
  )
  assert.equal(
    selectProactiveNotebookOpeningKey({ unseenCount: 0, totalCount: 3, reason: 'busy' }),
    'pet.proactive.notebook_opening_seen_only',
  )
  assert.equal(
    selectProactiveNotebookOpeningKey({ unseenCount: 1, totalCount: 4, reason: 'away' }),
    'pet.proactive.notebook_opening_one',
  )
  assert.equal(
    selectProactiveNotebookOpeningKey({ unseenCount: 3, totalCount: 4, reason: 'away' }),
    'pet.proactive.notebook_opening_away',
  )
  assert.equal(
    selectProactiveNotebookOpeningKey({ unseenCount: 3, totalCount: 4, reason: 'busy' }),
    'pet.proactive.notebook_opening_busy',
  )
  assert.equal(
    selectProactiveNotebookOpeningKey({ unseenCount: 3, totalCount: 4, reason: null }),
    'pet.proactive.notebook_opening_generic',
  )
})

test('the return tracker remembers away over busy and clears when nothing is unseen', () => {
  const tracker = createProactiveNotebookReturnTracker()
  assert.equal(tracker.reason(), null)

  tracker.observe({
    fullscreen: true,
    focusState: 'active',
    hasUnseen: true,
    unseenIds: ['a'],
  })
  assert.equal(tracker.reason(), 'busy')

  tracker.observe({
    fullscreen: true,
    focusState: 'locked',
    hasUnseen: true,
    unseenIds: ['a', 'b'],
  })
  assert.equal(tracker.reason(), 'away')

  tracker.observe({
    fullscreen: false,
    focusState: 'away',
    hasUnseen: true,
    unseenIds: ['a', 'b'],
  })
  assert.equal(tracker.reason(), 'away')

  tracker.observe({
    fullscreen: false,
    focusState: 'active',
    hasUnseen: false,
    unseenIds: [],
  })
  assert.equal(tracker.reason(), null)

  tracker.observe({
    fullscreen: true,
    focusState: 'active',
    hasUnseen: true,
    unseenIds: ['c'],
  })
  assert.equal(tracker.reason(), 'busy')
  tracker.reset()
  assert.equal(tracker.reason(), null)
})

test('the return reason follows where each unseen item arrived', () => {
  const away = createProactiveNotebookReturnTracker()
  away.observe({ fullscreen: false, focusState: 'active', hasUnseen: false, unseenIds: [] })
  away.observe({ fullscreen: false, focusState: 'away', hasUnseen: true, unseenIds: ['away-item'] })
  assert.equal(away.reason(), 'away')

  const presentThenLeft = createProactiveNotebookReturnTracker()
  presentThenLeft.observe({
    fullscreen: false,
    focusState: 'active',
    hasUnseen: true,
    unseenIds: ['present-a', 'present-b'],
  })
  presentThenLeft.observe({
    fullscreen: false,
    focusState: 'away',
    hasUnseen: true,
    unseenIds: ['present-a', 'present-b'],
  })
  assert.equal(presentThenLeft.reason(), null)
  assert.equal(
    selectProactiveNotebookOpeningKey({
      unseenCount: 2,
      totalCount: 2,
      reason: presentThenLeft.reason(),
    }),
    'pet.proactive.notebook_opening_generic',
  )

  const busy = createProactiveNotebookReturnTracker()
  busy.observe({ fullscreen: false, focusState: 'active', hasUnseen: false, unseenIds: [] })
  busy.observe({
    fullscreen: true,
    focusState: 'active',
    hasUnseen: true,
    unseenIds: ['fullscreen-item'],
  })
  assert.equal(busy.reason(), 'busy')
})

test('the return tracker never reads a typing signal', () => {
  const tracker = createProactiveNotebookReturnTracker()
  let typingRead = false
  const input = {
    fullscreen: false,
    focusState: 'active' as const,
    hasUnseen: true,
    unseenIds: ['a'],
    get typing() {
      typingRead = true
      return true
    },
  }

  tracker.observe(input)

  assert.equal(typingRead, false)
  assert.equal(tracker.reason(), null)
})

test('reading aloud needs speech on and no fullscreen, DND, quiet hours, sharing, lock or away', () => {
  const allowed = {
    speechOutputEnabled: true,
    fullscreen: false,
    systemDnd: false,
    inQuietHours: false,
    screenSharing: false,
    focusState: 'active' as const,
  }

  assert.equal(canReadProactiveNotebookAloud(allowed), true)
  assert.equal(canReadProactiveNotebookAloud({ ...allowed, speechOutputEnabled: false }), false)
  assert.equal(canReadProactiveNotebookAloud({ ...allowed, fullscreen: true }), false)
  assert.equal(canReadProactiveNotebookAloud({ ...allowed, systemDnd: true }), false)
  assert.equal(canReadProactiveNotebookAloud({ ...allowed, inQuietHours: true }), false)
  assert.equal(canReadProactiveNotebookAloud({ ...allowed, screenSharing: true }), false)
  assert.equal(canReadProactiveNotebookAloud({ ...allowed, focusState: 'locked' }), false)
  assert.equal(canReadProactiveNotebookAloud({ ...allowed, focusState: 'away' }), false)

  // An unknown DND / sharing state is not a positive report, so it does not block.
  assert.equal(canReadProactiveNotebookAloud({ ...allowed, systemDnd: null, screenSharing: null }), true)
})

test('the plan speaks titles only, at most three unseen rows, letters as the letter line, then the rest', () => {
  assert.equal(PROACTIVE_NOTEBOOK_SPEECH_MAX_ITEMS, 3)
  const plan = buildProactiveNotebookSpeechPlan({
    openingText: 'Opening',
    rows: [
      speechRow({ id: 'a', title: 'Title a' }),
      speechRow({ id: 'b', title: 'Secret letter title', letter: true }),
      speechRow({ id: 'c', title: 'Title c' }),
      speechRow({ id: 'd', title: 'Title d' }),
      speechRow({ id: 'e', title: 'Title e' }),
      speechRow({ id: 'seen', title: 'Seen title', unseen: false }),
    ],
    spokenIds: new Set(['c']),
    letterText: 'There is a letter',
    restText: 'Look at the rest',
  })

  assert.deepEqual(plan, [
    { rowId: null, text: 'Opening' },
    { rowId: 'a', text: 'Title a' },
    { rowId: 'b', text: 'There is a letter' },
    { rowId: 'd', text: 'Title d' },
    { rowId: null, text: 'Look at the rest' },
  ])
  assert.equal(plan.some((step) => step.text.includes('Secret letter title')), false)
  assert.equal(plan.some((step) => step.text.includes('Body')), false)

  const exactlyThree = buildProactiveNotebookSpeechPlan({
    openingText: 'Opening',
    rows: [speechRow({ id: 'a' }), speechRow({ id: 'b' }), speechRow({ id: 'c' })],
    spokenIds: new Set(),
    letterText: 'Letter',
    restText: 'Rest',
  })
  assert.deepEqual(exactlyThree.map((step) => step.rowId), [null, 'a', 'b', 'c'])

  const allSpoken = buildProactiveNotebookSpeechPlan({
    openingText: 'Opening',
    rows: [speechRow({ id: 'a' }), speechRow({ id: 'b' })],
    spokenIds: new Set(['a', 'b']),
    letterText: 'Letter',
    restText: 'Rest',
  })
  assert.deepEqual(allSpoken, [{ rowId: null, text: 'Opening' }])
})

test('the narrator speaks a plan sequentially and reports each row once', async () => {
  const spokenText: string[] = []
  const speaking: Array<string | null> = []
  const handled: string[] = []
  const narrator = createProactiveNotebookNarrator({
    speak: async (text) => {
      spokenText.push(text)
    },
    stop: () => {},
    onSpeaking: (rowId) => speaking.push(rowId),
    onSpoken: (rowId) => handled.push(rowId),
  })
  const plan: ProactiveNotebookSpeechStep[] = [
    { rowId: null, text: 'Opening' },
    { rowId: 'a', text: 'Title a' },
    { rowId: 'b', text: 'Title b' },
  ]

  await narrator.start(plan)

  assert.deepEqual(spokenText, ['Opening', 'Title a', 'Title b'])
  assert.deepEqual(speaking, [null, 'a', 'b', null])
  assert.deepEqual(handled, ['a', 'b'])
  assert.equal(narrator.isActive(), false)
})

test('an interrupt stops the plan at once, clears the highlight and can be restarted', async () => {
  const spokenText: string[] = []
  const speaking: Array<string | null> = []
  const handled: string[] = []
  const releases = new Map<string, () => void>()
  let stopCalls = 0

  const narrator = createProactiveNotebookNarrator({
    speak: (text) => {
      spokenText.push(text)
      return new Promise<void>((resolve) => {
        releases.set(text, resolve)
      })
    },
    stop: () => {
      stopCalls += 1
    },
    onSpeaking: (rowId) => speaking.push(rowId),
    onSpoken: (rowId) => handled.push(rowId),
  })

  const firstRun = narrator.start([
    { rowId: null, text: 'Opening one' },
    { rowId: 'a', text: 'Title a' },
  ])
  await flushMicrotasks()
  assert.equal(narrator.isActive(), true)
  assert.deepEqual(spokenText, ['Opening one'])

  narrator.interrupt()
  assert.equal(narrator.isActive(), false)
  assert.equal(stopCalls, 1)
  assert.equal(speaking.at(-1), null)
  assert.deepEqual(handled, [])

  releases.get('Opening one')?.()
  await firstRun
  assert.deepEqual(spokenText, ['Opening one'])

  const secondRun = narrator.start([
    { rowId: null, text: 'Opening two' },
    { rowId: 'b', text: 'Title b' },
  ])
  await flushMicrotasks()
  assert.deepEqual(spokenText, ['Opening one', 'Opening two'])

  releases.get('Opening two')?.()
  await flushMicrotasks()
  assert.deepEqual(spokenText, ['Opening one', 'Opening two', 'Title b'])
  releases.get('Title b')?.()
  await secondRun

  assert.deepEqual(handled, ['b'])
  assert.equal(stopCalls, 1)
  assert.equal(narrator.isActive(), false)
  assert.equal(speaking.at(-1), null)
})

test('a new start interrupts the previous plan and the old plan never resumes', async () => {
  const spokenText: string[] = []
  const releases = new Map<string, () => void>()
  let stopCalls = 0

  const narrator = createProactiveNotebookNarrator({
    speak: (text) => {
      spokenText.push(text)
      return new Promise<void>((resolve) => {
        releases.set(text, resolve)
      })
    },
    stop: () => {
      stopCalls += 1
    },
    onSpeaking: () => {},
    onSpoken: () => {},
  })

  const firstRun = narrator.start([
    { rowId: null, text: 'Opening one' },
    { rowId: 'a', text: 'Title a' },
  ])
  await flushMicrotasks()

  const secondRun = narrator.start([{ rowId: null, text: 'Opening two' }])
  await flushMicrotasks()
  assert.equal(stopCalls, 1)

  releases.get('Opening one')?.()
  await firstRun
  assert.equal(spokenText.includes('Title a'), false)

  releases.get('Opening two')?.()
  await secondRun
  assert.deepEqual(spokenText, ['Opening one', 'Opening two'])
})

test('a rejected speak ends the plan quietly', async () => {
  const spokenText: string[] = []
  const handled: string[] = []
  const narrator = createProactiveNotebookNarrator({
    speak: async (text) => {
      spokenText.push(text)
      if (text === 'Title b') throw new Error('speech failed')
    },
    stop: () => {},
    onSpeaking: () => {},
    onSpoken: (rowId) => handled.push(rowId),
  })

  await narrator.start([
    { rowId: null, text: 'Opening' },
    { rowId: 'a', text: 'Title a' },
    { rowId: 'b', text: 'Title b' },
    { rowId: 'c', text: 'Title c' },
  ])

  assert.deepEqual(spokenText, ['Opening', 'Title a', 'Title b'])
  assert.deepEqual(handled, ['a'])
  assert.equal(narrator.isActive(), false)
})
