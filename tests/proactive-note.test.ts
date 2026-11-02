import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import type { ProactiveInboxEntry } from '../shared/proactiveDelivery.js'
import { PET_MODEL_PRESETS } from '../src/features/pet/models.ts'
import {
  createProactiveNoteMotionGate,
  createSingleClickGate,
  isProactiveNoteMotionSuppressed,
  resolveProactiveNoteAnchor,
  resolveProactiveNoteView,
  shouldOpenNotebookOnStageClick,
  PROACTIVE_NOTE_GLANCE_THROTTLE_MS,
  PROACTIVE_NOTE_KEEPS_SEEN_ACTIONABLE,
  PROACTIVE_NOTE_SINGLE_CLICK_DELAY_MS,
  PROACTIVE_NOTE_WIGGLE_DURATION_MS,
  PROACTIVE_NOTE_WIGGLE_INTERVAL_MS,
  type ProactiveNoteEntry,
  type ProactiveNoteView,
} from '../src/features/proactive/proactiveNote.ts'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { ProactiveNote } = await import('../src/components/ProactiveNote.tsx')

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const NOW = 30 * DAY

type NoteEntry = Pick<
  ProactiveInboxEntry,
  'id' | 'status' | 'actions' | 'priority' | 'createdAt'
>

function entry(overrides: Partial<NoteEntry> & { id: string }): ProactiveNoteEntry {
  return {
    status: 'unread',
    actions: [],
    priority: 'normal',
    createdAt: NOW,
    ...overrides,
  }
}

function unseen(count: number, overrides: Partial<NoteEntry> = {}): ProactiveNoteEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry({ id: `unseen-${index}`, createdAt: NOW - index, ...overrides }),
  )
}

const importantView: ProactiveNoteView = { state: 'important', sheets: 3, animated: true }
const oneView: ProactiveNoteView = { state: 'one', sheets: 1, animated: true }
const noneView: ProactiveNoteView = { state: 'none', sheets: 0, animated: true }

test('no unseen entries means no note', () => {
  assert.deepEqual(resolveProactiveNoteView([], { nowMs: NOW }), noneView)
  assert.deepEqual(
    resolveProactiveNoteView([entry({ id: 'read', status: 'read' })], { nowMs: NOW }),
    noneView,
  )
})

test('one and two unseen ordinary entries both draw a single sheet', () => {
  for (const count of [1, 2]) {
    const view = resolveProactiveNoteView(unseen(count), { nowMs: NOW })
    assert.deepEqual(view, { state: 'one', sheets: 1, animated: true })
  }
})

test('three or more unseen ordinary entries draw a capped stack', () => {
  for (const count of [3, 4, 10]) {
    const view = resolveProactiveNoteView(unseen(count), { nowMs: NOW })
    assert.deepEqual(view, { state: 'stack', sheets: 3, animated: true })
  }
})

test('a high-priority unseen entry makes the note important', () => {
  const entries = [
    entry({ id: 'normal-1', actions: [] }),
    entry({ id: 'normal-2', actions: [] }),
    entry({ id: 'high', priority: 'high', actions: [] }),
  ]
  assert.deepEqual(resolveProactiveNoteView(entries, { nowMs: NOW }), {
    state: 'important',
    sheets: 3,
    animated: true,
  })
})

test('an actionable unseen entry makes the note important and caps sheets at 3', () => {
  assert.deepEqual(
    resolveProactiveNoteView([entry({ id: 'actionable', actions: ['done'] })], { nowMs: NOW }),
    { state: 'important', sheets: 1, animated: true },
  )
  const many = unseen(10, { priority: 'high' })
  assert.deepEqual(resolveProactiveNoteView(many, { nowMs: NOW }), {
    state: 'important',
    sheets: 3,
    animated: true,
  })
})

test('important wins over a ready stack', () => {
  const entries = [...unseen(3), entry({ id: 'high', priority: 'high' })]
  assert.deepEqual(resolveProactiveNoteView(entries, { nowMs: NOW }), {
    state: 'important',
    sheets: 3,
    animated: true,
  })
})

