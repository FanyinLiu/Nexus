import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'

import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { MAIN_MESSAGE_LOCALES, MAIN_MESSAGES } from '../electron/mainMessagesTable.js'
import { validateProactiveDeliveryPayload } from '../electron/ipc/proactivePayloadSchemas.js'
import { buildProactiveNotificationCopy } from '../electron/proactiveNotificationCopy.js'
import {
  createProactiveInboxStore,
  PROACTIVE_INBOX_FILE_NAME,
} from '../electron/services/proactiveInboxStore.js'
import type { Logger } from '../electron/logger.js'
import {
  PROACTIVE_SOURCES,
  type DeliveryContext,
  type ProactiveMessage,
  type ProactiveSource,
} from '../shared/proactiveDelivery.js'
import {
  STATE_KEY,
  hookUrl,
  resetProactiveNotificationState,
} from './helpers/proactive-notification-hooks.mjs'

register(hookUrl)

const NOW = 1_700_000_000_000

type SourceSeed = {
  title: string
  body: string
  fullBody: string
  fragment: string
  summaryCount?: number
}

const SOURCE_SEEDS: Record<ProactiveSource, SourceSeed> = {
  reminder: {
    title: '下午三点和老王开会',
    body: '在三楼小会议室，记得带上季度预算表。',
    fullBody: '下午三点和老王开会，在三楼小会议室，记得带上季度预算表，顺便把上周的会议纪要打印出来。',
    fragment: '三楼小会议室',
  },
  agenda: {
    title: '十点的设计评审',
    body: '在三楼小会议室，带上新版原型和上次的反馈。',
    fullBody: '十点的设计评审在三楼小会议室，带上新版原型、上次的反馈，还有打印好的用户访谈记录。',
    fragment: '新版原型',
  },
  open_arc: {
    title: '那个没写完的提案',
    body: '上次停在预算那一页，今天接着写吗？',
    fullBody: '那个没写完的提案上次停在预算那一页，今天接着写吗？客户周五就要看到完整版本了。',
    fragment: '预算那一页',
  },
  letter: {
    title: '今天想和你说的话',
    body: '最近辛苦了，晚饭记得吃点热的。',
    fullBody: '最近辛苦了，晚饭记得吃点热的。别总是一个人扛着，周末也可以出去走走。',
    fragment: '晚饭记得吃点热的',
  },
  capsule: {
    title: '给明年的自己',
    body: '希望你还在坚持早上跑步。',
    fullBody: '给明年的自己：希望你还在坚持早上跑步。如果累了，就慢一点，但别停下。',
    fragment: '坚持早上跑步',
  },
  bracket: {
    title: '午休时间到了',
    body: '先把杯子洗了，再去楼下晒十分钟太阳。',
    fullBody: '午休时间到了，先把杯子洗了，再去楼下晒十分钟太阳，回来再继续处理邮件。',
    fragment: '楼下晒十分钟太阳',
  },
  away: {
    title: '你不在的时候',
    body: '快递放在门口了；妈妈打电话说周末回家吃饭；牛奶快喝完了',
    fullBody: '快递放在门口了；妈妈打电话说周末回家吃饭；牛奶快喝完了；记得把冰箱里的酸奶也喝掉。',
    fragment: '快递放在门口了',
    summaryCount: 3,
  },
  dream: {
    title: '昨晚梦见会发光的图书馆',
    body: '你在书架间找到一本没有名字的书。',
    fullBody: '昨晚梦见会发光的图书馆，你在书架间找到一本没有名字的书，翻开后里面全是手写的星星。',
    fragment: '没有名字的书',
  },
}

type Notification = { title: string, body?: string, onClick?: () => void }
type LogCall = { level: string, message: string, meta?: unknown }
type Handler = (event: unknown, payload?: unknown) => unknown

function makeContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    panelFocused: false,
    fullscreen: false,
    focusState: 'active',
    inQuietHours: false,
    systemDnd: null,
    awayNotificationsEnabled: false,
    stripEnabled: true,
    ...overrides,
  }
}

function makeMessage(overrides: Partial<ProactiveMessage> = {}): ProactiveMessage {
  return {
    id: 'msg-1',
    source: 'reminder',
    kind: 'reminder_follow_up',
    priority: 'normal',
    title: 'Stand up',
    body: 'You asked me to remind you.',
    actions: [],
    createdAt: NOW,
    ...overrides,
  }
}

