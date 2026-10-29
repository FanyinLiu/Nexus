import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  buildTimeReminderContext,
  createTimeNoticeGate,
  formatConversationGap,
  getLocalClock,
  lastUserMessageAt,
  partOfDayForHour,
  previousUserMessageAt,
  type PartOfDay,
} from '../src/features/chat/timeAwareness.ts'
import { getChatPromptStrings } from '../src/features/chat/prompts/index.ts'
import { buildChatRequestPayload } from '../src/features/chat/systemPromptBuilder.ts'
import { buildStartupGreeting } from '../src/app/appSupport.ts'
import { loadSettings } from '../src/lib/storage.ts'
import type { ChatMessage, MemoryRecallContext } from '../src/types'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
  clear() { this.data.clear() }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: new MemoryStorage(),
      desktopPet: {
        personaLoadSoul: async () => '',
        personaLoadMemory: async () => '',
      },
    },
    configurable: true,
    writable: true,
  })
})

test('part of day covers every hour boundary', () => {
  const expected: Array<[number, PartOfDay]> = [
    [0, 'lateNight'],
    [4, 'lateNight'],
    [5, 'earlyMorning'],
    [7, 'earlyMorning'],
    [8, 'morning'],
    [11, 'morning'],
    [12, 'noon'],
    [13, 'noon'],
    [14, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [22, 'evening'],
    [23, 'lateNight'],
    [24, 'lateNight'],
    [-1, 'lateNight'],
  ]
  for (const [hour, part] of expected) {
    assert.equal(partOfDayForHour(hour), part, `hour ${hour} should be ${part}`)
  }
})

test('gap formatting separates minutes, hours, days, and the first ever chat', () => {
  const now = new Date('2026-07-13T12:00:00.000Z')
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000)
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

  assert.deepEqual(formatConversationGap(null, now), { kind: 'first' })
  assert.deepEqual(formatConversationGap('not a date', now), { kind: 'first' })
  assert.deepEqual(formatConversationGap(minutesAgo(0.5), now), { kind: 'minutes', amount: 0 })
  assert.deepEqual(formatConversationGap(minutesAgo(40), now), { kind: 'minutes', amount: 40 })
  assert.deepEqual(formatConversationGap(minutesAgo(60), now), { kind: 'hours', amount: 1 })
  assert.deepEqual(formatConversationGap(hoursAgo(3), now), { kind: 'hours', amount: 3 })
  assert.deepEqual(formatConversationGap(hoursAgo(23.5), now), { kind: 'hours', amount: 23 })
  assert.deepEqual(formatConversationGap(daysAgo(1), now), { kind: 'days', amount: 1 })
  assert.deepEqual(formatConversationGap(daysAgo(3), now), { kind: 'days', amount: 3 })
  // Clock skew should read as "just now", never as a negative gap.
  assert.deepEqual(
    formatConversationGap(new Date(now.getTime() + 5_000), now),
    { kind: 'minutes', amount: 0 },
  )
})

test('local clock honours an explicit time zone and weekday', () => {
  const instant = new Date('2026-07-13T23:30:00.000Z')

  const utc = getLocalClock(instant, 'UTC')
  assert.equal(utc.hour, 23)
  assert.equal(utc.weekday, 1)
  assert.equal(partOfDayForHour(utc.hour), 'lateNight')

  const tokyo = getLocalClock(instant, 'Asia/Tokyo')
  assert.equal(tokyo.hour, 8)
  assert.equal(tokyo.weekday, 2)
  assert.equal(partOfDayForHour(tokyo.hour), 'morning')

  const losAngeles = getLocalClock(instant, 'America/Los_Angeles')
  assert.equal(losAngeles.hour, 16)
  assert.equal(losAngeles.weekday, 1)
  assert.equal(partOfDayForHour(losAngeles.hour), 'afternoon')
})

test('a broken time zone falls back to the system clock instead of throwing', () => {
  const instant = new Date('2026-07-13T23:30:00.000Z')
  const clock = getLocalClock(instant, 'Not/AZone')
  assert.equal(clock.hour, instant.getHours())
  assert.equal(clock.weekday, instant.getDay())
})

test('return notice is granted at most once per session', () => {
  const gate = createTimeNoticeGate()
  const signal = {
    gap: { kind: 'days' as const, amount: 3 },
    partOfDay: 'morning' as const,
    isWeekend: false,
    isMonday: false,
  }

  assert.equal(gate.shouldNotice(signal), true)
  assert.equal(gate.noticed, true)
  assert.equal(gate.shouldNotice(signal), false)

  gate.reset()
  assert.equal(gate.shouldNotice({ ...signal, gap: { kind: 'minutes', amount: 5 } }), false)
  assert.equal(gate.shouldNotice({ ...signal, gap: { kind: 'minutes', amount: 5 }, partOfDay: 'lateNight' }), true)

  gate.reset()
  assert.equal(gate.shouldNotice({ ...signal, gap: { kind: 'hours', amount: 4 } }), true)
  assert.equal(gate.shouldNotice({ ...signal, gap: { kind: 'hours', amount: 4 } }), false)
})

test('weekends and Monday mornings can grant the once-per-session notice', () => {
  const weekendGate = createTimeNoticeGate()
  assert.equal(weekendGate.shouldNotice({
    gap: { kind: 'minutes', amount: 10 },
    partOfDay: 'afternoon',
    isWeekend: true,
    isMonday: false,
  }), true)

  const mondayGate = createTimeNoticeGate()
  assert.equal(mondayGate.shouldNotice({
    gap: { kind: 'minutes', amount: 10 },
    partOfDay: 'morning',
    isWeekend: false,
    isMonday: true,
  }), true)
})

