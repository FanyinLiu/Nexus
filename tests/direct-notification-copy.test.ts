import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  AGENDA_NOTIFICATION_WHAT_MAX,
  bracketNotificationBody,
  bracketNotificationKind,
  buildAgendaNotification,
  letterNotificationBody,
  truncateAgendaWhat,
} from '../src/features/proactive/directNotificationCopy.ts'
import type { BracketNotificationKind } from '../src/features/proactive/directNotificationCopy.ts'
import { buildBracketMessage, buildBracketNotification } from '../src/features/proactive/bracketCopy.ts'
import type { BracketCallback } from '../src/features/proactive/bracketCopy.ts'
import { buildLoopOutreach } from '../src/features/memory/loopOutreach.ts'
import { deliverDueOpenArc } from '../src/features/arc/openArcProactiveMessage.ts'
import type {
  DeliverDueOpenArcDeps,
  OpenArcDeliveryText,
} from '../src/features/arc/openArcProactiveMessage.ts'
import type { OpenArcRecord } from '../src/features/arc/openArcStore.ts'
import {
  buildCapsuleProactiveMessage,
  deliverDueCapsule,
} from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import type { DeliverDueCapsuleDeps } from '../src/features/futureCapsule/capsuleProactiveMessage.ts'
import { buildFutureCapsuleDelivery } from '../src/features/futureCapsule/futureCapsuleDelivery.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { ensureLocaleLoaded, t } from '../src/i18n/runtime.ts'
import type { DeliveryContext } from '../shared/proactiveDelivery.js'
import type { AppLocale } from '../src/types/i18n.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const LOCALES: AppLocale[] = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']
const NOW = 1_700_000_000_000

// Natural seed data: these are exactly the kind of strings that must never
// reach a lock screen.
const MEMORY_TEXT = '周四下午三点在国贸和小林对一下季度方案'
const EVENING_TOPIC = '搬家的事'
const TODAY_EVENT = '去医院复查'
const ERRAND_PROMPT = '帮我查一下下周去杭州的高铁'
const ERRAND_RESULT = 'G7311 08:05 出发，11:12 到杭州东'
const LETTER_GREETING = '亲爱的你，这周辛苦了。'
const LETTER_BODY = '这周你完成了季度方案，也去看了房子。'
const ARC_THEME = '要不要换工作'

// ── Console capture ────────────────────────────────────────────────────────

type ConsoleOutput = string[]

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: ConsoleOutput }> {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }
  const output: ConsoleOutput = []
  const record = (...args: unknown[]) => {
    output.push(args.map((value) => String(value)).join(' '))
  }
  console.log = record
  console.info = record
  console.warn = record
  console.error = record
  console.debug = record
  try {
    const result = await fn()
    return { result, output }
  } finally {
    console.log = original.log
    console.info = original.info
    console.warn = original.warn
    console.error = original.error
    console.debug = original.debug
  }
}

function assertNoSecret(output: ConsoleOutput, ...secrets: string[]) {
  for (const line of output) {
    for (const secret of secrets) {
      assert.equal(line.includes(secret), false, `console output leaked ${JSON.stringify(secret)}: ${line}`)
    }
  }
}

function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

// ── truncateAgendaWhat ─────────────────────────────────────────────────────

test('truncateAgendaWhat keeps exactly the 20-code-point budget', () => {
  assert.equal(AGENDA_NOTIFICATION_WHAT_MAX, 20)

  const exactly = 'a'.repeat(20)
  assert.equal(truncateAgendaWhat(exactly), exactly)

  const over = 'a'.repeat(21)
  assert.equal(truncateAgendaWhat(over), `${'a'.repeat(20)}…`)
})

test('truncateAgendaWhat counts CJK code points, not UTF-16 units', () => {
  const exactly = '记'.repeat(20)
  assert.equal(truncateAgendaWhat(exactly), exactly)

  const over = '记'.repeat(21)
  const result = truncateAgendaWhat(over)
  assert.equal(result, `${'记'.repeat(20)}…`)
  assert.equal(Array.from(result).length, 21)
})