function createCaptureLogger(calls: LogCall[]): Logger {
  const push = (level: string) => (message: string, meta?: Record<string, unknown>) => {
    calls.push({ level, message, meta })
  }
  const logger: Logger = {
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    child: () => logger,
  }
  return logger
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function captureConsole(t: TestContext): string[] {
  const output: string[] = []
  const target = console as unknown as Record<string, (...args: unknown[]) => void>
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const originals = new Map<string, (...args: unknown[]) => void>()

  for (const method of methods) {
    originals.set(method, target[method])
    target[method] = (...args: unknown[]) => {
      output.push(`${method} ${args.map(serialize).join(' ')}`)
    }
  }

  t.after(() => {
    for (const method of methods) {
      const original = originals.get(method)
      if (original) target[method] = original
    }
  })

  return output
}

function createTempDir(t: TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-proactive-notification-'))
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

function createHarness(options: {
  loggerCalls?: LogCall[]
  notificationError?: Error
  inbox?: ReturnType<typeof createProactiveInboxStore>
} = {}) {
  const notifications: Notification[] = []
  const inboxEntries: ProactiveMessage[] = []
  const loggerCalls = options.loggerCalls ?? []
  const handlers = new Map<string, Handler>()
  const emptyMutation = () => ({
    changed: false,
    entries: [],
    removedIds: [],
    unreadCount: 0,
  })

  const ipc = createProactiveIpc({
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener)
      },
    },
    getAllWindows: () => [],
    getWindowCapability: () => 'unknown',
    requireTrustedSender: () => {},
    inbox: options.inbox ?? {
      list: () => ({ entries: [...inboxEntries], unreadCount: inboxEntries.length, removedIds: [] }),
      prune: () => emptyMutation(),
      upsert: (message: ProactiveMessage) => {
        inboxEntries.push(message)
        return emptyMutation()
      },
      setStatus: () => emptyMutation(),
      flush: async () => true,
      clear: async () => true,
    },
    logger: createCaptureLogger(loggerCalls),
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: {
      show: () => true,
      withdraw: () => true,
      withdrawAll: () => {},
    },
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze 10 min', open: 'Open chat' }),
    showOsNotification: (payload: Notification) => {
      notifications.push(payload)
      if (options.notificationError) throw options.notificationError
      return true
    },
    isPanelFocused: () => false,
  })

  return {
    notifications,
    loggerCalls,
    inboxEntries,
    store: options.inbox ?? null,
    async deliver(message: ProactiveMessage) {
      const handler = handlers.get('proactive:deliver')
      assert.ok(handler, 'missing proactive:deliver handler')
      return await handler({ trusted: true }, {
        message,
        context: makeContext({ focusState: 'idle', awayNotificationsEnabled: true }),
      })
    },
    stop: () => ipc.stopPrune(),
  }
}

function assertNoText(text: string, secrets: readonly string[], label: string): void {
  for (const secret of secrets) {
    if (!secret) continue
    assert.equal(text.includes(secret), false, `${label} leaked "${secret}": ${text}`)
  }
}

function logText(calls: readonly LogCall[]): string {
  return calls.map((call) => `${call.level} ${call.message} ${serialize(call.meta)}`).join('\n')
}

test('the os_notification outlet shows every source title-only and never logs the entry body', async (t) => {
  const consoleOutput = captureConsole(t)
  const allConsoleText = () => consoleOutput.join('\n')

  for (const source of PROACTIVE_SOURCES) {
    const seed = SOURCE_SEEDS[source]
    for (const actions of [[], ['done', 'snooze', 'open']] as const) {
      const loggerCalls: LogCall[] = []
      const harness = createHarness({ loggerCalls })
      const message = makeMessage({
        id: `${source}-${actions.length}-${actions.join('-') || 'none'}`,
        source,
        title: seed.title,
        body: seed.body,
        fullBody: seed.fullBody,
        actions: [...actions],
        ...(source === 'away' ? { summaryCount: seed.summaryCount } : {}),
      })

      const decision = await harness.deliver(message)
      harness.stop()

      assert.deepEqual(decision, { rule: 5, outlets: ['inbox', 'os_notification'] })
      assert.equal(harness.notifications.length, 1, `${source}/${actions.length}`)
      const notification = harness.notifications[0]!
      assert.equal(notification.title, message.title, `${source}/${actions.length} title`)
      assertNoText(notification.title, [seed.body, seed.fullBody, seed.fragment], `${source} title`)
      assertNoText(notification.body ?? '', [seed.body, seed.fullBody, seed.fragment], `${source} body`)
      assertNoText(logText(loggerCalls), [seed.body, seed.fullBody, seed.fragment], `${source} logs`)
    }
  }

  for (const seed of Object.values(SOURCE_SEEDS)) {
    assertNoText(allConsoleText(), [seed.body, seed.fullBody, seed.fragment], 'console')
  }
})

