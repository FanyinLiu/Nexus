import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decideErrandRun,
  isInWindow,
  nightAnchorIso,
  recordRun,
  type ErrandRunnerState,
} from '../src/features/agent/errandPolicy.ts'
import { buildErrandDeliveryBody } from '../src/features/agent/errandDelivery.ts'

// ── isInWindow ────────────────────────────────────────────────────────────

test('isInWindow: non-wrapping window 9-17', () => {
  const w = { startHour: 9, endHour: 17 }
  assert.equal(isInWindow(8, w), false)
  assert.equal(isInWindow(9, w), true)
  assert.equal(isInWindow(13, w), true)
  assert.equal(isInWindow(17, w), false)
})

test('isInWindow: wrapping window 22-6', () => {
  const w = { startHour: 22, endHour: 6 }
  assert.equal(isInWindow(21, w), false)
  assert.equal(isInWindow(22, w), true)
  assert.equal(isInWindow(23, w), true)
  assert.equal(isInWindow(0, w), true)
  assert.equal(isInWindow(5, w), true)
  assert.equal(isInWindow(6, w), false)
  assert.equal(isInWindow(12, w), false)
})

test('isInWindow: degenerate start === end window is empty', () => {
  const w = { startHour: 12, endHour: 12 }
  assert.equal(isInWindow(11, w), false)
  assert.equal(isInWindow(12, w), false)
  assert.equal(isInWindow(13, w), false)
})

// ── decideErrandRun ───────────────────────────────────────────────────────

function atHour(hour: number): number {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

test('decideErrandRun: outside window → outside_window', () => {
  const decision = decideErrandRun({
    nowMs: atHour(13),
    hasQueuedErrand: true,
    state: {},
  })
  assert.equal(decision.shouldRun, false)
  if (!decision.shouldRun) assert.equal(decision.reason, 'outside_window')
})

test('decideErrandRun: empty queue → no_queued_errand', () => {
  const decision = decideErrandRun({
    nowMs: atHour(23),
    hasQueuedErrand: false,
    state: {},
  })
  assert.equal(decision.shouldRun, false)
  if (!decision.shouldRun) assert.equal(decision.reason, 'no_queued_errand')
})

test('decideErrandRun: cooldown blocks consecutive runs', () => {
  const lastRun = new Date(atHour(23) - 5 * 60 * 1000).toISOString()
  const decision = decideErrandRun({
    nowMs: atHour(23),
    hasQueuedErrand: true,
    state: { lastRunAt: lastRun },
  })
  assert.equal(decision.shouldRun, false)
  if (!decision.shouldRun) assert.equal(decision.reason, 'cooldown')
})

test('decideErrandRun: cooldown clears after 15 min', () => {
  const lastRun = new Date(atHour(23) - 20 * 60 * 1000).toISOString()
  const decision = decideErrandRun({
    nowMs: atHour(23),
    hasQueuedErrand: true,
    state: { lastRunAt: lastRun },
  })
  assert.equal(decision.shouldRun, true)
})

test('decideErrandRun: per-night budget exhausts', () => {
  const nowMs = atHour(23)
  const anchor = nightAnchorIso(nowMs)
  const decision = decideErrandRun({
    nowMs,
    hasQueuedErrand: true,
    state: {
      nightStartedAt: anchor,
      ranThisNight: 4,
      // make cooldown not the bottleneck:
      lastRunAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
    },
  })
  assert.equal(decision.shouldRun, false)
  if (!decision.shouldRun) assert.equal(decision.reason, 'night_budget_exhausted')
})

test('decideErrandRun: budget resets across night anchors', () => {
  // State says we've run 4 already, but with an old anchor (yesterday's). The
  // new run should be allowed and start a fresh count.
  const nowMs = atHour(23)
  const decision = decideErrandRun({
    nowMs,
    hasQueuedErrand: true,
    state: {
      nightStartedAt: '2020-01-01T22:00:00.000Z',
      ranThisNight: 4,
    },
  })
  assert.equal(decision.shouldRun, true)
})

// ── recordRun ─────────────────────────────────────────────────────────────

test('recordRun: increments existing-night counter', () => {
  const anchor = nightAnchorIso(atHour(23))
  const before: ErrandRunnerState = {
    nightStartedAt: anchor,
    ranThisNight: 2,
    lastRunAt: '2026-04-26T22:00:00.000Z',
  }
  const after = recordRun(before, anchor, '2026-04-27T00:00:00.000Z')
  assert.equal(after.ranThisNight, 3)
  assert.equal(after.lastRunAt, '2026-04-27T00:00:00.000Z')
  assert.equal(after.nightStartedAt, anchor)
})

test('recordRun: starts a fresh count on a new anchor', () => {
  const before: ErrandRunnerState = {
    nightStartedAt: '2020-01-01T22:00:00.000Z',
    ranThisNight: 5,
  }
  const newAnchor = nightAnchorIso(atHour(23))
  const after = recordRun(before, newAnchor, '2026-04-27T00:00:00.000Z')
  assert.equal(after.ranThisNight, 1)
  assert.equal(after.nightStartedAt, newAnchor)
})

// ── buildErrandDeliveryBody ───────────────────────────────────────────────

test('buildErrandDeliveryBody: zh-CN composes prompt + result', () => {
  const body = buildErrandDeliveryBody({
    uiLanguage: 'zh-CN',
    companionName: '星',
    prompt: '帮我查最好的浓缩咖啡磨豆机',
    result: 'Niche Zero 是性价比之选，旋转刀具均匀，800 美元附近。',
  })
  assert.match(body, /昨晚我帮你研究了/)
  assert.match(body, /浓缩咖啡磨豆机/)
  assert.match(body, /Niche Zero/)
})

test('buildErrandDeliveryBody: trims long prompt + result', () => {
  const longPrompt = 'a'.repeat(500)
  const longResult = 'b'.repeat(500)
  const body = buildErrandDeliveryBody({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    prompt: longPrompt,
    result: longResult,
  })
  // Cap is 60 + 90 + chrome; ensure the giant inputs were trimmed.
  assert.ok(body.length < 300, `expected <300 chars, got ${body.length}`)
  assert.match(body, /…/)
})

test('buildErrandDeliveryBody: falls back to en-US for unknown locale', () => {
  const body = buildErrandDeliveryBody({
    uiLanguage: 'eo' as never,
    companionName: 'Nexus',
    prompt: 'task',
    result: 'done',
  })
  assert.match(body, /looked into/)
})

test('buildErrandDeliveryBody: empty result becomes em dash', () => {
  const body = buildErrandDeliveryBody({
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    prompt: 'task',
    result: '',
  })
  assert.match(body, /—/)
})
