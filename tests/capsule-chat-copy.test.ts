/**
 * Future-self capsules in chat: the localized copy, the age wording, and the
 * three delivery outlets that must never carry the letter.
 *
 * The letter is the user's own writing. It is allowed to appear in the chat
 * card and in the inbox entry, and nowhere else — a pet bubble, an OS toast
 * and the voice channel are all readable by someone else at the desk.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import { routeDelivery } from '../shared/proactiveDelivery.js'
import type { DeliveryContext, ProactiveMessage } from '../shared/proactiveDelivery.js'
import { createProactiveInboxStore } from '../electron/services/proactiveInboxStore.js'
import { createProactiveIpc } from '../electron/ipc/proactiveIpc.js'
import { validateProactiveDeliveryPayload } from '../electron/ipc/proactivePayloadSchemas.js'
import {
  buildCapsuleChatLine,
  buildCapsuleProactiveMessage,
  deliverDueCapsule,
} from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import {
  buildFutureCapsuleDelivery,
  formatCapsuleAge,
  formatCapsuleWrittenLabel,
} from '../src/features/futureCapsule/futureCapsuleDelivery.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { runFutureCapsuleTick } from '../src/hooks/useFutureCapsuleScheduler.ts'
import type { CompanionNoticePayload } from '../src/hooks/chat/types.ts'
import { AVAILABLE_LOCALES, ensureLocaleLoaded, t } from '../src/i18n/runtime.ts'
import { FUTURE_CAPSULE_STORE_STORAGE_KEY } from '../src/lib/storage/core.ts'
import { normalizeChatMessage } from '../src/lib/storage/chat.ts'
import type { AppSettings } from '../src/types/index.ts'
import type { AppLocale } from '../src/types/i18n.ts'

for (const locale of AVAILABLE_LOCALES) await ensureLocaleLoaded(locale)

const NOW = new Date('2026-05-01T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

const LETTER_TITLE = '给明年的自己'
const LETTER_BODY = '希望你还在坚持早上跑步。\n如果累了，就慢一点，但别停下。\n还有，记得给妈妈打电话。'

/** The opener as the product spec words it, per locale, for a given {time}. */
const OPENER_BY_LOCALE: Record<AppLocale, (time: string) => string> = {
  'zh-CN': (time) => `你${time}写给今天的信，到了。`,
  'zh-TW': (time) => `你${time}寫給今天的信，到了。`,
  'en-US': (time) => `The letter you wrote ${time} for today is here.`,
  ja: (time) => `${time}のあなたから、今日のあなたへの手紙が届きました。`,
  ko: (time) => `${time}의 당신이 오늘의 당신에게 쓴 편지가 도착했어요.`,
}

function capsuleAged(
  days: number,
  overrides: Partial<FutureCapsuleRecord> = {},
): FutureCapsuleRecord {
  return {
    id: 'capsule-chat',
    message: LETTER_BODY,
    createdAt: new Date(NOW.getTime() - days * DAY_MS).toISOString(),
    scheduledFor: '2020-01-01',
    status: 'pending',
    ...overrides,
  }
}

function deliveryFor(locale: AppLocale, days: number, overrides: Partial<FutureCapsuleRecord> = {}) {
  return buildFutureCapsuleDelivery({
    uiLanguage: locale,
    capsule: capsuleAged(days, overrides),
    now: NOW,
  })
}

/** No outlet copy may contain any line of the authored letter. */
function assertNoLetterText(text: string, label: string) {
  for (const line of LETTER_BODY.split('\n')) {
    assert.ok(!text.includes(line), `${label} must not leak the letter line: ${line}`)
  }
}

// ── {time}: spoken-style age, not exact days ────────────────────────────────

