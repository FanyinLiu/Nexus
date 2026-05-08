import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_RSS_INTERVAL_MINUTES,
  MAX_RSS_INTERVAL_MINUTES,
  MIN_RSS_INTERVAL_MINUTES,
  WEBHOOK_MAX_BODY_BYTES,
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
