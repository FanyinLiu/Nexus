import assert from 'node:assert/strict'
import { test } from 'node:test'

import { analyzeGuidance } from '../src/features/autonomy/guidanceAnalysis.ts'
import type { GuidanceTelemetryEntry } from '../src/features/autonomy/guidanceTelemetry.ts'
import type { UserAffectSample } from '../src/features/autonomy/userAffectTimeline.ts'

const HOUR_MS = 60 * 60 * 1000

function fire(
  kind: GuidanceTelemetryEntry['kind'],
  ts: string,
  beforeValence: number | null = null,
): GuidanceTelemetryEntry {
  return { kind, ts, beforeValence }
}

function sample(ts: string, valence: number): UserAffectSample {
  return { ts, valence, arousal: 0.5, source: 'text_signal', confidence: 0.5 }
}

// ── analyzeGuidance ──────────────────────────────────────────────────────

test('analyze: empty inputs → empty report, both pointer fields null', () => {
  const r = analyzeGuidance([], [], new Date('2026-04-28T12:00:00Z'))
  assert.equal(r.byKind.length, 0)
  assert.equal(r.bestPerformingKind, null)
  assert.equal(r.weakestKind, null)
})

test('analyze: counts fires per kind, regardless of whether affect samples exist', () => {
  const r = analyzeGuidance(
    [
      fire('affect:stuck-low', '2026-04-20T10:00:00Z'),
      fire('affect:stuck-low', '2026-04-21T10:00:00Z'),
      fire('rupture:contempt', '2026-04-22T10:00:00Z'),
    ],
    [],
    new Date('2026-04-28T12:00:00Z'),
  )
  const stuck = r.byKind.find((k) => k.kind === 'affect:stuck-low')
  const cont = r.byKind.find((k) => k.kind === 'rupture:contempt')
  assert.ok(stuck)
  assert.ok(cont)
  assert.equal(stuck!.fireCount, 2)
  assert.equal(cont!.fireCount, 1)
})

test('analyze: valenceDelta requires before+after sample on each fire', () => {
  // 4h window so fires 24h apart don't overlap each other's lookahead.
  // Fire 1 at 12:00, samples at 10:00 (-0.4) before, 14:00 (0.0) after.
  // Fire 2 a day later, same shape with bigger lift.
  const fires = [
    fire('affect:stuck-low', '2026-04-20T12:00:00Z'),
    fire('affect:stuck-low', '2026-04-21T12:00:00Z'),
  ]
  const samples = [
    sample('2026-04-20T10:00:00Z', -0.4),
    sample('2026-04-20T14:00:00Z', 0.0),
    sample('2026-04-21T10:00:00Z', -0.5),
    sample('2026-04-21T14:00:00Z', 0.1),
  ]
  const r = analyzeGuidance(fires, samples, new Date('2026-04-28T12:00:00Z'), {
    perFireWindowHours: 4,
  })
  const stuck = r.byKind.find((k) => k.kind === 'affect:stuck-low')!
  assert.equal(stuck.pairedFires, 2)
  // mean delta = ((0 - (-0.4)) + (0.1 - (-0.5))) / 2 = (0.4 + 0.6) / 2 = 0.5
  assert.ok(stuck.valenceDelta != null)
  assert.ok(Math.abs(stuck.valenceDelta! - 0.5) < 1e-9)
})

test('analyze: valenceDelta null when fewer than 2 paired fires', () => {
  // Single paired fire — not enough for a meaningful delta.
  const fires = [fire('affect:stuck-low', '2026-04-20T12:00:00Z')]
  const samples = [
    sample('2026-04-20T10:00:00Z', -0.4),
    sample('2026-04-20T14:00:00Z', 0.0),
  ]
  const r = analyzeGuidance(fires, samples, new Date('2026-04-28T12:00:00Z'))
  const stuck = r.byKind.find((k) => k.kind === 'affect:stuck-low')!
  assert.equal(stuck.pairedFires, 1)
  assert.equal(stuck.valenceDelta, null)
})

test('analyze: ignores samples within ±5s of fire (the "in the moment" sample)', () => {
  // Fire at exactly 12:00:00; sample at 12:00:02 should NOT count as before or after.
  // 4h window keeps the two fires' lookaheads from cross-contaminating.
  const fires = [
    fire('affect:stuck-low', '2026-04-20T12:00:00Z'),
    fire('affect:stuck-low', '2026-04-21T12:00:00Z'),
  ]
  const samples = [
    // The "in the moment" samples — within ±5s of fire — must be excluded.
    sample('2026-04-20T12:00:02Z', 99),
    sample('2026-04-21T12:00:02Z', 99),
    // Real before/after pairs.
    sample('2026-04-20T10:00:00Z', 0.0),
    sample('2026-04-20T14:00:00Z', 0.2),
    sample('2026-04-21T10:00:00Z', 0.0),
    sample('2026-04-21T14:00:00Z', 0.2),
  ]
  const r = analyzeGuidance(fires, samples, new Date('2026-04-28T12:00:00Z'), {
    perFireWindowHours: 4,
  })
  const stuck = r.byKind.find((k) => k.kind === 'affect:stuck-low')!
  // If the in-the-moment 99 leaked into either side, the means would explode;
  // expected delta = 0.2 across both fires.
  assert.ok(Math.abs(stuck.valenceDelta! - 0.2) < 1e-9)
})