const AGE_CASES: Array<{
  days: number
  label: string
  expected: Record<AppLocale, string>
}> = [
  {
    days: 1,
    label: '1 day',
    expected: { 'zh-CN': '1天前', 'zh-TW': '1天前', 'en-US': 'a day ago', ja: '1日前', ko: '1일 전' },
  },
  {
    days: 59,
    label: '59 days',
    expected: { 'zh-CN': '59天前', 'zh-TW': '59天前', 'en-US': '59 days ago', ja: '59日前', ko: '59일 전' },
  },
  {
    days: 60,
    label: '60 days (2 months)',
    expected: { 'zh-CN': '2个月前', 'zh-TW': '2個月前', 'en-US': '2 months ago', ja: '2か月前', ko: '2개월 전' },
  },
  {
    days: 61,
    label: '61 days (2 months)',
    expected: { 'zh-CN': '2个月前', 'zh-TW': '2個月前', 'en-US': '2 months ago', ja: '2か月前', ko: '2개월 전' },
  },
  {
    days: 359,
    label: '359 days (11 months)',
    expected: { 'zh-CN': '11个月前', 'zh-TW': '11個月前', 'en-US': '11 months ago', ja: '11か月前', ko: '11개월 전' },
  },
  {
    days: 360,
    label: '360 days (11 months)',
    expected: { 'zh-CN': '11个月前', 'zh-TW': '11個月前', 'en-US': '11 months ago', ja: '11か月前', ko: '11개월 전' },
  },
  {
    days: 364,
    label: '364 days (11 months)',
    expected: { 'zh-CN': '11个月前', 'zh-TW': '11個月前', 'en-US': '11 months ago', ja: '11か月前', ko: '11개월 전' },
  },
  {
    days: 365,
    label: '365 days (one year)',
    expected: { 'zh-CN': '一年前', 'zh-TW': '一年前', 'en-US': 'a year ago', ja: '1年前', ko: '1년 전' },
  },
  {
    days: 729,
    label: '729 days (one year)',
    expected: { 'zh-CN': '一年前', 'zh-TW': '一年前', 'en-US': 'a year ago', ja: '1年前', ko: '1년 전' },
  },
  {
    days: 730,
    label: '730 days (2 years)',
    expected: { 'zh-CN': '2年前', 'zh-TW': '2年前', 'en-US': '2 years ago', ja: '2年前', ko: '2년 전' },
  },
]

for (const ageCase of AGE_CASES) {
  test(`capsule age at ${ageCase.label} is spoken the same way in all 5 locales`, () => {
    for (const locale of AVAILABLE_LOCALES) {
      assert.equal(
        formatCapsuleAge(ageCase.days, locale),
        ageCase.expected[locale],
        `${locale}:${ageCase.days}`,
      )
    }
  })
}

// ── Opener ──────────────────────────────────────────────────────────────────

test('the opener is one normal sentence per locale and never quotes the letter', () => {
  for (const locale of AVAILABLE_LOCALES) {
    const oneDay = deliveryFor(locale, 1)
    assert.equal(oneDay.opener, OPENER_BY_LOCALE[locale](AGE_CASES[0]!.expected[locale]), locale)
    assertNoLetterText(oneDay.opener, `${locale} opener`)

    const oneYear = deliveryFor(locale, 400)
    assert.equal(oneYear.opener, OPENER_BY_LOCALE[locale](AGE_CASES[7]!.expected[locale]), locale)
  }
})

test('the zh capsule opener has no gap between the number and the time word', () => {
  const expected = {
    3: ['你3天前写给今天的信，到了。', '你3天前寫給今天的信，到了。'],
    60: ['你2个月前写给今天的信，到了。', '你2個月前寫給今天的信，到了。'],
    730: ['你2年前写给今天的信，到了。', '你2年前寫給今天的信，到了。'],
  } as const
  for (const [days, texts] of Object.entries(expected)) {
    for (const [locale, text] of [['zh-CN', texts[0]], ['zh-TW', texts[1]]] as const) {
      assert.doesNotMatch(deliveryFor(locale, Number(days)).opener, /\s/, `${locale}:${days}`)
      assert.equal(deliveryFor(locale, Number(days)).opener, text, `${locale}:${days}`)
    }
  }
  for (const locale of ['zh-CN', 'zh-TW'] as const) for (const key of ['chat.capsule.age.days', 'chat.capsule.age.one_day', 'chat.capsule.age.months', 'chat.capsule.age.one_year', 'chat.capsule.age.years'] as const) assert.doesNotMatch(t(key, { n: 3, m: 2, y: 2 }, locale), /\s/, `${locale}:${key}`)
})

