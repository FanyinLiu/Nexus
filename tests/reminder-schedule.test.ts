import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  addReminderTaskToCollection,
  computeNextReminderRun,
  removeReminderTaskFromCollection,
  updateReminderTaskInCollection,
} from '../src/features/reminders/schedule.ts'
import { shouldRunReminderScheduler } from '../src/features/reminders/runtime.ts'
import {
  loadReminderTasks,
  saveReminderTasks,
} from '../src/lib/storage/reminders.ts'
import { REMINDER_TASKS_STORAGE_KEY } from '../src/lib/storage/core.ts'
import type { ReminderTask } from '../src/types/reminders.ts'

const NOW = new Date('2026-03-29T10:00:00+08:00')

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installLocalStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('addReminderTaskToCollection returns the created reminder immediately', () => {
  const result = addReminderTaskToCollection([], (prefix) => `${prefix}-1`, {
    title: '\u559d\u6c34',
    prompt: '\u559d\u6c34',
    action: { kind: 'notice' },
    enabled: true,
    schedule: {
      kind: 'at',
      at: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    },
  }, NOW)

  assert.equal(result.createdTask.id, 'reminder-1')
  assert.equal(result.createdTask.title, '\u559d\u6c34')
  assert.equal(result.tasks.length, 1)
  assert.equal(result.tasks[0]?.id, 'reminder-1')
})

test('updateReminderTaskInCollection returns the updated reminder immediately', () => {
  const result = updateReminderTaskInCollection([
    {
      id: 'reminder-1',
      title: '\u559d\u6c34\u63d0\u9192',
      prompt: '\u559d\u6c34',
      action: { kind: 'notice' },
      enabled: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      nextRunAt: '2026-03-29T10:05:00.000Z',
      schedule: {
        kind: 'at',
        at: '2026-03-29T10:05:00.000Z',
      },
    },
  ], 'reminder-1', {
    prompt: '\u559d\u6c34\u5e76\u7ad9\u8d77\u6765\u6d3b\u52a8\u4e00\u4e0b',
  }, NOW)

  assert.equal(result.updatedTask?.id, 'reminder-1')
  assert.equal(result.updatedTask?.prompt, '\u559d\u6c34\u5e76\u7ad9\u8d77\u6765\u6d3b\u52a8\u4e00\u4e0b')
  assert.equal(result.tasks[0]?.prompt, '\u559d\u6c34\u5e76\u7ad9\u8d77\u6765\u6d3b\u52a8\u4e00\u4e0b')
})

test('updateReminderTaskInCollection trims title and prompt updates', () => {
  const result = updateReminderTaskInCollection([
    {
      id: 'reminder-1',
      title: '\u559d\u6c34\u63d0\u9192',
      prompt: '\u559d\u6c34',
      action: { kind: 'notice' },
      enabled: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      nextRunAt: '2026-03-29T10:05:00.000Z',
      schedule: {
        kind: 'at',
        at: '2026-03-29T10:05:00.000Z',
      },
    },
  ], 'reminder-1', {
    title: '  \u65b0\u6807\u9898  ',
    prompt: '  \u65b0\u63d0\u793a  ',
  }, NOW)

  assert.equal(result.updatedTask?.title, '\u65b0\u6807\u9898')
  assert.equal(result.updatedTask?.prompt, '\u65b0\u63d0\u793a')
})

test('updateReminderTaskInCollection ignores blank required text updates', () => {
  const result = updateReminderTaskInCollection([
    {
      id: 'reminder-1',
      title: '\u559d\u6c34\u63d0\u9192',
      prompt: '\u559d\u6c34',
      action: { kind: 'notice' },
      enabled: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      nextRunAt: '2026-03-29T10:05:00.000Z',
      schedule: {
        kind: 'at',
        at: '2026-03-29T10:05:00.000Z',
      },
    },
  ], 'reminder-1', {
    title: '   ',
    prompt: '\n\t  ',
  }, NOW)

  assert.equal(result.updatedTask?.title, '\u559d\u6c34\u63d0\u9192')
  assert.equal(result.updatedTask?.prompt, '\u559d\u6c34')
  assert.equal(result.tasks[0]?.title, '\u559d\u6c34\u63d0\u9192')
  assert.equal(result.tasks[0]?.prompt, '\u559d\u6c34')
})

