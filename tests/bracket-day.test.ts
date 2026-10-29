import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decideBracket, type BracketDecisionInput } from '../src/features/proactive/bracketScheduler.ts'
import {
  extractTomorrowTopic,
  findTodayEventTopic,
  latestTomorrowTopic,
  morningCallbackTopic,
} from '../src/features/proactive/bracketTopic.ts'
import {
  buildBracketMessage,
  buildBracketNotification,
  getBracketTemplates,
} from '../src/features/proactive/bracketCopy.ts'
import type { MemoryItem } from '../src/types/memory.ts'
import type { UiLanguage } from '../src/types/app.ts'

const LOCALES: UiLanguage[] = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']

// Local-time constructors keep the assertions independent of the machine's
// timezone. The scheduler itself works in local hours.
function local(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

// Equal bounds disable quiet hours; individual gating tests override them.
const QUIET_OFF = { quietStart: 0, quietEnd: 0 }

function base(overrides: Partial<BracketDecisionInput> = {}): BracketDecisionInput {
  return {
    enabled: true,
    nowMs: local(2026, 4, 25, 8),
    lastMorningFiredMs: null,
    lastEveningFiredMs: null,
    relationshipType: 'friend',
    ...QUIET_OFF,
    ...overrides,
  }
}

test('morning is eligible from the first open after 05:00', () => {
  const early = decideBracket(base({ nowMs: local(2026, 4, 25, 5, 5) }))
  assert.equal(early.shouldFire, true)
  assert.equal(early.shouldFire && early.bracket, 'morning')

  const beforeFive = decideBracket(base({ nowMs: local(2026, 4, 25, 4, 59) }))
  assert.equal(beforeFive.shouldFire, false)
  assert.equal(beforeFive.reason, 'outside_windows')
})

test('morning fires at most once per local day and again after midnight', () => {
  const first = local(2026, 4, 25, 6, 10)
  const again = decideBracket(base({
    nowMs: local(2026, 4, 25, 11, 50),
    lastMorningFiredMs: first,
  }))
  assert.equal(again.shouldFire, false)
  assert.equal(again.reason, 'morning_already_fired_today')

  const nextDay = decideBracket(base({
    nowMs: local(2026, 4, 26, 5, 10),
    lastMorningFiredMs: first,
  }))
  assert.equal(nextDay.shouldFire, true)
})

test('a fire just before local midnight does not count as today', () => {
  const lateYesterday = local(2026, 4, 24, 23, 50)
  const decision = decideBracket(base({
    nowMs: local(2026, 4, 25, 5, 30),
    lastMorningFiredMs: lateYesterday,
  }))
  assert.equal(decision.shouldFire, true)
  assert.equal(decision.shouldFire && decision.bracket, 'morning')
})

test('evening fires once in its own window and a second time only next day', () => {
  const evening = local(2026, 4, 25, 21)
  const first = decideBracket(base({ nowMs: evening, lastMorningFiredMs: local(2026, 4, 25, 8) }))
  assert.equal(first.shouldFire, true)
  assert.equal(first.shouldFire && first.bracket, 'evening')

  const second = decideBracket(base({
    nowMs: local(2026, 4, 25, 22),
    lastMorningFiredMs: local(2026, 4, 25, 8),
    lastEveningFiredMs: evening,
  }))
  assert.equal(second.shouldFire, false)
  assert.equal(second.reason, 'evening_already_fired_today')
})

test('busy, typing, fullscreen, away, quiet hours, pause and the switch all gate', () => {
  assert.equal(decideBracket(base({ busy: true })).reason, 'busy')
  assert.equal(decideBracket(base({ userTyping: true })).reason, 'typing')
  assert.equal(decideBracket(base({ fullscreen: true })).reason, 'fullscreen')
  assert.equal(decideBracket(base({ focusState: 'away' })).reason, 'not_around')
  assert.equal(decideBracket(base({ focusState: 'locked' })).reason, 'not_around')
  assert.equal(decideBracket(base({
    nowMs: local(2026, 4, 25, 21),
    quietStart: 20,
    quietEnd: 23,
  })).reason, 'quiet_hours')
  assert.equal(decideBracket(base({ memoryPaused: true })).reason, 'memory_paused')
  assert.equal(decideBracket(base({ enabled: false })).reason, 'disabled')
})

test('a recent chat or another proactive open defers the bracket', () => {
  const recent = decideBracket(base({ recentChatActivity: true }))
  assert.equal(recent.shouldFire, false)
  assert.equal(recent.reason, 'recent_chat')

  const otherOpen = decideBracket(base({
    nowMs: local(2026, 4, 25, 21),
    lastOpenClaimAtMs: local(2026, 4, 25, 20, 30),
  }))
  assert.equal(otherOpen.shouldFire, false)
  assert.equal(otherOpen.reason, 'other_open_recent')

  // The claim window expires, so the bracket can still run later.
  const later = decideBracket(base({
    nowMs: local(2026, 4, 25, 22, 30),
    lastOpenClaimAtMs: local(2026, 4, 25, 20, 30),
  }))
  assert.equal(later.shouldFire, true)
})

test('priority on the same open: follow-up beats letter beats bracket', () => {
  const followUp = decideBracket(base({
    eventFollowUpDue: true,
    letterDue: true,
  }))
  assert.equal(followUp.shouldFire, false)
  assert.equal(followUp.reason, 'event_follow_up_pending')

  const letter = decideBracket(base({ letterDue: true }))
  assert.equal(letter.shouldFire, false)
  assert.equal(letter.reason, 'letter_pending')
})

test('the evening exchange becomes a short morning callback', () => {
  assert.equal(
    extractTomorrowTopic('今天挺累的，明天要早起开会，得早点睡'),
    '今天要早起开会',
  )
  assert.equal(
    extractTomorrowTopic('Today was fine. Tomorrow I have an early meeting.'),
    'Today I have an early meeting',
  )
  assert.equal(extractTomorrowTopic('今天很普通，没什么特别的'), null)
})

test('latestTomorrowTopic only reads user turns after the evening prompt', () => {
  const after = local(2026, 4, 25, 21)
  const messages = [
    { role: 'assistant' as const, content: 'Anything early tomorrow?', createdAt: new Date(local(2026, 4, 25, 20, 59)).toISOString() },
    { role: 'user' as const, content: '明天要早起开会', createdAt: new Date(local(2026, 4, 25, 21, 4)).toISOString() },
    { role: 'assistant' as const, content: '好，我记着。', createdAt: new Date(local(2026, 4, 25, 21, 5)).toISOString() },
    { role: 'user' as const, content: '明天还想顺路买杯咖啡', createdAt: new Date(local(2026, 4, 25, 21, 8)).toISOString() },
  ]
  const picked = latestTomorrowTopic(messages, after)
  assert.deepEqual(picked, {
    topic: '今天还想顺路买杯咖啡',
    atMs: local(2026, 4, 25, 21, 8),
  })
})

function eventMemory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'loop-interview',
    content: '明天上午十点去医院复查',
    category: 'goal',
    kind: 'open_loop',
    loopKind: 'event',
    loopStatus: 'open',
    loopDueAt: new Date(local(2026, 4, 25, 10)).toISOString(),
    loopDueText: '明天上午十点',
    createdAt: new Date(local(2026, 4, 24, 18)).toISOString(),
    updatedAt: new Date(local(2026, 4, 24, 18)).toISOString(),
    ...overrides,
  }
}

