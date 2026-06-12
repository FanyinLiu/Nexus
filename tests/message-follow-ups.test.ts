import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'

import {
  FOLLOW_UP_DAILY_CAP,
  FOLLOW_UP_MAX_AGE_MS,
  FOLLOW_UP_MIN_AGE_MS,
  buildMessageFollowUpPromptText,
  consumeMessageFollowUpPromptText,
  loadMessageFollowUps,
  markFollowUpFired,
  recordFollowUpEntry,
  recordMessageFollowUp,
  selectDueFollowUp,
  type MessageFollowUpEntry,
} from '../src/lib/storage/messageFollowUps.ts'

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: createLocalStorageMock() },
    configurable: true,
    writable: true,
  })
})

const T0 = 1_700_000_000_000
const HOUR = 60 * 60 * 1000

function entry(overrides: Partial<MessageFollowUpEntry> = {}): MessageFollowUpEntry {
  return {
    conversationKey: '微信:张三',
    sourceLabel: '微信',
    senderLabel: '张三',
    receivedAt: T0,
    messageCount: 1,
    ...overrides,
  }
}

describe('recordFollowUpEntry', () => {
  test('a repeat ping before firing refreshes the clock and counts the burst', () => {
    let list = recordFollowUpEntry([], { conversationKey: '微信:张三', sourceLabel: '微信', senderLabel: '张三' }, T0)
    list = recordFollowUpEntry(list, { conversationKey: '微信:张三', sourceLabel: '微信', senderLabel: '张三' }, T0 + HOUR)
    assert.equal(list.length, 1)
    assert.equal(list[0].messageCount, 2)
    assert.equal(list[0].receivedAt, T0 + HOUR)
  })

  test('a new burst after a fired follow-up becomes a fresh candidate', () => {
    let list = [entry({ firedAt: T0 + HOUR })]
    list = recordFollowUpEntry(list, { conversationKey: '微信:张三', sourceLabel: '微信', senderLabel: '张三' }, T0 + 2 * HOUR)
    assert.equal(list.length, 1)
    assert.equal(list[0].firedAt, undefined)
    assert.equal(list[0].messageCount, 1)
  })
})

describe('selectDueFollowUp', () => {
  test('respects the 2h–24h surfacing window', () => {
    const list = [entry()]
    assert.equal(selectDueFollowUp(list, T0 + HOUR), null) // too fresh
    assert.equal(selectDueFollowUp(list, T0 + FOLLOW_UP_MIN_AGE_MS)?.conversationKey, '微信:张三')
    assert.equal(selectDueFollowUp(list, T0 + FOLLOW_UP_MAX_AGE_MS + 1), null) // expired
  })

  test('picks the most overdue candidate and skips fired ones', () => {
    const list = [
      entry({ conversationKey: 'a', receivedAt: T0 + HOUR }),
      entry({ conversationKey: 'b', receivedAt: T0 }),
      entry({ conversationKey: 'c', receivedAt: T0 - HOUR, firedAt: T0 + HOUR }),
    ]
    assert.equal(selectDueFollowUp(list, T0 + 5 * HOUR)?.conversationKey, 'b')
  })

  test('daily cap: after two fired follow-ups, nothing more surfaces today', () => {
    const list = [
      entry({ conversationKey: 'a', firedAt: T0 + 3 * HOUR }),
      entry({ conversationKey: 'b', firedAt: T0 + 4 * HOUR }),
      entry({ conversationKey: 'c', receivedAt: T0 }),
    ]
    assert.equal(FOLLOW_UP_DAILY_CAP, 2)
    assert.equal(selectDueFollowUp(list, T0 + 5 * HOUR), null)
    // The cap rolls off once the fired entries age out of the 24h window.
    assert.equal(
      selectDueFollowUp(
        list.map((e) => (e.conversationKey === 'c' ? { ...e, receivedAt: T0 + 30 * HOUR } : e)),
        T0 + 33 * HOUR,
      )?.conversationKey,
      'c',
    )
  })
})

describe('prompt text', () => {
  test('asks gently, includes the burst count, and only includes the topic when present', () => {
    const withTopic = buildMessageFollowUpPromptText(entry({ topicHint: '周末聚餐的事', messageCount: 3, receivedAt: Date.now() - 3 * HOUR }))
    assert.match(withTopic, /张三/)
    assert.match(withTopic, /微信/)
    assert.match(withTopic, /3 messages/)
    assert.match(withTopic, /周末聚餐的事/)
    assert.match(withTopic, /never nagging/i)

    const withoutTopic = buildMessageFollowUpPromptText(entry({ receivedAt: Date.now() - 3 * HOUR }))
    assert.doesNotMatch(withoutTopic, /started with/)
  })
})

describe('end-to-end consume', () => {
  test('records, surfaces once in the window, never repeats', () => {
    const now = Date.now()
    recordMessageFollowUp(
      { conversationKey: '微信:张三', sourceLabel: '微信', senderLabel: '张三' },
      now - 3 * HOUR,
    )

    const first = consumeMessageFollowUpPromptText(now)
    assert.match(first, /张三/)

    const second = consumeMessageFollowUpPromptText(now + 1000)
    assert.equal(second, '')
    // The entry is retained as fired (daily-cap accounting) until it expires.
    assert.equal(loadMessageFollowUps()[0]?.firedAt !== undefined, true)
  })

  test('markFollowUpFired only touches the targeted conversation', () => {
    const list = [entry({ conversationKey: 'a' }), entry({ conversationKey: 'b' })]
    const next = markFollowUpFired(list, 'a', T0 + HOUR)
    assert.equal(next.find((e) => e.conversationKey === 'a')?.firedAt, T0 + HOUR)
    assert.equal(next.find((e) => e.conversationKey === 'b')?.firedAt, undefined)
  })
})
