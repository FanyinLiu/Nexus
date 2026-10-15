import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  applyAgendaUserAction,
  buildAgendaPrompt,
  emptyAgendaState,
  followUpKeyToSettle,
  projectAgenda,
  selectAgendaItem,
  syncProactiveAgenda,
  type AgendaItem,
} from '../src/features/autonomy/proactiveAgenda.ts'
import {
  loadMessageFollowUps,
  recordMessageFollowUp,
  settleMessageFollowUp,
  consumeMessageFollowUpPromptText,
} from '../src/lib/storage/messageFollowUps.ts'
import {
  loadProactiveAgenda,
  normalizeProactiveAgenda,
} from '../src/lib/storage/proactiveAgenda.ts'
import type { MemoryItem } from '../src/types/memory.ts'
import type { ProactiveAgendaState } from '../src/types/proactive.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function atLocal(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime()
}

const NOW = atLocal(2026, 10, 15, 12)

function loop(patch: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'content' | 'createdAt'>): MemoryItem {
  return {
    category: 'goal',
    source: 'chat',
    kind: 'open_loop',
    loopStatus: 'open',
    enabled: true,
    status: 'active',
    ...patch,
  }
}

function empty(): ProactiveAgendaState {
  return emptyAgendaState()
}

beforeEach(() => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
      },
    },
    configurable: true,
    writable: true,
  })
})

test('the same source becomes one agenda row and a dismissal stays dismissed', () => {
  const createdAt = new Date(NOW - 4 * DAY).toISOString()
  const memories = [
    loop({ id: 'report', content: "I'll send the report Friday", createdAt }),
    loop({ id: 'report', content: "I'll send the report Friday", createdAt }),
  ]
  const first = projectAgenda({ memories, followUps: [], previous: empty(), nowMs: NOW })
  assert.equal(first.items.length, 1)
  assert.equal(first.items[0]?.id, 'agenda:open_loop:report')

  const dismissed = applyAgendaUserAction(first, memories, 'agenda:open_loop:report', 'dismiss', NOW)
  assert.equal(dismissed.state.items[0]?.state, 'dismissed')
  assert.equal(dismissed.memories[0]?.loopStatus, 'dismissed')

  const again = projectAgenda({
    memories: dismissed.memories,
    followUps: [],
    previous: dismissed.state,
    nowMs: NOW + HOUR,
  })
  assert.equal(again.items.filter((item) => item.sourceId === 'report').length, 1)
  assert.equal(again.items[0]?.state, 'dismissed')
  assert.equal(selectAgendaItem(again.items, NOW + HOUR, 'next_turn'), null)
})

test('due loops outrank stale ones and a same-day firing does not repeat', () => {
  const overdue = loop({
    id: 'overdue',
    content: 'send the report',
    createdAt: new Date(NOW - 2 * DAY).toISOString(),
    loopDueAt: new Date(NOW - HOUR).toISOString(),
  })
  const stale = loop({
    id: 'stale',
    content: 'book the interview',
    createdAt: new Date(NOW - 4 * DAY).toISOString(),
  })
  const fresh = loop({
    id: 'fresh',
    content: 'pay the invoice someday',
    createdAt: new Date(NOW - HOUR).toISOString(),
  })
  const state = projectAgenda({ memories: [stale, fresh, overdue], followUps: [], previous: empty(), nowMs: NOW })
  assert.equal(state.items.some((item) => item.sourceId === 'fresh'), false)
  const picked = selectAgendaItem(state.items, NOW, 'return')
  assert.equal(picked?.sourceId, 'overdue')
  assert.equal(picked?.deliverOn, 'either')

  const fired: AgendaItem = { ...picked!, firedAt: NOW - HOUR, attempts: 1 }
  assert.equal(selectAgendaItem([fired], NOW, 'next_turn'), null)
  assert.equal(selectAgendaItem([{ ...fired, attempts: 2, firedAt: NOW - 2 * DAY }], NOW, 'next_turn'), null)
})

test('legacy follow-ups migrate once, fired rows stay done, and dismiss retires the old store', () => {
  const receivedAt = NOW - 3 * HOUR
  recordMessageFollowUp({
    conversationKey: 'wechat:ada',
    sourceLabel: '微信',
    senderLabel: 'Ada',
  }, receivedAt)
  recordMessageFollowUp({
    conversationKey: 'wechat:bea',
    sourceLabel: '微信',
    senderLabel: 'Bea',
  }, receivedAt)
  settleMessageFollowUp('wechat:bea', NOW - HOUR)

  const migrated = syncProactiveAgenda([], NOW)
  const again = syncProactiveAgenda([], NOW + 1000)
  assert.equal(again.items.length, migrated.items.length)
  assert.equal(again.items.filter((item) => item.kind === 'message_follow_up').length, 2)
  assert.equal(again.items.find((item) => item.sourceId === 'wechat:bea')?.state, 'done')
  assert.equal(loadMessageFollowUps().map((entry) => entry.conversationKey).sort().join(','), 'wechat:ada,wechat:bea')

  const ada = again.items.find((item) => item.sourceId === 'wechat:ada')
  assert.ok(ada)
  assert.equal(selectAgendaItem(again.items, NOW, 'next_turn')?.sourceId, 'wechat:ada')
  assert.match(buildAgendaPrompt(ada, loadMessageFollowUps()), /Ada/)

  const dismissed = applyAgendaUserAction(again, [], ada.id, 'dismiss', NOW)
  const key = followUpKeyToSettle(ada, 'dismiss')
  assert.equal(key, 'wechat:ada')
  assert.equal(followUpKeyToSettle(ada, 'snooze'), null)
  if (key) settleMessageFollowUp(key, NOW)
  const saved: ProactiveAgendaState = { ...dismissed.state, lastConsolidationAt: new Date(NOW).toISOString() }
  const rebuilt = projectAgenda({
    memories: [],
    followUps: loadMessageFollowUps(),
    previous: saved,
    nowMs: NOW + 1000,
  })
  assert.equal(rebuilt.items.find((item) => item.sourceId === 'wechat:ada')?.state, 'dismissed')
  assert.equal(consumeMessageFollowUpPromptText(NOW + 1000), '')
  assert.equal(loadProactiveAgenda().items.length, migrated.items.length)
})

test('a corrupt agenda blob becomes an empty queue without duplicate ids', () => {
  assert.deepEqual(normalizeProactiveAgenda('nope'), empty())
  const normalized = normalizeProactiveAgenda({
    items: [
      { id: 'agenda:open_loop:a', kind: 'open_loop', sourceId: 'a', summary: 'send it', notBefore: 1, deliverOn: 'either', state: 'pending', attempts: 0 },
      { id: 'agenda:open_loop:a', kind: 'open_loop', sourceId: 'a', summary: 'send it again', notBefore: 1, deliverOn: 'either', state: 'pending', attempts: 0 },
      { kind: 'nope', sourceId: 'b', summary: 'drop me' },
    ],
    firedAt: [1, 'bad'],
    lastConsolidationAt: 'not-a-date',
  })
  assert.equal(normalized.items.length, 1)
  assert.deepEqual(normalized.firedAt, [1])
  assert.equal(normalized.lastConsolidationAt, null)
})
