import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  aggregateYearbook,
  buildMonthKeys,
} from '../src/features/yearbook/yearbookAggregator.ts'
import {
  buildYearbookFilename,
  renderYearbookHtml,
} from '../src/features/yearbook/yearbookRender.ts'
import type { UserAffectSample } from '../src/features/autonomy/userAffectTimeline.ts'
import type { EmotionSample } from '../src/features/autonomy/stateTimeline.ts'
import type { SavedLetter } from '../src/features/letter/letterStore.ts'

function userSample(ts: string, valence: number): UserAffectSample {
  return { ts, valence, arousal: 0.5, source: 'text_signal', confidence: 0.5 }
}
function companionSample(ts: string, warmth: number): EmotionSample {
  return { ts, energy: 0.5, warmth, curiosity: 0.5, concern: 0.5 }
}
function letter(letterDate: string, createdAt: string, greeting: string): SavedLetter {
  return {
    id: letterDate,
    letterDate,
    createdAt,
    personaId: 'default',
    uiLanguage: 'en-US',
    content: { greeting, summary: '', suggestion: '', intention: '', experiment: '', closing: '' },
    weekDayCount: 5,
    themes: [],
  }
}

// ── buildMonthKeys ───────────────────────────────────────────────────────

test('buildMonthKeys: returns 12 months ending at "now", oldest first', () => {
  const now = new Date(2026, 3, 27)  // Apr 27 2026
  const keys = buildMonthKeys(now)
  assert.equal(keys.length, 12)
  // Last key should be the current month
  assert.equal(keys[11], '2026-04')
  // 11 months back from April 2026 = May 2025
  assert.equal(keys[0], '2025-05')
})

test('buildMonthKeys: handles year wraparound', () => {
  const now = new Date(2026, 0, 15)  // Jan 15 2026
  const keys = buildMonthKeys(now)
  assert.equal(keys[11], '2026-01')
  assert.equal(keys[0], '2025-02')
})

// ── aggregateYearbook ────────────────────────────────────────────────────

test('aggregate: empty inputs → 12 empty months + zero year stats', () => {
  const now = new Date(2026, 3, 27)
  const out = aggregateYearbook([], [], [], now)
  assert.equal(out.months.length, 12)
  assert.equal(out.yearSnapshot.n, 0)
  assert.equal(out.letters.length, 0)
})

test('aggregate: only samples within last 365d are kept', () => {
  const now = new Date(2026, 3, 27, 12, 0, 0)
  const tooOldIso = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString()
  const recentIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const samples = [
    userSample(tooOldIso, -0.5),
    userSample(recentIso, 0.3),
  ]
  const out = aggregateYearbook(samples, [], [], now)
  // Only the recent sample contributes
  assert.equal(out.yearSnapshot.n, 1)
})

test('aggregate: monthly buckets are populated by sample timestamps', () => {
  const now = new Date(2026, 3, 27, 12, 0, 0)
  // Two samples in March 2026, one in April 2026
  const samples = [
    userSample('2026-03-10T12:00:00Z', 0.2),
    userSample('2026-03-25T12:00:00Z', 0.3),
    userSample('2026-04-15T12:00:00Z', 0.4),
  ]
  const out = aggregateYearbook(samples, [], [], now)
  const march = out.months.find((m) => m.monthKey === '2026-03')
  const april = out.months.find((m) => m.monthKey === '2026-04')
  assert.ok(march)
  assert.ok(april)
  assert.equal(march!.snapshot.n, 2)
  assert.equal(april!.snapshot.n, 1)
})

test('aggregate: letters are filtered + sorted oldest-first', () => {
  const now = new Date(2026, 3, 27, 12, 0, 0)
  const letters: SavedLetter[] = [
    letter('2026-03-15', '2026-03-15T20:00:00Z', 'C'),
    letter('2024-01-10', '2024-01-10T20:00:00Z', 'too-old'),  // outside year window
    letter('2026-04-01', '2026-04-01T20:00:00Z', 'D'),
    letter('2026-02-08', '2026-02-08T20:00:00Z', 'B'),
  ]
  const out = aggregateYearbook([], [], letters, now)
  assert.equal(out.letters.length, 3)
  assert.equal(out.letters[0].letterDate, '2026-02-08')
  assert.equal(out.letters[2].letterDate, '2026-04-01')
})