test('read, done and dismissed entries never count toward the note', () => {
  const entries = [
    entry({ id: 'read', status: 'read', priority: 'high', actions: ['done'] }),
    entry({ id: 'done', status: 'done', priority: 'high', actions: ['done'] }),
    entry({ id: 'dismissed', status: 'dismissed', priority: 'high', actions: ['done'] }),
  ]

  assert.deepEqual(resolveProactiveNoteView(entries, { nowMs: NOW }), noneView)

  // A read high-priority entry beside one ordinary unseen entry stays "one".
  assert.deepEqual(
    resolveProactiveNoteView([entry({ id: 'unread' }), ...entries], { nowMs: NOW }),
    { state: 'one', sheets: 1, animated: true },
  )
})

test('hidden snoozed ids and entries older than 15 days are ignored', () => {
  const boundary = entry({ id: 'boundary', createdAt: NOW - 15 * DAY })
  const entries = [
    entry({ id: 'hidden', priority: 'high', actions: ['done'] }),
    entry({ id: 'too-old', priority: 'high', actions: ['done'], createdAt: NOW - 15 * DAY - 1 }),
    boundary,
    entry({ id: 'recent', createdAt: NOW - 1 }),
  ]

  assert.deepEqual(
    resolveProactiveNoteView(entries, { hiddenIds: ['hidden'], nowMs: NOW }),
    { state: 'one', sheets: 1, animated: true },
  )

  // Without the hidden filter the hidden high-priority entry is important.
  assert.equal(
    resolveProactiveNoteView(entries, { hiddenIds: [], nowMs: NOW }).state,
    'important',
  )
})

test('seen-but-unhandled actionable entries wait for the product switch', () => {
  assert.equal(PROACTIVE_NOTE_KEEPS_SEEN_ACTIONABLE, false)

  const seen = [entry({ id: 'seen', status: 'read', actions: ['done'] })]

  assert.deepEqual(resolveProactiveNoteView(seen, { nowMs: NOW }), noneView)
  assert.deepEqual(resolveProactiveNoteView(seen, { nowMs: NOW, keepSeenActionable: true }), {
    state: 'one',
    sheets: 1,
    animated: false,
  })

  // Only actionable read entries qualify; high priority alone is not enough.
  assert.deepEqual(
    resolveProactiveNoteView([entry({ id: 'seen', status: 'read', priority: 'high' })], {
      nowMs: NOW,
      keepSeenActionable: true,
    }),
    noneView,
  )
})

test('ordinary glances are throttled to once per 30 minutes', () => {
  const gate = createProactiveNoteMotionGate()
  const t0 = 1_000_000

  assert.equal(gate.approach({ nowMs: t0, view: oneView, suppressed: false }), true)
  assert.equal(
    gate.approach({ nowMs: t0 + PROACTIVE_NOTE_GLANCE_THROTTLE_MS - 1, view: oneView, suppressed: false }),
    false,
  )
  assert.equal(
    gate.approach({ nowMs: t0 + PROACTIVE_NOTE_GLANCE_THROTTLE_MS, view: oneView, suppressed: false }),
    true,
  )
})

test('a suppressed or refused approach does not consume the glance budget', () => {
  const gate = createProactiveNoteMotionGate()

  assert.equal(gate.approach({ nowMs: 0, view: oneView, suppressed: true }), false)
  assert.equal(gate.approach({ nowMs: 0, view: oneView, suppressed: false }), true)
  assert.equal(gate.approach({ nowMs: 1, view: oneView, suppressed: false }), false)
})

test('important notes glance on every approach without the 30-minute throttle', () => {
  const gate = createProactiveNoteMotionGate()
  const times = [0, 1, 2, 5 * MINUTE, 29 * MINUTE, 30 * MINUTE]

  for (const nowMs of times) {
    assert.equal(gate.approach({ nowMs, view: importantView, suppressed: false }), true)
  }
})

