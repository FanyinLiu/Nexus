import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildAffectGuidance,
  classifyAffectGuidance,
  type AffectGuidanceState,
} from '../src/features/autonomy/affectGuidance.ts'
import type { AffectSnapshot } from '../src/features/autonomy/affectDynamics.ts'

function snap(overrides: Partial<AffectSnapshot> = {}): AffectSnapshot {
  return {
    n: 10,
    baselineValence: 0,
    baselineArousal: 0.5,
    variability: 0.2,
    inertia: 0.1,
    windowStart: '2026-04-01T00:00:00Z',
    windowEnd: '2026-04-14T00:00:00Z',
    ...overrides,
  }
}

// ── classifyAffectGuidance ───────────────────────────────────────────────

test('classify: empty / too few samples → none', () => {
  assert.equal(
    classifyAffectGuidance({ snapshot: snap({ n: 0, baselineValence: null, variability: null, inertia: null }) }),
    'none',
  )
  assert.equal(classifyAffectGuidance({ snapshot: snap({ n: 4 }) }), 'none')
})

test('classify: stuck-low when baseline < -0.2 AND inertia >= 0.4', () => {
  const s: AffectGuidanceState = classifyAffectGuidance({
    snapshot: snap({ baselineValence: -0.3, inertia: 0.5, variability: 0.2 }),
  })
  assert.equal(s, 'stuck-low')
})

test('classify: not stuck-low when only one of the two thresholds is met', () => {
  // Low baseline but low inertia (not stuck) → should not classify as stuck.
  // With variability=0.2 (≤ 0.5), volatile won't trigger either; with v=-0.3
  // (not > 0.3), steady-warm won't trigger. So result is 'none'.
  assert.equal(
    classifyAffectGuidance({ snapshot: snap({ baselineValence: -0.3, inertia: 0.1 }) }),
    'none',
  )
  // High inertia but neutral baseline → not stuck-low.
  assert.equal(
    classifyAffectGuidance({ snapshot: snap({ baselineValence: 0.0, inertia: 0.5 }) }),
    'none',
  )
})

test('classify: volatile when variability > 0.5 (and not stuck-low)', () => {
  assert.equal(
    classifyAffectGuidance({ snapshot: snap({ variability: 0.6, baselineValence: 0.0, inertia: 0.1 }) }),
    'volatile',
  )
})

test('classify: stuck-low takes precedence over volatile', () => {
  // Both stuck-low (baseline < -0.2, inertia >= 0.4) AND volatile (variability > 0.5).
  // Stuck-low should win — it's the most actionable / most-needs-the-companion-
  // -to-back-off state.
  assert.equal(
    classifyAffectGuidance({
      snapshot: snap({ baselineValence: -0.4, inertia: 0.5, variability: 0.7 }),
    }),
    'stuck-low',
  )
})

test('classify: steady-warm when baseline > 0.3 AND variability < 0.3', () => {
  assert.equal(
    classifyAffectGuidance({ snapshot: snap({ baselineValence: 0.4, variability: 0.2, inertia: 0.1 }) }),
    'steady-warm',
  )
})

test('classify: mid-range baseline + low variability does not trigger steady-warm', () => {
  assert.equal(
    classifyAffectGuidance({ snapshot: snap({ baselineValence: 0.1, variability: 0.2 }) }),
    'none',
  )
})

test('classify: positive baseline but high variability → not steady-warm', () => {
  // baseline > 0.3 but variability >= 0.3 (and < 0.5 so not volatile either) → none
  assert.equal(
    classifyAffectGuidance({ snapshot: snap({ baselineValence: 0.4, variability: 0.45 }) }),
    'none',
  )
})

// ── recent-drop branch (M1.5) ────────────────────────────────────────────

test('classify: recent-drop when recent baseline ≤ long baseline - 0.2', () => {
  // Long-window baseline neutral (0.1), recent has dropped to -0.2 → delta -0.3.
  const s = classifyAffectGuidance({
    snapshot: snap({ baselineValence: 0.1, variability: 0.2, inertia: 0.1 }),
    recentSnapshot: snap({ n: 4, baselineValence: -0.2 }),
  })
  assert.equal(s, 'recent-drop')
})

test('classify: recent-drop ignored when recent has too few samples', () => {
  // recent.n must be >= 2; with n=1 the branch should be skipped.
  const s = classifyAffectGuidance({
    snapshot: snap({ baselineValence: 0.1 }),
    recentSnapshot: snap({ n: 1, baselineValence: -0.5 }),
  })
  assert.equal(s, 'none')
})

test('classify: shallow drop (delta > -0.2) does not trigger recent-drop', () => {
  // Drop of -0.15 — below the threshold magnitude.
  const s = classifyAffectGuidance({
    snapshot: snap({ baselineValence: 0.1 }),
    recentSnapshot: snap({ n: 5, baselineValence: -0.05 }),
  })
  assert.equal(s, 'none')
})

