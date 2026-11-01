import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import { REMINDER_STRIP_SNOOZE_MS } from '../electron/services/reminderStripQueue.js'
import { createReminderStripSession } from '../electron/services/reminderStripSession.js'

const LABELS = { done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }

type Item = { id: string; title: string; body: string; labels: typeof LABELS }

function makeItem(id = 'task-1'): Item {
  return { id, title: `title-${id}`, body: `body-${id}`, labels: LABELS }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function createHarness(t: TestContext, options: { asyncCanReshow?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const snapshots: Array<{ items: Item[] }> = []
  const actions: string[] = []
  let allowed = true

  const session = createReminderStripSession({
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    snoozeMs: REMINDER_STRIP_SNOOZE_MS,
    onQueueChange: (snapshot) => snapshots.push(snapshot as { items: Item[] }),
    onAction: (action) => actions.push(action),
    canReshow: options.asyncCanReshow ? async () => allowed : () => allowed,
  })

  return {
    session,
    snapshots,
    actions,
    setCanReshow: (value: boolean) => {
      allowed = value
    },
    lastItems: () => snapshots.at(-1)?.items ?? [],
  }
}

test('snooze removes the item and re-queues it after exactly ten minutes', async (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())

  assert.deepEqual(harness.session.handleAction({ id: 'task-1', action: 'snooze' }), { ok: true })
  assert.deepEqual(harness.actions, ['snooze'])
  assert.deepEqual(harness.session.snapshot().items, [])

  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS - 1)
  await flushAsyncWork()
  assert.deepEqual(harness.session.snapshot().items, [])

  t.mock.timers.tick(1)
  await flushAsyncWork()
  const items = harness.session.snapshot().items
  assert.equal(items.length, 1)
  assert.equal(items[0]?.id, 'task-1')
})

test('an async canReshow re-queues only after its check resolves', async (t) => {
  const harness = createHarness(t, { asyncCanReshow: true })
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  // The check is still in flight, so nothing is queued yet.
  assert.deepEqual(harness.session.snapshot().items, [])

  await flushAsyncWork()
  const items = harness.session.snapshot().items
  assert.equal(items.length, 1)
  assert.equal(items[0]?.id, 'task-1')
})

test('a snoozed item stays gone when canReshow says it may not return', async (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  harness.setCanReshow(false)
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  assert.deepEqual(harness.session.snapshot().items, [])
})

test('withdrawing the id cancels its pending snooze', async (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  harness.session.withdraw('task-1')
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  assert.deepEqual(harness.session.snapshot().items, [])
})

test('withdrawing while an async canReshow is pending keeps the item gone', async (t) => {
  const harness = createHarness(t, { asyncCanReshow: true })
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  harness.session.withdraw('task-1')
  await flushAsyncWork()

  assert.deepEqual(harness.session.snapshot().items, [])
})

test('re-delivering the same id before the timer fires cancels the pending snooze', async (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  harness.session.show(makeItem())
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  const items = harness.session.snapshot().items
  assert.equal(items.length, 1)
  assert.equal(items[0]?.id, 'task-1')
})

test('destroy clears every pending snooze timer', async (t) => {
  const harness = createHarness(t)
  harness.session.show(makeItem())
  harness.session.handleAction({ id: 'task-1', action: 'snooze' })

  harness.session.destroy()
  const changesBeforeTick = harness.snapshots.length
  t.mock.timers.tick(REMINDER_STRIP_SNOOZE_MS)
  await flushAsyncWork()

  assert.equal(harness.snapshots.length, changesBeforeTick)
  assert.deepEqual(harness.session.snapshot().items, [])
})