test('important notes wait one interval before wiggling, then repeat at most once per interval', () => {
  const gate = createProactiveNoteMotionGate()

  assert.equal(gate.tick({ nowMs: 0, view: importantView, suppressed: false }), 0)
  assert.equal(
    gate.tick({ nowMs: PROACTIVE_NOTE_WIGGLE_INTERVAL_MS - 1, view: importantView, suppressed: false }),
    0,
  )
  assert.equal(
    gate.tick({ nowMs: PROACTIVE_NOTE_WIGGLE_INTERVAL_MS, view: importantView, suppressed: false }),
    PROACTIVE_NOTE_WIGGLE_DURATION_MS,
  )
  assert.ok(PROACTIVE_NOTE_WIGGLE_DURATION_MS <= 1000)
  assert.equal(
    gate.tick({ nowMs: 2 * PROACTIVE_NOTE_WIGGLE_INTERVAL_MS - 1, view: importantView, suppressed: false }),
    0,
  )
  assert.equal(
    gate.tick({ nowMs: 2 * PROACTIVE_NOTE_WIGGLE_INTERVAL_MS, view: importantView, suppressed: false }),
    PROACTIVE_NOTE_WIGGLE_DURATION_MS,
  )
})

test('wiggling stops once the important state is gone and restarts its wait for a new one', () => {
  const gate = createProactiveNoteMotionGate()

  assert.equal(gate.tick({ nowMs: 0, view: importantView, suppressed: false }), 0)
  assert.equal(
    gate.tick({ nowMs: PROACTIVE_NOTE_WIGGLE_INTERVAL_MS, view: importantView, suppressed: false }),
    PROACTIVE_NOTE_WIGGLE_DURATION_MS,
  )

  // Seen: no motion while the state is none, however long it lasts.
  assert.equal(gate.tick({ nowMs: 11 * MINUTE, view: noneView, suppressed: false }), 0)
  assert.equal(gate.tick({ nowMs: 30 * MINUTE, view: noneView, suppressed: false }), 0)
  assert.equal(gate.tick({ nowMs: 45 * MINUTE, view: oneView, suppressed: false }), 0)

  // A new important entry restarts the full 10-minute wait.
  assert.equal(gate.tick({ nowMs: 46 * MINUTE, view: importantView, suppressed: false }), 0)
  assert.equal(
    gate.tick({ nowMs: 56 * MINUTE - 1, view: importantView, suppressed: false }),
    0,
  )
  assert.equal(
    gate.tick({ nowMs: 56 * MINUTE, view: importantView, suppressed: false }),
    PROACTIVE_NOTE_WIGGLE_DURATION_MS,
  )
})

const suppressionContexts = [
  {
    name: 'fullscreen',
    context: { fullscreen: true, systemDnd: null, inQuietHours: false, focusState: 'active' as const },
  },
  {
    name: 'system DND',
    context: { fullscreen: false, systemDnd: true, inQuietHours: false, focusState: 'active' as const },
  },
  {
    name: 'quiet hours',
    context: { fullscreen: false, systemDnd: null, inQuietHours: true, focusState: 'active' as const },
  },
  {
    name: 'locked',
    context: { fullscreen: false, systemDnd: null, inQuietHours: false, focusState: 'locked' as const },
  },
  {
    name: 'away',
    context: { fullscreen: false, systemDnd: null, inQuietHours: false, focusState: 'away' as const },
  },
]

test('suppressed contexts draw the note but never move it', () => {
  for (const { name, context } of suppressionContexts) {
    assert.equal(isProactiveNoteMotionSuppressed(context), true, name)

    const gate = createProactiveNoteMotionGate()
    let motions = 0
    for (let minute = 0; minute <= 120; minute += 1) {
      const nowMs = minute * MINUTE
      if (gate.approach({ nowMs, view: importantView, suppressed: true })) motions += 1
      if (gate.tick({ nowMs, view: importantView, suppressed: true }) > 0) motions += 1
    }
    assert.equal(motions, 0, name)
  }
})

