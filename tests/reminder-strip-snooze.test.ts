import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import { REMINDER_STRIP_SNOOZE_MS } from '../electron/services/reminderStripQueue.js'
import { createReminderStripSession } from '../electron/services/reminderStripSession.js'

const LABELS = { done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }

type Item = { id: string; title: string; body: string; labels: typeof LABELS }

function makeItem(id = 'task-1'): Item {
  return { id, title: `title-${id}`, body: `body-${id}`, labels: LABELS }
}

function createHarness(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const snapshots: Array<{ items: Item[] }> = []
  const actions: string[] = []
  let pending = true

  const session = createReminderStripSession({
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    snoozeMs: REMINDER_STRIP_SNOOZE_MS,
    onQueueChange: (snapshot) => snapshots.push(snapshot as { items: Item[] }),
    onAction: (action) => actions.push(action),
    isPending: () => pending,
  })

  return {
    session,
    snapshots,
    actions,
    setPending: (value: boolean) => {
      pending = value
    },
    lastItems: () => snapshots.at(-1)?.items ?? [],
  }
}

test('snooze removes the item and re-queues it after exactly ten minutes', (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())

  assert.deepEqual(harness.session.handleAction({ id: 'task-1', action: 'snooze' }), { ok: true })
  assert.deepEqual(harness.actions, ['snooze'])
  assert.deepEqual(harness.session.snapshot().items, [])

  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS - 1)
  assert.deepEqual(harness.session.snapshot().items, [])

  t.mock.timers.tick(1)
  const items = harness.session.snapshot().items
  assert.equal(items.length, 1)
  assert.equal(items[0]?.id, 'task-1')
})

test('a snoozed item stays gone when its inbox entry is no longer unread', (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  harness.setPending(false)
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)

  assert.deepEqual(harness.session.snapshot().items, [])
})

test('withdrawing the id cancels its pending snooze', (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  harness.session.withdraw('task-1')
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)

  assert.deepEqual(harness.session.snapshot().items, [])
})

test('re-delivering the same id before the timer fires cancels the pending snooze', (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  harness.session.show(makeItem())
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)

  const items = harness.session.snapshot().items
  assert.equal(items.length, 1)
  assert.equal(items[0]?.id, 'task-1')
})

test('destroy clears every pending snooze timer', (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  harness.session.destroy()
  const changesBeforeTick = harness.snapshots.length
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)

  assert.equal(harness.snapshots.length, changesBeforeTick)
  assert.deepEqual(harness.session.snapshot().items, [])
})
