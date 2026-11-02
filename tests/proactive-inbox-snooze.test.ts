import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createProactiveInboxSnoozeScheduler,
  PROACTIVE_INBOX_SNOOZE_MS,
} from '../src/features/proactive/proactiveInboxSnooze.ts'
import type { ProactiveInboxEntryView } from '../src/features/proactive/proactiveInboxOverlay.ts'
import { enMessages } from '../src/i18n/locales/en/index.ts'
import { zhCNMessages } from '../src/i18n/locales/zh-CN/index.ts'

function entry(id: string, overrides: Partial<ProactiveInboxEntryView> = {}): ProactiveInboxEntryView {
  return {
    id,
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'high',
    title: `Title ${id}`,
    body: `Body ${id}`,
    actions: ['done', 'snooze'],
    createdAt: 1,
    status: 'unread',
    updatedAt: 1,
    ...overrides,
  }
}

function createFakeClock() {
  let now = 0
  let nextHandle = 1
  const timers = new Map<number, { dueAt: number, callback: () => void }>()

  return {
    setTimeout(callback: () => void, ms: number) {
      const handle = nextHandle++
      timers.set(handle, { dueAt: now + ms, callback })
      return handle
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number)
    },
    advance(ms: number) {
      now += ms
      let due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)
      while (due.length > 0) {
        const [handle, timer] = due[0]
        timers.delete(handle)
        timer.callback()
        due = [...timers.entries()]
          .filter(([, entryTimer]) => entryTimer.dueAt <= now)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)
      }
    },
    pendingCount() {
      return timers.size
    },
  }
}

test('snooze re-delivers exactly once after ten minutes', () => {
  const clock = createFakeClock()
  const delivered: ProactiveInboxEntryView[] = []
  const scheduler = createProactiveInboxSnoozeScheduler({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDeliver: (item) => { delivered.push(item) },
  })

  scheduler.snooze(entry('a'))
  assert.equal(scheduler.isSnoozed('a'), true)
  clock.advance(PROACTIVE_INBOX_SNOOZE_MS - 1)
  assert.equal(delivered.length, 0)

  clock.advance(1)
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].id, 'a')
  assert.equal(scheduler.isSnoozed('a'), false)
  assert.equal(clock.pendingCount(), 0)

  clock.advance(PROACTIVE_INBOX_SNOOZE_MS)
  assert.equal(delivered.length, 1)
})

test('a done or dismissed entry cancels its snooze timer', () => {
  const clock = createFakeClock()
  const delivered: ProactiveInboxEntryView[] = []
  const scheduler = createProactiveInboxSnoozeScheduler({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDeliver: (item) => { delivered.push(item) },
  })

  scheduler.snooze(entry('done-later'))
  scheduler.snooze(entry('dismissed-later'))
  scheduler.reconcile([
    entry('done-later', { status: 'done' }),
    entry('dismissed-later', { status: 'dismissed' }),
  ])

  assert.deepEqual(scheduler.snoozedIds(), [])
  clock.advance(PROACTIVE_INBOX_SNOOZE_MS)
  assert.equal(delivered.length, 0)
})

test('an entry removed from the inbox cancels its timer', () => {
  const clock = createFakeClock()
  const delivered: ProactiveInboxEntryView[] = []
  const scheduler = createProactiveInboxSnoozeScheduler({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDeliver: (item) => { delivered.push(item) },
  })

  scheduler.snooze(entry('gone'))
  scheduler.reconcile([])
  clock.advance(PROACTIVE_INBOX_SNOOZE_MS)
  assert.equal(delivered.length, 0)
})

test('the snooze duration is pinned to ten minutes in the constant, timer and copy', () => {
  assert.equal(PROACTIVE_INBOX_SNOOZE_MS, 10 * 60_000)
  assert.equal(PROACTIVE_INBOX_SNOOZE_MS, 600000)

  // A scheduler built without `snoozeMs` must ask the injected timer for
  // exactly ten minutes; changing the constant alone would break this.
  const delays: number[] = []
  const scheduler = createProactiveInboxSnoozeScheduler({
    setTimeout: (_callback, ms) => {
      delays.push(ms)
      return delays.length
    },
    clearTimeout: () => {},
    onDeliver: () => {},
  })
  scheduler.snooze(entry('pinned'))
  assert.deepEqual(delays, [600000])

  // The visible label must agree with the constant; changing either alone fails.
  assert.match((zhCNMessages as Record<string, string>)['pet.proactive.inbox_snooze'], /10/)
  assert.match((enMessages as Record<string, string>)['pet.proactive.inbox_snooze'], /10/)
})

test('dispose clears every pending timer and snoozing again replaces one', () => {
  const clock = createFakeClock()
  const delivered: ProactiveInboxEntryView[] = []
  const scheduler = createProactiveInboxSnoozeScheduler({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDeliver: (item) => { delivered.push(item) },
  })

  scheduler.snooze(entry('a'))
  scheduler.snooze(entry('a'))
  assert.equal(clock.pendingCount(), 1)

  scheduler.snooze(entry('b'))
  scheduler.dispose()
  assert.equal(clock.pendingCount(), 0)
  clock.advance(PROACTIVE_INBOX_SNOOZE_MS)
  assert.equal(delivered.length, 0)
})