test('no capsule copy asks to read the letter out loud or prefixes a companion name', () => {
  for (const locale of AVAILABLE_LOCALES) {
    const delivery = deliveryFor(locale, 30, { title: LETTER_TITLE })
    for (const copy of [delivery.opener, delivery.header, delivery.notificationTitle]) {
      assert.doesNotMatch(copy, /让我念给你|讓我念給你|読みあげます|읽어드릴게요|Reading it back/)
      assert.doesNotMatch(copy, /Nexus:|星绘：|星繪：/)
      assert.doesNotMatch(copy, /^[「“"']|[」”"']$/)
    }
  }
})

test('the letter body stays verbatim in every locale', () => {
  for (const locale of AVAILABLE_LOCALES) {
    const delivery = deliveryFor(locale, 30)
    assert.equal(delivery.letterBody, LETTER_BODY, locale)
    assert.ok(delivery.letterBody.includes('\n'))
  }
})

// ── Card header ────────────────────────────────────────────────────────────

const DEFAULT_HEADER: Record<AppLocale, string> = {
  'zh-CN': '给今天的你',
  'zh-TW': '給今天的你',
  'en-US': 'To you, today',
  ja: '今日のあなたへ',
  ko: '오늘의 당신에게',
}

test('an untitled capsule gets the default card header in all 5 locales', () => {
  for (const locale of AVAILABLE_LOCALES) {
    assert.equal(deliveryFor(locale, 30).header, DEFAULT_HEADER[locale], locale)
  }
})

test("a titled capsule keeps the user's own title as the card header", () => {
  for (const locale of AVAILABLE_LOCALES) {
    const delivery = deliveryFor(locale, 30, { title: `  ${LETTER_TITLE}  ` })
    assert.equal(delivery.header, LETTER_TITLE, locale)
    assert.notEqual(delivery.header, DEFAULT_HEADER[locale], locale)
  }
})

// ── Written date ───────────────────────────────────────────────────────────

test('the card date line for 2025-11-01 reads correctly in all 5 locales', () => {
  const writtenAt = new Date(2025, 10, 1, 12, 0, 0).toISOString()
  const expected: Record<AppLocale, string> = {
    'zh-CN': '写于 2025年11月1日',
    'zh-TW': '寫於 2025年11月1日',
    'en-US': 'Written Nov 1, 2025',
    ja: '2025年11月1日に書いた手紙',
    ko: '2025년 11월 1일에 쓴 편지',
  }
  for (const locale of AVAILABLE_LOCALES) {
    assert.equal(formatCapsuleWrittenLabel(writtenAt, locale), expected[locale], locale)
  }
})

test('an unparseable written stamp renders no date line instead of a bogus one', () => {
  assert.equal(formatCapsuleWrittenLabel('not-a-date', 'en-US'), '')
})

// ── Outlets: zero letter content ───────────────────────────────────────────

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

function zhCapsuleMessage(now = NOW.getTime()): {
  capsule: FutureCapsuleRecord
  delivery: ReturnType<typeof buildFutureCapsuleDelivery>
  message: ProactiveMessage
} {
  const capsule = capsuleAged(300, { title: LETTER_TITLE })
  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: 'zh-CN',
    capsule,
    now: new Date(now),
  })
  return {
    capsule,
    delivery,
    message: buildCapsuleProactiveMessage(capsule, delivery, now),
  }
}

type DeliverHandler = (event: unknown, payload?: unknown) => unknown

/** Wire the real IPC module with fake windows so outlets can be observed. */
function createProactiveHarness(options: { capability?: 'pet' | 'panel' } = {}) {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const notifications: Array<{ title: string; body: string }> = []
  const webContents = {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) },
  }
  const win = { isDestroyed: () => false, webContents }
  const emptyMutation = () => ({
    changed: true,
    entries: [],
    removedIds: [],
    unreadCount: 1,
  })
  let deliverHandler: DeliverHandler | null = null

  const ipc = createProactiveIpc({
    ipcMain: {
      handle: (channel: string, listener: DeliverHandler) => {
        if (channel === 'proactive:deliver') deliverHandler = listener
      },
    },
    getAllWindows: () => [win],
    getWindowCapability: () => options.capability ?? 'pet',
    requireTrustedSender: () => {},
    inbox: {
      list: () => ({ entries: [], unreadCount: 0, removedIds: [] }),
      prune: () => emptyMutation(),
      upsert: () => emptyMutation(),
      setStatus: () => emptyMutation(),
      flush: async () => true,
      clear: async () => true,
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      child() { return this },
    } as never,
    setInterval: () => ({ unref: () => {} }),
    clearInterval: () => {},
    strip: { show: () => true, withdraw: () => true, withdrawAll: () => {} },
    getStripLabels: () => ({ done: 'Done', snooze: 'Snooze', open: 'Open' }),
    showOsNotification: (payload: { title: string; body: string }) => { notifications.push(payload) },
    isPanelFocused: () => false,
  })
  ipc.stopPrune()

  return {
    sent,
    notifications,
    async deliver(message: ProactiveMessage, context: DeliveryContext) {
      assert.ok(deliverHandler, 'proactive:deliver must be registered')
      return await deliverHandler({}, { message, context })
    },
  }
}

