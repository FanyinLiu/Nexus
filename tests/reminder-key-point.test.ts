/**
 * Behaviour tests for key-point reminder/agenda titles.
 *
 * The pure module, the storage normalizers (which double as the migration),
 * the notification copy and one real hook run are covered here. No assertion
 * prints the user's text; the privacy cases serialise the payloads and check
 * that a marker never appears.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import {
  KEY_POINT_MAX,
  KEY_POINT_TIMEOUT_MS,
  buildKeyPointRequest,
  fallbackKeyPoint,
  generateKeyPoint,
  isKeyPointCandidateCurrent,
  normalizeKeyPoint,
  parseKeyPointReply,
  reminderKeyPointSource,
  resolveKeyPoint,
  scanKeyPointCandidates,
} from '../src/features/reminders/keyPoint.ts'
import { updateReminderTaskInCollection } from '../src/features/reminders/schedule.ts'
import {
  buildAgendaNotification,
  truncateAgendaWhat,
} from '../src/features/proactive/directNotificationCopy.ts'
import { buildReminderProactiveMessage } from '../src/features/reminders/proactiveMessage.ts'
import { normalizeMemoryItemsForStorage } from '../src/lib/storage/memory.ts'
import { loadReminderTasks, saveReminderTasks } from '../src/lib/storage/reminders.ts'
import { REMINDER_TASKS_STORAGE_KEY } from '../src/lib/storage/core.ts'
import {
  createHookRenderer,
  installEnvironment,
  makeLoop,
  makeSettings,
} from './helpers/directNotificationHookHarness.ts'
import type { MemoryItem } from '../src/types/memory.ts'
import type { ReminderTask } from '../src/types/reminders.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function graphemeCount(text: string): number {
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: string[] }> {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }
  const output: string[] = []
  const record = (...args: unknown[]) => { output.push(args.map((value) => String(value)).join(' ')) }
  console.log = record
  console.info = record
  console.warn = record
  console.error = record
  console.debug = record
  try {
    return { result: await fn(), output }
  } finally {
    console.log = original.log
    console.info = original.info
    console.warn = original.warn
    console.error = original.error
    console.debug = original.debug
  }
}

// ── normalizeKeyPoint ──────────────────────────────────────────────────────

test('KEY_POINT_MAX is 20 and the generation timeout stays short', () => {
  assert.equal(KEY_POINT_MAX, 20)
  assert.equal(KEY_POINT_TIMEOUT_MS, 15_000)
  assert.equal(normalizeKeyPoint('取'.repeat(20)), '取'.repeat(20))
  assert.equal(normalizeKeyPoint('取'.repeat(21)), '取'.repeat(20))
  assert.equal(normalizeKeyPoint('a'.repeat(30)), 'a'.repeat(20))
  assert.equal(normalizeKeyPoint('😀'.repeat(25)), '😀'.repeat(20))
  assert.equal(normalizeKeyPoint(`${'记'.repeat(20)}😀`), '记'.repeat(20))
})

test('normalizeKeyPoint counts grapheme clusters, so a ZWJ family is one unit', () => {
  const exactly = `${'记'.repeat(19)}${FAMILY}`
  assert.equal(graphemeCount(exactly), 20)
  assert.equal(normalizeKeyPoint(exactly), exactly)
  assert.equal(LONE_SURROGATE.test(normalizeKeyPoint(`${'记'.repeat(20)}${FAMILY}`)), false)
  assert.equal(normalizeKeyPoint(`${'记'.repeat(20)}${FAMILY}`), '记'.repeat(20))
})

test('normalizeKeyPoint keeps the first non-blank line and collapses whitespace', () => {
  assert.equal(normalizeKeyPoint('\n  \n  取   快递  \n第二行'), '取 快递')
  assert.equal(normalizeKeyPoint('第一行\n第二行'), '第一行')
  assert.equal(normalizeKeyPoint('\r\n第一行\r\n第二行'), '第一行')
})

test('normalizeKeyPoint strips wrapping quotes/brackets and trailing punctuation', () => {
  for (const input of ['「取快递」', '“取快递”', '"取快递"', "'取快递'", '【取快递】', '（取快递）', '(取快递)', '[取快递]']) {
    assert.equal(normalizeKeyPoint(input), '取快递', input)
  }
  assert.equal(normalizeKeyPoint('「取快递。」'), '取快递')
  assert.equal(normalizeKeyPoint('取快递！'), '取快递')
  assert.equal(normalizeKeyPoint('Pick up parcel.'), 'Pick up parcel')
  assert.equal(normalizeKeyPoint('  「  取快递  」  '), '取快递')
})

test('normalizeKeyPoint returns null for blank or non-string input', () => {
  for (const input of ['', '   ', '\n \r\n\t', null, undefined, 42, {}, []]) {
    assert.equal(normalizeKeyPoint(input), null, String(input))
  }
})

// ── fallback / resolve ─────────────────────────────────────────────────────

test('fallbackKeyPoint is exactly the #235 agenda clip', () => {
  const cases = [
    '买牛奶\n顺便取快递',
    '  一件小事  ',
    '记'.repeat(25),
    `${'记'.repeat(19)}${FAMILY}尾巴`,
    '',
    '\n \n',
  ]
  for (const input of cases) {
    assert.equal(fallbackKeyPoint(input), truncateAgendaWhat(input))
  }
})

test('fallbackKeyPoint keeps only the first non-blank line and marks a later line', () => {
  assert.equal(fallbackKeyPoint('买牛奶\n顺便取快递'), '买牛奶…')
  assert.equal(fallbackKeyPoint(`${'记'.repeat(25)}\n第二行`), `${'记'.repeat(20)}…`)
})

test('resolveKeyPoint prefers a valid stored value and clips old or bad data', () => {
  assert.equal(resolveKeyPoint('取快递', '一段很长的提醒正文'), '取快递')
  assert.equal(resolveKeyPoint('「取快递」。', '一段很长的提醒正文'), '取快递')
  assert.equal(resolveKeyPoint(undefined, '买牛奶\n顺便取快递'), '买牛奶…')
  assert.equal(resolveKeyPoint(42, '买牛奶\n顺便取快递'), '买牛奶…')
  assert.equal(resolveKeyPoint('', '买牛奶\n顺便取快递'), '买牛奶…')
  assert.equal(resolveKeyPoint('x'.repeat(30), '买牛奶'), 'x'.repeat(20))
  assert.equal(resolveKeyPoint(undefined, 'x'.repeat(30)), `${'x'.repeat(20)}…`)
})

test('a title-only or prompt-only edit clears the stored reminder key point', () => {
  const task: ReminderTask = {
    id: 'reminder-edit',
    title: '取快递',
    prompt: '明天下午去驿站取快递',
    keyPoint: '取快递',
    action: { kind: 'notice' },
    enabled: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    schedule: { kind: 'at', at: '2026-04-02T08:00:00.000Z' },
  }
  const now = new Date('2026-04-01T01:00:00.000Z')
  assert.equal(
    updateReminderTaskInCollection([task], task.id, { title: '寄快递' }, now).updatedTask?.keyPoint,
    undefined,
  )
  assert.equal(
    updateReminderTaskInCollection([task], task.id, { prompt: '改成下午三点' }, now).updatedTask?.keyPoint,
    undefined,
  )
  assert.equal(
    updateReminderTaskInCollection([task], task.id, { enabled: false }, now).updatedTask?.keyPoint,
    '取快递',
  )
})

test('scanKeyPointCandidates notices new rows, then rejects a stale wording', () => {
  const task: ReminderTask = {
    id: 'reminder-scan',
    title: '取快递',
    prompt: '明天下午去驿站取快递',
    action: { kind: 'notice' },
    enabled: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    schedule: { kind: 'at', at: '2026-04-02T08:00:00.000Z' },
  }
  const loop = makeLoop({ id: 'loop-scan', content: '周四下午三点对一下季度方案', createdAt: task.createdAt })
  const seed = scanKeyPointCandidates({
    reminderTasks: [task],
    memories: [loop],
    state: {
      reminderTexts: new Map<string, string>(),
      loopTexts: new Map<string, string>(),
      attempted: new Map<string, string>(),
      initialized: false,
    },
  })
  assert.deepEqual(seed.candidates, [])

  const secondTask = { ...task, id: 'reminder-scan-2', title: '寄快递', prompt: '明天上午寄快递' }
  const secondLoop = makeLoop({ id: 'loop-scan-2', content: '周五交接一下报告', createdAt: task.createdAt })
  const scan = scanKeyPointCandidates({
    reminderTasks: [task, secondTask],
    memories: [loop, secondLoop],
    state: seed.state,
  })
  assert.equal(scan.candidates.length, 2)
  assert.equal(scan.candidates[0]?.kind, 'reminder')
  assert.equal(scan.candidates[1]?.kind, 'loop')

  const reminderCandidate = scan.candidates[0]!
  assert.equal(isKeyPointCandidateCurrent(reminderCandidate, [task, secondTask], [loop, secondLoop]), true)
  const editedTask = { ...secondTask, title: '改成寄文件' }
  assert.equal(isKeyPointCandidateCurrent(reminderCandidate, [task, editedTask], [loop, secondLoop]), false)
  assert.notEqual(reminderKeyPointSource(secondTask), reminderKeyPointSource(editedTask))
})

// ── Prompt / reply ─────────────────────────────────────────────────────────

test('buildKeyPointRequest asks for one short line in the text language', () => {
  const prompt = buildKeyPointRequest('明天下午取快递', 'zh-CN')
  assert.match(prompt.system, /20 characters/u)
  assert.match(prompt.system, /Simplified Chinese/u)
  assert.match(prompt.system, /no quotes/u)
  assert.match(prompt.user, /明天下午取快递/u)
  assert.equal(parseKeyPointReply('「取快递」'), '取快递')
  assert.equal(parseKeyPointReply('取快递\n更多解释'), '取快递')
  assert.equal(parseKeyPointReply('   '), null)
})

// ── generateKeyPoint ───────────────────────────────────────────────────────

test('generateKeyPoint applies the reply only after the model returns', async () => {
  let resolveReply: ((value: string | null) => void) | null = null
  const applied: string[] = []
  const pending = generateKeyPoint('明天下午去驿站取快递', {
    uiLanguage: 'zh-CN',
    complete: () => new Promise((resolve) => { resolveReply = resolve }),
    isCurrent: () => true,
    apply: (keyPoint) => applied.push(keyPoint),
  })

  assert.deepEqual(applied, [])
  resolveReply?.('「取快递」')
  assert.equal(await pending, '取快递')
  assert.deepEqual(applied, ['取快递'])
})

test('generateKeyPoint drops a reply when the item text changed meanwhile', async () => {
  let changes = 0
  const applied: string[] = []
  const result = await generateKeyPoint('旧文本', {
    uiLanguage: 'zh-CN',
    complete: async () => '旧要点',
    isCurrent: () => {
      changes += 1
      return false
    },
    apply: (keyPoint) => applied.push(keyPoint),
  })

  assert.equal(result, null)
  assert.deepEqual(applied, [])
  assert.equal(changes, 1)
})

test('generateKeyPoint leaves no key point on failure, bad reply, or timeout', async () => {
  const applied: string[] = []

  const failed = await generateKeyPoint('取快递', {
    uiLanguage: 'zh-CN',
    complete: async () => { throw new Error('provider down') },
    apply: (keyPoint) => applied.push(keyPoint),
  })
  assert.equal(failed, null)

  const blank = await generateKeyPoint('取快递', {
    uiLanguage: 'zh-CN',
    complete: async () => '   ',
    apply: (keyPoint) => applied.push(keyPoint),
  })
  assert.equal(blank, null)

  const timedOut = await generateKeyPoint('取快递', {
    uiLanguage: 'zh-CN',
    timeoutMs: 5,
    complete: () => new Promise(() => {}),
    apply: (keyPoint) => applied.push(keyPoint),
  })
  assert.equal(timedOut, null)
  assert.deepEqual(applied, [])
})

test('generateKeyPoint never logs the text, prompt, reply, or key point', async () => {
  const secret = '第二行里的独特标记'
  const text = `${'甲'.repeat(25)}第一行标记\n${secret}`
  const { output } = await captureConsole(async () => {
    await generateKeyPoint(text, {
      uiLanguage: 'zh-CN',
      complete: async () => `「${'取快递'}」`,
      isCurrent: () => true,
      apply: () => undefined,
    })
    await generateKeyPoint(text, {
      uiLanguage: 'zh-CN',
      complete: async () => { throw new Error(`failed for ${text}`) },
      isCurrent: () => true,
      apply: () => undefined,
    })
  })

  assert.deepEqual(output, [])
  assert.equal(JSON.stringify(output).includes(secret), false)
})

// ── Notification copy ──────────────────────────────────────────────────────

test('a reminder notification title is the resolved key point', () => {
  const base = {
    id: 'task-1',
    title: '明天下午去菜市场旁边的驿站取快递',
    prompt: '明天下午去菜市场旁边的驿站取快递',
  }
  const withKeyPoint = buildReminderProactiveMessage(
    { ...base, keyPoint: '取快递' },
    { displayText: 'full prompt', speech: '', now: 1 },
  )
  assert.equal(withKeyPoint.title, '取快递')

  const oldRow = buildReminderProactiveMessage(base, { displayText: 'full prompt', speech: '', now: 1 })
  assert.equal(oldRow.title, truncateAgendaWhat(base.title))
  assert.equal(oldRow.title.length <= 21, true)
})

test('the agenda OS payload is the key point title and has no body', () => {
  const result = buildAgendaNotification({ keyPoint: '取快递', what: '明天下午去菜市场旁边的驿站取快递' })
  assert.deepEqual(result, { title: '取快递' })
  assert.deepEqual(Object.keys(result), ['title'])
})

test('the full multi-line text never reaches an OS payload', () => {
  const marker = '绝不能上锁屏的第二行'
  const text = `${'甲'.repeat(25)}第一行超长内容\n${marker}`
  const agenda = buildAgendaNotification({ what: text })
  const reminder = buildReminderProactiveMessage(
    { id: 'task', title: text, prompt: text },
    { displayText: text, speech: '', now: 1 },
  )

  const serialized = JSON.stringify({ agenda, reminderTitle: reminder.title })
  assert.equal(serialized.includes(marker), false)
  assert.equal(serialized.includes('甲'.repeat(21)), false)
  assert.equal(JSON.stringify(agenda).includes('甲'.repeat(21)), false)
  assert.equal(agenda.title, `${'甲'.repeat(20)}…`)
})

// ── Storage / migration ────────────────────────────────────────────────────

function installReminderStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
      },
    },
    configurable: true,
    writable: true,
  })
  return store
}

function makeReminderRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'reminder-1',
    title: '取快递',
    prompt: '明天下午去驿站取快递',
    action: { kind: 'notice' },
    enabled: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    schedule: { kind: 'at', at: '2026-04-02T08:00:00.000Z' },
    ...patch,
  }
}

test('legacy reminder rows load without a key point and keep using the fallback', () => {
  const store = installReminderStorage({
    [REMINDER_TASKS_STORAGE_KEY]: JSON.stringify([makeReminderRow()]),
  })
  try {
    const loaded = loadReminderTasks()
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0]?.keyPoint, undefined)
    assert.equal(resolveKeyPoint(loaded[0]?.keyPoint, loaded[0]?.title ?? ''), '取快递')
    assert.equal(store.has(REMINDER_TASKS_STORAGE_KEY), true)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('reminder storage drops invalid key points, clips long ones and round-trips', () => {
  const store = installReminderStorage({
    [REMINDER_TASKS_STORAGE_KEY]: JSON.stringify([
      makeReminderRow({ id: 'valid', keyPoint: '「取快递」。' }),
      makeReminderRow({ id: 'wrong-type', keyPoint: 42 }),
      makeReminderRow({ id: 'long', keyPoint: 'x'.repeat(30) }),
      makeReminderRow({ id: 'blank', keyPoint: '   ' }),
    ]),
  })
  try {
    const loaded = loadReminderTasks()
    const byId = new Map(loaded.map((task) => [task.id, task]))
    assert.equal(byId.get('valid')?.keyPoint, '取快递')
    assert.equal(byId.get('wrong-type')?.keyPoint, undefined)
    assert.equal(byId.get('long')?.keyPoint, 'x'.repeat(20))
    assert.equal(byId.get('blank')?.keyPoint, undefined)

    saveReminderTasks(loaded)
    assert.deepEqual(loadReminderTasks(), loaded)
    assert.equal((JSON.parse(store.get(REMINDER_TASKS_STORAGE_KEY) ?? '[]') as ReminderTask[])[0]?.keyPoint, '取快递')
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

function makeMemoryRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'memory-1',
    content: '周四下午三点对一下季度方案',
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    loopStatus: 'open',
    createdAt: '2026-04-01T00:00:00.000Z',
    ...patch,
  }
}

test('legacy memory rows load without loopKeyPoint; invalid values are dropped or clipped', () => {
  const rows = normalizeMemoryItemsForStorage([
    makeMemoryRow({ id: 'legacy' }),
    makeMemoryRow({ id: 'valid', loopKeyPoint: '季度方案' }),
    makeMemoryRow({ id: 'quoted', loopKeyPoint: '「季度方案」。' }),
    makeMemoryRow({ id: 'wrong-type', loopKeyPoint: 42 }),
    makeMemoryRow({ id: 'long', loopKeyPoint: 'x'.repeat(30) }),
    makeMemoryRow({ id: 'not-a-loop', kind: 'fact', loopKeyPoint: '应被丢弃' }),
  ])
  const byId = new Map(rows.map((row) => [row.id, row]))
  assert.equal(byId.get('legacy')?.loopKeyPoint, undefined)
  assert.equal(byId.get('valid')?.loopKeyPoint, '季度方案')
  assert.equal(byId.get('quoted')?.loopKeyPoint, '季度方案')
  assert.equal(byId.get('wrong-type')?.loopKeyPoint, undefined)
  assert.equal(byId.get('long')?.loopKeyPoint, 'x'.repeat(20))
  assert.equal(byId.get('not-a-loop')?.loopKeyPoint, undefined)

  const twice = normalizeMemoryItemsForStorage(rows)
  assert.deepEqual(twice, rows)
})

// ── Hook wiring ────────────────────────────────────────────────────────────

test('the scheduler saves the reminder and open loop first, then fills both key points', async (t) => {
  const now = new Date(2026, 4, 1, 12, 0, 0).getTime()
  const replies: Array<(value: { content: string } | null) => void> = []
  const prompts: string[] = []
  installEnvironment(t, {
    now,
    desktopPet: {
      completeChat: async (payload: { messages: Array<{ content: string }> }) => {
        prompts.push(payload.messages.map((message) => message.content).join('\n'))
        return new Promise((resolve) => { replies.push(resolve) })
      },
    },
  })

  const { useKeyPointScheduler } = await import('../src/hooks/useKeyPointScheduler.ts')
  const renderer = createHookRenderer(useKeyPointScheduler)
  const settingsRef = { current: makeSettings({ memoryPaused: false }) }
  const reminderTasksRef: { current: ReminderTask[] } = { current: [] }
  const memoriesRef: { current: MemoryItem[] } = { current: [] }
  const appliedReminders: Array<[string, string]> = []
  const setMemories = (updater: MemoryItem[] | ((current: MemoryItem[]) => MemoryItem[])) => {
    memoriesRef.current = typeof updater === 'function' ? updater(memoriesRef.current) : updater
  }

  const baseOptions = {
    enabled: true,
    settingsRef,
    reminderTasks: [] as ReminderTask[],
    reminderTasksRef,
    setReminderKeyPoint: (id: string, keyPoint: string) => { appliedReminders.push([id, keyPoint]) },
    memories: [] as MemoryItem[],
    memoriesRef,
    setMemories,
  }

  renderer.render(baseOptions)

  const task: ReminderTask = {
    id: 'reminder-hook',
    title: '取快递',
    prompt: '明天下午去驿站取快递',
    action: { kind: 'notice' },
    enabled: true,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    schedule: { kind: 'at', at: new Date(now + 60_000).toISOString() },
  }
  const loop = makeLoop({
    id: 'loop-hook',
    content: '周四下午三点对一下季度方案',
    createdAt: new Date(now).toISOString(),
  })
  reminderTasksRef.current = [task]
  memoriesRef.current = [loop]
  renderer.render({
    ...baseOptions,
    reminderTasks: [task],
    memories: [loop],
  })
  await flushAsync()

  assert.equal(replies.length, 1, 'one model call at a time')
  assert.deepEqual(appliedReminders, [], 'the item is already saved without waiting for the model')
  assert.equal(memoriesRef.current[0]?.loopKeyPoint, undefined)

  replies[0]?.({ content: '「取快递」' })
  await flushAsync()
  assert.deepEqual(appliedReminders, [['reminder-hook', '取快递']])

  assert.equal(replies.length, 2, 'the open loop follows the reminder')
  replies[1]?.({ content: '「对季度方案」' })
  await flushAsync()
  assert.equal(memoriesRef.current[0]?.loopKeyPoint, '对季度方案')

  // The prompts carry the item text for the model, but the key point is the
  // only thing written back.
  assert.equal(prompts.length, 2)
  renderer.unmount()
})