test('the morning prefers last night over a dated event, then falls back', () => {
  const nowMs = local(2026, 4, 25, 7)
  const memories = [eventMemory()]
  const evening = morningCallbackTopic({
    eveningTopic: '今天要早起开会',
    eveningTopicAtMs: local(2026, 4, 24, 22, 30),
  }, memories, nowMs)
  assert.deepEqual(evening, { kind: 'evening', topic: '今天要早起开会' })

  const fallback = morningCallbackTopic({}, memories, nowMs)
  assert.deepEqual(fallback, { kind: 'event', topic: '去医院复查' })

  const stale = morningCallbackTopic({
    eveningTopic: '今天要早起开会',
    eveningTopicAtMs: local(2026, 4, 23, 22, 30),
  }, memories, nowMs)
  assert.deepEqual(stale, { kind: 'event', topic: '去医院复查' })
})

test('findTodayEventTopic ignores other days and non-event loops', () => {
  assert.equal(findTodayEventTopic([eventMemory()], local(2026, 4, 26, 7)), null)
  assert.equal(findTodayEventTopic([
    eventMemory({ loopKind: 'commitment' }),
  ], local(2026, 4, 25, 7)), null)
})

test('every locale has a greeting, event callback and tomorrow question', () => {
  for (const locale of LOCALES) {
    const t = getBracketTemplates(locale)
    assert.ok(t.morningGreeting.length > 0, `${locale} morning greeting`)
    assert.ok(t.eveningGreeting.length > 0, `${locale} evening greeting`)
    assert.ok(t.morningEventCallback.includes('{topic}'), `${locale} event callback placeholder`)
    assert.ok(t.eveningTomorrowPrompt.length > 0, `${locale} tomorrow prompt`)
  }
})

test('the morning event callback names the dated event', () => {
  const out = buildBracketNotification({
    uiLanguage: 'zh-CN',
    companionName: 'X',
    bracket: 'morning',
    todayEventTopic: '去医院复查',
  })
  assert.match(out.body, /去医院复查/)
  assert.match(out.body, /今天/)
})

test('the chat version adds a greeting and the evening asks about tomorrow', () => {
  const morning = buildBracketMessage({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'morning',
    previousEveningTopic: 'today I have an early meeting',
    randomFn: () => 0,
  })
  assert.match(morning.body, /^Good morning\./)
  assert.match(morning.body, /today I have an early meeting/)

  const evening = buildBracketMessage({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'evening',
    randomFn: () => 0,
  })
  assert.match(evening.body, /^Evening\./)
  assert.match(evening.body, /Anything early tomorrow\?/)

  const notification = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'evening',
    randomFn: () => 0,
  })
  assert.doesNotMatch(notification.body, /^Evening\./)
})
