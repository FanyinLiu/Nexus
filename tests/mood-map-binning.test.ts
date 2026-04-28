import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  binSamplesByDay,
  localDayKey,
} from '../src/features/autonomy/moodMapBinning.ts'
import type { UserAffectSample } from '../src/features/autonomy/userAffectTimeline.ts'

function sample(ts: string, valence: number, arousal: number): UserAffectSample {
  return { ts, valence, arousal, source: 'text_signal', confidence: 0.5 }
}

// ── localDayKey ──────────────────────────────────────────────────────────

test('localDayKey: returns YYYY-MM-DD for a valid ISO timestamp', () => {
  // Use noon UTC on a fixed day; the shape (length + dashes) is what we
  // check, since the actual day depends on the runner's TZ.
  const key = localDayKey('2026-04-15T12:00:00Z')
  assert.ok(key, 'expected non-null')
  assert.match(key!, /^\d{4}-\d{2}-\d{2}$/)
})

test('localDayKey: malformed string returns null', () => {
  assert.equal(localDayKey('not-a-timestamp'), null)
})

// ── binSamplesByDay ──────────────────────────────────────────────────────

test('binSamplesByDay: empty input produces empty output', () => {
  assert.deepEqual(binSamplesByDay([]), [])
})

test('binSamplesByDay: same-day samples collapse to a single bin with mean', () => {
  // Use ISO times that are unambiguously the same calendar day in any
  // sane local TZ — three timestamps in the middle of the day.
  const samples = [
    sample('2026-04-15T10:00:00Z', 0.2, 0.3),
    sample('2026-04-15T13:00:00Z', 0.4, 0.5),
    sample('2026-04-15T16:00:00Z', 0.6, 0.7),
  ]
  const bins = binSamplesByDay(samples)
  // We don't assert the exact day key (TZ-dependent), but expect 1 bin.
  assert.equal(bins.length, 1)
  assert.equal(bins[0].count, 3)
  assert.ok(Math.abs(bins[0].valence - 0.4) < 1e-9)
  assert.ok(Math.abs(bins[0].arousal - 0.5) < 1e-9)
})

test('binSamplesByDay: distinct days produce sorted bins', () => {
  // Pick noon UTC on 3 well-separated days so TZ shift can't reorder them.
  const samples = [
    sample('2026-04-17T12:00:00Z', 0.5, 0.5),
    sample('2026-04-15T12:00:00Z', 0.1, 0.2),
    sample('2026-04-16T12:00:00Z', 0.3, 0.4),
  ]
  const bins = binSamplesByDay(samples)
  assert.equal(bins.length, 3)
  // Sorted ascending: bin[0].day < bin[1].day < bin[2].day
  assert.ok(bins[0].day < bins[1].day)
  assert.ok(bins[1].day < bins[2].day)
  // First (earliest) day should carry the 0.1 valence sample
  assert.ok(Math.abs(bins[0].valence - 0.1) < 1e-9)
  // Last day should carry 0.5
  assert.ok(Math.abs(bins[bins.length - 1].valence - 0.5) < 1e-9)
})

test('binSamplesByDay: malformed timestamps are skipped, not crashed on', () => {
  const samples = [
    sample('garbage', 0.9, 0.9),
    sample('2026-04-15T12:00:00Z', 0.2, 0.3),
  ]
  const bins = binSamplesByDay(samples)
  assert.equal(bins.length, 1)
  assert.ok(Math.abs(bins[0].valence - 0.2) < 1e-9)
})
