import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decideBracket,
  type BracketDecisionInput,
} from '../src/features/proactive/bracketScheduler.ts'

const HOUR = 60 * 60_000

const MORNING_8 = new Date('2026-04-25T08:00:00').getTime()
const EVENING_22 = new Date('2026-04-25T22:00:00').getTime()
const NOON = new Date('2026-04-25T12:00:00').getTime()
const NIGHT_3AM = new Date('2026-04-25T03:00:00').getTime()

function base(overrides: Partial<BracketDecisionInput> = {}): BracketDecisionInput {
  return {
    enabled: true,
    nowMs: MORNING_8,
    lastMorningFiredMs: null,
    lastEveningFiredMs: null,
    relationshipType: 'friend',
    ...overrides,
  }
}

test('fires morning when in morning window and unfired', () => {
  const r = decideBracket(base())
  assert.equal(r.shouldFire, true)
  assert.equal(r.shouldFire && r.bracket, 'morning')
})

test('fires evening when in evening window and unfired', () => {
  const r = decideBracket(base({ nowMs: EVENING_22 }))
  assert.equal(r.shouldFire, true)
  assert.equal(r.shouldFire && r.bracket, 'evening')
})

test('does not fire outside both windows (noon)', () => {
  const r = decideBracket(base({ nowMs: NOON }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'outside_windows')
})

test('does not fire deep night (3am)', () => {
  const r = decideBracket(base({ nowMs: NIGHT_3AM }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'outside_windows')
})

test('does not fire when disabled', () => {
  const r = decideBracket(base({ enabled: false }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'disabled')
})

test('quiet_companion relationship opts out', () => {
  const r = decideBracket(base({ relationshipType: 'quiet_companion' }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'relationship_type_opted_out')
})

test('skips morning when already fired today', () => {
  const r = decideBracket(base({ lastMorningFiredMs: MORNING_8 - 30 * 60_000 }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'morning_already_fired_today')
})

test('fires morning the next day even if it fired yesterday', () => {
  const yesterday = MORNING_8 - 24 * HOUR
  const r = decideBracket(base({ lastMorningFiredMs: yesterday }))
  assert.equal(r.shouldFire, true)
})

test('skips evening if morning fired less than minGapHours ago (same day)', () => {
  // Should not happen in practice since morning < evening, but guards
  // against a clock-skip / weird timezone shift case.
  const recentMorning = EVENING_22 - 4 * HOUR
  const r = decideBracket(base({ nowMs: EVENING_22, lastMorningFiredMs: recentMorning }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'too_close_to_other_bracket')
})

test('fires evening when morning was earlier same day past min gap', () => {
  const morningEarlier = EVENING_22 - 14 * HOUR
  const r = decideBracket(base({ nowMs: EVENING_22, lastMorningFiredMs: morningEarlier }))
  assert.equal(r.shouldFire, true)
  assert.equal(r.shouldFire && r.bracket, 'evening')
})

test('skips evening when already fired today', () => {
  const r = decideBracket(base({ nowMs: EVENING_22, lastEveningFiredMs: EVENING_22 - 30 * 60_000 }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'evening_already_fired_today')
})

test('respects custom morning window', () => {
  const six = new Date('2026-04-25T06:00:00').getTime()
  const r = decideBracket(base({
    nowMs: six,
    morningWindow: { startHour: 6, endHour: 9 },
  }))
  assert.equal(r.shouldFire, true)
  assert.equal(r.shouldFire && r.bracket, 'morning')
})
