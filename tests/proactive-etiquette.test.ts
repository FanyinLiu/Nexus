import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  PROACTIVE_REPEAT_THRESHOLD,
  PROACTIVE_SILENCE_STOP_MS,
  admitProactiveMessage,
  emptyProactiveEtiquetteState,
  evaluateProactiveMessage,
  isResumeMessagesPhrase,
  isTooSimilar,
  loadProactiveEtiquetteState,
  parseLeaveMeAlone,
  proactiveBackoffGapMs,
  proactiveBudgetCap,
  proactiveMessagePriority,
  recordProactiveUserMessage,
  saveProactiveEtiquetteState,
  scoreProactiveSimilarity,
  type ProactiveEtiquetteRequest,
  type ProactiveEtiquetteState,
} from '../src/features/autonomy/proactiveEtiquette.ts'
import {
  DEFAULT_PROACTIVE_QUIET_END,
  DEFAULT_PROACTIVE_QUIET_START,
  PROACTIVE_MIN_GAP_MS,
  isLikelyMeetingSurface,
} from '../src/features/autonomy/proactiveBudget.ts'
import { extractMemoriesFromMessage } from '../src/features/memory/memory.ts'
import { localDayKey } from '../src/lib/localDate.ts'
import type { ChatMessage } from '../src/types/chat.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function atLocal(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

const NOW = atLocal(2026, 10, 15, 14)

beforeEach(() => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
      },
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  })
})

function state(patch: Partial<ProactiveEtiquetteState> = {}): ProactiveEtiquetteState {
  return { ...emptyProactiveEtiquetteState(NOW), ...patch }
}

function request(patch: Partial<ProactiveEtiquetteRequest> = {}): ProactiveEtiquetteRequest {
  return {
    nowMs: NOW,
    kind: 'open_loop',
    text: 'send the quarterly report',
    preset: 'normal',
    enabled: true,
    quietStart: DEFAULT_PROACTIVE_QUIET_START,
    quietEnd: DEFAULT_PROACTIVE_QUIET_END,
    focusState: 'active',
    channel: 'next_turn',
    ...patch,
  }
}

test('quiet hours, focus, fullscreen, typing, meetings, and busy surfaces block delivery', () => {
  const quiet = evaluateProactiveMessage(request({ nowMs: atLocal(2026, 10, 15, 23, 30) }), state())
  assert.equal(quiet.allow, false)
  assert.equal(quiet.reason, 'quiet-hours')

  assert.equal(evaluateProactiveMessage(request({ userTyping: true }), state()).reason, 'typing')
  assert.equal(evaluateProactiveMessage(request({ fullscreen: true }), state()).reason, 'fullscreen')
  assert.equal(evaluateProactiveMessage(request({ busy: true }), state()).reason, 'busy')
  assert.equal(evaluateProactiveMessage(request({ focusState: 'away' }), state()).reason, 'away')
  assert.equal(evaluateProactiveMessage(request({ focusState: 'locked' }), state()).reason, 'away')
  assert.equal(evaluateProactiveMessage(request({ enabled: false }), state()).reason, 'disabled')
  assert.equal(isLikelyMeetingSurface('Zoom Meeting', 'zoom.us'), true)
  assert.equal(isLikelyMeetingSurface('腾讯会议 - 周会', null), true)
  assert.equal(isLikelyMeetingSurface('Visual Studio Code', 'Code'), false)
})

test('a leave-me-alone span blocks every proactive kind until it expires', () => {
  const quiet = state({ quietUntil: NOW + 2 * HOUR, lastUserMessageAt: NOW - HOUR })
  assert.equal(evaluateProactiveMessage(request({ kind: 'letter' }), quiet).reason, 'leave-me-alone')
  assert.equal(evaluateProactiveMessage(request({ kind: 'idle' }), quiet).reason, 'leave-me-alone')
  const expired = state({ quietUntil: NOW - 1, lastUserMessageAt: NOW - HOUR })
  assert.equal(evaluateProactiveMessage(request(), expired).allow, true)
})

test('ignored proactive gaps double each time and a user reply resets the streak', () => {
  assert.equal(proactiveBackoffGapMs(1), PROACTIVE_MIN_GAP_MS)
  assert.equal(proactiveBackoffGapMs(2), PROACTIVE_MIN_GAP_MS * 2)
  assert.equal(proactiveBackoffGapMs(3), PROACTIVE_MIN_GAP_MS * 4)

  const gap = proactiveBackoffGapMs(3)
  const blocked = state({
    lastUserMessageAt: NOW - 2 * DAY,
    lastProactiveAt: NOW - gap + 60_000,
    ignoredStreak: 3,
  })
  assert.equal(evaluateProactiveMessage(request(), blocked).reason, 'backoff')

  const allowed = state({
    lastUserMessageAt: NOW - 2 * DAY,
    lastProactiveAt: NOW - gap,
    ignoredStreak: 3,
  })
  assert.equal(evaluateProactiveMessage(request(), allowed).allow, true)

  recordProactiveUserMessage('I am back', NOW)
  const reset = loadProactiveEtiquetteState(NOW)
  assert.equal(reset.ignoredStreak, 0)
  assert.equal(reset.lastUserMessageAt, NOW)
})