test('truncateAgendaWhat never splits an astral character', () => {
  const exactly = '😀'.repeat(20)
  assert.equal(truncateAgendaWhat(exactly), exactly)

  const over = '😀'.repeat(21)
  const result = truncateAgendaWhat(over)
  assert.equal(result, `${'😀'.repeat(20)}…`)
  assert.equal(Array.from(result).length, 21)
  assert.equal(result.slice(0, 40), '😀'.repeat(20))
  assert.equal(hasLoneSurrogate(result), false)

  const mixed = `${'记'.repeat(10)}${'😀'.repeat(11)}`
  const mixedResult = truncateAgendaWhat(mixed)
  assert.equal(mixedResult, `${'记'.repeat(10)}${'😀'.repeat(10)}…`)
  assert.equal(Array.from(mixedResult).length, 21)
  assert.equal(hasLoneSurrogate(mixedResult), false)
})

test('truncateAgendaWhat trims leading and trailing whitespace before counting', () => {
  assert.equal(truncateAgendaWhat('  一件小事  '), '一件小事')
  assert.equal(truncateAgendaWhat(`${'  '}${'a'.repeat(21)}  `), `${'a'.repeat(20)}…`)
})

// ── Agenda notification ────────────────────────────────────────────────────

test('buildAgendaNotification body is the reminder what and nothing else', async () => {
  await ensureLocaleLoaded('zh-CN')
  const memory: MemoryItem = {
    id: 'memory-quarterly',
    content: MEMORY_TEXT,
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    loopKind: 'commitment',
    loopDueAt: new Date(2026, 9, 22, 15, 0, 0, 0).toISOString(),
    loopDueText: '周四下午三点',
    loopPlace: '国贸',
    createdAt: '2026-10-19T08:00:00.000Z',
  }
  const outreach = buildLoopOutreach(memory, new Date(2026, 9, 20, 10, 0, 0, 0).getTime(), t)
  assert.ok(outreach)
  assert.equal(outreach.why.summary, MEMORY_TEXT)

  const { result, output } = await captureConsole(async () => buildAgendaNotification({
    title: t('proactive.loop.notify_title', undefined, 'zh-CN'),
    what: outreach.why.summary,
  }))

  assert.deepEqual(result, { title: '提醒', body: MEMORY_TEXT })
  assert.equal(result.body, truncateAgendaWhat(outreach.why.summary))
  // No template, place suffix or clock text is appended to the what.
  assert.equal(result.body.includes('办好了吗'), false)
  assert.equal(result.body.includes('要我前一晚提醒你吗'), false)
  assert.equal(result.body.includes('，国贸'), false)
  assert.equal(result.body.includes('10月22日'), false)
  assertNoSecret(output, MEMORY_TEXT, truncateAgendaWhat(MEMORY_TEXT))
})

test('buildAgendaNotification uses the English reminder title and clips long what', async () => {
  await ensureLocaleLoaded('en-US')
  const longWhat = 'x'.repeat(30)
  const result = buildAgendaNotification({
    title: t('proactive.loop.notify_title', undefined, 'en-US'),
    what: longWhat,
  })
  assert.equal(result.title, 'Reminder')
  assert.equal(result.body, `${'x'.repeat(20)}…`)
})

// ── Locale strings ─────────────────────────────────────────────────────────

