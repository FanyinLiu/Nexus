import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeNextReminderRun,
  markReminderTaskTriggered,
  refreshReminderTask,
  refreshReminderTaskForHandoff,
  reconcileTriggeredTaskWithPersisted,
  reminderAlreadyTriggered,
} from '../src/features/reminders/schedule.ts'
import type { ReminderTask, ReminderTaskSchedule } from '../src/types/index.ts'

function makeTask(
  overrides: Partial<ReminderTask> & { schedule: ReminderTaskSchedule },
): ReminderTask {
  return {
    id: 'handoff',
    title: 'Handoff',
    prompt: 'body',
    action: { kind: 'notice' },
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Drive one handoff refresh followed by one trigger. The returned count is the
 * number of due instants the taking-over scheduler would deliver.
 */
function deliverDuringHandoff(task: ReminderTask, from: Date, petLastOnlineAt?: string) {
  const handedOff = refreshReminderTaskForHandoff(task, { now: from, petLastOnlineAt })
  const nextRunAt = Date.parse(handedOff.nextRunAt ?? '')
  if (!Number.isFinite(nextRunAt) || nextRunAt > from.getTime()) {
    return { delivered: 0, task: handedOff }
  }
  return { delivered: 1, task: markReminderTaskTriggered(handedOff, from) }
}

function assertRecurringDueSurvivesHandoff(schedule: ReminderTaskSchedule) {
  const base = new Date('2026-01-05T00:00:05.000Z')
  const dueAt = computeNextReminderRun(schedule, base)
  const task = makeTask({ schedule, nextRunAt: dueAt })
  const from = new Date(Date.parse(dueAt) + 5_000)

  // A plain refresh lands on the *following* occurrence, which is exactly the
  // skip this handoff path must avoid.
  assert.notEqual(refreshReminderTask(task, from).nextRunAt, dueAt)

  const first = deliverDuringHandoff(task, from)
  assert.equal(first.delivered, 1, 'the due occurrence is delivered once')
  assert.equal(first.task.lastTriggeredAt, from.toISOString())

  const second = deliverDuringHandoff(first.task, new Date(from.getTime() + 1_000))
  assert.equal(second.delivered, 0, 'the same occurrence is not delivered twice')
  assert.notEqual(second.task.nextRunAt, dueAt)
}

test('an every-interval occurrence that fell due during handoff is delivered exactly once', () => {
  assertRecurringDueSurvivesHandoff({
    kind: 'every',
    everyMinutes: 15,
    anchorAt: '2026-01-05T00:00:05.000Z',
  })
})

test('a daily cron occurrence that fell due during handoff is delivered exactly once', () => {
  assertRecurringDueSurvivesHandoff({ kind: 'cron', expression: '0 9 * * *' })
})

test('a weekly cron occurrence that fell due during handoff is delivered exactly once', () => {
  assertRecurringDueSurvivesHandoff({ kind: 'cron', expression: '0 9 * * 1' })
})

test('a generic cron occurrence that fell due during handoff is delivered exactly once', () => {
  assertRecurringDueSurvivesHandoff({ kind: 'cron', expression: '*/5 * * * *' })
})

test('a due at-row exactly 30s overdue survives the handoff', () => {
  const task = makeTask({
    schedule: { kind: 'at', at: '2026-01-01T00:00:00.000Z' },
    nextRunAt: '2026-01-01T00:00:00.000Z',
  })

  const handedOff = refreshReminderTaskForHandoff(task, { now: new Date('2026-01-01T00:00:30.000Z') })
  assert.equal(handedOff.nextRunAt, '2026-01-01T00:00:00.000Z')
})

test('a due at-row 30.001s overdue is not replayed after a handoff', () => {
  const task = makeTask({
    schedule: { kind: 'at', at: '2026-01-01T00:00:00.000Z' },
    nextRunAt: '2026-01-01T00:00:00.000Z',
  })

  const handedOff = refreshReminderTaskForHandoff(task, { now: new Date('2026-01-01T00:00:30.001Z') })
  assert.equal(handedOff.nextRunAt, undefined)
})

test('a disabled task is never delivered during a handoff', () => {
  const task = makeTask({
    enabled: false,
    schedule: { kind: 'at', at: '2026-01-01T00:00:00.000Z' },
    nextRunAt: '2026-01-01T00:00:00.000Z',
  })

  const handedOff = refreshReminderTaskForHandoff(task, { now: new Date('2026-01-01T00:00:30.000Z') })
  assert.equal(handedOff.nextRunAt, undefined)
  assert.deepEqual(deliverDuringHandoff(task, new Date('2026-01-01T00:00:30.000Z')).delivered, 0)
})

test('a trigger from an earlier occurrence does not suppress the next one', () => {
  const dueAt = '2026-01-02T09:00:00.000Z'
  const task = makeTask({
    schedule: { kind: 'cron', expression: '0 9 * * *' },
    lastTriggeredAt: '2026-01-01T09:00:00.000Z',
    nextRunAt: dueAt,
  })

  const handedOff = refreshReminderTaskForHandoff(task, { now: new Date('2026-01-02T09:00:05.000Z') })
  assert.equal(handedOff.nextRunAt, dueAt)
})

test('historic overdue at-rows do not replay after a handoff', () => {
  const task = makeTask({
    schedule: { kind: 'at', at: '2025-12-31T23:59:00.000Z' },
    nextRunAt: '2025-12-31T23:59:00.000Z',
  })

  const handedOff = refreshReminderTaskForHandoff(task, { now: new Date('2026-01-01T00:00:31.000Z') })
  assert.equal(handedOff.nextRunAt, undefined)
})

test('a due row survives when the panel discovers the offline pet 45s late', () => {
  const dueAt = '2026-01-01T00:10:00.000Z'
  const task = makeTask({
    schedule: { kind: 'at', at: dueAt },
    nextRunAt: dueAt,
  })

  const handedOff = refreshReminderTaskForHandoff(task, {
    now: new Date('2026-01-01T00:10:45.000Z'),
    petLastOnlineAt: '2026-01-01T00:09:50.000Z',
  })
  assert.equal(handedOff.nextRunAt, dueAt)
})

test('a row older than the grace before the pet last online is not replayed', () => {
  const dueAt = '2026-01-01T00:08:00.000Z'
  const task = makeTask({
    schedule: { kind: 'at', at: dueAt },
    nextRunAt: dueAt,
  })

  const handedOff = refreshReminderTaskForHandoff(task, {
    now: new Date('2026-01-01T00:12:00.000Z'),
    petLastOnlineAt: '2026-01-01T00:10:00.000Z',
  })
  assert.equal(handedOff.nextRunAt, undefined)
})

test('the takeover grace is measured against the pet last online time', () => {
  const reference = '2026-01-01T00:10:00.000Z'
  const within = makeTask({
    schedule: { kind: 'at', at: '2026-01-01T00:09:30.000Z' },
    nextRunAt: '2026-01-01T00:09:30.000Z',
  })
  const outside = makeTask({
    schedule: { kind: 'at', at: '2026-01-01T00:09:29.999Z' },
    nextRunAt: '2026-01-01T00:09:29.999Z',
  })

  const options = { now: new Date('2026-01-01T00:15:00.000Z'), petLastOnlineAt: reference }
  assert.equal(refreshReminderTaskForHandoff(within, options).nextRunAt, within.nextRunAt)
  assert.equal(refreshReminderTaskForHandoff(outside, options).nextRunAt, undefined)
})

test('a persisted trigger at or after the due instant suppresses a stale copy', () => {
  const task = makeTask({
    schedule: { kind: 'at', at: '2026-01-01T00:00:30.000Z' },
    nextRunAt: '2026-01-01T00:00:30.000Z',
  })

  assert.equal(
    reminderAlreadyTriggered(task, { ...task, lastTriggeredAt: '2026-01-01T00:00:30.500Z' }),
    true,
  )
  assert.equal(
    reminderAlreadyTriggered(task, { ...task, lastTriggeredAt: '2026-01-01T00:00:29.000Z' }),
    false,
  )
  assert.equal(reminderAlreadyTriggered(task, { ...task }), false)
})

test('external delivery drains the stale row and preserves its next recurrence', () => {
  const task = makeTask({
    schedule: { kind: 'at', at: '2026-01-01T00:00:30.000Z' },
    nextRunAt: '2026-01-01T00:00:30.000Z',
  })
  const stored = {
    ...task,
    lastTriggeredAt: '2026-01-01T00:00:30.500Z',
    nextRunAt: '2026-01-01T01:00:00.000Z',
  }

  const drained = reconcileTriggeredTaskWithPersisted(task, stored)
  assert.equal(drained.lastTriggeredAt, '2026-01-01T00:00:30.500Z')
  assert.equal(drained.nextRunAt, '2026-01-01T01:00:00.000Z')
})

const MISSED_CATCH_UP_CASES: Array<{
  name: string
  schedule: ReminderTaskSchedule
  // How far past the first missed occurrence the panel starts up.
  missedByMs: number
}> = [
  {
    name: 'every-minute',
    schedule: { kind: 'every', everyMinutes: 1, anchorAt: '2026-01-05T00:00:05.000Z' },
    missedByMs: 5 * 60_000,
  },
  {
    name: 'daily cron',
    schedule: { kind: 'cron', expression: '0 9 * * *' },
    missedByMs: 5 * 24 * 60 * 60_000,
  },
  {
    name: 'weekly cron',
    schedule: { kind: 'cron', expression: '0 9 * * 1' },
    missedByMs: 5 * 7 * 24 * 60 * 60_000,
  },
  {
    name: 'five-minute cron',
    schedule: { kind: 'cron', expression: '*/5 * * * *' },
    missedByMs: 5 * 5 * 60_000,
  },
]

for (const { name, schedule, missedByMs } of MISSED_CATCH_UP_CASES) {
  test(`a ${name} reminder missed five times is caught up exactly once at startup`, () => {
    const base = new Date('2026-01-05T00:00:05.000Z')
    const dueAt = computeNextReminderRun(schedule, base)
    const task = makeTask({ schedule, nextRunAt: dueAt })
    const petLastOnlineAt = new Date(Date.parse(dueAt) - 10_000).toISOString()
    const from = new Date(Date.parse(dueAt) + missedByMs)

    const first = deliverDuringHandoff(task, from, petLastOnlineAt)
    assert.equal(first.delivered, 1, 'only one occurrence is caught up')

    const second = deliverDuringHandoff(first.task, new Date(from.getTime() + 1_000), petLastOnlineAt)
    assert.equal(second.delivered, 0, 'the missed backlog is not replayed again')
    assert.notEqual(second.task.nextRunAt, dueAt)
    assert.ok(Date.parse(second.task.nextRunAt ?? '') > from.getTime())
  })
}

test('a due occurrence already triggered by the pet is not preserved for the handoff', () => {
  const dueAt = '2026-01-05T00:15:05.000Z'
  const task = makeTask({
    schedule: { kind: 'every', everyMinutes: 15, anchorAt: '2026-01-05T00:00:05.000Z' },
    nextRunAt: dueAt,
    lastTriggeredAt: '2026-01-05T00:15:05.500Z',
  })
  const from = new Date('2026-01-05T00:15:10.000Z')

  const handedOff = refreshReminderTaskForHandoff(task, {
    now: from,
    petLastOnlineAt: '2026-01-05T00:14:55.000Z',
  })

  assert.notEqual(handedOff.nextRunAt, dueAt)
  assert.ok(Date.parse(handedOff.nextRunAt ?? '') > from.getTime())
})