test('the pet bubble from main carries the routing title and the opener only', async () => {
  const { delivery, message } = zhCapsuleMessage()
  const harness = createProactiveHarness()

  const decision = await harness.deliver(message, makeContext())
  assert.deepEqual(decision, { rule: 4, outlets: ['inbox', 'bubble'] })

  const presentation = harness.sent.find((item) => item.channel === 'proactive:present')?.payload as {
    outlet: string
    message: ProactiveMessage
  }
  assert.ok(presentation, 'the bubble outlet must present to the pet')
  assert.equal(presentation.outlet, 'bubble')
  assert.equal(presentation.message.title, delivery.notificationTitle)
  assert.equal(presentation.message.title, '过去的你给现在的你')
  assert.equal(presentation.message.body, delivery.opener)
  assert.equal('fullBody' in presentation.message, false)
  assert.equal('publicCopy' in presentation.message, false)
  assertNoLetterText(JSON.stringify(presentation), 'pet bubble presentation')
})

test('the router OS notification carries the routing title and the opener only', async () => {
  const { delivery, message } = zhCapsuleMessage()
  const harness = createProactiveHarness({ capability: 'panel' })

  const decision = await harness.deliver(
    message,
    makeContext({ focusState: 'idle', awayNotificationsEnabled: true }),
  )
  assert.deepEqual(decision, { rule: 5, outlets: ['inbox', 'os_notification'] })

  assert.equal(harness.notifications.length, 1)
  assert.deepEqual(harness.notifications[0], {
    title: '过去的你给现在的你',
    body: delivery.opener,
  })
  assertNoLetterText(JSON.stringify(harness.notifications), 'router OS notification')
})

test('the legacy path sends the opener in the OS toast and the letter in one chat line', async () => {
  const { capsule, delivery } = zhCapsuleMessage()
  const notifications: Array<{ title: string; body: string }> = []
  const chatLines: unknown[] = []
  const delivered: string[] = []

  await deliverDueCapsule({
    capsule,
    delivery,
    now: NOW.getTime(),
    useLegacyPath: true,
    showNotification: async (payload) => { notifications.push(payload) },
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async (line) => { chatLines.push(line) },
    markDelivered: (id) => { delivered.push(id) },
    isStopped: () => false,
  })

  assert.deepEqual(notifications, [{
    title: '过去的你给现在的你',
    body: delivery.opener,
  }])
  assertNoLetterText(JSON.stringify(notifications), 'legacy OS notification')

  assert.equal(chatLines.length, 1, 'the legacy path still delivers the letter exactly once')
  const line = chatLines[0] as { content: string; capsuleLetter: { body: string } }
  assert.equal(line.content, delivery.opener)
  assert.equal(line.capsuleLetter.body, delivery.letterBody)
  assert.equal(line.capsuleLetter.body, LETTER_BODY)
  assert.deepEqual(delivered, [capsule.id])
})