test('after about a week without a reply she stops initiating until the user speaks', () => {
  const silenced = state({
    lastUserMessageAt: NOW - PROACTIVE_SILENCE_STOP_MS - HOUR,
    lastProactiveAt: NOW - HOUR,
    ignoredStreak: 2,
  })
  assert.equal(evaluateProactiveMessage(request(), silenced).reason, 'long-silence')

  recordProactiveUserMessage('hello again', NOW)
  const reset = loadProactiveEtiquetteState(NOW)
  assert.equal(evaluateProactiveMessage(request(), reset).allow, true)
})

test('"leave me alone" parses in Chinese, English, Japanese, and Korean', () => {
  const cases: Array<[string, string, number, number | undefined]> = [
    ['今天别找我了', 'today', atLocal(2026, 10, 16, 0), undefined],
    ['明天前别打扰我', 'tomorrow', atLocal(2026, 10, 16, DEFAULT_PROACTIVE_QUIET_END), undefined],
    ['安静一会儿', 'hours', NOW + 3 * HOUR, 3],
    ['两小时别理我', 'hours', NOW + 2 * HOUR, 2],
    ['先别给我发消息', 'hours', NOW + 3 * HOUR, 3],
    ["don't message me today", 'today', atLocal(2026, 10, 16, 0), undefined],
    ['leave me alone for a bit', 'hours', NOW + 3 * HOUR, 3],
    ['stay quiet for 2 hours', 'hours', NOW + 2 * HOUR, 2],
    ["don't contact me until tomorrow", 'tomorrow', atLocal(2026, 10, 16, DEFAULT_PROACTIVE_QUIET_END), undefined],
    ['今日は話しかけないで', 'today', atLocal(2026, 10, 16, 0), undefined],
    ['明日まで連絡しないで', 'tomorrow', atLocal(2026, 10, 16, DEFAULT_PROACTIVE_QUIET_END), undefined],
    ['しばらくそっとしておいて', 'hours', NOW + 3 * HOUR, 3],
    ['오늘 연락하지 마', 'today', atLocal(2026, 10, 16, 0), undefined],
    ['내일까지 메시지 보내지 마', 'tomorrow', atLocal(2026, 10, 16, DEFAULT_PROACTIVE_QUIET_END), undefined],
    ['두 시간 동안 조용히 해줘', 'hours', NOW + 2 * HOUR, 2],
  ]
  for (const [text, span, untilMs, hours] of cases) {
    const parsed = parseLeaveMeAlone(text, NOW)
    assert.ok(parsed, `expected to parse: ${text}`)
    assert.equal(parsed.span, span, text)
    assert.equal(parsed.untilMs, untilMs, text)
    if (hours !== undefined) assert.equal(parsed.hours, hours, text)
  }
})

test('negated leave-me-alone phrases are not commands', () => {
  const negatives = [
    '别不理我',
    '不要不跟我说话',
    '今天不用不跟我说话',
    "don't ignore me",
    'please don\'t leave me alone',
    "I don't want you to leave me alone",
    '一人にしないで',
    '無視しないで',
    '무시하지 마',
    '혼자 두지 마',
  ]
  for (const text of negatives) {
    assert.equal(parseLeaveMeAlone(text, NOW), null, text)
  }
  assert.equal(isResumeMessagesPhrase('可以找我了'), true)
  assert.equal(isResumeMessagesPhrase('you can message me again'), true)
  assert.equal(isResumeMessagesPhrase('もう大丈夫'), true)
  assert.equal(isResumeMessagesPhrase('이제 말 걸어도 돼'), true)
  assert.equal(isResumeMessagesPhrase('今天别找我了'), false)
})

test('acknowledges once, extends the span, and undo really clears it', () => {
  const first = recordProactiveUserMessage('今天别找我了', NOW)
  assert.equal(first.action, 'leave_alone')
  assert.ok(first.ack)
  assert.equal(first.quietUntil, atLocal(2026, 10, 16, 0))

  const second = recordProactiveUserMessage('明天前别打扰我', NOW + HOUR)
  assert.equal(second.action, 'leave_alone')
  assert.equal(second.ack, null, 'already quiet: no second acknowledgement')
  assert.equal(second.quietUntil, atLocal(2026, 10, 16, DEFAULT_PROACTIVE_QUIET_END))

  assert.equal(evaluateProactiveMessage(request(), loadProactiveEtiquetteState(NOW + HOUR)).reason, 'leave-me-alone')
  const resumed = recordProactiveUserMessage('可以找我了', NOW + 2 * HOUR)
  assert.equal(resumed.action, 'resume')
  assert.equal(resumed.quietUntil, null)
  assert.equal(evaluateProactiveMessage(request({ nowMs: NOW + 2 * HOUR }), loadProactiveEtiquetteState(NOW + 2 * HOUR)).allow, true)
})

