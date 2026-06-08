import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  subscribe,
  unsubscribe,
  unsubscribeAll,
  publish,
  listSubscriptions,
  getRecentMessages,
  getStats,
} from '../electron/services/pluginMessageBus.js'

// The module holds global mutable state with no reset().
// Clean up subscriptions between tests.
// _recentMessages accumulates — tests that inspect it use relative checks.

beforeEach(() => {
  unsubscribeAll('server-a')
  unsubscribeAll('server-b')
  unsubscribeAll('server-c')
})

// ── subscribe / unsubscribe / unsubscribeAll ──────────────────────────────

describe('subscribe', () => {
  it('accepts a valid topic', () => {
    assert.equal(subscribe('server-a', 'chat.message'), true)
  })

  it('rejects an invalid topic (empty string)', () => {
    assert.equal(subscribe('server-a', ''), false)
  })

  it('rejects a topic with spaces', () => {
    assert.equal(subscribe('server-a', 'bad topic'), false)
  })

  it('enforces the per-server subscription limit', () => {
    for (let i = 0; i < 50; i++) {
      assert.equal(subscribe('server-a', `topic.${i}`), true)
    }
    assert.equal(subscribe('server-a', 'topic.overflow'), false)
  })
})

describe('unsubscribe', () => {
  it('removes a single subscription', () => {
    subscribe('server-a', 'x.y')
    unsubscribe('server-a', 'x.y')
    assert.deepEqual(listSubscriptions(), {})
  })

  it('does not throw for a non-existent topic', () => {
    unsubscribe('server-a', 'nonexistent')
  })
})

describe('unsubscribeAll', () => {
  it('removes all subscriptions for a server', () => {
    subscribe('server-a', 'a.one')
    subscribe('server-a', 'a.two')
    subscribe('server-b', 'a.one')
    unsubscribeAll('server-a')
    // server-b's subscription should remain
    assert.deepEqual(listSubscriptions(), { 'a.one': ['server-b'] })
  })
})

// ── publish ───────────────────────────────────────────────────────────────

describe('publish', () => {
  it('records the message for observability but does not push (returns 0)', () => {
    subscribe('server-a', 'news.update')
    subscribe('server-b', 'news.update')

    // Inter-plugin push delivery is intentionally not wired; publish records
    // the message (recent/stats) and reports 0 delivered.
    const count = publish('server-c', 'news.update', { text: 'hi' })
    assert.equal(count, 0)
    const recent = getRecentMessages(1)
    assert.equal(recent[0].topic, 'news.update')
    assert.equal(recent[0].from, 'server-c')
  })

  it('returns 0 for a topic with no subscribers', () => {
    assert.equal(publish('server-a', 'empty.topic', null), 0)
  })

  it('returns 0 for an invalid topic', () => {
    assert.equal(publish('server-a', '', null), 0)
  })

  it('logs the message to recent messages', () => {
    publish('server-a', 'log.test', { v: 1 })
    const recent = getRecentMessages(1)
    assert.equal(recent.length, 1)
    assert.equal(recent[0].topic, 'log.test')
    assert.equal(recent[0].from, 'server-a')
    assert.deepEqual(recent[0].payload, { v: 1 })
  })
})

// ── listSubscriptions ─────────────────────────────────────────────────────

describe('listSubscriptions', () => {
  it('returns current topic-to-subscribers map', () => {
    subscribe('server-a', 'x.one')
    subscribe('server-b', 'x.one')
    subscribe('server-a', 'x.two')
    const subs = listSubscriptions()
    assert.deepEqual(new Set(subs['x.one']), new Set(['server-a', 'server-b']))
    assert.deepEqual(subs['x.two'], ['server-a'])
  })
})

// ── getRecentMessages ─────────────────────────────────────────────────────

describe('getRecentMessages', () => {
  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) publish('s', `m.${i}`, i)
    const msgs = getRecentMessages(3)
    assert.equal(msgs.length, 3)
    // Should be the 3 most recent
    assert.equal(msgs[0].topic, 'm.2')
    assert.equal(msgs[2].topic, 'm.4')
  })

  it('returns messages in chronological order', () => {
    publish('s', 'order.first', null)
    publish('s', 'order.second', null)
    const msgs = getRecentMessages(2)
    assert.equal(msgs[0].topic, 'order.first')
    assert.equal(msgs[1].topic, 'order.second')
  })
})

// ── getStats ──────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('counts match actual operations', () => {
    const before = getStats()
    subscribe('server-a', 'stat.one')
    subscribe('server-b', 'stat.one')
    subscribe('server-a', 'stat.two')
    publish('server-a', 'stat.one', null)

    const after = getStats()
    assert.equal(after.topicCount - before.topicCount, 2)
    assert.equal(after.totalSubscriptions - before.totalSubscriptions, 3)
    assert.equal(after.recentMessageCount - before.recentMessageCount, 1)
  })
})
