import assert from 'node:assert/strict'
import { register } from 'node:module'
import test, { type TestContext } from 'node:test'

import React from 'react'

import { computeNextReminderRun } from '../src/features/reminders/schedule.ts'
import { createRealReactRoot } from './helpers/realReactRoot.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { useReminderScheduler } = await import('../src/hooks/useReminderScheduler.ts')

const STORAGE_KEY = 'nexus:reminder-tasks'
const NOW = 1_700_000_000_000

type Task = Record<string, unknown> & { id: string }

function iso(value: number) {
  return new Date(value).toISOString()
}

function makeTask(
  id: string,
  action: Record<string, unknown>,
  schedule: Record<string, unknown>,
  nextRunAt: string,
): Task {
  return {
    id,
    title: id,
    prompt: `body ${id}`,
    action,
    enabled: true,
    createdAt: iso(NOW),
    updatedAt: iso(NOW),
    schedule,
    nextRunAt,
  }
}

type PanelTimer = { id: number; at: number; callback: () => void }

function installEnvironment(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const store = new Map<string, string>()
  const timers: PanelTimer[] = []
  let nextId = 1
  const windowStub = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)) },
      removeItem: (key: string) => { store.delete(key) },
    },
    setTimeout: (callback: () => void, delay = 0) => {
      const id = nextId++
      timers.push({ id, at: Date.now() + delay, callback })
      return id
    },
    clearTimeout: (id: number) => {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })
  return {
    readTasks: () => JSON.parse(store.get(STORAGE_KEY) ?? '[]') as Task[],
    writeTasks: (tasks: Task[]) => { store.set(STORAGE_KEY, JSON.stringify(tasks)) },
    advance: (ms: number) => { t.mock.timers.tick(ms) },
    runDueTimers: () => {
      for (;;) {
        const now = Date.now()
        const index = timers.findIndex((timer) => timer.at <= now)
        if (index < 0) return
        const [timer] = timers.splice(index, 1)
        timer?.callback()
      }
    },
    pendingTimers: () => timers.length,
  }
}

type SchedulerOptions = {
  petLastOnlineAt?: string
  takeoverOnlyNotice?: boolean
}

type Observer = { tasks: Task[] }

function SchedulerProbe({
  initialTasks,
  onTrigger,
  options,
  onTasksChange,
}: {
  initialTasks: Task[]
  onTrigger: (task: Task) => void
  options: SchedulerOptions
  onTasksChange: (tasks: Task[]) => void
}) {
  const [tasks, setTasks] = React.useState(initialTasks)
  React.useEffect(() => {
    onTasksChange(tasks)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  }, [onTasksChange, tasks])
  useReminderScheduler({
    enabled: true,
    tasks: tasks as never,
    setTasks: setTasks as never,
    locale: 'en-US',
    onTrigger: onTrigger as never,
    petLastOnlineAt: options.petLastOnlineAt,
    takeoverOnlyNotice: options.takeoverOnlyNotice,
  })
  return null
}

async function mountScheduler(
  initialTasks: Task[],
  onTrigger: (task: Task) => void,
  options: SchedulerOptions = {},
) {
  const observer: Observer = { tasks: initialTasks }
  const root = createRealReactRoot()
  await root.render(React.createElement(SchedulerProbe, {
    initialTasks,
    onTrigger,
    options,
    onTasksChange: (next) => { observer.tasks = next },
  }))
  return {
    act: root.act,
    unmount: root.unmount,
    getTasks: () => observer.tasks,
  }
}

test('a one-shot reminder older than the mount grace is not replayed', async (t) => {
  const environment = installEnvironment(t)
  for (const [label, ageMs] of [['10 minutes', 10 * 60_000], ['1 day', 24 * 60 * 60_000]] as const) {
    const dueAt = NOW - ageMs
    const task = makeTask('one-shot', { kind: 'notice' }, { kind: 'at', at: iso(dueAt) }, iso(dueAt))
    environment.writeTasks([task])
    const triggered: string[] = []
    const scheduler = await mountScheduler([task], (triggeredTask) => { triggered.push(triggeredTask.id) })
    try {
      assert.deepEqual(triggered, [], `${label} old row is not triggered on mount`)
      assert.equal(scheduler.getTasks()[0]?.nextRunAt, undefined, 'refresh drops the stale one-shot row')
      assert.equal(environment.readTasks()[0]?.nextRunAt, undefined)

      await scheduler.act(() => {
        environment.advance(5_000)
        environment.runDueTimers()
      })
      assert.deepEqual(triggered, [], `${label} old row is not triggered by later ticks`)
    } finally {
      await scheduler.unmount()
      assert.equal(environment.pendingTimers(), 0, 'unmount leaves no timer behind')
    }
  }
})