const EXPECTED_NOTIFY_COPY: Record<AppLocale, Record<string, string>> = {
  'zh-CN': {
    'proactive.notify.bracket_last_night': '昨晚聊的事，我还记着。',
    'proactive.notify.bracket_today': '今天有件事别忘了。',
    'proactive.notify.bracket_errand': '昨晚帮你查的东西整理好了。',
    'proactive.notify.letter_ready': '这周的信写好了。',
    'proactive.notify.open_arc_fallback': '上次你说的那件事，后来怎么样了？',
  },
  'zh-TW': {
    'proactive.notify.bracket_last_night': '昨晚聊的事，我還記著。',
    'proactive.notify.bracket_today': '今天有件事別忘了。',
    'proactive.notify.bracket_errand': '昨晚幫你查的東西整理好了。',
    'proactive.notify.letter_ready': '這週的信寫好了。',
    'proactive.notify.open_arc_fallback': '上次你說的那件事，後來怎麼樣了？',
  },
  'en-US': {
    'proactive.notify.bracket_last_night': 'Still thinking about what we talked about last night.',
    'proactive.notify.bracket_today': "There's something on today, don't forget.",
    'proactive.notify.bracket_errand': 'I finished looking into that thing from last night.',
    'proactive.notify.letter_ready': "This week's letter is ready.",
    'proactive.notify.open_arc_fallback': 'How did that thing you mentioned last time turn out?',
  },
  ja: {
    'proactive.notify.bracket_last_night': '昨日の夜の話、まだ覚えてるよ。',
    'proactive.notify.bracket_today': '今日、忘れちゃいけないことがあるよ。',
    'proactive.notify.bracket_errand': '昨日の夜頼まれたこと、まとめておいたよ。',
    'proactive.notify.letter_ready': '今週の手紙、書けたよ。',
    'proactive.notify.open_arc_fallback': 'この前話してたこと、その後どうなった？',
  },
  ko: {
    'proactive.notify.bracket_last_night': '어젯밤에 했던 얘기, 아직 기억하고 있어요.',
    'proactive.notify.bracket_today': '오늘 잊으면 안 되는 일이 있어요.',
    'proactive.notify.bracket_errand': '어젯밤 부탁한 거 정리해 뒀어요.',
    'proactive.notify.letter_ready': '이번 주 편지 다 썼어요.',
    'proactive.notify.open_arc_fallback': '지난번에 말했던 일, 그 뒤로 어떻게 됐어요?',
  },
}

test('all five new notification keys match the literals in all five locales', async () => {
  for (const locale of LOCALES) {
    await ensureLocaleLoaded(locale)
    const expected = EXPECTED_NOTIFY_COPY[locale]
    assert.deepEqual(
      {
        'proactive.notify.bracket_last_night': t('proactive.notify.bracket_last_night', undefined, locale),
        'proactive.notify.bracket_today': t('proactive.notify.bracket_today', undefined, locale),
        'proactive.notify.bracket_errand': t('proactive.notify.bracket_errand', undefined, locale),
        'proactive.notify.letter_ready': t('proactive.notify.letter_ready', undefined, locale),
        'proactive.notify.open_arc_fallback': t('proactive.notify.open_arc_fallback', undefined, locale),
      },
      expected,
      locale,
    )
  }
})

// ── Bracket ────────────────────────────────────────────────────────────────

test('buildBracketNotification reports which callback supplied the body', () => {
  const eveningCallback = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'morning',
    previousEveningTopic: EVENING_TOPIC,
  })
  assert.equal(eveningCallback.callback, 'evening')
  assert.ok(eveningCallback.body.includes(EVENING_TOPIC))

  const eventCallback = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'morning',
    todayEventTopic: TODAY_EVENT,
  })
  assert.equal(eventCallback.callback, 'event')
  assert.ok(eventCallback.body.includes(TODAY_EVENT))

  const openQuestion = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'morning',
    randomFn: () => 0,
  })
  assert.equal(openQuestion.callback, null)

  const evening = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'evening',
    randomFn: () => 0,
  })
  assert.equal(evening.callback, null)
})

test('bracketNotificationBody substitutes a fixed line and never keeps the topic', async () => {
  await ensureLocaleLoaded('zh-CN')
  await ensureLocaleLoaded('en-US')
  const currentBody = `昨晚你提到「${EVENING_TOPIC}」。今天也一起加油。`
  const errandBody = `帮你查了：${ERRAND_PROMPT}。${ERRAND_RESULT}`

  const { output } = await captureConsole(async () => {
    assert.equal(bracketNotificationBody('zh-CN', 'last_night', currentBody), '昨晚聊的事，我还记着。')
    assert.equal(bracketNotificationBody('zh-CN', 'today', `今天有「${TODAY_EVENT}」，我记着呢。`), '今天有件事别忘了。')
    assert.equal(bracketNotificationBody('zh-CN', 'errand', errandBody), '昨晚帮你查的东西整理好了。')
    assert.equal(bracketNotificationBody('en-US', 'last_night', currentBody), 'Still thinking about what we talked about last night.')
    assert.equal(bracketNotificationBody('en-US', 'today', currentBody), "There's something on today, don't forget.")
    assert.equal(bracketNotificationBody('en-US', 'errand', errandBody), 'I finished looking into that thing from last night.')
  })

  for (const kind of ['last_night', 'today', 'errand'] as const) {
    const body = bracketNotificationBody('en-US', kind, currentBody)
    assert.equal(body.includes(EVENING_TOPIC), false)
    assert.equal(body.includes(ERRAND_PROMPT), false)
    assert.equal(body.includes(ERRAND_RESULT), false)
    assert.equal(body.includes(TODAY_EVENT), false)
  }
  assertNoSecret(output, EVENING_TOPIC, TODAY_EVENT, ERRAND_PROMPT, ERRAND_RESULT)
})

