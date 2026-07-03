import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isSafeTimeMs,
  MAX_VALID_JS_DATE_MS,
  toFiniteTimeMs,
} from '../src/lib/time.ts'

test('isSafeTimeMs accepts only nonnegative safe JS date timestamps', () => {
  assert.equal(isSafeTimeMs(0), true)
  assert.equal(isSafeTimeMs(MAX_VALID_JS_DATE_MS), true)

  assert.equal(isSafeTimeMs(-1), false)
  assert.equal(isSafeTimeMs(1.5), false)
  assert.equal(isSafeTimeMs(Number.NaN), false)
  assert.equal(isSafeTimeMs(Number.POSITIVE_INFINITY), false)
  assert.equal(isSafeTimeMs(MAX_VALID_JS_DATE_MS + 1), false)
  assert.equal(isSafeTimeMs(Number.MAX_SAFE_INTEGER), false)
})

test('toFiniteTimeMs normalizes dates and rejects unsafe parsed values', () => {
  assert.equal(
    toFiniteTimeMs('2026-06-21T17:00:00.000Z'),
    Date.parse('2026-06-21T17:00:00.000Z'),
  )
  assert.equal(toFiniteTimeMs(new Date('2026-06-21T17:00:00.000Z')), Date.parse('2026-06-21T17:00:00.000Z'))
  assert.equal(toFiniteTimeMs('not a date'), null)
  assert.equal(toFiniteTimeMs(-1), null)
  assert.equal(toFiniteTimeMs(1.5), null)
  assert.equal(toFiniteTimeMs(Number.MAX_SAFE_INTEGER), null)
})
