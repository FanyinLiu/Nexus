import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createProactiveNotebookArrivalTracker,
  type ProactiveNotebookArrivalContext,
} from '../src/features/proactive/proactiveNotebookArrival.ts'

const ACTIVE: ProactiveNotebookArrivalContext = {
  fullscreen: false,
  systemDnd: null,
  inQuietHours: false,
  focusState: 'active',
}

function observe(
  tracker: ReturnType<typeof createProactiveNotebookArrivalTracker>,
  overrides: Partial<Parameters<typeof tracker.observe>[0]> = {},
) {
  return tracker.observe({
    unseenIds: ['one'],
    open: false,
    focusState: 'active',
    context: ACTIVE,
    userTyping: false,
    ...overrides,
  })
}

test('one newly arrived unseen id speaks the singular line', () => {
  const tracker = createProactiveNotebookArrivalTracker()

  assert.deepEqual(observe(tracker, { unseenIds: ['a'] }), {
    kind: 'announce',
    key: 'pet.proactive.notebook_arrived_one',
  })
})

test('two or more newly arrived unseen ids speak the plural line', () => {
  const tracker = createProactiveNotebookArrivalTracker()

  assert.deepEqual(observe(tracker, { unseenIds: ['a', 'b'] }), {
    kind: 'announce',
    key: 'pet.proactive.notebook_arrived_many',
  })
})

test('the same batch is never announced twice', () => {
  const tracker = createProactiveNotebookArrivalTracker()

  assert.equal(observe(tracker, { unseenIds: ['a', 'b'] }).kind, 'announce')
  assert.deepEqual(observe(tracker, { unseenIds: ['a', 'b'] }), { kind: 'idle' })
  assert.deepEqual(observe(tracker, { unseenIds: ['b', 'a'] }), { kind: 'idle' })
})

test('a later arrival counts only the ids not announced before', () => {
  const tracker = createProactiveNotebookArrivalTracker()

  assert.equal(observe(tracker, { unseenIds: ['a', 'b'] }).kind, 'announce')
  assert.deepEqual(observe(tracker, { unseenIds: ['a', 'b', 'c'] }), {
    kind: 'announce',
    key: 'pet.proactive.notebook_arrived_one',
  })
  assert.deepEqual(observe(tracker, { unseenIds: ['a', 'b', 'c', 'd'] }), {
    kind: 'announce',
    key: 'pet.proactive.notebook_arrived_one',
  })
  assert.deepEqual(observe(tracker, { unseenIds: ['a', 'b', 'c', 'd'] }), { kind: 'idle' })
})

test('typing holds the line and the re-check says it once typing stops', () => {
  const tracker = createProactiveNotebookArrivalTracker()

  assert.deepEqual(observe(tracker, { userTyping: true }), { kind: 'wait' })
  assert.deepEqual(observe(tracker, { userTyping: true }), { kind: 'wait' })
  assert.deepEqual(observe(tracker, { userTyping: false }), {
    kind: 'announce',
    key: 'pet.proactive.notebook_arrived_one',
  })
  assert.deepEqual(observe(tracker, { userTyping: false }), { kind: 'idle' })
})

test('away and locked consume the batch without speaking', () => {
  for (const focusState of ['away', 'locked'] as const) {
    const tracker = createProactiveNotebookArrivalTracker()
    const context = { ...ACTIVE, focusState }

    assert.deepEqual(observe(tracker, { unseenIds: ['a', 'b'], context }), { kind: 'handled' })
    // Back at the desk with the same unseen lines: the return greeting covers it.
    assert.deepEqual(observe(tracker, { unseenIds: ['a', 'b'], context: ACTIVE }), { kind: 'idle' })
  }
})

test('an unknown environment may still be away through the focus fallback', () => {
  const waiting = createProactiveNotebookArrivalTracker()
  assert.deepEqual(observe(waiting, { context: null, focusState: 'active' }), { kind: 'wait' })
  assert.equal(observe(waiting, { context: ACTIVE }).kind, 'announce')

  const away = createProactiveNotebookArrivalTracker()
  assert.deepEqual(observe(away, { context: null, focusState: 'away' }), { kind: 'handled' })
})

test('an open notebook stays silent until it closes', () => {
  const tracker = createProactiveNotebookArrivalTracker()

  assert.deepEqual(observe(tracker, { open: true }), { kind: 'wait' })
  assert.deepEqual(observe(tracker, { open: false }), {
    kind: 'announce',
    key: 'pet.proactive.notebook_arrived_one',
  })
})

test('fullscreen, DND and quiet hours hold the line without consuming it', () => {
  const suppressed: ProactiveNotebookArrivalContext[] = [
    { ...ACTIVE, fullscreen: true },
    { ...ACTIVE, systemDnd: true },
    { ...ACTIVE, inQuietHours: true },
  ]

  for (const context of suppressed) {
    const tracker = createProactiveNotebookArrivalTracker()
    assert.deepEqual(observe(tracker, { context }), { kind: 'wait' })
    assert.equal(observe(tracker, { context: ACTIVE }).kind, 'announce')
  }
})

test('a cleared notebook starts a fresh announcement session', () => {
  const tracker = createProactiveNotebookArrivalTracker()

  assert.equal(observe(tracker, { unseenIds: ['a'] }).kind, 'announce')
  assert.deepEqual(observe(tracker, { unseenIds: [] }), { kind: 'idle' })
  assert.equal(observe(tracker, { unseenIds: ['a'] }).kind, 'announce')
})
