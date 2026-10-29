import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aggregateSundayLetter } from '../src/features/letter/aggregator.ts'
import type { DailyMemoryEntry, MemoryItem } from '../src/types/index.ts'

const NOW = new Date('2026-04-26T20:00:00').getTime()

function memory(overrides: Partial<MemoryItem> & { id: string; content: string }): MemoryItem {
  return {
    category: 'preference',
    source: 'chat',
    createdAt: new Date(NOW - 24 * 60 * 60_000).toISOString(),
    significance: 0.6,
    emotionalValence: 'positive',
    ...overrides,
  } as MemoryItem
}

function diary(overrides: Partial<DailyMemoryEntry> & { id: string; content: string }): DailyMemoryEntry {
  return {
    day: '2026-04-25',
    role: 'user',
    source: 'chat',
    createdAt: new Date(NOW - 24 * 60 * 60_000).toISOString(),
    ...overrides,
  }
}

test('skips only a truly empty week', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [],
    recentDiaryEntries: [],
    activeDayKeys: [],
  })
  assert.equal(out.shouldFire, false)
  assert.equal(out.shouldFire === false && out.reason, 'empty_week')
  assert.equal(out.weekDayCount, 0)
})

test('a light week with two active days fires even with no stored memory', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [],
    activeDayKeys: ['2026-04-23', '2026-04-25'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.equal(out.weekDayCount, 2)
  assert.deepEqual(out.highlights, [])
  assert.deepEqual(out.diaryLines, [])
})

test('one busy day with a few messages is enough', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [],
    activeDayKeys: ['2026-04-25'],
    userMessageCount: 3,
  })
  assert.equal(out.shouldFire, true)
})

test('one quiet day with two messages is not enough on its own', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [],
    activeDayKeys: ['2026-04-25'],
    userMessageCount: 2,
  })
  assert.equal(out.shouldFire, false)
  assert.equal(out.shouldFire === false && out.reason, 'empty_week')
})

test('one remembered event is enough on a single-day week', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [memory({ id: 'event', content: '周四有面试', significance: 0 })],
    activeDayKeys: ['2026-04-23'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.equal(out.highlights.length, 1)
  assert.equal(out.highlights[0]?.id, 'event')
})

test('a diary entry alone is enough on a single-day week', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [],
    recentDiaryEntries: [diary({ id: 'd1', content: '今天把搬家的事定下来了' })],
    activeDayKeys: ['2026-04-25'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.deepEqual(out.diaryLines, ['今天把搬家的事定下来了'])
})

test('passes the gate and rolls up highlights / stressors / themes', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [
      memory({ id: 'a', content: '搞定了那个 bug', significance: 0.8, emotionalValence: 'positive', category: 'project' }),
      memory({ id: 'b', content: '约朋友吃了饭', significance: 0.5, emotionalValence: 'positive', category: 'preference' }),
      memory({ id: 'c', content: '会议拖到九点', significance: 0.7, emotionalValence: 'negative', category: 'project' }),
      memory({ id: 'd', content: '看完一本书', significance: 0.3, emotionalValence: 'mixed', category: 'habit' }),
    ],
    activeDayKeys: ['2026-04-21', '2026-04-22', '2026-04-23', '2026-04-25'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.equal(out.highlights.length, 3)
  assert.equal(out.highlights[0].id, 'a')
  assert.equal(out.stressors.length, 1)
  assert.equal(out.stressors[0].id, 'c')
  assert.deepEqual(out.themes.sort(), ['habit', 'preference', 'project'])
  assert.equal(out.weekDayCount, 4)
})

test('neutral memories still become concrete highlights', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [
      memory({ id: 'n1', content: '把厨房收拾了', significance: 0, emotionalValence: 'neutral' }),
      memory({ id: 'n2', content: '修好了台灯', significance: 0, emotionalValence: undefined }),
    ],
    activeDayKeys: ['d1', 'd2'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.deepEqual(out.highlights.map((item) => item.id), ['n1', 'n2'])
})

