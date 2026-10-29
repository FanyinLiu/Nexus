import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agendaDeliveryAllowed,
  emptyAgendaState,
  filterAgendaItemsForNextTurn,
  projectAgenda,
  recordLoopSurfaced,
  selectAgendaItem,
} from '../src/features/autonomy/proactiveAgenda.ts'
import { evaluateProactiveEtiquette } from '../src/features/autonomy/proactiveBudget.ts'
import { memoryChangeKey } from '../src/features/memory/changeCopy.ts'
import { applyLoopEventAction } from '../src/features/memory/loopCardActions.ts'
import {
  EVENT_FOLLOW_UP_DELAY_MS,
  eventFollowUpMs,
  loopKindOf,
} from '../src/features/memory/loopDetails.ts'
import {
  buildLoopOutreach,
  loopNoteVariant,
} from '../src/features/memory/loopOutreach.ts'
import {
  classifyEventUtterance,
  extractOpenLoopItems,
} from '../src/features/memory/openLoops.ts'
import { normalizeMemoryItem } from '../src/lib/storage/memory.ts'
import { extractMemoriesFromMessage } from '../src/features/memory/memory.ts'
import { t } from '../src/i18n/runtime.ts'
import type { AgendaItem } from '../src/types/proactive.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function atLocal(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function loop(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content'>): MemoryItem {
  return {
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    loopStatus: 'open',
    enabled: true,
    status: 'active',
    createdAt: atLocal(2026, 10, 15, 9).toISOString(),
    ...patch,
  }
}

test('captures dated events without a commitment verb in zh, en, ja, and ko', () => {
  const thursday = atLocal(2026, 10, 15, 9).toISOString()
  const samples = [
    { text: '明天上午十点去医院复查', dueDay: 16, dueHour: 10 },
    { text: '我下个月要搬家', dueMonth: 10, dueDay: 30, dueHour: 18 },
    { text: '下周三有个面试', dueDay: 21, dueHour: 18 },
    { text: '周五考试', dueDay: 16, dueHour: 18 },
    { text: '后天出差', dueDay: 17, dueHour: 18 },
    { text: 'I have an interview next Wednesday', dueDay: 21, dueHour: 18 },
    { text: 'Doctor appointment tomorrow at 10am', dueDay: 16, dueHour: 10 },
    { text: 'I am moving next month', dueMonth: 10, dueDay: 30, dueHour: 18 },
    { text: 'Exam on Friday', dueDay: 16, dueHour: 18 },
    { text: 'Business trip tomorrow', dueDay: 16, dueHour: 18 },
    { text: '来週の水曜に面接', dueDay: 21, dueHour: 18 },
    { text: '明日の午前十時に病院で検査', dueDay: 16, dueHour: 10 },
    { text: '다음 주 수요일에 면접', dueDay: 21, dueHour: 18 },
    { text: '내일 병원 검진', dueDay: 16, dueHour: 18 },
  ]
  for (const sample of samples) {
    const [item] = extractOpenLoopItems(sample.text, thursday, () => `memory-${sample.text}`)
    assert.ok(item, sample.text)
    assert.equal(item.kind, 'open_loop', sample.text)
    assert.equal(item.loopKind, 'event', sample.text)
    assert.equal(item.loopStatus, 'open', sample.text)
    const due = new Date(item.loopDueAt ?? '')
    assert.equal(due.getDate(), sample.dueDay, sample.text)
    assert.equal(due.getHours(), sample.dueHour, sample.text)
    if (sample.dueMonth !== undefined) assert.equal(due.getMonth(), sample.dueMonth, sample.text)
  }
})

test('questions, negations, hypotheticals, other people, and the past stay out of event capture', () => {
  const thursday = atLocal(2026, 10, 15, 9).toISOString()
  const skipped = [
    '我下周三有个面试吗？',
    '如果下周三有个面试',
    '我同事下周三有个面试',
    '她说下周三有个面试',
    '我下周三不去面试了',
    '昨天的面试已经结束了',
    '明天上午十点去医院复查，身份证 110101199001011234',
    'Do I have an interview next Wednesday?',
    'My friend has an interview tomorrow',
    'If I had an interview tomorrow',
    "I'm not going to the exam tomorrow",
    'I had an exam yesterday',
  ]
  for (const text of skipped) {
    assert.equal(classifyEventUtterance(text, thursday), 'skip', text)
    assert.equal(extractOpenLoopItems(text, thursday, () => 'memory-skip').length, 0, text)
  }
  assert.equal(classifyEventUtterance('回头我看一下', thursday), 'none')
  assert.equal(classifyEventUtterance('我明天要准备面试', thursday), 'none')
})

test('commitments without an event noun still use commitment wording', () => {
  const thursday = atLocal(2026, 10, 15, 9).toISOString()
  const [item] = extractOpenLoopItems("I'll send the report Friday", thursday, () => 'memory-report')
  assert.ok(item)
  assert.equal(item.loopKind, 'commitment')
})

