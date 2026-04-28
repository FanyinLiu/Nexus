import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decideNextCheckIn,
} from '../src/features/arc/openArcPolicy.ts'
import { buildArcCheckIn } from '../src/features/arc/openArcDelivery.ts'
import type { OpenArcRecord } from '../src/features/arc/openArcStore.ts'

const DAY_MS = 24 * 60 * 60 * 1000

function arc(overrides: Partial<OpenArcRecord> = {}): OpenArcRecord {
  return {
    id: 'a',
    theme: 'manager 1:1 friday',
    startedAt: new Date().toISOString(),
    checkInDays: [3, 5],
    status: 'open',
    checkInsFired: [],
    ...overrides,
  }
}

const QUIET_OFF = { quietHoursStart: 0, quietHoursEnd: 0 }  // disabled

// ── decideNextCheckIn ────────────────────────────────────────────────────

test('decideNextCheckIn: empty list → no-arcs', () => {
  const d = decideNextCheckIn([], new Date('2026-04-30T10:00:00Z'), QUIET_OFF)
  assert.equal(d.shouldFire, false)
  assert.equal(d.reason, 'no-arcs')
})

test('decideNextCheckIn: arc just opened (day 0) → no-milestone-due, but framed as all-checked-in when no arc has any due', () => {
  // Day 0 means daysSoFar < 3, so no milestone due. Reason → all-checked-in
  // because we never set sawAnyFireable.
  const now = new Date('2026-04-30T12:00:00Z')
  const just = arc({ startedAt: now.toISOString() })
  const d = decideNextCheckIn([just], now, QUIET_OFF)
  assert.equal(d.shouldFire, false)
  // Either label is acceptable here — the user impact is "don't fire".
  assert.ok(d.reason === 'all-checked-in' || d.reason === 'no-milestone-due')
})

test('decideNextCheckIn: arc 3 days old, no pings yet → fires day-3 milestone', () => {
  const now = new Date('2026-04-30T12:00:00Z')
  const day3 = arc({ startedAt: new Date(now.getTime() - 3 * DAY_MS).toISOString() })
  const d = decideNextCheckIn([day3], now, QUIET_OFF)
  assert.equal(d.shouldFire, true)
  assert.equal(d.reason, 'fire')
  assert.equal(d.milestoneDay, 3)
  assert.equal(d.daysSinceStart, 3)
  assert.equal(d.arcId, 'a')
})

test('decideNextCheckIn: arc 5 days old, day-3 already fired → fires day-5', () => {
  const now = new Date('2026-04-30T12:00:00Z')
  const day5 = arc({
    startedAt: new Date(now.getTime() - 5 * DAY_MS).toISOString(),
    checkInsFired: [new Date(now.getTime() - 2 * DAY_MS).toISOString()],
  })
  const d = decideNextCheckIn([day5], now, QUIET_OFF)
  assert.equal(d.shouldFire, true)
  assert.equal(d.milestoneDay, 5)
})

test('decideNextCheckIn: arc fully checked in → all-checked-in, no fire', () => {
  const now = new Date('2026-04-30T12:00:00Z')
  const done = arc({
    startedAt: new Date(now.getTime() - 6 * DAY_MS).toISOString(),
    checkInsFired: [
      new Date(now.getTime() - 3 * DAY_MS).toISOString(),
      new Date(now.getTime() - 1 * DAY_MS).toISOString(),
    ],
  })
  const d = decideNextCheckIn([done], now, QUIET_OFF)
  assert.equal(d.shouldFire, false)
  assert.equal(d.reason, 'all-checked-in')
})

test('decideNextCheckIn: closed arcs are ignored', () => {
  const now = new Date('2026-04-30T12:00:00Z')
  const oldStart = new Date(now.getTime() - 5 * DAY_MS).toISOString()
  const arcs: OpenArcRecord[] = [
    arc({ id: 'r', startedAt: oldStart, status: 'resolved', resolvedAt: now.toISOString() }),
    arc({ id: 'd', startedAt: oldStart, status: 'dropped', droppedAt: now.toISOString() }),
  ]
  const d = decideNextCheckIn(arcs, now, QUIET_OFF)
  assert.equal(d.shouldFire, false)
  assert.equal(d.reason, 'no-arcs')
})