test('time reminder context keeps the gap and part of day together', () => {
  const now = new Date('2026-07-13T23:30:00.000Z')
  const context = buildTimeReminderContext({
    now,
    previousUserAt: '2026-07-10T23:30:00.000Z',
    timeZone: 'Asia/Tokyo',
    gate: createTimeNoticeGate(),
  })
  assert.equal(context.partOfDay, 'morning')
  assert.deepEqual(context.gap, { kind: 'days', amount: 3 })
  assert.equal(context.isWeekend, false)
  assert.equal(context.allowNotice, true)
})

test('message helpers find the last and previous user timestamps', () => {
  const messages = [
    { role: 'user', createdAt: '2026-07-10T08:00:00.000Z' },
    { role: 'assistant', createdAt: '2026-07-10T08:01:00.000Z' },
    { role: 'user', createdAt: '2026-07-13T08:00:00.000Z' },
  ]
  assert.equal(lastUserMessageAt(messages), '2026-07-13T08:00:00.000Z')
  assert.equal(previousUserMessageAt(messages), '2026-07-10T08:00:00.000Z')
  assert.equal(previousUserMessageAt([messages[0]]), null)
  assert.equal(lastUserMessageAt([]), null)
})

test('every locale renders one time-reminder block with part of day and gap', () => {
  const locales = ['en-US', 'ja', 'ko', 'zh-CN', 'zh-TW'] as const
  for (const locale of locales) {
    const prompts = getChatPromptStrings(locale)
    const reminder = prompts.currentTimeReminder({
      dateTime: '13/07/2026, 09:07',
      partOfDay: 'morning',
      gap: { kind: 'days', amount: 3 },
      isWeekend: false,
      allowNotice: true,
    })
    assert.match(reminder, /^<system-reminder>/)
    assert.match(reminder, /<\/system-reminder>$/)
    assert.equal(reminder.match(/<system-reminder>/g)?.length, 1)
    assert.ok(prompts.timeAwarenessGuidance.length > 20)
  }
})

test('the chat request carries the time block exactly once and the guidance once', async () => {
  const now = new Date(2026, 6, 13, 9, 7, 0, 0)
  const previous = new Date(now.getTime() - 3 * 86_400_000)
  const settings = { ...loadSettings(), uiLanguage: 'en-US' as const }
  const history: ChatMessage[] = [
    { id: 'u1', role: 'user', content: 'I am back', createdAt: previous.toISOString() },
    { id: 'a1', role: 'assistant', content: 'Welcome back.', createdAt: previous.toISOString() },
    { id: 'u2', role: 'user', content: 'How are you?', createdAt: now.toISOString() },
  ]
  const memoryContext: MemoryRecallContext = {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed: 'keyword',
    vectorSearchAvailable: false,
  }

  const payload = await buildChatRequestPayload(settings, history, memoryContext, { currentTime: now })
  const allMessages = payload.messages.map((message) => String(message.content)).join('\n')
  const latestUser = String(payload.messages.findLast((message) => message.role === 'user')?.content ?? '')
  const prompts = getChatPromptStrings('en-US')

  assert.equal(allMessages.match(/<system-reminder>/g)?.length, 1)
  assert.ok(latestUser.startsWith('<system-reminder>'))
  assert.match(latestUser, /Part of day: morning/)
  assert.match(latestUser, /Previous user message: 3 days ago/)
  assert.match(latestUser, /How are you\?$/)

  const system = String(payload.messages[0]?.content ?? '')
  assert.equal(system.split(prompts.timeAwarenessGuidance).length - 1, 1)
})

test('a first-ever chat says so instead of inventing a gap', async () => {
  const now = new Date(2026, 6, 13, 9, 7, 0, 0)
  const settings = { ...loadSettings(), uiLanguage: 'en-US' as const }
  const history: ChatMessage[] = [
    { id: 'u1', role: 'user', content: 'hello', createdAt: now.toISOString() },
  ]
  const memoryContext: MemoryRecallContext = {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed: 'keyword',
    vectorSearchAvailable: false,
  }

  const payload = await buildChatRequestPayload(settings, history, memoryContext, { currentTime: now })
  const latestUser = String(payload.messages.findLast((message) => message.role === 'user')?.content ?? '')
  assert.match(latestUser, /This is the first message ever/)
  assert.doesNotMatch(latestUser, /Previous user message:/)
})

test('startup greeting copy changes with the conversation gap', () => {
  const now = new Date('2026-07-13T12:00:00.000Z')
  const settings = loadSettings()
  const fakeTi: Parameters<typeof buildStartupGreeting>[2] = (key, params) => (
    `${key}|${String(params?.gap ?? params?.count ?? '')}`
  )

  const first = buildStartupGreeting(settings, [], fakeTi, { now, lastUserMessageAt: null })
  assert.match(first.text, /startup_greeting\.gap\.first/)

  const minutes = buildStartupGreeting(settings, [], fakeTi, {
    now,
    lastUserMessageAt: new Date(now.getTime() - 40 * 60_000).toISOString(),
  })
  assert.match(minutes.text, /startup_greeting\.gap\.minutes/)

  const hours = buildStartupGreeting(settings, [], fakeTi, {
    now,
    lastUserMessageAt: new Date(now.getTime() - 5 * 3_600_000).toISOString(),
  })
  assert.match(hours.text, /startup_greeting\.gap\.hours/)

  const days = buildStartupGreeting(settings, [], fakeTi, {
    now,
    lastUserMessageAt: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
  })
  assert.match(days.text, /startup_greeting\.gap\.days/)
})
