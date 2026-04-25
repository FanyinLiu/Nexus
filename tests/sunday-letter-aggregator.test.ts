import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aggregateSundayLetter } from '../src/features/letter/aggregator.ts'
import type { MemoryItem } from '../src/types/memory.ts'

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

test('skips letter when fewer than 3 active days', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [memory({ id: 'a', content: 'something nice' })],
    activeDayKeys: ['2026-04-25', '2026-04-26'],
  })
  assert.equal(out.shouldFire, false)
  assert.equal(out.shouldFire === false && out.reason, 'too_few_active_days')
})

test('skips letter when no significant memory passes threshold', () => {
  const out = aggregateSundayLetter({
    nowMs: NOW,
    recentMemories: [
      memory({ id: 'a', content: 'tiny thing', significance: 0.05 }),
      memory({ id: 'b', content: 'another tiny', significance: 0.1 }),
    ],
    activeDayKeys: ['2026-04-21', '2026-04-23', '2026-04-25'],
  })
  assert.equal(out.shouldFire, false)
  assert.equal(out.shouldFire === false && out.reason, 'no_significant_memory')
})

test('passes gate and rolls up highlights / stressors / themes', () => {
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
  // Only 2 distinct days → below threshold → skip
  assert.equal(out.shouldFire, false)
})