test('the router-failure fallback sends the opener in the OS toast and the letter in one chat line', async () => {
  const { capsule, delivery } = zhCapsuleMessage()
  const notifications: Array<{ title: string; body: string }> = []
  const chatLines: unknown[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule({
    capsule,
    delivery,
    now: NOW.getTime(),
    useLegacyPath: false,
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async (payload) => { notifications.push(payload) },
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async (line) => { chatLines.push(line) },
    markDelivered: (id) => { delivered.push(id) },
    isStopped: () => false,
  })

  assert.deepEqual(result, { path: 'fallback' })
  assert.deepEqual(notifications, [{
    title: '过去的你给现在的你',
    body: delivery.opener,
  }])
  assertNoLetterText(JSON.stringify(notifications), 'fallback OS notification')

  assert.equal(chatLines.length, 1, 'the fallback still delivers the letter exactly once')
  const line = chatLines[0] as { content: string; capsuleLetter: { body: string } }
  assert.equal(line.content, delivery.opener)
  assert.equal(line.capsuleLetter.body, LETTER_BODY)
  assert.deepEqual(delivered, [capsule.id])
})

test('a throwing legacy notification pushes no chat line and leaves the capsule pending', async () => {
  const { capsule, delivery } = zhCapsuleMessage()
  const chatLines: unknown[] = []
  const delivered: string[] = []

  await assert.rejects(() => deliverDueCapsule({
    capsule,
    delivery,
    now: NOW.getTime(),
    useLegacyPath: true,
    showNotification: async () => { throw new Error('notification down') },
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async (line) => { chatLines.push(line) },
    markDelivered: (id) => { delivered.push(id) },
    isStopped: () => false,
  }), /notification down/)

  assert.deepEqual(chatLines, [], 'a failed toast must not produce a half delivery')
  assert.deepEqual(delivered, [], 'the capsule stays retryable')
})

test('a throwing fallback notification pushes no chat line and leaves the capsule pending', async () => {
  const { capsule, delivery } = zhCapsuleMessage()
  const chatLines: unknown[] = []
  const delivered: string[] = []

  await assert.rejects(() => deliverDueCapsule({
    capsule,
    delivery,
    now: NOW.getTime(),
    useLegacyPath: false,
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async () => { throw new Error('notification down') },
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async (line) => { chatLines.push(line) },
    markDelivered: (id) => { delivered.push(id) },
    isStopped: () => false,
  }), /notification down/)

  assert.deepEqual(chatLines, [], 'a failed fallback toast must not produce a half delivery')
  assert.deepEqual(delivered, [], 'the capsule stays retryable')
})

test('a stopped scheduler drops the legacy chat line but keeps the toast', async () => {
  const { capsule, delivery } = zhCapsuleMessage()
  const notifications: Array<{ title: string; body: string }> = []
  const chatLines: unknown[] = []
  const delivered: string[] = []

  const result = await deliverDueCapsule({
    capsule,
    delivery,
    now: NOW.getTime(),
    useLegacyPath: false,
    deliver: async () => { throw new Error('bridge down') },
    showNotification: async (payload) => { notifications.push(payload) },
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async (line) => { chatLines.push(line) },
    markDelivered: (id) => { delivered.push(id) },
    isStopped: () => true,
  })

  assert.deepEqual(result, { path: 'fallback' })
  assert.deepEqual(notifications, [{
    title: '过去的你给现在的你',
    body: delivery.opener,
  }])
  assert.deepEqual(chatLines, [], 'a stopped scheduler writes no chat line')
  assert.deepEqual(delivered, [capsule.id])
})

// ── Voice ──────────────────────────────────────────────────────────────────

function makeSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    uiLanguage: 'zh-CN',
    companionName: '星绘',
    proactiveQuietHoursStart: 23,
    proactiveQuietHoursEnd: 8,
    proactiveAwayNotificationsEnabled: true,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    ...patch,
  } as unknown as AppSettings
}

test('the capsule never speaks the letter: any speech pushed is the opener or absent', async (t: TestContext) => {
  const { capsule, delivery, message } = zhCapsuleMessage()

  // The routed message itself has nothing to say, so no outlet can speak it.
  assert.equal('speech' in message, false)

  const payloads: CompanionNoticePayload[] = []
  const store = new Map<string, string>([
    [FUTURE_CAPSULE_STORE_STORAGE_KEY, JSON.stringify([capsule])],
  ])
  const desktopPet = new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      return async (...args: unknown[]) => {
        if (property === 'deliverProactiveMessage') {
          const { message: routed, context } = args[0] as Parameters<typeof routeDelivery>
          return routeDelivery(routed, context)
        }
        if (property === 'getDesktopContext') return null
        return undefined
      }
    },
  })
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
      },
      desktopPet,
    },
    configurable: true,
    writable: true,
  })
  t.after(() => { Reflect.deleteProperty(globalThis, 'window') })

  await runFutureCapsuleTick({
    settings: makeSettings(),
    now: NOW.getTime(),
    pushCompanionNotice: async (payload) => { payloads.push(payload) },
  }, () => false)

  assert.equal(payloads.length, 1)
  const payload = payloads[0]!
  assert.equal(payload.chatContent, delivery.opener)
  assert.equal(payload.bubbleContent, '', 'a capsule draws no pet bubble')
  // Nothing is spoken today; if that ever changes, the words must be the
  // opener. The letter is only ever the chat card.
  if (payload.speechContent !== undefined) {
    assert.equal(payload.speechContent, delivery.opener)
  }
  assertNoLetterText(payload.chatContent, 'capsule chat opener')
  assertNoLetterText(payload.bubbleContent ?? '', 'capsule bubble')
})