test('a failing notifier still writes no entry body to the logs or console', async (t) => {
  const consoleOutput = captureConsole(t)
  const loggerCalls: LogCall[] = []
  const seed = SOURCE_SEEDS.reminder
  const harness = createHarness({
    loggerCalls,
    notificationError: new Error(`notify down: ${seed.body}`),
  })
  const message = makeMessage({
    title: seed.title,
    body: seed.body,
    fullBody: seed.fullBody,
  })

  const decision = await harness.deliver(message)
  harness.stop()

  assert.deepEqual(decision, { rule: 5, outlets: ['inbox', 'os_notification'] })
  assert.equal(loggerCalls.some((call) => call.level === 'error'), true)
  assertNoText(logText(loggerCalls), [seed.body, seed.fullBody, seed.fragment], 'failure logs')
  assertNoText(consoleOutput.join('\n'), [seed.body, seed.fullBody, seed.fragment], 'failure console')
})

const AWAY_CONTEXTS = [
  { locale: 'zh-CN', template: '你不在的时候，她记了 {n} 件事。' },
  { locale: 'zh-TW', template: '你不在的時候，她記了 {n} 件事。' },
  { locale: 'ja', template: '留守の間に {n} 件メモしておいたよ。' },
  { locale: 'ko', template: '자리 비운 동안 {n}개 적어 뒀어요.' },
] as const

function awayMessage(overrides: Partial<ProactiveMessage> = {}): ProactiveMessage {
  const seed = SOURCE_SEEDS.away
  return makeMessage({
    source: 'away',
    kind: 'away',
    title: seed.title,
    body: seed.body,
    fullBody: seed.fullBody,
    summaryCount: seed.summaryCount,
    ...overrides,
  })
}

test('an away summary with nothing noted produces no copy in any locale', () => {
  for (const locale of MAIN_MESSAGE_LOCALES) {
    assert.equal(
      buildProactiveNotificationCopy(awayMessage({ summaryCount: 0 }), locale),
      null,
      locale,
    )
  }
})

test('away-summary copy matches every locale and uses the singular only for one', () => {
  for (const { locale, template } of AWAY_CONTEXTS) {
    for (const n of [1, 2, 3]) {
      const copy = buildProactiveNotificationCopy(awayMessage({ summaryCount: n }), locale)
      assert.ok(copy, `${locale}/${n} copy`)
      assert.equal(copy.title, SOURCE_SEEDS.away.title, `${locale}/${n} title`)
      assert.equal(copy.body, template.replace('{n}', String(n)), `${locale}/${n} body`)
    }
  }

  const one = buildProactiveNotificationCopy(awayMessage({ summaryCount: 1 }), 'en-US')
  assert.equal(one?.body, 'While you were away, she noted 1 thing.')

  for (const n of [2, 3]) {
    const copy = buildProactiveNotificationCopy(awayMessage({ summaryCount: n }), 'en-US')
    assert.equal(copy?.body, `While you were away, she noted ${n} things.`, `en-US/${n}`)
    assert.notEqual(copy?.body, 'While you were away, she noted 1 thing.')
  }
})

test('an away summary never carries the noted items into the toast or the logs', async (t) => {
  const seed = SOURCE_SEEDS.away
  const secrets = [seed.body, seed.fullBody, seed.fragment]

  for (const locale of MAIN_MESSAGE_LOCALES) {
    const copy = buildProactiveNotificationCopy(awayMessage(), locale)
    assertNoText(copy.title, secrets, `${locale} title`)
    assertNoText(copy.body ?? '', secrets, `${locale} body`)
  }

  const consoleOutput = captureConsole(t)
  const loggerCalls: LogCall[] = []
  const harness = createHarness({ loggerCalls })
  const message = awayMessage()
  await harness.deliver(message)
  harness.stop()

  assert.equal(harness.notifications.length, 1)
  const notification = harness.notifications[0]!
  assertNoText(notification.title, secrets, 'outlet title')
  assertNoText(notification.body ?? '', secrets, 'outlet body')
  assertNoText(logText(loggerCalls), secrets, 'outlet logs')
  assertNoText(consoleOutput.join('\n'), secrets, 'outlet console')
})