test('aggregate: co-regulation surfaces when both streams align', () => {
  const now = new Date(2026, 3, 27, 12, 0, 0)
  const u = [
    userSample('2026-04-01T12:00:00Z', -0.5),
    userSample('2026-04-02T12:00:00Z', -0.5),
    userSample('2026-04-03T12:00:00Z', 0.2),
    userSample('2026-04-04T12:00:00Z', 0.2),
  ]
  const c = [
    companionSample('2026-04-01T12:00:00Z', 0.8),
    companionSample('2026-04-02T12:00:00Z', 0.8),
    companionSample('2026-04-03T12:00:00Z', 0.4),
    companionSample('2026-04-04T12:00:00Z', 0.4),
  ]
  const out = aggregateYearbook(u, c, [], now)
  assert.equal(out.coregKind, 'co-regulating')
})

// ── renderYearbookHtml ───────────────────────────────────────────────────

test('render: produces a complete HTML5 document', () => {
  const now = new Date(2026, 3, 27)
  const snap = aggregateYearbook([], [], [], now)
  const html = renderYearbookHtml(snap, 'en-US')
  assert.match(html, /^<!DOCTYPE html>/)
  assert.match(html, /<html lang="en-US">/)
  assert.match(html, /A year with Nexus/)
})

test('render: zh-CN locale produces zh-CN header', () => {
  const now = new Date(2026, 3, 27)
  const snap = aggregateYearbook([], [], [], now)
  const html = renderYearbookHtml(snap, 'zh-CN')
  assert.match(html, /和 Nexus 的一年/)
  assert.match(html, /<html lang="zh-CN">/)
})

test('render: includes 12 monthly rows even when empty', () => {
  const now = new Date(2026, 3, 27)
  const snap = aggregateYearbook([], [], [], now)
  const html = renderYearbookHtml(snap, 'en-US')
  // Each month is a .month-row
  const rows = html.match(/class="month-row"/g) ?? []
  assert.equal(rows.length, 12)
})

test('render: empty months use the empty-month label', () => {
  const now = new Date(2026, 3, 27)
  const snap = aggregateYearbook([], [], [], now)
  const html = renderYearbookHtml(snap, 'en-US')
  assert.match(html, /no samples/)
})

test('render: letters appear chronologically with date headers', () => {
  const now = new Date(2026, 3, 27)
  const letters: SavedLetter[] = [
    letter('2026-03-15', '2026-03-15T20:00:00Z', 'March greeting'),
    letter('2026-04-01', '2026-04-01T20:00:00Z', 'April greeting'),
  ]
  const snap = aggregateYearbook([], [], letters, now)
  const html = renderYearbookHtml(snap, 'en-US')
  assert.match(html, /March greeting/)
  assert.match(html, /April greeting/)
  // March must appear before April in the output
  assert.ok(html.indexOf('March greeting') < html.indexOf('April greeting'))
})

test('render: HTML-escapes letter content', () => {
  const now = new Date(2026, 3, 27)
  const letters = [letter('2026-03-15', '2026-03-15T20:00:00Z', '<script>X</script>')]
  const snap = aggregateYearbook([], [], letters, now)
  const html = renderYearbookHtml(snap, 'en-US')
  assert.ok(!html.includes('<script>X</script>'))
  assert.match(html, /&lt;script&gt;X&lt;\/script&gt;/)
})

test('render: each of the 5 locales produces distinct page headers', () => {
  const now = new Date(2026, 3, 27)
  const snap = aggregateYearbook([], [], [], now)
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const headers = locales.map((l) => {
    const html = renderYearbookHtml(snap, l)
    return /<h1>([^<]+)<\/h1>/.exec(html)?.[1] ?? ''
  })
  assert.equal(new Set(headers).size, locales.length)
})

// ── buildYearbookFilename ────────────────────────────────────────────────

test('filename: locale-agnostic, date-stamped', () => {
  const now = new Date(2026, 3, 27)
  const f = buildYearbookFilename('zh-CN', now)
  assert.match(f, /^nexus-yearbook-2026-04-27\.html$/)
})