test('caps highlights at 4 and stressors at 3', () => {
  const recent: MemoryItem[] = []
  for (let i = 0; i < 6; i += 1) {
    recent.push(memory({ id: `pos-${i}`, content: `positive ${i}`, significance: 0.5 + i * 0.05 }))
  }
  for (let i = 0; i < 5; i += 1) {
    recent.push(memory({ id: `neg-${i}`, content: `negative ${i}`, significance: 0.5 + i * 0.05, emotionalValence: 'negative' }))
  }
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: recent,
    activeDayKeys: ['d1', 'd2', 'd3'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.equal(out.highlights.length, 4)
  assert.equal(out.stressors.length, 3)
})

test('extracts reflection lines sorted by confidence', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [
      memory({ id: 'r1', content: 'low conf reflection', importance: 'reflection', reflectionConfidence: 0.3 }),
      memory({ id: 'r2', content: 'high conf reflection', importance: 'reflection', reflectionConfidence: 0.9 }),
      memory({ id: 'r3', content: 'mid conf reflection', importance: 'reflection', reflectionConfidence: 0.6 }),
      memory({ id: 's', content: 'significant moment', significance: 0.8 }),
    ],
    activeDayKeys: ['d1', 'd2', 'd3'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.deepEqual(out.reflectionLines, [
    'high conf reflection',
    'mid conf reflection',
    'low conf reflection',
  ])
})

test('reflections themselves do not pollute highlights', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [
      memory({ id: 'r1', content: 'a reflection', importance: 'reflection', reflectionConfidence: 0.9, significance: 0.9 }),
      memory({ id: 's1', content: 'a moment', significance: 0.5 }),
    ],
    activeDayKeys: ['d1', 'd2', 'd3'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.equal(out.highlights.length, 1)
  assert.equal(out.highlights[0].id, 's1')
})

test('disabled, migrated, archived, superseded, and sensitive rows stay out of the letter', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [
      memory({ id: 'ok', content: '一起去看展了' }),
      memory({ id: 'off', content: '关掉的记忆', enabled: false }),
      memory({ id: 'migrated', content: '迁移来的记忆', migrated: true }),
      memory({ id: 'archived', content: '归档的记忆', status: 'archived' }),
      memory({ id: 'superseded', content: '被替代的记忆', status: 'superseded' }),
      memory({ id: 'secret', content: '我的密码是 hunter2' }),
    ],
    recentDiaryEntries: [
      diary({ id: 'd-ok', content: '今天下班很早' }),
      diary({ id: 'd-secret', content: '身份证号 110101199001011234' }),
    ],
    activeDayKeys: ['d1'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.deepEqual(out.highlights.map((item) => item.id), ['ok'])
  assert.deepEqual(out.diaryLines, ['今天下班很早'])
})

test('milestones reached pass through', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [memory({ id: 'a', content: 'something', significance: 0.5 })],
    activeDayKeys: ['d1', 'd2', 'd3'],
    milestonesReached: ['days-100'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.deepEqual(out.milestonesNotedThisWeek, ['days-100'])
})

test('dedups active day keys when caller passes the same date twice', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [memory({ id: 'a', content: 'something', significance: 0.5 })],
    activeDayKeys: ['d1', 'd1', 'd2'],
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.equal(out.weekDayCount, 2)
})

// ── affectShape attachment ────────────────────────────────────────────────

test('affectShape: omitted when sample count is below the min-samples gate', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [memory({ id: 'a', content: 'thing', significance: 0.5 })],
    activeDayKeys: ['d1', 'd2', 'd3'],
    affectThisWeek: {
      n: 3,
      baselineValence: 0.4,
      baselineArousal: 0.5,
      variability: 0.1,
      inertia: 0.2,
      windowStart: '2026-04-19T00:00:00Z',
      windowEnd: '2026-04-26T20:00:00Z',
    },
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.equal(out.affectShape, undefined)
})

test('affectShape: attached when sample count crosses the gate', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [memory({ id: 'a', content: 'thing', significance: 0.5 })],
    activeDayKeys: ['d1', 'd2', 'd3'],
    affectThisWeek: {
      n: 12,
      baselineValence: 0.42,
      baselineArousal: 0.55,
      variability: 0.18,
      inertia: 0.31,
      windowStart: '2026-04-19T00:00:00Z',
      windowEnd: '2026-04-26T20:00:00Z',
    },
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true || !out.affectShape) {
    assert.fail('expected affectShape to be attached')
    return
  }
  assert.equal(out.affectShape.n, 12)
  assert.equal(out.affectShape.baselineValence, 0.42)
  assert.equal(out.affectShape.variability, 0.18)
  assert.equal(out.affectShape.inertia, 0.31)
  assert.equal(out.affectShape.shiftFromPrior, null)
})

test('affectShape: omitted when baseline is null even with enough samples', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [memory({ id: 'a', content: 'thing', significance: 0.5 })],
    activeDayKeys: ['d1', 'd2', 'd3'],
    affectThisWeek: {
      n: 12,
      baselineValence: null,
      baselineArousal: null,
      variability: null,
      inertia: null,
      windowStart: '2026-04-19T00:00:00Z',
      windowEnd: '2026-04-26T20:00:00Z',
    },
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true) return
  assert.equal(out.affectShape, undefined)
})

test('affectShape: passes through prior-window shift when supplied', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [memory({ id: 'a', content: 'thing', significance: 0.5 })],
    activeDayKeys: ['d1', 'd2', 'd3'],
    affectThisWeek: {
      n: 12,
      baselineValence: 0.55,
      baselineArousal: 0.5,
      variability: 0.18,
      inertia: 0.42,
      windowStart: '2026-04-19T00:00:00Z',
      windowEnd: '2026-04-26T20:00:00Z',
    },
    affectShift: {
      baselineValenceDelta: 0.13,
      baselineArousalDelta: 0.05,
      valenceShiftIsNotable: true,
      variabilityRoseSharply: false,
      inertiaIsHigh: true,
    },
  })
  assert.equal(out.shouldFire, true)
  if (out.shouldFire !== true || !out.affectShape) {
    assert.fail('expected affectShape with shift')
    return
  }
  assert.equal(out.affectShape.shiftFromPrior?.valenceShiftIsNotable, true)
  assert.equal(out.affectShape.shiftFromPrior?.inertiaIsHigh, true)
})
