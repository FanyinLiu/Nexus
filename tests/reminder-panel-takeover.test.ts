import assert from 'node:assert/strict'
import { register } from 'node:module'
import test, { type TestContext } from 'node:test'

import {
  computeNextReminderRun,
  shouldRunReminderScheduler,
} from '../src/features/reminders/index.ts'
import { createReminderPanelWakeMonitor } from '../electron/reminderPanelWake.js'
import type { ReminderTask, ReminderTaskSchedule } from '../src/types/index.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { createHookRenderer } = await import('./helpers/directNotificationHookHarness.ts')
const { useReminderScheduler } = await import('../src/hooks/useReminderScheduler.ts')

const STORAGE_KEY = 'nexus:reminder-tasks'
// Chromium stretches hidden renderer timers to roughly one tick per minute.
const PANEL_TIMER_THROTTLE_MS = 60_000
const WAKE_INTERVAL_MS = 5_000

type Task = ReminderTask & Record<string, unknown>

type PanelTimer = { id: number; at: number; callback: () => void }

function createTask(id: string, schedule: ReminderTaskSchedule, nextRunAt: string): Task {
  return {
    id,
    title: id,
    prompt: `body ${id}`,
    action: { kind: 'notice' },
    enabled: true,
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    schedule,
    nextRunAt,
  }
}

function installWindow(t: TestContext) {
  const store = new Map<string, string>()
  const timers: PanelTimer[] = []
  let nextTimerId = 1
  const windowStub = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    },
    // Every renderer timer is throttled to at most one run per minute.
    setTimeout: (callback: () => void, delay = 0) => {
      const id = nextTimerId++
      timers.push({ id, at: Date.now() + Math.max(PANEL_TIMER_THROTTLE_MS, delay), callback })
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
  const runDueTimers = () => {
    for (;;) {
      const now = Date.now()
      const index = timers.findIndex((timer) => timer.at <= now)
      if (index < 0) return
      const [timer] = timers.splice(index, 1)
      timer?.callback()
    }
  }
  return { store, runDueTimers }
}

function scheduleCases(): Array<{ name: string; schedule: ReminderTaskSchedule }> {
  return [
    {
      name: 'every',
      schedule: {
        kind: 'every',
        everyMinutes: 15,
        anchorAt: '2026-01-05T00:00:00.000Z',
      },
    },
    { name: 'daily cron', schedule: { kind: 'cron', expression: '0 9 * * *' } },
    { name: 'weekly cron', schedule: { kind: 'cron', expression: '0 9 * * 1' } },
    { name: 'generic cron', schedule: { kind: 'cron', expression: '*/10 * * * *' } },
  ]
}