test('bracketNotificationBody returns the current body for an open question or evening', () => {
  const currentBody = 'What’s the first thing you noticed this morning?'
  assert.equal(bracketNotificationBody('en-US', null, currentBody), currentBody)
})

test('bracketNotificationKind truth table: errand wins, then evening, then event', () => {
  const cases: Array<{
    errandDelivered: boolean
    callback: BracketCallback
    expected: BracketNotificationKind
  }> = [
    { errandDelivered: true, callback: 'evening', expected: 'errand' },
    { errandDelivered: true, callback: 'event', expected: 'errand' },
    { errandDelivered: true, callback: null, expected: 'errand' },
    { errandDelivered: false, callback: 'evening', expected: 'last_night' },
    { errandDelivered: false, callback: 'event', expected: 'today' },
    { errandDelivered: false, callback: null, expected: null },
  ]

  for (const { errandDelivered, callback, expected } of cases) {
    assert.equal(
      bracketNotificationKind({ errandDelivered, callback }),
      expected,
      `errandDelivered=${errandDelivered} callback=${String(callback)}`,
    )
  }
})

test('bracketNotificationKind chains buildBracketMessage to the fixed OS line', async () => {
  await ensureLocaleLoaded('zh-CN')
  await ensureLocaleLoaded('en-US')

  const buildMorning = (
    uiLanguage: 'zh-CN' | 'en-US',
    input: { previousEveningTopic?: string; todayEventTopic?: string },
  ) => buildBracketMessage({
    uiLanguage,
    companionName: 'X',
    bracket: 'morning',
    previousEveningTopic: input.previousEveningTopic ?? null,
    todayEventTopic: input.todayEventTopic ?? null,
    randomFn: () => 0,
  })

  for (const uiLanguage of ['zh-CN', 'en-US'] as const) {
    const lastNight = buildMorning(uiLanguage, { previousEveningTopic: EVENING_TOPIC })
    const lastNightBody = bracketNotificationBody(
      uiLanguage,
      bracketNotificationKind({ errandDelivered: false, callback: lastNight.callback }),
      lastNight.body,
    )
    assert.equal(lastNightBody, t('proactive.notify.bracket_last_night', undefined, uiLanguage))
    assert.equal(lastNightBody.includes(EVENING_TOPIC), false)

    const today = buildMorning(uiLanguage, { todayEventTopic: TODAY_EVENT })
    const todayBody = bracketNotificationBody(
      uiLanguage,
      bracketNotificationKind({ errandDelivered: false, callback: today.callback }),
      today.body,
    )
    assert.equal(todayBody, t('proactive.notify.bracket_today', undefined, uiLanguage))
    assert.equal(todayBody.includes(TODAY_EVENT), false)

    const errand = buildMorning(uiLanguage, { previousEveningTopic: EVENING_TOPIC })
    const errandBody = bracketNotificationBody(
      uiLanguage,
      bracketNotificationKind({ errandDelivered: true, callback: errand.callback }),
      errand.body,
    )
    assert.equal(errandBody, t('proactive.notify.bracket_errand', undefined, uiLanguage))
    assert.equal(errandBody.includes(EVENING_TOPIC), false)

    const open = buildMorning(uiLanguage, {})
    assert.equal(open.callback, null)
    const openBody = bracketNotificationBody(
      uiLanguage,
      bracketNotificationKind({ errandDelivered: false, callback: open.callback }),
      open.body,
    )
    assert.equal(openBody, open.body)
  }
})

