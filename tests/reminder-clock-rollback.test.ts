import assert from 'node:assert/strict'
import { register } from 'node:module'
import test, { type TestContext } from 'node:test'

import {
  computeNextReminderRun,
  refreshReminderTaskForHandoff,
  reminderAlreadyTriggered,
} from '../src/features/reminders/schedule.ts'
import type { ReminderTask, ReminderTaskSchedule } from '../src/types/index.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { createHookRenderer } = await import('./helpers/directNotificationHookHarness.ts')
const { useReminderScheduler } = await import('../src/hooks/useReminderScheduler.ts')

const STORAGE_KEY = 'nexus:reminder-tasks'
const MINUTE = 60_000
// Corrected wall clock after an NTP correction moved it backwards.
const NOW = Date.parse('2026-03-29T00:20:00.000Z')
// Stamp written while the clock was still one hour ahead.
const AHEAD_STAMP = '2026-03-29T01:16:00.000Z'

type Task = ReminderTask

function makeTask(
  id: string,
  schedule: ReminderTaskSchedule,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    title: id,
    prompt: `body ${id}`,
    action: { kind: 'notice' },
    enabled: true,
    createdAt: new Date(NOW - MINUTE).toISOString(),
    updatedAt: new Date(NOW - MINUTE).toISOString(),
    schedule,
    ...overrides,
  }
}

function installEnvironment(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  const windowStub = {
    localStorage,
    setTimeout: (callback: () => void, delay = 0) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer: unknown) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })
  const readTasks = () => JSON.parse(store.get(STORAGE_KEY) ?? '[]') as Task[]
  const writeTasks = (tasks: Task[]) => {
    store.set(STORAGE_KEY, JSON.stringify(tasks))
  }
  return { readTasks, writeTasks }
}

function createScheduler(initialTasks: Task[], onTrigger: (task: Task) => void) {
  let tasks = initialTasks
  const setTasks = (updater: unknown) => {
    tasks = typeof updater === 'function'
      ? (updater as (current: Task[]) => Task[])(tasks)
      : updater as Task[]
  }
  const renderer = createHookRenderer(() => useReminderScheduler({
    enabled: true,
    tasks,
    setTasks: setTasks as never,
    locale: 'en-US',
    onTrigger: onTrigger as never,
  }))
  return { renderer, getTasks: () => tasks }
}

test('an ahead-of-time trigger stamp does not suppress the current due instant', () => {
  const dueAt = new Date(NOW + MINUTE).toISOString()
  const now = new Date(NOW + 2 * MINUTE)
  const schedules: ReminderTaskSchedule[] = [
    { kind: 'at', at: dueAt },
    { kind: 'every', everyMinutes: 15, anchorAt: new Date(NOW - 14 * MINUTE).toISOString() },
    { kind: 'cron', expression: '* * * * *' },
  ]

  for (const schedule of schedules) {
    const task = makeTask(schedule.kind, schedule, { nextRunAt: dueAt })
    assert.equal(
      reminderAlreadyTriggered(task, { ...task, lastTriggeredAt: AHEAD_STAMP }, now),
      false,
      `${schedule.kind}: a future trigger stamp is not a delivery of ${dueAt}`,
    )
    assert.equal(
      reminderAlreadyTriggered(task, { ...task, lastTriggeredAt: new Date(NOW + MINUTE + 500).toISOString() }, now),
      true,
      `${schedule.kind}: a trigger at the due instant is still a duplicate`,
    )
    assert.equal(
      reminderAlreadyTriggered(task, { ...task, lastTriggeredAt: new Date(NOW + MINUTE - 500).toISOString() }, now),
      false,
      `${schedule.kind}: an earlier trigger stamp does not cover this occurrence`,
    )
  }
})

test('a handoff keeps a due occurrence whose trigger stamp is ahead of the corrected clock', () => {
  const dueAt = new Date(NOW + MINUTE).toISOString()
  const task = makeTask('handoff', {
    kind: 'every',
    everyMinutes: 15,
    anchorAt: new Date(NOW - 14 * MINUTE).toISOString(),
  }, {
    nextRunAt: dueAt,
    lastTriggeredAt: AHEAD_STAMP,
  })

  const handedOff = refreshReminderTaskForHandoff(task, {
    now: new Date(Date.parse(dueAt) + 5_000),
  })

  assert.equal(handedOff.nextRunAt, dueAt, 'the due occurrence survives the handoff')
})

