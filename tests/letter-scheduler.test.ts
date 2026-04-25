import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decideLetter,
  type LetterDecisionInput,
} from '../src/features/letter/letterScheduler.ts'

const SUN_19 = new Date('2026-04-26T19:00:00').getTime() // Sunday 7pm local
const SUN_10 = new Date('2026-04-26T10:00:00').getTime() // Sunday 10am
const SAT_19 = new Date('2026-04-25T19:00:00').getTime()
const PREV_SUN_19 = new Date('2026-04-19T19:00:00').getTime()

function base(overrides: Partial<LetterDecisionInput> = {}): LetterDecisionInput {
  return {
    enabled: true,
    nowMs: SUN_19,
    lastFiredMs: null,
    relationshipType: 'friend',
    ...overrides,
  }
}

test('fires on Sunday evening when never fired before', () => {
  const r = decideLetter(base())
  assert.equal(r.shouldFire, true)
  assert.equal(r.reason, 'fire')
})

test('does not fire when disabled', () => {
  const r = decideLetter(base({ enabled: false }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'disabled')
})

test('quiet_companion opts out', () => {
  const r = decideLetter(base({ relationshipType: 'quiet_companion' }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'relationship_type_opted_out')
})

test('does not fire on Saturday evening', () => {
  const r = decideLetter(base({ nowMs: SAT_19 }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'not_sunday')
})

test('does not fire Sunday morning (before window)', () => {
  const r = decideLetter(base({ nowMs: SUN_10 }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'outside_window')
})

test('does not fire when already fired earlier the same Sunday', () => {
  const earlierSameSun = new Date('2026-04-26T18:30:00').getTime()
  const r = decideLetter(base({ lastFiredMs: earlierSameSun }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'already_fired_this_week')
})

test('fires when last fire was on the previous Sunday', () => {
  const r = decideLetter(base({ lastFiredMs: PREV_SUN_19 }))
  assert.equal(r.shouldFire, true)
})

test('respects custom window', () => {
  const sun9pm = new Date('2026-04-26T21:00:00').getTime()
  const r = decideLetter(base({
    nowMs: sun9pm,
    window: { startHour: 9, endHour: 20 }, // 9pm is outside
  }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'outside_window')
})

test('week boundary: a fire on Mon counts toward that prior Sunday week', () => {
  // Monday is a fresh week — the previous Sunday's fire shouldn't block
  // the next Sunday's fire (covered by the previous-Sunday test). And a
  // Monday-stamped fire shouldn't be possible under normal flow, but if
  // the clock jumped, it should still be in *its own* week boundary.
  const monday = new Date('2026-04-27T19:00:00').getTime()
  const lastFire = new Date('2026-04-26T19:00:00').getTime()
  // Same week per Sunday-key math (both belong to the 2026-04-26 Sunday week).
  // But Monday isn't a fire day → 'not_sunday', so the dedup doesn't matter.
  const r = decideLetter(base({ nowMs: monday, lastFiredMs: lastFire }))
  assert.equal(r.shouldFire, false)
  assert.equal(r.reason, 'not_sunday')
})