// ── Letter ─────────────────────────────────────────────────────────────────

test('letterNotificationBody is the fixed line, never the letter greeting or body', async () => {
  await ensureLocaleLoaded('en-US')
  await ensureLocaleLoaded('zh-CN')
  const { result, output } = await captureConsole(async () => letterNotificationBody('en-US'))
  assert.equal(result, "This week's letter is ready.")
  assert.equal(result.includes(LETTER_GREETING), false)
  assert.equal(result.includes(LETTER_BODY), false)
  assert.equal(letterNotificationBody('zh-CN'), '这周的信写好了。')
  assertNoSecret(output, LETTER_GREETING, LETTER_BODY)
})

// ── Fallbacks ──────────────────────────────────────────────────────────────

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

const ARC: OpenArcRecord = {
  id: 'arc-1',
  theme: ARC_THEME,
  startedAt: '2026-01-01T08:00:00.000Z',
  checkInDays: [3, 5],
  status: 'open',
  checkInsFired: [],
}

const ARC_DELIVERY: OpenArcDeliveryText = {
  title: 'A thread you opened',
  body: `Nexus held this for you: "${ARC_THEME}". Three days in — is it still sitting with you?`,
}

function makeOpenArcDeps(overrides: Partial<DeliverDueOpenArcDeps> = {}): DeliverDueOpenArcDeps {
  return {
    arc: ARC,
    delivery: ARC_DELIVERY,
    uiLanguage: 'en-US',
    milestoneDay: 3,
    now: NOW,
    useLegacyPath: false,
    deliver: async () => ({ rule: 4, outlets: ['inbox', 'bubble'] }),
    showNotification: async () => undefined,
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async () => undefined,
    recordCheckInFired: () => undefined,
    isStopped: () => false,
    ...overrides,
  }
}

test('open-arc routing error falls back to one fixed-line notification without the theme', async () => {
  await ensureLocaleLoaded('en-US')
  const notifications: OpenArcDeliveryText[] = []

  const { output } = await captureConsole(async () => {
    const result = await deliverDueOpenArc(makeOpenArcDeps({
      deliver: async () => { throw new Error('bridge down') },
      showNotification: async (payload) => { notifications.push(payload) },
    }))
    assert.deepEqual(result, { path: 'fallback' })
  })

  assert.deepEqual(notifications, [{
    title: ARC_DELIVERY.title,
    body: 'How did that thing you mentioned last time turn out?',
  }])
  const serialized = JSON.stringify(notifications)
  assert.equal(serialized.includes(ARC_THEME), false)
  assertNoSecret(output, ARC_THEME)
})

test('open-arc legacy path sends the same fixed-line notification', async () => {
  await ensureLocaleLoaded('en-US')
  const notifications: OpenArcDeliveryText[] = []
  const result = await deliverDueOpenArc(makeOpenArcDeps({
    useLegacyPath: true,
    showNotification: async (payload) => { notifications.push(payload) },
  }))

  assert.deepEqual(result, { path: 'legacy' })
  assert.deepEqual(notifications, [{
    title: ARC_DELIVERY.title,
    body: 'How did that thing you mentioned last time turn out?',
  }])
  assert.equal(JSON.stringify(notifications).includes(ARC_THEME), false)
})

const CAPSULE: FutureCapsuleRecord = {
  id: 'capsule-1',
  message: LETTER_BODY,
  createdAt: '2026-01-01T08:00:00.000Z',
  scheduledFor: '2026-02-01',
  status: 'pending',
}

function buildCapsuleFixture() {
  const delivery = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    capsule: CAPSULE,
    now: new Date('2026-02-01T12:00:00.000Z'),
  })
  const message = buildCapsuleProactiveMessage(CAPSULE, delivery, NOW)
  return { delivery, message, publicCopy: message.publicCopy }
}