// ── Chat line ──────────────────────────────────────────────────────────────

test('every capsule chat line is the opener plus the full letter card', () => {
  const capsule = capsuleAged(30, { title: LETTER_TITLE })
  const delivery = buildFutureCapsuleDelivery({ uiLanguage: 'zh-CN', capsule, now: NOW })
  const line = buildCapsuleChatLine(capsule, delivery)

  assert.equal(line.content, delivery.opener)
  assert.equal(line.capsuleLetter.title, LETTER_TITLE)
  assert.equal(line.capsuleLetter.body, LETTER_BODY)
  assert.equal(line.capsuleLetter.writtenAt, capsule.createdAt)
  assert.ok(line.capsuleLetter.body.includes('\n'), 'the card keeps the authored line breaks')
})

test('an untitled capsule leaves the card header to the renderer', () => {
  const capsule = capsuleAged(30)
  const delivery = buildFutureCapsuleDelivery({ uiLanguage: 'zh-CN', capsule, now: NOW })
  const line = buildCapsuleChatLine(capsule, delivery)

  assert.equal('title' in line.capsuleLetter, false)
})

// ── Inbox row ──────────────────────────────────────────────────────────────

test('the inbox row is the card header, the first 160 characters and the full letter', () => {
  const longLetter = `${'希'.repeat(400)}\n${'望'.repeat(200)}`
  const capsule = capsuleAged(30, { title: LETTER_TITLE, message: longLetter })
  const delivery = buildFutureCapsuleDelivery({ uiLanguage: 'zh-CN', capsule, now: NOW })
  const message = buildCapsuleProactiveMessage(capsule, delivery, NOW)

  assert.equal(message.title, LETTER_TITLE)
  assert.equal(message.body.length, 160)
  assert.equal(message.body, `${longLetter.slice(0, 159)}…`)
  assert.equal(message.fullBody, longLetter)
  assert.ok(message.fullBody?.includes('\n'), 'the inbox keeps the authored line breaks')
  assert.deepEqual(message.publicCopy, {
    title: '过去的你给现在的你',
    body: delivery.opener,
  })
  assert.doesNotMatch(message.body, /^「|」$/)
})

test('an untitled capsule inbox row uses the default header', () => {
  const capsule = capsuleAged(30)
  const delivery = buildFutureCapsuleDelivery({ uiLanguage: 'zh-CN', capsule, now: NOW })
  const message = buildCapsuleProactiveMessage(capsule, delivery, NOW)
  assert.equal(message.title, DEFAULT_HEADER['zh-CN'])
})

test('a ~3000 character letter is not truncated on the card and stays under the IPC budget', () => {
  const longLetter = `${'练'.repeat(1500)}\n${'习'.repeat(1500)}`
  const capsule = capsuleAged(30, { message: longLetter })
  const delivery = buildFutureCapsuleDelivery({ uiLanguage: 'zh-CN', capsule, now: NOW })
  const line = buildCapsuleChatLine(capsule, delivery)
  const message = buildCapsuleProactiveMessage(capsule, delivery, NOW.getTime())

  assert.equal(line.capsuleLetter.body, longLetter)
  assert.equal(line.capsuleLetter.body.length, 3001)
  assert.equal(message.fullBody, longLetter)
  assert.equal(message.body.length, 160)
  // The whole payload still passes the real validator.
  const validated = validateProactiveDeliveryPayload({ message, context: makeContext() })
  assert.equal(validated.message.fullBody, longLetter)
})