test('classify: stuck-low takes precedence over recent-drop', () => {
  // Long window matches stuck-low (chronic). Recent has also dropped.
  // The chronic signal is more load-bearing, so stuck-low wins.
  const s = classifyAffectGuidance({
    snapshot: snap({ baselineValence: -0.4, inertia: 0.5 }),
    recentSnapshot: snap({ n: 5, baselineValence: -0.7 }),
  })
  assert.equal(s, 'stuck-low')
})

test('classify: recent-drop takes precedence over volatile', () => {
  // Long window has high variability (volatile) AND recent dropped sharply.
  // Recent-drop wins — the acute signal is more actionable than the
  // generic "volatile, match the room" guidance.
  const s = classifyAffectGuidance({
    snapshot: snap({ baselineValence: 0.0, variability: 0.6, inertia: 0.1 }),
    recentSnapshot: snap({ n: 4, baselineValence: -0.3 }),
  })
  assert.equal(s, 'recent-drop')
})

test('classify: recentSnapshot omitted → recent-drop branch skipped', () => {
  // No recent snapshot passed; classifier ignores recent-drop branch entirely.
  const s = classifyAffectGuidance({
    snapshot: snap({ baselineValence: 0.0, variability: 0.2 }),
  })
  assert.equal(s, 'none')
})

// ── buildAffectGuidance ──────────────────────────────────────────────────

test('build: none state returns empty string', () => {
  const out = buildAffectGuidance({
    uiLanguage: 'en-US',
    snapshot: snap({ n: 0, baselineValence: null }),
  })
  assert.equal(out, '')
})

test('build: stuck-low produces prose containing the wrapping tag', () => {
  const out = buildAffectGuidance({
    uiLanguage: 'en-US',
    snapshot: snap({ baselineValence: -0.3, inertia: 0.5 }),
  })
  assert.match(out, /<user_affect_state>/)
  assert.match(out, /<\/user_affect_state>/)
  // Must instruct against naming the state to the user (privacy / no-clinical)
  assert.match(out, /[Dd]o not name this state/)
})

test('build: stuck-low prose mentions "stuck" pattern in en-US, distinct in zh-CN', () => {
  const en = buildAffectGuidance({
    uiLanguage: 'en-US',
    snapshot: snap({ baselineValence: -0.3, inertia: 0.5 }),
  })
  const zh = buildAffectGuidance({
    uiLanguage: 'zh-CN',
    snapshot: snap({ baselineValence: -0.3, inertia: 0.5 }),
  })
  assert.match(en, /stuck/)
  assert.match(zh, /卡住/)
  assert.notEqual(en, zh)
})

test('build: each of the 5 locales produces a non-empty distinct stuck-low body', () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const bodies = locales.map((l) =>
    buildAffectGuidance({
      uiLanguage: l,
      snapshot: snap({ baselineValence: -0.3, inertia: 0.5 }),
    }),
  )
  for (const b of bodies) assert.ok(b.length > 0)
  assert.equal(new Set(bodies).size, locales.length)
})

test('build: volatile vs steady-warm produce distinct bodies for same locale', () => {
  const vol = buildAffectGuidance({
    uiLanguage: 'en-US',
    snapshot: snap({ variability: 0.7 }),
  })
  const warm = buildAffectGuidance({
    uiLanguage: 'en-US',
    snapshot: snap({ baselineValence: 0.4, variability: 0.2 }),
  })
  assert.ok(vol.length > 0)
  assert.ok(warm.length > 0)
  assert.notEqual(vol, warm)
})

test('build: unknown locale falls back to en-US', () => {
  const out = buildAffectGuidance({
    uiLanguage: 'eo' as never,
    snapshot: snap({ baselineValence: -0.3, inertia: 0.5 }),
  })
  // en-US prose contains "stuck"
  assert.match(out, /stuck/)
})

test('build: recent-drop prose is distinct from stuck-low and volatile, mentions "landed"', () => {
  const drop = buildAffectGuidance({
    uiLanguage: 'en-US',
    snapshot: snap({ baselineValence: 0.1 }),
    recentSnapshot: snap({ n: 4, baselineValence: -0.2 }),
  })
  const stuck = buildAffectGuidance({
    uiLanguage: 'en-US',
    snapshot: snap({ baselineValence: -0.3, inertia: 0.5 }),
  })
  const vol = buildAffectGuidance({
    uiLanguage: 'en-US',
    snapshot: snap({ variability: 0.7 }),
  })
  assert.ok(drop.length > 0)
  assert.notEqual(drop, stuck)
  assert.notEqual(drop, vol)
  // The acute-event framing
  assert.match(drop, /landed/i)
})

test('build: recent-drop renders in 5 distinct locales', () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const bodies = locales.map((l) =>
    buildAffectGuidance({
      uiLanguage: l,
      snapshot: snap({ baselineValence: 0.1 }),
      recentSnapshot: snap({ n: 4, baselineValence: -0.2 }),
    }),
  )
  for (const b of bodies) assert.ok(b.length > 0)
  assert.equal(new Set(bodies).size, locales.length)
})