for (const { name, schedule } of scheduleCases()) {
  test(`main wakes the throttled panel and a ${name} due row is delivered exactly once`, (t) => {
    const dueAt = Date.parse(computeNextReminderRun(schedule, new Date('2026-01-05T00:00:00.000Z')))
    const offlineAt = dueAt - 10_000
    t.mock.timers.enable({ apis: ['Date'], now: offlineAt })

    const { store, runDueTimers } = installWindow(t)
    const task = createTask(`task-${name}`, schedule, new Date(dueAt).toISOString())
    store.set(STORAGE_KEY, JSON.stringify([task]))

    let runtime = {
      petOnline: true,
      panelOnline: true,
      petLastSeenAt: new Date(offlineAt).toISOString(),
    }
    let wakeToken = 0
    let tasks: Task[] = [task]
    const triggered: Array<{ id: string; at: number }> = []
    const setTasks = (updater: unknown) => {
      tasks = typeof updater === 'function'
        ? (updater as (current: Task[]) => Task[])(tasks)
        : updater as Task[]
    }

    let renderer: ReturnType<typeof createHookRenderer> | null = null
    const panelWindow = {
      isDestroyed: () => false,
      webContents: { send: () => undefined },
    }
    const monitor = createReminderPanelWakeMonitor({
      getPanelWindow: () => panelWindow,
      getSnapshot: () => ({ ...runtime }),
      deliverWake: (_win, snapshot) => {
        runtime = { ...snapshot } as typeof runtime
        wakeToken += 1
        renderer?.render(undefined)
      },
    })

    renderer = createHookRenderer(() => useReminderScheduler({
      enabled: shouldRunReminderScheduler('panel', runtime),
      tasks: tasks as never,
      setTasks: setTasks as never,
      locale: 'en-US',
      onTrigger: (triggeredTask: Task) => {
        triggered.push({ id: triggeredTask.id, at: Date.now() })
      },
      petLastOnlineAt: runtime.petLastSeenAt,
      wakeToken,
    }))

    const advance = (ms: number) => {
      t.mock.timers.tick(ms)
      runDueTimers()
      monitor.tick()
    }

    try {
      renderer.render(undefined)
      monitor.tick() // establish the pet as online before the fall

      runtime = { ...runtime, petOnline: false }
      monitor.tick()
      assert.equal(triggered.length, 0, 'the due row is still in the future')

      // Jump close to the due instant, then cross it with the main wake push.
      advance(Math.max(0, dueAt - WAKE_INTERVAL_MS - Date.now()))
      advance(WAKE_INTERVAL_MS)
      assert.deepEqual(triggered, [{ id: task.id, at: dueAt }], 'delivered at the wake, not 60s later')

      // Periodic wakes keep running while the pet is offline but the row is
      // already consumed.
      advance(WAKE_INTERVAL_MS * 4)
      assert.equal(triggered.length, 1, 'no duplicate from the throttled panel timer or later wakes')

      // Recovery: the panel stops scheduling and no replay follows.
      runtime = {
        ...runtime,
        petOnline: true,
        petLastSeenAt: new Date(Date.now()).toISOString(),
      }
      monitor.tick()
      advance(WAKE_INTERVAL_MS * 12)
      assert.equal(triggered.length, 1, 'an online pet produces no duplicate')
    } finally {
      renderer.unmount()
      monitor.stop()
    }
  })
}

test('a reminder due 45s before the panel discovers the offline pet is still delivered', (t) => {
  const dueAt = Date.parse('2026-01-05T00:10:00.000Z')
  t.mock.timers.enable({ apis: ['Date'], now: dueAt - 10_000 })

  const { store, runDueTimers } = installWindow(t)
  const task = createTask('late-takeover', { kind: 'at', at: new Date(dueAt).toISOString() }, new Date(dueAt).toISOString())
  store.set(STORAGE_KEY, JSON.stringify([task]))

  let runtime = {
    petOnline: true,
    panelOnline: true,
    petLastSeenAt: new Date(dueAt - 10_000).toISOString(),
  }
  let wakeToken = 0
  let tasks: Task[] = [task]
  const triggered: Array<{ id: string; at: number }> = []
  const setTasks = (updater: unknown) => {
    tasks = typeof updater === 'function'
      ? (updater as (current: Task[]) => Task[])(tasks)
      : updater as Task[]
  }

  let renderer: ReturnType<typeof createHookRenderer> | null = null
  const panelWindow = {
    isDestroyed: () => false,
    webContents: { send: () => undefined },
  }
  const monitor = createReminderPanelWakeMonitor({
    getPanelWindow: () => panelWindow,
    getSnapshot: () => ({ ...runtime }),
    deliverWake: (_win, snapshot) => {
      runtime = { ...snapshot } as typeof runtime
      wakeToken += 1
      renderer?.render(undefined)
    },
  })

  renderer = createHookRenderer(() => useReminderScheduler({
    enabled: shouldRunReminderScheduler('panel', runtime),
    tasks: tasks as never,
    setTasks: setTasks as never,
    locale: 'en-US',
    onTrigger: (triggeredTask: Task) => {
      triggered.push({ id: triggeredTask.id, at: Date.now() })
    },
    petLastOnlineAt: runtime.petLastSeenAt,
    wakeToken,
  }))

  const advance = (ms: number) => {
    t.mock.timers.tick(ms)
    runDueTimers()
    monitor.tick()
  }

  try {
    renderer.render(undefined)
    monitor.tick()
    runtime = { ...runtime, petOnline: false }
    // The first discovery is already 45s after the due instant.
    advance(45_000)
    assert.deepEqual(triggered, [{ id: task.id, at: Date.now() }])
    advance(WAKE_INTERVAL_MS * 4)
    assert.equal(triggered.length, 1)
  } finally {
    renderer.unmount()
    monitor.stop()
  }
})