test('the chat extractor appends a dated event loop', () => {
  const createdAt = atLocal(2026, 10, 15, 9).toISOString()
  const memories = extractMemoriesFromMessage({
    id: 'msg-event',
    role: 'user',
    content: '下周三有个面试',
    createdAt,
  })
  const item = memories.find((memory) => memory.kind === 'open_loop')
  assert.ok(item)
  assert.equal(item.loopKind, 'event')
  assert.equal(item.loopDueText, '下周三')
})

test('an event gets one follow-up card a day after it and never a preview', () => {
  const saidAt = atLocal(2026, 10, 15, 9)
  const [event] = extractOpenLoopItems('明天上午十点去医院复查', saidAt.toISOString(), () => 'memory-event')
  assert.ok(event)
  const dueMs = Date.parse(event.loopDueAt ?? '')
  const followUpMs = dueMs + EVENT_FOLLOW_UP_DELAY_MS

  assert.equal(buildLoopOutreach(event, dueMs - HOUR, t), null)
  assert.equal(buildLoopOutreach(event, dueMs + HOUR, t), null)
  assert.equal(buildLoopOutreach(event, followUpMs - 1000, t), null)

  const card = buildLoopOutreach(event, followUpMs, t)
  assert.ok(card)
  assert.equal(card.phase, 'check')
  assert.equal(card.mode, 'ask')
  assert.equal(card.check?.kind, 'event')
  assert.equal(card.offer, null)
  assert.match(card.text, /后来怎么样了/)
  assert.equal(card.text.includes('办好了吗'), false)
  assert.equal(card.why.quote, '明天上午十点去医院复查')
  assert.equal(loopNoteVariant({
    hasOffer: false,
    hasCheck: true,
    checkKind: card.check?.kind,
    hasWhy: true,
  }), 'event')

  const early = projectAgenda({
    memories: [event],
    followUps: [],
    previous: emptyAgendaState(),
    nowMs: followUpMs - 1000,
  })
  assert.equal(selectAgendaItem(early.items, followUpMs - 1000, 'return'), null)

  const due = projectAgenda({
    memories: [event],
    followUps: [],
    previous: emptyAgendaState(),
    nowMs: followUpMs,
  })
  const item = selectAgendaItem(due.items, followUpMs, 'return')
  assert.equal(item?.sourceId, 'memory-event')
  assert.equal(item?.deliverOn, 'return')

  const quiet = evaluateProactiveEtiquette({
    nowMs: followUpMs,
    enabled: true,
    preset: 'normal',
    quietStart: 10,
    quietEnd: 12,
    firedAt: [],
    dismissedAt: [],
    userTyping: false,
    fullscreen: false,
    focusState: 'active',
    channel: 'return',
  })
  assert.equal(quiet.allow, false)
})

test('an event follow-up is one-shot after the ask', () => {
  const followUpAt = atLocal(2026, 10, 17, 10)
  const event = loop({
    id: 'scan',
    content: '明天上午十点去医院复查',
    loopKind: 'event',
    loopDueAt: atLocal(2026, 10, 16, 10).toISOString(),
    loopDueText: '明天上午十点',
  })
  assert.equal(eventFollowUpMs(event.loopDueAt), followUpAt.getTime())
  const asked = recordLoopSurfaced([event], 'scan', followUpAt.toISOString(), 'check')
  assert.equal(asked[0]?.loopCheckAskedAt, followUpAt.toISOString())
  assert.equal(buildLoopOutreach(asked[0]!, followUpAt.getTime() + 1000, t), null)

  const projected = projectAgenda({
    memories: asked,
    followUps: [],
    previous: emptyAgendaState(),
    nowMs: followUpAt.getTime() + 1000,
  })
  assert.equal(selectAgendaItem(projected.items, followUpAt.getTime() + 1000, 'return'), null)
})

test('event answers close, defer, or drop the loop', () => {
  const event = loop({
    id: 'exam',
    content: '周五考试',
    loopKind: 'event',
    loopDueAt: atLocal(2026, 10, 16, 18).toISOString(),
    loopCheckAskedAt: atLocal(2026, 10, 17, 18).toISOString(),
  })
  const now = atLocal(2026, 10, 17, 19).toISOString()

  const good = applyLoopEventAction([event], 'exam', 'went_well', now, '挺好的')
  assert.equal(good.memories[0]?.loopStatus, 'done')
  assert.equal(memoryChangeKey(good.op!), 'memory.change.done')

  const rough = applyLoopEventAction([event], 'exam', 'went_rough', now, '不太顺')
  assert.equal(rough.memories[0]?.loopStatus, 'done')

  const notYet = applyLoopEventAction([event], 'exam', 'not_yet', now, '还没到')
  assert.equal(notYet.memories[0]?.loopStatus, 'open')
  assert.ok(notYet.memories[0]?.loopSnoozeUntil)
  assert.equal(memoryChangeKey(notYet.op!), 'memory.change.later')
  assert.equal(buildLoopOutreach(notYet.memories[0]!, Date.parse(now), t), null)

  const dontAsk = applyLoopEventAction([event], 'exam', 'dont_ask', now, '不用问了')
  assert.equal(dontAsk.memories[0]?.loopStatus, 'dismissed')
  assert.equal(memoryChangeKey(dontAsk.op!), 'memory.change.dismissed')
  assert.equal(buildLoopOutreach(dontAsk.memories[0]!, Date.parse(now), t), null)
})