function makeCapsuleDeps(overrides: Partial<DeliverDueCapsuleDeps> = {}): DeliverDueCapsuleDeps {
  const { delivery } = buildCapsuleFixture()
  return {
    capsule: CAPSULE,
    delivery,
    now: NOW,
    useLegacyPath: false,
    deliver: async () => ({ rule: 4, outlets: ['inbox', 'bubble'] }),
    showNotification: async () => undefined,
    buildContext: () => makeContext(),
    preferences: {
      quietStart: 22,
      quietEnd: 8,
      desktopAwarenessAllowed: true,
      awayNotificationsEnabled: true,
    },
    pushChatLine: async () => undefined,
    markDelivered: () => undefined,
    isStopped: () => false,
    ...overrides,
  }
}

test('capsule routing error falls back to the message publicCopy, never the letter', async () => {
  await ensureLocaleLoaded('en-US')
  const { publicCopy } = buildCapsuleFixture()
  assert.ok(publicCopy)
  const notifications: Array<{ title: string; body: string }> = []

  const { output } = await captureConsole(async () => {
    const result = await deliverDueCapsule(makeCapsuleDeps({
      deliver: async () => { throw new Error('bridge down') },
      showNotification: async (payload) => { notifications.push(payload) },
    }))
    assert.deepEqual(result, { path: 'fallback' })
  })

  assert.deepEqual(notifications, [{ title: publicCopy.title, body: publicCopy.body }])
  const serialized = JSON.stringify(notifications)
  assert.equal(serialized.includes(LETTER_BODY), false)
  assert.equal(serialized.includes(LETTER_GREETING), false)
  assertNoSecret(output, LETTER_BODY, LETTER_GREETING)
})

test('capsule legacy path sends the same publicCopy notification', async () => {
  await ensureLocaleLoaded('en-US')
  const { publicCopy } = buildCapsuleFixture()
  assert.ok(publicCopy)
  const notifications: Array<{ title: string; body: string }> = []

  const result = await deliverDueCapsule(makeCapsuleDeps({
    useLegacyPath: true,
    showNotification: async (payload) => { notifications.push(payload) },
  }))

  assert.deepEqual(result, { path: 'legacy' })
  assert.deepEqual(notifications, [{ title: publicCopy.title, body: publicCopy.body }])
  assert.equal(JSON.stringify(notifications).includes(LETTER_BODY), false)
})

// ── Source contracts ───────────────────────────────────────────────────────

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('useProactiveAgenda builds the notification from buildAgendaNotification, not `body: text`', () => {
  const source = readSource('../src/hooks/useProactiveAgenda.ts')
  assert.match(source, /buildAgendaNotification\(\{/)
  assert.match(source, /what:\s*outreach\.why\.summary/)
  assert.doesNotMatch(source, /body:\s*text\b/)
})

test('useBracketScheduler hands the computed notification body to the OS toast', () => {
  const source = readSource('../src/hooks/useBracketScheduler.ts')
  assert.match(source, /bracketNotificationBody\(s\.uiLanguage, notificationKind, result\.body\)/)
  assert.match(
    source,
    /showProactiveNotification\?\.\(\{[\s\S]*?body:\s*notificationBody/,
  )
  assert.doesNotMatch(
    source,
    /showProactiveNotification\?\.\(\{[\s\S]{0,200}?body,\s*\n/,
  )
})

test('useBracketScheduler derives the notification kind through bracketNotificationKind', () => {
  const source = readSource('../src/hooks/useBracketScheduler.ts')
  assert.match(
    source,
    /bracketNotificationKind\(\{ errandDelivered: deliveredErrandId !== null, callback: result\.callback \}\)/,
  )

  // The mapping itself must stay literal-free: swapping or dropping a branch
  // belongs in the pure function, not in the hook.
  const kindMapping = source.match(/const notificationKind =[\s\S]*?\n\s*const notificationBody/)?.[0] ?? ''
  assert.doesNotMatch(kindMapping, /'last_night'|'today'|'errand'/)
  assert.doesNotMatch(source, /'last_night'|'today'/)
})

test('useLetterScheduler sends the fixed letter line, not parsed.greeting', () => {
  const source = readSource('../src/hooks/useLetterScheduler.ts')
  assert.match(source, /body:\s*letterNotificationBody\(s\.uiLanguage\)/)
  assert.doesNotMatch(source, /body:\s*parsed\.greeting\b/)
})