test('analyze: ranks bestPerformingKind by valenceDelta', () => {
  // 3 fires for stuck-low → +0.3 lift; 3 fires for volatile → -0.1 (no lift / dip).
  const baseDay = new Date('2026-04-20T00:00:00Z').getTime()
  const fires: GuidanceTelemetryEntry[] = []
  const samples: UserAffectSample[] = []
  for (let i = 0; i < 3; i += 1) {
    const fireTs = new Date(baseDay + i * 24 * HOUR_MS).toISOString()
    fires.push(fire('affect:stuck-low', fireTs))
    samples.push(sample(new Date(baseDay + i * 24 * HOUR_MS - 2 * HOUR_MS).toISOString(), -0.2))
    samples.push(sample(new Date(baseDay + i * 24 * HOUR_MS + 2 * HOUR_MS).toISOString(), 0.1))
  }
  for (let i = 0; i < 3; i += 1) {
    const fireTs = new Date(baseDay + (i + 4) * 24 * HOUR_MS).toISOString()
    fires.push(fire('affect:volatile', fireTs))
    samples.push(sample(new Date(baseDay + (i + 4) * 24 * HOUR_MS - 2 * HOUR_MS).toISOString(), 0.1))
    samples.push(sample(new Date(baseDay + (i + 4) * 24 * HOUR_MS + 2 * HOUR_MS).toISOString(), 0.0))
  }
  const r = analyzeGuidance(fires, samples, new Date('2026-04-28T12:00:00Z'))
  assert.equal(r.bestPerformingKind, 'affect:stuck-low')
  assert.equal(r.weakestKind, 'affect:volatile')
})

test('analyze: kinds below minFires gate are excluded from best/weakest', () => {
  // stuck-low fires twice (below default minFires=3); should not be eligible.
  const fires = [
    fire('affect:stuck-low', '2026-04-20T12:00:00Z'),
    fire('affect:stuck-low', '2026-04-21T12:00:00Z'),
  ]
  const samples = [
    sample('2026-04-20T10:00:00Z', -0.4),
    sample('2026-04-20T14:00:00Z', 0.0),
    sample('2026-04-21T10:00:00Z', -0.4),
    sample('2026-04-21T14:00:00Z', 0.0),
  ]
  const r = analyzeGuidance(fires, samples, new Date('2026-04-28T12:00:00Z'))
  // Delta exists, but pairedFires=2 < minFires=3, so it shouldn't count.
  assert.equal(r.bestPerformingKind, null)
  assert.equal(r.weakestKind, null)
})

test('analyze: filters fires outside windowDays', () => {
  // Default windowDays = 365. A fire 400 days ago should be excluded.
  const now = new Date('2026-04-28T12:00:00Z')
  const tooOld = new Date(now.getTime() - 400 * 24 * HOUR_MS).toISOString()
  const recent = new Date(now.getTime() - 30 * 24 * HOUR_MS).toISOString()
  const r = analyzeGuidance(
    [
      fire('affect:stuck-low', tooOld),
      fire('affect:stuck-low', recent),
    ],
    [],
    now,
  )
  const stuck = r.byKind.find((k) => k.kind === 'affect:stuck-low')!
  assert.equal(stuck.fireCount, 1)
})

test('analyze: report fields are deterministic for stable inputs', () => {
  const fires = [
    fire('affect:stuck-low', '2026-04-20T12:00:00Z'),
    fire('affect:stuck-low', '2026-04-21T12:00:00Z'),
    fire('affect:stuck-low', '2026-04-22T12:00:00Z'),
  ]
  const samples = [
    sample('2026-04-20T10:00:00Z', -0.3),
    sample('2026-04-20T14:00:00Z', 0.0),
    sample('2026-04-21T10:00:00Z', -0.3),
    sample('2026-04-21T14:00:00Z', 0.0),
    sample('2026-04-22T10:00:00Z', -0.3),
    sample('2026-04-22T14:00:00Z', 0.0),
  ]
  const now = new Date('2026-04-28T12:00:00Z')
  const r1 = analyzeGuidance(fires, samples, now)
  const r2 = analyzeGuidance(fires, samples, now)
  assert.deepEqual(r1, r2)
})