test('a one-shot reminder still fires once after the clock rolls back behind its trigger stamp', (t) => {
  const { readTasks, writeTasks } = installEnvironment(t)
  const dueAt = new Date(NOW + MINUTE).toISOString()
  const task = makeTask('once', { kind: 'at', at: dueAt }, {
    nextRunAt: dueAt,
    lastTriggeredAt: AHEAD_STAMP,
  })
  writeTasks([task])

  const triggered: string[] = []
  const { renderer } = createScheduler([task], (triggeredTask) => { triggered.push(triggeredTask.id) })
  try {
    renderer.render(undefined)
    t.mock.timers.tick(MINUTE)
    renderer.render(undefined)

    assert.deepEqual(triggered, ['once'], 'the corrected due instant is delivered')
    assert.equal(
      readTasks()[0]?.lastTriggeredAt,
      new Date(NOW + MINUTE).toISOString(),
      'the ahead-of-time stamp is replaced by the real delivery time',
    )

    t.mock.timers.tick(MINUTE)
    renderer.render(undefined)
    assert.deepEqual(triggered, ['once'], 'the same occurrence is not replayed')
  } finally {
    renderer.unmount()
  }
})

test('a recurring reminder fires every later occurrence once after the clock rolls back and never replays', (t) => {
  const { writeTasks } = installEnvironment(t)
  const schedules: ReminderTaskSchedule[] = [
    { kind: 'every', everyMinutes: 15, anchorAt: new Date(NOW - 14 * MINUTE).toISOString() },
    { kind: 'cron', expression: '* * * * *' },
  ]

  for (const schedule of schedules) {
    const dueAt = computeNextReminderRun(schedule, new Date(NOW))
    assert.equal(dueAt, new Date(NOW + MINUTE).toISOString(), `${schedule.kind}: first occurrence is one minute away`)
    const task = makeTask(schedule.kind, schedule, {
      nextRunAt: dueAt,
      lastTriggeredAt: AHEAD_STAMP,
    })
    writeTasks([task])

    const triggered: string[] = []
    const { renderer } = createScheduler([task], (triggeredTask) => { triggered.push(triggeredTask.id) })
    try {
      renderer.render(undefined)

      t.mock.timers.tick(MINUTE)
      renderer.render(undefined)
      assert.deepEqual(triggered, [schedule.kind], `${schedule.kind}: the first corrected occurrence fires`)

      const interval = schedule.kind === 'every' ? schedule.everyMinutes * MINUTE : MINUTE
      t.mock.timers.tick(interval)
      renderer.render(undefined)
      assert.deepEqual(
        triggered,
        [schedule.kind, schedule.kind],
        `${schedule.kind}: the next occurrence still fires instead of being skipped`,
      )

      t.mock.timers.tick(1_000)
      renderer.render(undefined)
      assert.deepEqual(
        triggered,
        [schedule.kind, schedule.kind],
        `${schedule.kind}: a fired occurrence is not replayed`,
      )
    } finally {
      renderer.unmount()
    }
  }
})

test('a same-instant delivery from another window is still not replayed after a clock change', (t) => {
  const { writeTasks } = installEnvironment(t)
  const dueAt = new Date(NOW - 1_000)
  const task = makeTask('shared', { kind: 'at', at: dueAt.toISOString() }, {
    nextRunAt: dueAt.toISOString(),
  })
  writeTasks([{
    ...task,
    lastTriggeredAt: new Date(NOW - 500).toISOString(),
    nextRunAt: undefined,
  }])

  const triggered: string[] = []
  const { renderer, getTasks } = createScheduler([task], (triggeredTask) => { triggered.push(triggeredTask.id) })
  try {
    renderer.render(undefined)
    t.mock.timers.tick(200)
    renderer.render(undefined)

    assert.deepEqual(triggered, [], 'the other window already delivered this occurrence')
    assert.equal(getTasks()[0]?.nextRunAt, undefined, 'the stale local row is drained')
  } finally {
    renderer.unmount()
  }
})

test('the normal forward path still delivers a due reminder once', (t) => {
  const { writeTasks } = installEnvironment(t)
  const dueAt = new Date(NOW + 1_000).toISOString()
  const task = makeTask('forward', { kind: 'at', at: dueAt }, { nextRunAt: dueAt })
  writeTasks([task])

  const triggered: string[] = []
  const { renderer } = createScheduler([task], (triggeredTask) => { triggered.push(triggeredTask.id) })
  try {
    renderer.render(undefined)
    t.mock.timers.tick(1_000)
    renderer.render(undefined)
    assert.deepEqual(triggered, ['forward'])

    t.mock.timers.tick(1_000)
    renderer.render(undefined)
    assert.deepEqual(triggered, ['forward'], 'a delivered one-shot reminder stays delivered')
  } finally {
    renderer.unmount()
  }
})