test('updateReminderTaskInCollection preserves speechText when updating other fields', () => {
  const result = updateReminderTaskInCollection([
    {
      id: 'reminder-1',
      title: '\u559d\u6c34\u63d0\u9192',
      prompt: '\u559d\u6c34',
      speechText: '\u8be5\u559d\u6c34\u4e86',
      action: { kind: 'notice' },
      enabled: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      nextRunAt: '2026-03-29T10:05:00.000Z',
      schedule: {
        kind: 'at',
        at: '2026-03-29T10:05:00.000Z',
      },
    },
  ], 'reminder-1', {
    prompt: '  \u8d77\u8eab\u559d\u6c34  ',
  }, NOW)

  assert.equal(result.updatedTask?.prompt, '\u8d77\u8eab\u559d\u6c34')
  assert.equal(result.updatedTask?.speechText, '\u8be5\u559d\u6c34\u4e86')
})

test('updateReminderTaskInCollection clears speechText only when given blank speech text', () => {
  const result = updateReminderTaskInCollection([
    {
      id: 'reminder-1',
      title: '\u559d\u6c34\u63d0\u9192',
      prompt: '\u559d\u6c34',
      speechText: '\u8be5\u559d\u6c34\u4e86',
      action: { kind: 'notice' },
      enabled: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      nextRunAt: '2026-03-29T10:05:00.000Z',
      schedule: {
        kind: 'at',
        at: '2026-03-29T10:05:00.000Z',
      },
    },
  ], 'reminder-1', {
    speechText: '   ',
  }, NOW)

  assert.equal(result.updatedTask?.speechText, undefined)
})

test('computeNextReminderRun rejects zero cron steps instead of treating them as every minute', () => {
  assert.throws(() => computeNextReminderRun({
    kind: 'cron',
    expression: '*/0 * * * *',
  }, NOW), /step must be at least 1/)
})

test('computeNextReminderRun rejects inverted and out-of-range cron ranges', () => {
  assert.throws(() => computeNextReminderRun({
    kind: 'cron',
    expression: '5-1 * * * *',
  }, NOW), /out of range/)

  assert.throws(() => computeNextReminderRun({
    kind: 'cron',
    expression: '58-99 * * * *',
  }, NOW), /out of range/)
})

test('removeReminderTaskFromCollection returns the removed reminder immediately', () => {
  const result = removeReminderTaskFromCollection([
    {
      id: 'reminder-1',
      title: '\u559d\u6c34\u63d0\u9192',
      prompt: '\u559d\u6c34',
      action: { kind: 'notice' },
      enabled: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      nextRunAt: '2026-03-29T10:05:00.000Z',
      schedule: {
        kind: 'at',
        at: '2026-03-29T10:05:00.000Z',
      },
    },
  ], 'reminder-1')

  assert.equal(result.removedTask?.id, 'reminder-1')
  assert.equal(result.tasks.length, 0)
})

test('panel scheduler takes over only when the pet window is offline', () => {
  assert.equal(shouldRunReminderScheduler('pet', {
    petOnline: true,
    panelOnline: true,
  }), true)

  assert.equal(shouldRunReminderScheduler('panel', {
    petOnline: true,
    panelOnline: true,
  }), false)

  assert.equal(shouldRunReminderScheduler('panel', {
    petOnline: false,
    panelOnline: true,
  }), true)

  assert.equal(shouldRunReminderScheduler('panel', {
    petOnline: false,
    panelOnline: false,
  }), false)
})