test('publicCopy obeys the title/body budgets and rejects an oversized pair', () => {
  const message = zhCapsuleMessage().message
  const validated = validateProactiveDeliveryPayload({ message, context: makeContext() })
  assert.deepEqual(validated.message.publicCopy, message.publicCopy)

  assert.throws(() => validateProactiveDeliveryPayload({
    message: {
      ...message,
      publicCopy: { title: message.publicCopy!.title, body: 'b'.repeat(161) },
    },
    context: makeContext(),
  }), /publicCopy\.body must be at most 160 characters/)

  assert.throws(() => validateProactiveDeliveryPayload({
    message: {
      ...message,
      publicCopy: { title: 't'.repeat(81), body: message.publicCopy!.body },
    },
    context: makeContext(),
  }), /publicCopy\.title must be at most 80 characters/)
})

function createInbox(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-capsule-copy-inbox-'))
  const store = createProactiveInboxStore({
    getStorePath: () => path.join(directory, 'proactive-inbox.json'),
    now: () => NOW.getTime(),
  })
  t.after(async () => {
    await store.flush()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return { store, directory }
}

test('the inbox persists publicCopy and drops a malformed one without losing the entry', async (t) => {
  const { store, directory } = createInbox(t)
  const { message } = zhCapsuleMessage()
  store.upsert(message)

  const listed = store.list().entries.find((entry) => entry.id === message.id)
  assert.deepEqual(listed?.publicCopy, message.publicCopy)

  // A hand-edited file with an oversized public copy keeps the row, drops the
  // outlet copy: the entry is still renderable, the bad pair is not.
  store.upsert({ ...message, id: 'capsule:bad-copy', publicCopy: { title: 't'.repeat(81), body: 'b' } })
  await store.flush()
  const reopened = createProactiveInboxStore({
    getStorePath: () => path.join(directory, 'proactive-inbox.json'),
    now: () => NOW.getTime(),
  })
  const entries = reopened.list().entries
  const bad = entries.find((entry) => entry.id === 'capsule:bad-copy')
  assert.ok(bad, 'the entry survives an unusable publicCopy')
  assert.equal('publicCopy' in bad, false)
})

// ── Chat history persistence ───────────────────────────────────────────────

test('chat history round-trips capsuleLetter and drops malformed values', () => {
  const letter = {
    title: LETTER_TITLE,
    body: LETTER_BODY,
    writtenAt: '2025-11-01T04:00:00.000Z',
  }
  const base = {
    id: 'msg-capsule',
    role: 'assistant' as const,
    content: '你300天前写给今天的信，到了。',
    createdAt: '2026-05-01T12:00:00.000Z',
  }

  const kept = normalizeChatMessage({ ...base, capsuleLetter: letter }, 0)
  assert.ok(kept)
  assert.deepEqual(kept.capsuleLetter, letter)

  // A body over the storage budget, or an unparseable stamp, drops the card.
  const oversized = normalizeChatMessage({
    ...base,
    capsuleLetter: { ...letter, body: 'x'.repeat(10001) },
  }, 1)
  assert.ok(oversized)
  assert.equal('capsuleLetter' in oversized, false)

  const badDate = normalizeChatMessage({
    ...base,
    capsuleLetter: { ...letter, writtenAt: 'not-a-date' },
  }, 2)
  assert.ok(badDate)
  assert.equal('capsuleLetter' in badDate, false)

  const emptyBody = normalizeChatMessage({
    ...base,
    capsuleLetter: { ...letter, body: '   ' },
  }, 3)
  assert.ok(emptyBody)
  assert.equal('capsuleLetter' in emptyBody, false)

  // A card without a title is valid; the renderer supplies the default.
  const untitled = normalizeChatMessage({
    ...base,
    capsuleLetter: { body: LETTER_BODY, writtenAt: letter.writtenAt },
  }, 4)
  assert.ok(untitled)
  assert.deepEqual(untitled.capsuleLetter, { body: LETTER_BODY, writtenAt: letter.writtenAt })

  // The card normalizes its stamp to canonical ISO.
  const offset = normalizeChatMessage({
    ...base,
    capsuleLetter: { ...letter, writtenAt: '2025-11-01T12:00:00+08:00' },
  }, 5)
  assert.equal(offset?.capsuleLetter?.writtenAt, '2025-11-01T04:00:00.000Z')
})

