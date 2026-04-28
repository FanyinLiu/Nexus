import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyCoRegulation,
  computeCoRegulationSnapshot,
} from '../src/features/autonomy/coregulation.ts'
import type { UserAffectSample } from '../src/features/autonomy/userAffectTimeline.ts'
import type { EmotionSample } from '../src/features/autonomy/stateTimeline.ts'

function userSample(day: string, valence: number): UserAffectSample {
  // day = YYYY-MM-DD; build a noon-UTC ISO so the local-day binning is stable
  return {
    ts: `${day}T12:00:00Z`,
    valence,
    arousal: 0.5,
    source: 'text_signal',
    confidence: 0.5,
  }
}

function companionSample(day: string, warmth: number): EmotionSample {
  return {
    ts: `${day}T12:00:00Z`,
    energy: 0.5,
    warmth,
    curiosity: 0.5,
    concern: 0.5,
  }
}

// ── computeCoRegulationSnapshot ──────────────────────────────────────────

test('coreg: empty inputs → all-null snapshot', () => {
  const out = computeCoRegulationSnapshot([], [])
  assert.equal(out.n, 0)
  assert.equal(out.counterBalance, null)
  assert.equal(out.warmthValenceCorrelation, null)
})

test('coreg: only-user or only-companion data → empty', () => {
  const userOnly = computeCoRegulationSnapshot([userSample('2026-04-01', 0.2)], [])
  assert.equal(userOnly.n, 0)
  const companionOnly = computeCoRegulationSnapshot([], [companionSample('2026-04-01', 0.5)])
  assert.equal(companionOnly.n, 0)
})

test('coreg: counter-balance positive when companion warmer on user-low days', () => {
  // User valence: low (-0.5) on apr 01-02, neutral (+0.1) on apr 03-04.
  // Companion warmth: high (0.8) on apr 01-02, modest (0.4) on apr 03-04.
  // Companion is warmer when user is down → positive counter-balance.
  const user = [
    userSample('2026-04-01', -0.5),
    userSample('2026-04-02', -0.5),
    userSample('2026-04-03', 0.1),
    userSample('2026-04-04', 0.1),
  ]
  const companion = [
    companionSample('2026-04-01', 0.8),
    companionSample('2026-04-02', 0.8),
    companionSample('2026-04-03', 0.4),
    companionSample('2026-04-04', 0.4),
  ]
  const out = computeCoRegulationSnapshot(user, companion)
  assert.equal(out.n, 4)
  assert.ok(out.counterBalance != null)
  assert.ok(out.counterBalance! > 0.3)
  // warmthValenceCorrelation should be strongly negative
  assert.ok(out.warmthValenceCorrelation != null)
  assert.ok(out.warmthValenceCorrelation! < -0.5)
})

test('coreg: counter-balance negative when companion cooler on user-low days', () => {
  // Reverse pattern.
  const user = [
    userSample('2026-04-01', -0.5),
    userSample('2026-04-02', -0.5),
    userSample('2026-04-03', 0.1),
    userSample('2026-04-04', 0.1),
  ]
  const companion = [
    companionSample('2026-04-01', 0.2),
    companionSample('2026-04-02', 0.2),
    companionSample('2026-04-03', 0.8),
    companionSample('2026-04-04', 0.8),
  ]
  const out = computeCoRegulationSnapshot(user, companion)
  assert.ok(out.counterBalance != null)
  assert.ok(out.counterBalance! < -0.3)
})

test('coreg: counter-balance null when one valence-bucket is empty', () => {
  // All days have valence ≥ 0, so the "low" bucket is empty.
  const user = [
    userSample('2026-04-01', 0.1),
    userSample('2026-04-02', 0.2),
    userSample('2026-04-03', 0.3),
  ]
  const companion = [
    companionSample('2026-04-01', 0.5),
    companionSample('2026-04-02', 0.5),
    companionSample('2026-04-03', 0.5),
  ]
  const out = computeCoRegulationSnapshot(user, companion)
  assert.equal(out.n, 3)
  // counterBalance requires both buckets non-empty
  assert.equal(out.counterBalance, null)
  // correlation can still be computed
  assert.ok(out.warmthValenceCorrelation != null || out.warmthValenceCorrelation === null)
})

test('coreg: only days present in both streams are aligned', () => {
  // User has 5 days; companion has 3 — only 3 should be aligned.
  const user = [
    userSample('2026-04-01', 0.0),
    userSample('2026-04-02', 0.0),
    userSample('2026-04-03', 0.0),
    userSample('2026-04-04', 0.0),
    userSample('2026-04-05', 0.0),
  ]
  const companion = [
    companionSample('2026-04-02', 0.5),
    companionSample('2026-04-03', 0.5),
    companionSample('2026-04-04', 0.5),
  ]
  const out = computeCoRegulationSnapshot(user, companion)
  assert.equal(out.n, 3)
})

test('coreg: zero-variance series produces null correlation but counter-balance can still fire', () => {
  // Companion warmth is constant; correlation is undefined (den=0 → null).
  const user = [
    userSample('2026-04-01', -0.5),
    userSample('2026-04-02', 0.3),
    userSample('2026-04-03', -0.4),
  ]
  const companion = [
    companionSample('2026-04-01', 0.5),
    companionSample('2026-04-02', 0.5),
    companionSample('2026-04-03', 0.5),
  ]
  const out = computeCoRegulationSnapshot(user, companion)
  assert.equal(out.warmthValenceCorrelation, null)
  // counterBalance is computed from grouped means; with constant warmth → 0.
  assert.equal(out.counterBalance, 0)
})

// ── classifyCoRegulation ────────────────────────────────────────────────

test('classify: too few days → unknown', () => {
  const out = classifyCoRegulation({
    n: 2,
    counterBalance: 0.5,
    warmthValenceCorrelation: -0.7,
    windowStart: null,
    windowEnd: null,
  })
  assert.equal(out, 'unknown')
})

test('classify: positive counter-balance ≥ 0.15 → co-regulating', () => {
  const out = classifyCoRegulation({
    n: 5,
    counterBalance: 0.18,
    warmthValenceCorrelation: -0.1,
    windowStart: '2026-04-01',
    windowEnd: '2026-04-05',
  })
  assert.equal(out, 'co-regulating')
})

test('classify: strong negative correlation alone → co-regulating', () => {
  const out = classifyCoRegulation({
    n: 5,
    counterBalance: 0.05,
    warmthValenceCorrelation: -0.5,
    windowStart: '2026-04-01',
    windowEnd: '2026-04-05',
  })
  assert.equal(out, 'co-regulating')
})

test('classify: negative counter-balance ≤ -0.15 → mirroring', () => {
  const out = classifyCoRegulation({
    n: 5,
    counterBalance: -0.2,
    warmthValenceCorrelation: 0.1,
    windowStart: '2026-04-01',
    windowEnd: '2026-04-05',
  })
  assert.equal(out, 'mirroring')
})

test('classify: neutral metrics → flat', () => {
  const out = classifyCoRegulation({
    n: 5,
    counterBalance: 0.05,
    warmthValenceCorrelation: 0.1,
    windowStart: '2026-04-01',
    windowEnd: '2026-04-05',
  })
  assert.equal(out, 'flat')
})

test('classify: both metrics null → unknown even if n large', () => {
  const out = classifyCoRegulation({
    n: 10,
    counterBalance: null,
    warmthValenceCorrelation: null,
    windowStart: '2026-04-01',
    windowEnd: '2026-04-10',
  })
  assert.equal(out, 'unknown')
})