test('loadReminderTasks compacts non-array persisted payloads', () => {
  const localStorage = installLocalStorage({
    [REMINDER_TASKS_STORAGE_KEY]: JSON.stringify({ id: 'not-an-array' }),
  })

  assert.deepEqual(loadReminderTasks(), [])
  assert.deepEqual(
    JSON.parse(localStorage.getItem(REMINDER_TASKS_STORAGE_KEY) ?? 'null'),
    [],
  )
})

test('loadReminderTasks filters malformed schedules and normalizes persisted tasks', () => {
  const localStorage = installLocalStorage({
    [REMINDER_TASKS_STORAGE_KEY]: JSON.stringify([
      {
        id: ' keep ',
        title: '  AI news  ',
        prompt: '  search AI news  ',
        speechText: '  read this  ',
        action: { kind: 'web_search', query: '  AI  ', limit: 99 },
        enabled: true,
        createdAt: '2026-03-29T02:00:00.000Z',
        updatedAt: '2026-03-29T02:00:00.000Z',
        nextRunAt: 'not a date',
        schedule: { kind: 'every', everyMinutes: 90.6, anchorAt: 'bad anchor' },
      },
      {
        id: 'empty-search',
        title: 'Fallback',
        prompt: 'Notify instead',
        action: { kind: 'web_search', query: '   ', limit: 3 },
        enabled: true,
        createdAt: '2026-03-29T02:00:00.000Z',
        updatedAt: '2026-03-29T02:00:00.000Z',
        schedule: { kind: 'at', at: '2026-03-29T03:00:00.000Z' },
      },
      {
        id: 'bad-cron',
        title: 'Bad',
        prompt: 'Bad',
        createdAt: '2026-03-29T02:00:00.000Z',
        updatedAt: '2026-03-29T02:00:00.000Z',
        schedule: { kind: 'cron', expression: '* * *' },
      },
      null,
    ]),
  })

  const tasks = loadReminderTasks()

  assert.equal(tasks.length, 2)
  assert.equal(tasks[0]?.id, 'keep')
  assert.equal(tasks[0]?.title, 'AI news')
  assert.equal(tasks[0]?.prompt, 'search AI news')
  assert.deepEqual(tasks[0]?.action, { kind: 'web_search', query: 'AI', limit: 8 })
  assert.deepEqual(tasks[0]?.schedule, {
    kind: 'every',
    everyMinutes: 91,
    anchorAt: '2026-03-29T02:00:00.000Z',
  })
  assert.equal(tasks[0]?.nextRunAt, undefined)
  assert.deepEqual(tasks[1]?.action, { kind: 'notice' })
  assert.deepEqual(
    JSON.parse(localStorage.getItem(REMINDER_TASKS_STORAGE_KEY) ?? '[]'),
    tasks,
  )
})

test('saveReminderTasks filters invalid task records before persisting', () => {
  const localStorage = installLocalStorage()

  saveReminderTasks([
    {
      id: 'valid',
      title: 'Valid',
      prompt: 'Run',
      action: { kind: 'chat_action', instruction: '  summarize today  ' },
      enabled: true,
      createdAt: '2026-03-29T02:00:00.000Z',
      updatedAt: '2026-03-29T02:00:00.000Z',
      schedule: { kind: 'cron', expression: ' 0 9 * * * ' },
    },
    {
      id: '',
      title: 'Drop',
      prompt: 'Drop',
      action: { kind: 'notice' },
      enabled: true,
      createdAt: '',
      updatedAt: '',
      schedule: { kind: 'at', at: 'not-a-date' },
    } as ReminderTask,
  ])

  assert.deepEqual(
    JSON.parse(localStorage.getItem(REMINDER_TASKS_STORAGE_KEY) ?? '[]'),
    [
      {
        id: 'valid',
        title: 'Valid',
        prompt: 'Run',
        action: { kind: 'chat_action', instruction: 'summarize today' },
        enabled: true,
        createdAt: '2026-03-29T02:00:00.000Z',
        updatedAt: '2026-03-29T02:00:00.000Z',
        schedule: { kind: 'cron', expression: '0 9 * * *' },
      },
    ],
  )
})