test('unknown DND and an active or idle focus state do not suppress motion', () => {
  assert.equal(
    isProactiveNoteMotionSuppressed({
      fullscreen: false,
      systemDnd: null,
      inQuietHours: false,
      focusState: 'active',
    }),
    false,
  )
  assert.equal(
    isProactiveNoteMotionSuppressed({
      fullscreen: false,
      systemDnd: null,
      inQuietHours: false,
      focusState: 'idle',
    }),
    false,
  )
  assert.equal(
    isProactiveNoteMotionSuppressed({
      fullscreen: false,
      systemDnd: false,
      inQuietHours: false,
      focusState: 'active',
    }),
    false,
  )
})

test('only a left single click without drag on a visible note opens the notebook', () => {
  const base = { noteState: 'one' as const, button: 0, dragged: false, clickCount: 1 }

  assert.equal(shouldOpenNotebookOnStageClick(base), true)
  assert.equal(
    shouldOpenNotebookOnStageClick({ ...base, noteState: 'stack' }),
    true,
  )
  assert.equal(
    shouldOpenNotebookOnStageClick({ ...base, noteState: 'important' }),
    true,
  )
  assert.equal(
    shouldOpenNotebookOnStageClick({ ...base, noteState: 'none' }),
    false,
  )
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

type NoteElement = {
  props: {
    onClick: (event: { stopPropagation: () => void }) => void
    onDoubleClick: (event: { stopPropagation: () => void }) => void
  }
}

function renderNoteElement(onActivate: () => void): NoteElement {
  const element = ProactiveNote({
    view: oneView,
    motion: null,
    label: 'note',
    anchor: { x: 0.5, y: 0.4 },
    onActivate,
  })
  assert.ok(element, 'a visible note must render')
  return element as unknown as NoteElement
}

test('a click on the note activates once and never reaches the stage', () => {
  let activations = 0
  let stops = 0
  const note = renderNoteElement(() => {
    activations += 1
  })
  const event = {
    stopPropagation: () => {
      stops += 1
    },
  }

  note.props.onClick(event)
  assert.equal(activations, 1)
  assert.equal(stops, 1)

  // A double click must not fall through to the stage voice gesture either.
  note.props.onDoubleClick(event)
  assert.equal(activations, 1)
  assert.equal(stops, 2)
})

test('built-in models define a note anchor inside the stage box', () => {
  const builtIns = ['mao', 'haru', 'hiyori']

  for (const id of builtIns) {
    const model = PET_MODEL_PRESETS.find((preset) => preset.id === id)
    assert.ok(model, `${id} must exist`)
    const anchor = model.layout?.noteAnchor
    assert.ok(anchor, `${id} must define noteAnchor`)
    assert.ok(anchor.x > 0 && anchor.x < 1, `${id} x inside 0..1`)
    assert.ok(anchor.y > 0 && anchor.y < 1, `${id} y inside 0..1`)
    assert.deepEqual(resolveProactiveNoteAnchor(model), anchor)
  }
})

test('a model without an anchor falls back to the beside-the-head default', () => {
  assert.deepEqual(resolveProactiveNoteAnchor({}), { x: 0.7, y: 0.2 })
  assert.deepEqual(resolveProactiveNoteAnchor({ layout: {} }), { x: 0.7, y: 0.2 })
  assert.deepEqual(
    resolveProactiveNoteAnchor({ layout: { noteAnchor: { x: 0.61, y: 0.18 } } }),
    { x: 0.61, y: 0.18 },
  )
})

test('model anchors are clamped to the stage box', () => {
  assert.deepEqual(
    resolveProactiveNoteAnchor({ layout: { noteAnchor: { x: -1, y: 2 } } }),
    { x: 0.05, y: 0.95 },
  )
  assert.deepEqual(
    resolveProactiveNoteAnchor({ layout: { noteAnchor: { x: 0, y: 1 } } }),
    { x: 0.05, y: 0.95 },
  )
})
