import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProactiveInboxEntry } from '../shared/proactiveDelivery.js'
import {
  createSingleClickGate,
  resolveProactiveNoteView,
  shouldOpenNotebookOnStageClick,
  PROACTIVE_NOTE_SINGLE_CLICK_DELAY_MS,
  type ProactiveNoteEntry,
} from '../src/features/proactive/proactiveNote.ts'

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const NOW = 30 * DAY

type NoteEntry = Pick<ProactiveInboxEntry, 'id' | 'status' | 'actions' | 'priority' | 'createdAt'>

function entry(overrides: Partial<NoteEntry> & { id: string }): ProactiveNoteEntry {
  return {
    status: 'unread',
    createdAt: NOW,
    ...overrides,
  }
}

test('no unseen entries means no notebook state', () => {
  assert.deepEqual(resolveProactiveNoteView([], { nowMs: NOW }), { state: 'none' })
  assert.deepEqual(
    resolveProactiveNoteView([entry({ id: 'read', status: 'read' })], { nowMs: NOW }),
    { state: 'none' },
  )
})

test('one or many unseen entries collapse to the same unread state', () => {
  for (const count of [1, 2, 3, 10]) {
    const entries = Array.from({ length: count }, (_, index) =>
      entry({ id: `unseen-${index}`, createdAt: NOW - index }),
    )
    assert.deepEqual(resolveProactiveNoteView(entries, { nowMs: NOW }), { state: 'unread' })
  }
})

test('read, done and dismissed entries never count as unseen', () => {
  const entries = [
    entry({ id: 'read', status: 'read' }),
    entry({ id: 'done', status: 'done' }),
    entry({ id: 'dismissed', status: 'dismissed' }),
  ]

  assert.deepEqual(resolveProactiveNoteView(entries, { nowMs: NOW }), { state: 'none' })
  assert.deepEqual(
    resolveProactiveNoteView([entry({ id: 'unread' }), ...entries], { nowMs: NOW }),
    { state: 'unread' },
  )
})

test('hidden snoozed ids and entries older than 15 days are ignored', () => {
  const boundary = entry({ id: 'boundary', createdAt: NOW - 15 * DAY })
  const entries = [
    entry({ id: 'hidden' }),
    entry({ id: 'too-old', createdAt: NOW - 15 * DAY - 1 }),
    boundary,
    entry({ id: 'recent', createdAt: NOW - 1 }),
  ]

  assert.deepEqual(
    resolveProactiveNoteView(entries, { hiddenIds: ['hidden', 'recent'], nowMs: NOW }),
    { state: 'unread' },
  )
  assert.deepEqual(
    resolveProactiveNoteView(entries, { hiddenIds: ['hidden', 'recent', 'boundary'], nowMs: NOW }),
    { state: 'none' },
  )
})

test('only a left single click without drag on unread items opens the notebook', () => {
  const base = { noteState: 'unread' as const, button: 0, dragged: false, clickCount: 1 }

  assert.equal(shouldOpenNotebookOnStageClick(base), true)
  assert.equal(shouldOpenNotebookOnStageClick({ ...base, noteState: 'none' }), false)
  assert.equal(shouldOpenNotebookOnStageClick({ ...base, button: 2 }), false)
  assert.equal(shouldOpenNotebookOnStageClick({ ...base, dragged: true }), false)
  assert.equal(shouldOpenNotebookOnStageClick({ ...base, clickCount: 2 }), false)
})

function createFakeTimers() {
  let nextId = 1
  const pending = new Map<number, { run: () => void; delayMs: number }>()

  return {
    setTimeout(run: () => void, delayMs: number): number {
      const id = nextId
      nextId += 1
      pending.set(id, { run, delayMs })
      return id
    },
    clearTimeout(handle: number): void {
      pending.delete(handle)
    },
    runAll(): void {
      const tasks = [...pending.values()]
      pending.clear()
      for (const task of tasks) task.run()
    },
    delays(): number[] {
      return [...pending.values()].map((task) => task.delayMs)
    },
  }
}

test('a single click opens after the delay exactly once', () => {
  const timers = createFakeTimers()
  const gate = createSingleClickGate(timers)
  let runs = 0

  gate.click(() => {
    runs += 1
  })

  assert.equal(runs, 0)
  assert.deepEqual(timers.delays(), [PROACTIVE_NOTE_SINGLE_CLICK_DELAY_MS])
  assert.equal(PROACTIVE_NOTE_SINGLE_CLICK_DELAY_MS, 260)

  timers.runAll()
  assert.equal(runs, 1)
})

test('a double click cancels the pending single click so the notebook never opens', () => {
  const timers = createFakeTimers()
  const gate = createSingleClickGate(timers)
  let runs = 0

  gate.click(() => {
    runs += 1
  })
  gate.doubleClick()

  assert.deepEqual(timers.delays(), [])
  timers.runAll()
  assert.equal(runs, 0)
})
