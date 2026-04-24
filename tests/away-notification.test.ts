import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decideAwayNotification,
  type AwayNotificationDecisionInput,
} from '../src/features/proactive/awayScheduler.ts'
import { pickAwayNotificationCopy } from '../src/features/proactive/awayNotificationCopy.ts'
import type { CompanionRelationshipType, UiLanguage } from '../src/types/app.ts'

const MIN = 60_000
const HOUR = 60 * MIN

// Pin "now" to a daytime moment so quiet-hours checks pass by default.
// 2026-04-25 14:00 local = idle thinking-of-you window.
const NOW = new Date('2026-04-25T14:00:00').getTime()

function base(overrides: Partial<AwayNotificationDecisionInput> = {}): AwayNotificationDecisionInput {
  return {
    enabled: true,
    nowMs: NOW,
    lastUserActivityMs: NOW - 5 * HOUR,
    lastFiredMs: null,
    thresholdMinutes: 240,
    ...overrides,
  }
}

test('decideAwayNotification: fires when idle past threshold and not in cooldown/quiet', () => {
  const result = decideAwayNotification(base())
  assert.equal(result.shouldFire, true)
  assert.equal(result.reason, 'fire')
})

test('decideAwayNotification: does not fire when disabled', () => {
  const result = decideAwayNotification(base({ enabled: false }))
  assert.equal(result.shouldFire, false)
  assert.equal(result.reason, 'disabled')
})

test('decideAwayNotification: does not fire when below threshold', () => {
  const result = decideAwayNotification(base({ lastUserActivityMs: NOW - 30 * MIN }))
  assert.equal(result.shouldFire, false)
  assert.equal(result.reason, 'below_threshold')
})

test('decideAwayNotification: does not fire while cooldown is active', () => {
  const result = decideAwayNotification(base({ lastFiredMs: NOW - 30 * MIN }))
  assert.equal(result.shouldFire, false)
  assert.equal(result.reason, 'in_cooldown')
})

test('decideAwayNotification: does not fire during quiet hours (wrap-around 23-08)', () => {
  const earlyAm = new Date('2026-04-25T03:00:00').getTime()
  const result = decideAwayNotification(base({ nowMs: earlyAm, lastUserActivityMs: earlyAm - 5 * HOUR }))
  assert.equal(result.shouldFire, false)
  assert.equal(result.reason, 'quiet_hours')
})

test('decideAwayNotification: fires at 09:00 (just past quiet window)', () => {
  const t = new Date('2026-04-25T09:00:00').getTime()
  const result = decideAwayNotification(base({ nowMs: t, lastUserActivityMs: t - 5 * HOUR }))
  assert.equal(result.shouldFire, true)
})

test('decideAwayNotification: skips when no activity recorded yet', () => {
  const result = decideAwayNotification(base({ lastUserActivityMs: null }))
  assert.equal(result.shouldFire, false)
  assert.equal(result.reason, 'no_activity_yet')
})

test('pickAwayNotificationCopy: interpolates companion name', () => {
  const out = pickAwayNotificationCopy({
    uiLanguage: 'zh-CN',
    relationshipType: 'open_ended',
    companionName: '星绘',
    randomFn: () => 0,
  })
  assert.match(out.title, /星绘/)
})

test('pickAwayNotificationCopy: returns distinct buckets per relationship type', () => {
  const seen = new Set<string>()
  const types: CompanionRelationshipType[] = ['friend', 'mentor', 'quiet_companion']
  for (const t of types) {
    const out = pickAwayNotificationCopy({
      uiLanguage: 'zh-CN',
      relationshipType: t,
      companionName: 'X',
      randomFn: () => 0,
    })
    seen.add(`${out.title}|${out.body}`)
  }
  assert.equal(seen.size, 3)
})

test('pickAwayNotificationCopy: all 5 locales produce non-empty body for every type', () => {
  const locales: UiLanguage[] = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']
  const types: CompanionRelationshipType[] = ['open_ended', 'friend', 'mentor', 'quiet_companion']
  for (const loc of locales) {
    for (const t of types) {
      const out = pickAwayNotificationCopy({
        uiLanguage: loc,
        relationshipType: t,
        companionName: 'X',
        randomFn: () => 0,
      })
      assert.ok(out.title.length > 0 && out.body.length > 0, `${loc}/${t}`)
    }
  }
})