test('an overdue recurring reminder is advanced to the next occurrence instead of replayed on mount', async (t) => {
  const environment = installEnvironment(t)
  const cases = [
    {
      id: 'every',
      schedule: { kind: 'every', everyMinutes: 30, anchorAt: iso(NOW - 60 * 60_000) },
    },
    {
      id: 'cron',
      schedule: { kind: 'cron', expression: '*/30 * * * *' },
    },
  ]
  for (const { id, schedule } of cases) {
    const dueAt = NOW - 10 * 60_000
    const task = makeTask(id, { kind: 'notice' }, schedule, iso(dueAt))
    const expectedNextRunAt = computeNextReminderRun(schedule as never, new Date(NOW))
    environment.writeTasks([task])
    const triggered: string[] = []
    const scheduler = await mountScheduler([task], (triggeredTask) => { triggered.push(triggeredTask.id) })
    try {
      assert.deepEqual(triggered, [], `${id} is not replayed on mount`)
      assert.equal(scheduler.getTasks()[0]?.nextRunAt, expectedNextRunAt)
      assert.equal(environment.readTasks()[0]?.nextRunAt, expectedNextRunAt)

      await scheduler.act(() => {
        environment.advance(5_000)
        environment.runDueTimers()
      })
      assert.deepEqual(triggered, [])
    } finally {
      await scheduler.unmount()
      assert.equal(environment.pendingTimers(), 0, 'unmount leaves no timer behind')
    }
  }
})

test('a recurring reminder due within the mount grace is caught up exactly once', async (t) => {
  const environment = installEnvironment(t)
  const dueAt = NOW - 10_000
  const schedule = { kind: 'every', everyMinutes: 30, anchorAt: iso(dueAt - 30 * 60_000) }
  const task = makeTask('recent-every', { kind: 'notice' }, schedule, iso(dueAt))
  environment.writeTasks([task])
  const triggered: string[] = []
  const scheduler = await mountScheduler([task], (triggeredTask) => { triggered.push(triggeredTask.id) })
  try {
    assert.deepEqual(triggered, [task.id], 'the recent occurrence is caught up once')
    const expectedNextRunAt = computeNextReminderRun(schedule as never, new Date(NOW))
    assert.equal(scheduler.getTasks()[0]?.nextRunAt, expectedNextRunAt)
    await scheduler.act(() => {
      environment.advance(5_000)
      environment.runDueTimers()
    })
    assert.deepEqual(triggered, [task.id], 'the catch-up is not repeated')
  } finally {
    await scheduler.unmount()
    assert.equal(environment.pendingTimers(), 0, 'unmount leaves no timer behind')
  }
})

test('a stalled pet renderer recovers overdue weather, notice and recurring rows once', async (t) => {
  const environment = installEnvironment(t)
  const dueAt = NOW + 5_000
  const everySchedule = { kind: 'every', everyMinutes: 5, anchorAt: iso(dueAt - 5 * 60_000) }
  const tasks = [
    makeTask('weather', { kind: 'weather', location: 'Beijing' }, { kind: 'at', at: iso(dueAt) }, iso(dueAt)),
    makeTask('notice', { kind: 'notice' }, { kind: 'at', at: iso(dueAt) }, iso(dueAt)),
    makeTask('every', { kind: 'notice' }, everySchedule, iso(dueAt)),
  ]
  environment.writeTasks(tasks)
  const triggered: string[] = []
  const scheduler = await mountScheduler(tasks, (triggeredTask) => { triggered.push(triggeredTask.id) })
  try {
    assert.deepEqual(triggered, [], 'nothing is due at mount')

    // The renderer is frozen for two minutes: the timer is due but never runs.
    await scheduler.act(() => {
      environment.advance(2 * 60_000)
      environment.runDueTimers()
    })
    assert.deepEqual(triggered, ['weather', 'notice', 'every'], 'each overdue row runs once')

    const stored = environment.readTasks()
    assert.equal(typeof stored.find((task) => task.id === 'weather')?.lastTriggeredAt, 'string')
    assert.equal(typeof stored.find((task) => task.id === 'notice')?.lastTriggeredAt, 'string')
    const everyNextRunAt = Date.parse(String(stored.find((task) => task.id === 'every')?.nextRunAt ?? ''))
    assert.ok(Number.isFinite(everyNextRunAt) && everyNextRunAt > Date.now())

    await scheduler.act(() => {
      environment.advance(30_000)
      environment.runDueTimers()
    })
    assert.deepEqual(triggered, ['weather', 'notice', 'every'], 'recovery does not replay')
  } finally {
    await scheduler.unmount()
    assert.equal(environment.pendingTimers(), 0, 'unmount leaves no timer behind')
  }
})
