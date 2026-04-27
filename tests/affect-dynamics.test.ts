import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  computeAffectSnapshot,
  compareAffectSnapshots,
} from '../src/features/autonomy/affectDynamics.ts'
import {
  textSignalToVAD,
  voiceEmotionToVAD,
} from '../src/features/autonomy/userAffectTimeline.ts'
import type { UserAffectSample } from '../src/features/autonomy/userAffectTimeline.ts'

const ISO = (offsetHours: number) => new Date(Date.parse('2026-04-01T00:00:00Z') + offsetHours * 3600_000).toISOString()

function sample(valence: number, arousal: number, hour = 0): UserAffectSample {
  return {
    ts: ISO(hour),
    valence,
    arousal,
    source: 'text_signal',
    confidence: 0.7,
  }
}

// ── computeAffectSnapshot ─────────────────────────────────────────────────

test('computeAffectSnapshot: empty window → all nulls', () => {
  const snap = computeAffectSnapshot([])
  assert.equal(snap.n, 0)
  assert.equal(snap.baselineValence, null)
  assert.equal(snap.variability, null)
  assert.equal(snap.inertia, null)
})

test('computeAffectSnapshot: single sample → baseline only, no variability/inertia', () => {
  const snap = computeAffectSnapshot([sample(0.4, 0.5)])
  assert.equal(snap.n, 1)
  assert.equal(snap.baselineValence, 0.4)
  assert.equal(snap.baselineArousal, 0.5)
  assert.equal(snap.variability, null)
  assert.equal(snap.inertia, null)
})

test('computeAffectSnapshot: two samples → variability available, inertia still null', () => {
  const snap = computeAffectSnapshot([sample(0.2, 0.5, 0), sample(0.6, 0.5, 1)])
  assert.equal(snap.n, 2)
  assert.equal(snap.baselineValence, 0.4)
  assert.ok(snap.variability != null && snap.variability > 0)
  assert.equal(snap.inertia, null)
})

test('computeAffectSnapshot: monotonic positive trend → high inertia (sticky moods)', () => {
  // Steady upward trend over enough samples that the lag-1 autocorrelation
  // climbs comfortably past 0.5 (5/6-sample linear ramps land around 0.4-0.5
  // exactly; 7+ samples cross the threshold).
  const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((v, i) => sample(v, 0.5, i))
  const snap = computeAffectSnapshot(samples)
  assert.ok(snap.inertia != null && snap.inertia > 0.5, `expected inertia > 0.5, got ${snap.inertia}`)
})

test('computeAffectSnapshot: alternating series → low / negative inertia', () => {
  const samples = [0.4, -0.4, 0.4, -0.4, 0.4, -0.4].map((v, i) => sample(v, 0.5, i))
  const snap = computeAffectSnapshot(samples)
  assert.ok(snap.inertia != null && snap.inertia < 0, `expected inertia < 0 for alternating series, got ${snap.inertia}`)
})

test('computeAffectSnapshot: flat series → inertia == 0 (no division-by-zero)', () => {
  const samples = [0.3, 0.3, 0.3, 0.3].map((v, i) => sample(v, 0.5, i))
  const snap = computeAffectSnapshot(samples)
  assert.equal(snap.inertia, 0)
  assert.equal(snap.variability, 0)
})

test('computeAffectSnapshot: window endpoints captured', () => {
  const snap = computeAffectSnapshot([sample(0.1, 0.5, 0), sample(0.5, 0.5, 24)])
  assert.equal(snap.windowStart, ISO(0))
  assert.equal(snap.windowEnd, ISO(24))
})

// ── compareAffectSnapshots ────────────────────────────────────────────────

test('compareAffectSnapshots: month-over-month lift triggers notable shift', () => {
  const earlier = computeAffectSnapshot([sample(0.2, 0.5, 0), sample(0.3, 0.5, 24)])
  const later = computeAffectSnapshot([sample(0.5, 0.5, 48), sample(0.6, 0.5, 72)])
  const shift = compareAffectSnapshots(earlier, later)
  assert.ok(shift.baselineValenceDelta != null && shift.baselineValenceDelta > 0)
  assert.equal(shift.valenceShiftIsNotable, true)
})

test('compareAffectSnapshots: small drift not notable', () => {
  const earlier = computeAffectSnapshot([sample(0.40, 0.5, 0), sample(0.42, 0.5, 24)])
  const later = computeAffectSnapshot([sample(0.43, 0.5, 48), sample(0.44, 0.5, 72)])
  const shift = compareAffectSnapshots(earlier, later)
  assert.equal(shift.valenceShiftIsNotable, false)
})

test('compareAffectSnapshots: variability spike detected', () => {
  // Earlier window: nearly flat. Later: wide swings.
  const earlier = computeAffectSnapshot([
    sample(0.30, 0.5, 0), sample(0.31, 0.5, 24), sample(0.30, 0.5, 48),
  ])
  const later = computeAffectSnapshot([
    sample(-0.5, 0.5, 72), sample(0.7, 0.5, 96), sample(-0.6, 0.5, 120),
  ])
  const shift = compareAffectSnapshots(earlier, later)
  assert.equal(shift.variabilityRoseSharply, true)
})

test('compareAffectSnapshots: high inertia flagged on Kuppens threshold', () => {
  const earlier = computeAffectSnapshot([sample(0, 0.5, 0)])
  // Steady climb over 7 samples → inertia comfortably >= 0.4 even with
  // floating-point round-off (5-sample ramps land *exactly* on 0.4 and
  // would flake against the >= comparison).
  const later = computeAffectSnapshot(
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((v, i) => sample(v, 0.5, 24 + i)),
  )
  const shift = compareAffectSnapshots(earlier, later)
  assert.equal(shift.inertiaIsHigh, true)
})

test('compareAffectSnapshots: null baselines pass through to deltas', () => {
  const empty = computeAffectSnapshot([])
  const filled = computeAffectSnapshot([sample(0.5, 0.5, 0)])
  const shift = compareAffectSnapshots(empty, filled)
  assert.equal(shift.baselineValenceDelta, null)
  assert.equal(shift.valenceShiftIsNotable, false)
})

// ── Source-specific mappers ───────────────────────────────────────────────

test('voiceEmotionToVAD: happy is high V/A, sad is low V', () => {
  const happy = voiceEmotionToVAD('happy')
  const sad = voiceEmotionToVAD('sad')
  assert.ok(happy.valence > 0)
  assert.ok(sad.valence < 0)
  assert.ok(happy.arousal > sad.arousal)
})

test('voiceEmotionToVAD: angry vs fearful — same valence sign, angry slightly higher arousal', () => {
  const angry = voiceEmotionToVAD('angry')
  const fearful = voiceEmotionToVAD('fearful')
  assert.ok(angry.valence < 0 && fearful.valence < 0)
  assert.ok(angry.arousal > fearful.arousal)
})

test('voiceEmotionToVAD: surprised is mid-V high-A', () => {
  const surprised = voiceEmotionToVAD('surprised')
  assert.ok(Math.abs(surprised.valence) < 0.2)
  assert.ok(surprised.arousal > 0.7)
})

test('textSignalToVAD: praise positive, frustration negative', () => {
  assert.ok(textSignalToVAD('praise').valence > 0)
  assert.ok(textSignalToVAD('frustration').valence < 0)
})