test('anti-repeat weights topic words and lets unrelated topics through', () => {
  const recent = ['明天记得交季度报告', '今天会议改到三点']
  const sameTopic = scoreProactiveSimilarity('记得交季度报告了吗', recent)
  const unrelated = scoreProactiveSimilarity('外面下雨了，记得带伞', recent)
  assert.ok(sameTopic >= PROACTIVE_REPEAT_THRESHOLD, `sameTopic=${sameTopic}`)
  assert.ok(unrelated < PROACTIVE_REPEAT_THRESHOLD, `unrelated=${unrelated}`)
  assert.equal(isTooSimilar('明天记得交季度报告', recent), true)
  assert.equal(isTooSimilar('晚饭想吃面', recent), false)

  // 今天/哈哈 are common: sharing only those must not look like the same topic.
  const commonOnly = scoreProactiveSimilarity('今天哈哈', ['今天报告交了'])
  assert.ok(commonOnly < PROACTIVE_REPEAT_THRESHOLD, `commonOnly=${commonOnly}`)
})

test('the daily budget is shared and reserves room for letters and event follow-ups', () => {
  assert.equal(proactiveMessagePriority('letter'), 'high')
  assert.equal(proactiveMessagePriority('event_follow_up'), 'high')
  assert.equal(proactiveMessagePriority('open_loop'), 'normal')
  assert.equal(proactiveMessagePriority('bracket'), 'normal')
  assert.equal(proactiveMessagePriority('dream'), 'low')
  assert.equal(proactiveMessagePriority('idle'), 'low')
  assert.equal(proactiveBudgetCap('normal', 'high'), 3)
  assert.equal(proactiveBudgetCap('normal', 'normal'), 2)
  assert.equal(proactiveBudgetCap('normal', 'low'), 1)
  assert.equal(proactiveBudgetCap('low', 'high'), 1)

  saveProactiveEtiquetteState(state({
    lastUserMessageAt: NOW - HOUR,
    budgetDay: localDayKey(NOW),
    budgetEntries: [
      { kind: 'open_loop', priority: 'normal', at: NOW - 2 * HOUR },
      { kind: 'bracket', priority: 'normal', at: NOW - HOUR },
    ],
  }), NOW)

  const idle = admitProactiveMessage(request({ kind: 'idle', text: 'nice weather' }))
  assert.equal(idle.allow, false)
  assert.equal(idle.reason, 'daily-budget')

  const letter = admitProactiveMessage(request({ kind: 'letter', text: '' }))
  assert.equal(letter.allow, true, 'high priority can still use the reserved slot')
  assert.equal(loadProactiveEtiquetteState(NOW).budgetEntries.length, 3)

  const event = admitProactiveMessage(request({
    nowMs: NOW + PROACTIVE_MIN_GAP_MS,
    kind: 'event_follow_up',
    text: 'how did the interview go?',
  }))
  assert.equal(event.allow, false)
  assert.equal(event.reason, 'daily-budget')
})

test('a dream mention is admitted last and spends the same shared slot', () => {
  saveProactiveEtiquetteState(state({ lastUserMessageAt: NOW - HOUR }), NOW)

  const dream = admitProactiveMessage(request({
    kind: 'dream',
    text: 'I dreamed the hallway was full of paper cranes',
  }))
  assert.equal(dream.allow, true)
  const recorded = loadProactiveEtiquetteState(NOW).budgetEntries
  assert.deepEqual(recorded.map((entry) => [entry.kind, entry.priority]), [['dream', 'low']])

  // One normal line for the day leaves nothing for a dream, while an event
  // follow-up or a letter still fits in its reserved slot.
  saveProactiveEtiquetteState(state({
    lastUserMessageAt: NOW - HOUR,
    budgetEntries: recorded,
  }), NOW)
  const bracket = admitProactiveMessage(request({ nowMs: NOW + PROACTIVE_MIN_GAP_MS, kind: 'bracket', text: '' }))
  assert.equal(bracket.allow, true)

  const laterDream = admitProactiveMessage(request({
    nowMs: NOW + 2 * PROACTIVE_MIN_GAP_MS,
    kind: 'dream',
    text: 'the garden again',
  }))
  assert.equal(laterDream.allow, false)
  assert.equal(laterDream.reason, 'daily-budget')

  const event = admitProactiveMessage(request({
    nowMs: NOW + 2 * PROACTIVE_MIN_GAP_MS,
    kind: 'event_follow_up',
    text: 'how did the interview go?',
  }))
  assert.equal(event.allow, true)
})

test('proactive trigger prompts are not memories, even when replayed as assistant text', () => {
  const prompt = 'The user has an unfinished commitment: "send the report". '
    + 'You cannot know whether it is already done. If it fits naturally, ask once. '
    + 'Never nag and never assert it was forgotten.'
  const assistantTurn: ChatMessage = {
    id: 'msg-trigger',
    role: 'assistant',
    content: prompt,
    createdAt: new Date(NOW).toISOString(),
  }
  assert.deepEqual(extractMemoriesFromMessage(assistantTurn), [])
})
