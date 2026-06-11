import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DEFAULT_RSS_INTERVAL_MINUTES,
  MAX_RSS_INTERVAL_MINUTES,
  MIN_RSS_INTERVAL_MINUTES,
  WEBHOOK_MAX_BODY_BYTES,
  normalizeWebhookPayload,
  normalizeRssIntervalMinutes,
  sanitizeNotificationChannels,
} from '../electron/services/notificationBridgeUtils.js'

test('notification bridge normalizes RSS intervals from channel minutes', () => {
  assert.equal(normalizeRssIntervalMinutes(Number.NaN), DEFAULT_RSS_INTERVAL_MINUTES)
  assert.equal(normalizeRssIntervalMinutes(1), MIN_RSS_INTERVAL_MINUTES)
  assert.equal(normalizeRssIntervalMinutes(10.9), 10)
  assert.equal(normalizeRssIntervalMinutes(2000), MAX_RSS_INTERVAL_MINUTES)
})

test('notification bridge sanitizes RSS channel interval fields together', () => {
  const [channel] = sanitizeNotificationChannels([
    {
      id: ' feed ',
      name: ' Example ',
      kind: 'rss',
      enabled: true,
      checkIntervalMinutes: 1,
      config: { url: ' https://example.com/feed.xml ', intervalSec: 60 },
    },
  ])

  assert.equal(channel.id, 'feed')
  assert.equal(channel.name, 'Example')
  assert.equal(channel.checkIntervalMinutes, MIN_RSS_INTERVAL_MINUTES)
  assert.equal(channel.config.url, 'https://example.com/feed.xml')
  assert.equal(channel.config.intervalSec, MIN_RSS_INTERVAL_MINUTES * 60)
})

test('notification bridge can migrate old RSS intervalSec-only channels', () => {
  const [channel] = sanitizeNotificationChannels([
    {
      id: 'feed',
      name: 'Example',
      kind: 'rss',
      enabled: true,
      config: { url: 'https://example.com/feed.xml', intervalSec: 900 },
    },
  ])

  assert.equal(channel.checkIntervalMinutes, 15)
  assert.equal(channel.config.intervalSec, 900)
})

test('notification bridge defaults missing RSS intervals and exposes body cap', () => {
  const [channel] = sanitizeNotificationChannels([
    {
      id: 'feed',
      name: 'Example',
      kind: 'rss',
      enabled: true,
      config: { url: 'https://example.com/feed.xml' },
    },
  ])

  assert.equal(channel.checkIntervalMinutes, DEFAULT_RSS_INTERVAL_MINUTES)
  assert.equal(channel.config.intervalSec, DEFAULT_RSS_INTERVAL_MINUTES * 60)
  assert.equal(WEBHOOK_MAX_BODY_BYTES, 64 * 1024)
})

test('notification bridge normalizes explicit chat message webhook payloads', () => {
  const result = normalizeWebhookPayload({
    kind: 'message',
    source: '微信',
    chatTitle: '项目群',
    sender: ' 张三 ',
    text: '  晚上同步一下\n\n进展 ',
    conversationId: 'room-1',
    messageId: 'msg-1',
  })

  assert.equal(result.ok, true)
  assert.equal(result.message.kind, 'message')
  assert.equal(result.message.sourceName, '微信')
  assert.equal(result.message.title, '项目群')
  assert.equal(result.message.sender, '张三')
  assert.equal(result.message.body, '晚上同步一下 进展')
  assert.equal(result.message.conversationId, 'room-1')
  assert.equal(result.message.messageId, 'msg-1')
})

test('notification bridge keeps ordinary webhook payloads as notifications', () => {
  const result = normalizeWebhookPayload({
    source: 'CI',
    title: 'Build finished',
    body: 'green',
  })

  assert.equal(result.ok, true)
  assert.equal(result.message.kind, 'notification')
  assert.equal(result.message.sourceName, 'CI')
  assert.equal(result.message.title, 'Build finished')
})

// ── Webhook auth hardening (ClawJacked-informed) ─────────────────────────────

import { verifyWebhookAuth, createAuthFailureLimiter } from '../electron/services/notificationBridgeUtils.js'

describe('verifyWebhookAuth', () => {
  test('accepts the exact bearer token', () => {
    assert.equal(verifyWebhookAuth('Bearer secret-token-123', 'secret-token-123'), true)
  })

  test('rejects wrong, malformed and missing headers', () => {
    assert.equal(verifyWebhookAuth('Bearer wrong', 'secret-token-123'), false)
    assert.equal(verifyWebhookAuth('secret-token-123', 'secret-token-123'), false)
    assert.equal(verifyWebhookAuth(undefined, 'secret-token-123'), false)
    assert.equal(verifyWebhookAuth('Bearer ', 'secret-token-123'), false)
  })

  test('an unset server token authorizes nobody', () => {
    assert.equal(verifyWebhookAuth('Bearer anything', null), false)
    assert.equal(verifyWebhookAuth('Bearer ', ''), false)
  })
})

describe('createAuthFailureLimiter', () => {
  test('blocks after maxFailures inside the window and recovers after it', () => {
    let nowMs = 1_000_000
    const limiter = createAuthFailureLimiter({ maxFailures: 3, windowMs: 60_000, now: () => nowMs })

    assert.equal(limiter.isBlocked(), false)
    limiter.recordFailure()
    limiter.recordFailure()
    assert.equal(limiter.isBlocked(), false)
    limiter.recordFailure()
    assert.equal(limiter.isBlocked(), true)

    // Window slides: old failures expire, the door reopens.
    nowMs += 61_000
    assert.equal(limiter.isBlocked(), false)
  })
})