test('a zero-count away summary raises no OS notification but still lands in the inbox', async (t) => {
  const seed = SOURCE_SEEDS.away
  const secrets = [seed.title, seed.body, seed.fullBody, seed.fragment, '0 things', '0 件事']
  const consoleOutput = captureConsole(t)
  const loggerCalls: LogCall[] = []
  const directory = createTempDir(t)
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, PROACTIVE_INBOX_FILE_NAME),
    now: () => NOW,
  })
  const harness = createHarness({ loggerCalls, inbox: store })
  const message = awayMessage({ summaryCount: 0 })

  const decision = await harness.deliver(message)
  harness.stop()

  assert.deepEqual(decision, { rule: 5, outlets: ['inbox', 'os_notification'] })
  assert.equal(harness.notifications.length, 0, 'zero-count away raises no toast')
  const stored = store.list().entries
  assert.equal(stored.length, 1, 'the inbox still holds the entry')
  assert.equal(stored[0]?.id, message.id)
  assert.equal(Object.hasOwn(stored[0]!, 'summaryCount'), false, 'the store drops summaryCount')
  assert.equal(await store.flush(), true)

  const logged = logText(loggerCalls)
  assertNoText(logged, secrets, 'zero-count logs')
  assertNoText(consoleOutput.join('\n'), secrets, 'zero-count console')
})

test('an away summary count reaches the toast but never reaches the stored inbox', async (t) => {
  const seed = SOURCE_SEEDS.away
  const directory = createTempDir(t)
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, PROACTIVE_INBOX_FILE_NAME),
    now: () => NOW,
  })
  const harness = createHarness({ inbox: store })
  const three = awayMessage({ id: 'away-three', summaryCount: 3, createdAt: NOW + 1 })
  const zero = awayMessage({ id: 'away-zero', summaryCount: 0, createdAt: NOW })

  const threeDecision = await harness.deliver(three)
  const zeroDecision = await harness.deliver(zero)
  harness.stop()

  assert.deepEqual(threeDecision, { rule: 5, outlets: ['inbox', 'os_notification'] })
  assert.deepEqual(zeroDecision, { rule: 5, outlets: ['inbox', 'os_notification'] })

  const stored = store.list().entries
  assert.deepEqual(stored.map((entry) => entry.id).sort(), ['away-three', 'away-zero'])
  for (const entry of stored) {
    assert.equal(Object.hasOwn(entry, 'summaryCount'), false, `${entry.id} stored entry`)
  }

  assert.equal(harness.notifications.length, 1, 'only the n=3 away summary raises a toast')
  assert.equal(harness.notifications[0]?.title, seed.title)
  assert.equal(harness.notifications[0]?.body, 'While you were away, she noted 3 things.')

  assert.equal(await store.flush(), true)
  const persisted = fs.readFileSync(path.join(directory, PROACTIVE_INBOX_FILE_NAME), 'utf8')
  assert.equal(persisted.includes('summaryCount'), false, 'the file never contains summaryCount')
  for (const id of ['away-three', 'away-zero']) {
    assert.equal(persisted.includes(id), true, `${id} persisted`)
  }
})

