import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createDefaultRhythmProfile,
  normalizeRhythmProfile,
} from '../src/features/autonomy/rhythmLearner.ts'

test('normalizeRhythmProfile returns defaults for non-object persistence', () => {
  const normalized = normalizeRhythmProfile(null)
  assert.equal(normalized.slots.length, 24)
  assert.deepEqual(normalized.slots, new Array(24).fill(0))
  assert.equal(normalized.totalInteractions, 0)
})

test('normalizeRhythmProfile clamps slots and preserves exactly 24 hourly buckets', () => {
  const normalized = normalizeRhythmProfile({
    slots: [2, -1, Number.NaN, 12_000, ...new Array(30).fill(0.5)],
    lastDecayDate: '2026-06-04',
    totalInteractions: 12.6,
  })

  assert.equal(normalized.slots.length, 24)
  assert.deepEqual(normalized.slots.slice(0, 5), [2, 0, 0, 10_000, 0.5])
  assert.equal(normalized.lastDecayDate, '2026-06-04')
  assert.equal(normalized.totalInteractions, 13)
})

test('normalizeRhythmProfile falls back for bad decay date and derives total when missing', () => {
  const fallback = createDefaultRhythmProfile()
  const normalized = normalizeRhythmProfile({
    slots: [1, 2, 3],
    lastDecayDate: 'not-a-date',
  })

  assert.equal(normalized.lastDecayDate, fallback.lastDecayDate)
  assert.equal(normalized.totalInteractions, 6)
})