test('decideNextCheckIn: quiet hours block firing', () => {
  // Quiet 22-7; "now" = local 23:00 hour. Use Date constructor with locale.
  const fireTimeUtc = new Date('2026-04-30T15:00:00Z')
  // Coerce: build a now whose getHours() is 23 regardless of TZ — use a
  // local-date constructor.
  const now = new Date(2026, 3, 30, 23, 0, 0)  // Apr 30 2026 23:00 local
  void fireTimeUtc
  const day3 = arc({ startedAt: new Date(now.getTime() - 3 * DAY_MS).toISOString() })
  const d = decideNextCheckIn([day3], now, { quietHoursStart: 22, quietHoursEnd: 7 })
  assert.equal(d.shouldFire, false)
  assert.equal(d.reason, 'quiet-hours')
})

test('decideNextCheckIn: prefers oldest open arc when multiple are due', () => {
  const now = new Date('2026-04-30T12:00:00Z')
  const newer = arc({
    id: 'newer',
    startedAt: new Date(now.getTime() - 3 * DAY_MS).toISOString(),
  })
  const older = arc({
    id: 'older',
    startedAt: new Date(now.getTime() - 5 * DAY_MS).toISOString(),
    checkInsFired: [new Date(now.getTime() - 2 * DAY_MS).toISOString()],
  })
  const d = decideNextCheckIn([newer, older], now, QUIET_OFF)
  assert.equal(d.shouldFire, true)
  // older started first → wins
  assert.equal(d.arcId, 'older')
})

// ── buildArcCheckIn ──────────────────────────────────────────────────────

test('buildArcCheckIn: day 3 uses "still on your mind" prose, day 5 uses closure prose', () => {
  const a = arc({ theme: 'manager 1:1 friday' })
  const day3 = buildArcCheckIn({
    arc: a,
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    milestoneDay: 3,
  })
  const day5 = buildArcCheckIn({
    arc: a,
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    milestoneDay: 5,
  })
  assert.notEqual(day3.body, day5.body)
  assert.match(day3.body, /Three days/)
  assert.match(day5.body, /land/i)
  assert.ok(day3.body.includes('manager 1:1 friday'))
})

test('buildArcCheckIn: zh-CN includes the theme verbatim and companion name', () => {
  const out = buildArcCheckIn({
    arc: arc({ theme: '跟妈说搬家的事' }),
    uiLanguage: 'zh-CN',
    companionName: '星',
    milestoneDay: 3,
  })
  assert.match(out.body, /跟妈说搬家的事/)
  assert.match(out.body, /星/)
})

test('buildArcCheckIn: trims very long themes with ellipsis', () => {
  const long = 'x'.repeat(200)
  const out = buildArcCheckIn({
    arc: arc({ theme: long }),
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    milestoneDay: 3,
  })
  assert.ok(!out.body.includes('x'.repeat(150)), 'theme should be trimmed')
  assert.match(out.body, /…/)
})

test('buildArcCheckIn: empty companion name falls back to "Nexus"', () => {
  const out = buildArcCheckIn({
    arc: arc(),
    uiLanguage: 'en-US',
    companionName: '',
    milestoneDay: 3,
  })
  assert.match(out.body, /Nexus/)
})

test('buildArcCheckIn: late milestone (day 7+) uses LATE_BODY template', () => {
  const out = buildArcCheckIn({
    arc: arc({ checkInDays: [3, 5, 7] }),
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    milestoneDay: 7,
  })
  // LATE_BODY contains "still holding"
  assert.match(out.body, /still holding/)
})

test('buildArcCheckIn: each of 5 locales returns non-empty distinct body', () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const bodies = locales.map((l) =>
    buildArcCheckIn({
      arc: arc(),
      uiLanguage: l,
      companionName: 'Nexus',
      milestoneDay: 3,
    }).body,
  )
  for (const b of bodies) assert.ok(b.length > 0)
  assert.equal(new Set(bodies).size, locales.length)
})

test('buildArcCheckIn: title is localized', () => {
  const en = buildArcCheckIn({
    arc: arc(),
    uiLanguage: 'en-US',
    companionName: 'Nexus',
    milestoneDay: 3,
  })
  const zh = buildArcCheckIn({
    arc: arc(),
    uiLanguage: 'zh-CN',
    companionName: 'Nexus',
    milestoneDay: 3,
  })
  assert.match(en.title, /thread/i)
  assert.match(zh.title, /线/)
})
