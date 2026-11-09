import assert from 'node:assert/strict'
import { register } from 'node:module'
import test, { type TestContext } from 'node:test'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { createHookRenderer } = await import('./helpers/directNotificationHookHarness.ts')
const { useReminderScheduler } = await import('../src/hooks/useReminderScheduler.ts')

const STORAGE_KEY = 'nexus:reminder-tasks'
const NOW = 1_700_000_000_000

type Task = Record<string, unknown> & { id: string }

function makeTask(id: string, at: number, overrides: Record<string, unknown> = {}): Task {
  return {
    id,
    title: id,
    prompt: `body ${id}`,
    action: { kind: 'notice' },
    enabled: true,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    schedule: { kind: 'at', at: new Date(at).toISOString() },
    nextRunAt: new Date(at).toISOString(),
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
    tasks: tasks as never,
    setTasks: setTasks as never,
    locale: 'en-US',
    onTrigger: onTrigger as never,
  }))
  return { renderer, getTasks: () => tasks }
}

test('an externally delivered stale row drains and the next future row still fires once', (t) => {
  const { readTasks, writeTasks } = installEnvironment(t)
  const dueA = NOW - 1_000
  const dueB = NOW + 1_500
  const A = makeTask('A', dueA)
  const B = makeTask('B', dueB)
  // A was already delivered by the other window.
  writeTasks([{ ...A, lastTriggeredAt: new Date(NOW - 500).toISOString(), nextRunAt: undefined }, B])

  const triggered: string[] = []
  const { renderer } = createScheduler([A, B], (task) => { triggered.push(task.id) })
  try {
    renderer.render(undefined)
    t.mock.timers.tick(200)
    renderer.render(undefined)
    assert.deepEqual(triggered, [], 'stale A is not re-triggered')

    t.mock.timers.tick(1_300)
    renderer.render(undefined)
    assert.deepEqual(triggered, ['B'], 'future B fires exactly once')
    assert.equal(readTasks().find((task) => task.id === 'B')?.lastTriggeredAt !== undefined, true)
  } finally {
    renderer.unmount()
  }
})

test('the pet and panel firing in the same tick deliver a due task exactly once', (t) => {
  installEnvironment(t)
  const dueAt = NOW - 1_000
  const task = makeTask('shared', dueAt)
  const persisted = JSON.parse(JSON.stringify([task])) as Task[]
  // Both windows start from the same persisted row.
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))

  const petTriggered: string[] = []
  const panelTriggered: string[] = []
  const pet = createScheduler([task], (triggeredTask) => { petTriggered.push(triggeredTask.id) })
  const panel = createScheduler([{ ...task }], (triggeredTask) => { panelTriggered.push(triggeredTask.id) })
  try {
    pet.renderer.render(undefined)
    panel.renderer.render(undefined)

    // One mock tick drives both scheduler timers before either window can
    // re-render, which is the race the synchronous trigger write closes.
    t.mock.timers.tick(200)
    pet.renderer.render(undefined)
    panel.renderer.render(undefined)

    assert.deepEqual(petTriggered, ['shared'], 'the pet delivers the due row')
    assert.deepEqual(panelTriggered, [], 'the panel sees the persisted trigger and stays quiet')

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as Task[]
    assert.equal(typeof stored[0]?.lastTriggeredAt, 'string')
  } finally {
    pet.renderer.unmount()
    panel.renderer.unmount()
  }
})
