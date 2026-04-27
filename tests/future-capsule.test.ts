import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildFutureCapsuleDelivery,
  daysBetween,
} from '../src/features/futureCapsule/futureCapsuleDelivery.ts'

// ── daysBetween ──────────────────────────────────────────────────────────

test('daysBetween: future timestamp returns 0', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  assert.equal(daysBetween(future, new Date()), 0)
})

test('daysBetween: same instant returns 0', () => {
  const now = new Date()
  assert.equal(daysBetween(now.toISOString(), now), 0)
})

test('daysBetween: ~30 days ago returns 30', () => {
  const now = new Date('2026-04-30T12:00:00Z')
  const earlier = new Date('2026-03-31T12:00:00Z').toISOString()
  assert.equal(daysBetween(earlier, now), 30)
})

test('daysBetween: less than a day rounds up to 1 (so the body never says "0 days")', () => {
  const now = new Date()
  const earlier = new Date(now.getTime() - 60 * 60 * 1000).toISOString()  // 1h ago
  assert.equal(daysBetween(earlier, now), 1)
})

test('daysBetween: malformed ISO returns 0', () => {
  assert.equal(daysBetween('not-an-iso', new Date()), 0)
})

// ── buildFutureCapsuleDelivery ───────────────────────────────────────────

const baseCapsule = {
  id: 'x',
  message: 'hi',
  createdAt: '2026-03-31T12:00:00Z',
  scheduledFor: '2026-04-30',
  status: 'pending' as const,
}

test('buildFutureCapsuleDelivery: zh-CN includes the message and days-ago', () => {
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'zh-CN',
    companionName: '星',
    capsule: { ...baseCapsule, message: '记得善待自己' },
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.match(result.body, /30 天前/)
  assert.match(result.body, /记得善待自己/)
})

test('buildFutureCapsuleDelivery: titled vs untitled produce different copy', () => {
  const now = new Date('2026-04-30T12:00:00Z')
  const untitled = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule: baseCapsule,
    now,
  })
  const titled = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule: { ...baseCapsule, title: 'after the album' },
    now,
  })
  assert.notEqual(untitled.body, titled.body)
  assert.match(titled.body, /after the album/)
})

test('buildFutureCapsuleDelivery: trims very long message', () => {
  const longMsg = 'x'.repeat(500)
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    capsule: { ...baseCapsule, message: longMsg },
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.ok(!result.body.includes('x'.repeat(200)), 'expected the message to be trimmed')
  assert.match(result.body, /…/)
})

test('buildFutureCapsuleDelivery: unknown locale falls back to en-US', () => {
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'eo' as never,
    companionName: 'Nexus',
    capsule: baseCapsule,
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.match(result.body, /you wrote/)
})

test('buildFutureCapsuleDelivery: empty companion name falls back to "Nexus"', () => {
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'en-US',
    companionName: '',
    capsule: baseCapsule,
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.match(result.body, /Nexus/)
})

test('buildFutureCapsuleDelivery: each of the 5 locales returns non-empty distinct body', () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const bodies = locales.map((l) =>
    buildFutureCapsuleDelivery({
      uiLanguage: l,
      companionName: 'Nexus',
      capsule: baseCapsule,
      now: new Date('2026-04-30T12:00:00Z'),
    }).body,
  )
  for (const body of bodies) {
    assert.ok(body.length > 0, 'expected non-empty body')
  }
  assert.equal(new Set(bodies).size, locales.length, 'each locale should produce a distinct copy')
})

test('buildFutureCapsuleDelivery: returns a localized title label', () => {
  const result = buildFutureCapsuleDelivery({
    uiLanguage: 'zh-CN',
    companionName: '星',
    capsule: baseCapsule,
    now: new Date('2026-04-30T12:00:00Z'),
  })
  assert.match(result.title, /过去的你/)
})
