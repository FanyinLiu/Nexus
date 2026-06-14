import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildHotTierMemorySections, buildSemanticMemorySection } from '../src/features/chat/memoryInjection.ts'

const EMPTY_RECALL = { longTerm: [], daily: [], semantic: [] }

test('long-term guidance frames memories as lived experience, not data', () => {
  const ctx = {
    ...EMPTY_RECALL,
    longTerm: [{ content: 'User loves cats' }],
  }
  const { longTermSection } = buildHotTierMemorySections(ctx, 10_000)
  assert.match(longTermSection, /your time together/)
  assert.match(longTermSection, /memory surfaces on its own/)
  assert.doesNotMatch(longTermSection, /recite/i)
  assert.doesNotMatch(longTermSection, /database/i)
})

test('daily guidance frames entries as fresh shared moments', () => {
  const ctx = {
    ...EMPTY_RECALL,
    daily: [{ day: '2026-06-14', role: 'user' as const, content: 'Worked late' }],
  }
  const { dailySection } = buildHotTierMemorySections(ctx, 10_000)
  assert.match(dailySection, /still fresh/)
  assert.match(dailySection, /someone you see every day/)
})

test('semantic guidance uses experiential framing for confidence scores', () => {
  const ctx = {
    ...EMPTY_RECALL,
    semantic: [{ layer: 'long_term' as const, score: 0.92, content: 'User moved to Tokyo' }],
  }
  const section = buildSemanticMemorySection(ctx)
  assert.match(section, /vivid and specific/)
  assert.match(section, /faint echo/)
  assert.match(section, /confidence 0\.92/)
})

test('empty memories produce empty strings', () => {
  const { longTermSection, dailySection } = buildHotTierMemorySections(EMPTY_RECALL, 10_000)
  assert.equal(longTermSection, '')
  assert.equal(dailySection, '')
  assert.equal(buildSemanticMemorySection(EMPTY_RECALL), '')
})