test('an away entry without a valid summaryCount falls back to the title only', () => {
  const message = awayMessage()
  const invalid = [undefined, null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2'] as const

  for (const summaryCount of invalid) {
    const copy = buildProactiveNotificationCopy(
      awayMessage({ summaryCount: summaryCount as unknown as number }),
      'en-US',
    )
    assert.deepEqual(copy, { title: message.title }, String(summaryCount))
  }
})

test('the copy layer enforces the 0-999 summary count bound in every locale', () => {
  const title = SOURCE_SEEDS.away.title
  const invalid = [1000, -1, 2.5, '3', Number.NaN, Number.POSITIVE_INFINITY] as const

  for (const locale of MAIN_MESSAGE_LOCALES) {
    for (const summaryCount of invalid) {
      const copy = buildProactiveNotificationCopy(
        awayMessage({ summaryCount: summaryCount as unknown as number }),
        locale,
      )
      assert.deepEqual(copy, { title }, `${locale}/${String(summaryCount)}`)
    }

    const max = buildProactiveNotificationCopy(awayMessage({ summaryCount: 999 }), locale)
    assert.ok(max, `${locale}/999 copy`)
    assert.equal(max.title, title, `${locale}/999 title`)
    assert.equal(typeof max.body, 'string', `${locale}/999 body`)
  }

  const maxEn = buildProactiveNotificationCopy(awayMessage({ summaryCount: 999 }), 'en-US')
  assert.equal(maxEn?.body, 'While you were away, she noted 999 things.')
})

test('the proactive:deliver validator accepts 0/1/2 and rejects invalid summary counts', () => {
  for (const summaryCount of [0, 1, 2]) {
    const validated = validateProactiveDeliveryPayload({
      message: awayMessage({ summaryCount }),
      context: makeContext(),
    })
    assert.equal(validated.message.summaryCount, summaryCount)
  }

  for (const summaryCount of [-1, 1.5, '2', 1000]) {
    assert.throws(
      () => validateProactiveDeliveryPayload({
        message: awayMessage({ summaryCount: summaryCount as unknown as number }),
        context: makeContext(),
      }),
      /summaryCount/u,
      String(summaryCount),
    )
  }
})

test('a capsule keeps its public title and opener and never leaks the letter', async (t) => {
  const consoleOutput = captureConsole(t)
  const loggerCalls: LogCall[] = []
  const harness = createHarness({ loggerCalls })
  const letter = '亲爱的未来的我：希望你还在坚持早上跑步。如果累了，就慢一点，但别停下。'
  const message = makeMessage({
    source: 'capsule',
    kind: 'capsule',
    title: '给明年的自己',
    body: letter,
    fullBody: letter,
    publicCopy: { title: '给今天的你', body: '打开这封信' },
    actions: ['open'],
  })

  await harness.deliver(message)
  harness.stop()

  const notification = harness.notifications[0]
  assert.ok(notification)
  assert.equal(notification.title, message.publicCopy?.title)
  assert.equal(notification.body, message.publicCopy?.body)
  assertNoText(notification.title, [letter], 'capsule title')
  assertNoText(notification.body ?? '', [letter], 'capsule body')
  assertNoText(logText(loggerCalls), [letter], 'capsule logs')
  assertNoText(consoleOutput.join('\n'), [letter], 'capsule console')
})

test('both away-summary keys exist in all five main locales with equal key counts', () => {
  const counts = MAIN_MESSAGE_LOCALES.map((locale) => Object.keys(MAIN_MESSAGES[locale]).length)

  for (const locale of MAIN_MESSAGE_LOCALES) {
    assert.equal(typeof MAIN_MESSAGES[locale]['proactiveNotification.awaySummary.one'], 'string', locale)
    assert.equal(typeof MAIN_MESSAGES[locale]['proactiveNotification.awaySummary.other'], 'string', locale)
  }

  assert.equal(new Set(counts).size, 1)
})

type NotificationInstance = {
  options: { title: string; body?: string; silent: boolean; icon: string }
  handlers: Map<string, Array<() => void>>
  shown: boolean
}

type RuntimeState = {
  supported: boolean
  instances: NotificationInstance[]
  shown: number
  focusCalls: number
  createdWindows: number
  panelWindows: Array<{ loading: boolean, finishLoad: () => void }>
  nextPanelLoading: boolean
}

function runtime(): RuntimeState {
  const state = (globalThis as unknown as Record<string, RuntimeState | undefined>)[STATE_KEY]
  assert.ok(state, 'notification hook state was never initialized')
  return state
}

test('a title-only notification is shown without body text', async () => {
  resetProactiveNotificationState()
  const module = await import('../electron/services/proactiveNotification.js')
  const show = module.showProactiveNotification as (input: {
    title?: unknown
    body?: unknown
    onClick?: unknown
  }) => boolean

  assert.equal(show({ title: '  你不在的时候  ' }), true)
  assert.equal(runtime().instances.length, 1)
  const notification = runtime().instances[0]!
  assert.equal(notification.options.title, '你不在的时候')
  assert.equal('body' in notification.options, false)
  assert.equal(notification.shown, true)
  assert.equal((notification.handlers.get('click') ?? []).length, 1)

  resetProactiveNotificationState()
  assert.equal(show({ title: '   ' }), false)
  assert.equal(show({}), false)
  assert.equal(runtime().instances.length, 0)
})