test('a due-less loop becomes a card callback after three days', () => {
  const createdAt = atLocal(2026, 10, 15, 9)
  const memory = loop({ id: 'someday', content: '回头我看一下', createdAt: createdAt.toISOString() })
  const staleMs = createdAt.getTime() + 3 * DAY

  const early = projectAgenda({
    memories: [memory],
    followUps: [],
    previous: emptyAgendaState(),
    nowMs: staleMs - 1000,
  })
  assert.equal(early.items.some((item) => item.sourceId === 'someday'), false)

  const state = projectAgenda({
    memories: [memory],
    followUps: [],
    previous: emptyAgendaState(),
    nowMs: staleMs,
  })
  const item = selectAgendaItem(state.items, staleMs, 'return')
  assert.equal(item?.sourceId, 'someday')
  assert.equal(item?.deliverOn, 'either')

  const card = buildLoopOutreach(memory, staleMs, t)
  assert.ok(card)
  assert.equal(card.phase, 'callback')
  assert.equal(card.offer, null)
  assert.equal(card.check, null)
  assert.match(card.text, /后来怎么样了/)
  assert.equal(card.why.quote, '回头我看一下')
  assert.equal(loopNoteVariant({
    hasOffer: false,
    hasCheck: false,
    hasWhy: true,
  }), 'callback')
})

test('agenda delivery respects the same switches as existing loops', () => {
  assert.equal(agendaDeliveryAllowed({ proactiveAgendaEnabled: true, memoryPaused: false }), true)
  assert.equal(agendaDeliveryAllowed({ proactiveAgendaEnabled: false, memoryPaused: false }), false)
  assert.equal(agendaDeliveryAllowed({ proactiveAgendaEnabled: true, memoryPaused: true }), false)
  assert.equal(agendaDeliveryAllowed({ proactiveAgendaEnabled: undefined, memoryPaused: false }), false)

  const items: AgendaItem[] = [
    {
      id: 'agenda:open_loop:exam',
      kind: 'open_loop',
      sourceId: 'exam',
      summary: '周五考试',
      priority: 3,
      notBefore: 0,
      deliverOn: 'either',
      state: 'pending',
      attempts: 0,
    },
    {
      id: 'agenda:message_follow_up:wechat:ada',
      kind: 'message_follow_up',
      sourceId: 'wechat:ada',
      summary: 'Ada · 微信',
      priority: 2,
      notBefore: 0,
      deliverOn: 'either',
      state: 'pending',
      attempts: 0,
    },
  ]
  assert.deepEqual(filterAgendaItemsForNextTurn(items, true).map((item) => item.id), ['agenda:message_follow_up:wechat:ada'])
  assert.deepEqual(filterAgendaItemsForNextTurn(items, false).map((item) => item.id), items.map((item) => item.id))
})

test('stored rows without loopKind stay commitments and normalization keeps the new field', () => {
  const legacy = normalizeMemoryItem({
    id: 'legacy',
    content: 'I sent the report Friday',
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    createdAt: '2026-10-15T02:00:00.000Z',
    loopStatus: 'open',
    schemaVersion: 2,
  }, 0)
  assert.ok(legacy)
  assert.equal(legacy.loopKind, undefined)
  assert.equal(loopKindOf(legacy), 'commitment')

  const stored = normalizeMemoryItem({
    id: 'stored-event',
    content: '下周三有个面试',
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    createdAt: '2026-10-15T02:00:00.000Z',
    loopStatus: 'open',
    loopKind: 'event',
    schemaVersion: 2,
  }, 0)
  assert.ok(stored)
  assert.equal(stored.loopKind, 'event')
  assert.equal(loopKindOf(stored), 'event')

  const legacyCard = buildLoopOutreach(
    loop({
      id: 'legacy',
      content: '我周五把报告发你',
      loopDueAt: atLocal(2026, 10, 16, 18).toISOString(),
    }),
    atLocal(2026, 10, 16, 19).getTime(),
    t,
  )
  assert.ok(legacyCard)
  assert.equal(legacyCard.check?.kind, undefined)
  assert.match(legacyCard.text, /办好了吗/)
  assert.equal(loopNoteVariant({
    hasOffer: false,
    hasCheck: true,
    checkKind: legacyCard.check?.kind,
    hasWhy: true,
  }), 'commitment')
})
