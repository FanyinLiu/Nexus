import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  computeMemorySignificance,
  getRankingScore,
} from '../src/features/memory/decay.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const neutralEmotion = { energy: 0.5, warmth: 0.5, curiosity: 0.4, concern: 0.15 }

test('computeMemorySignificance: neutral baseline emotion → 0', () => {
  assert.equal(computeMemorySignificance(neutralEmotion), 0)
})

test('computeMemorySignificance: high arousal raises score', () => {
  const score = computeMemorySignificance({ energy: 0.95, warmth: 0.6, curiosity: 0.9, concern: 0.15 })
  assert.ok(score > 0.1, `expected > 0.1 for high arousal, got ${score}`)
})

test('computeMemorySignificance: heavy concern registers a signal', () => {
  const score = computeMemorySignificance({ energy: 0.4, warmth: 0.5, curiosity: 0.3, concern: 0.85 })
  assert.ok(score > 0, `concern-only state should register: ${score}`)
})

test('computeMemorySignificance: always clamped to [0, 1]', () => {
  const lowest = computeMemorySignificance({ energy: 0.2, warmth: 0.2, curiosity: 0.2, concern: 0.1 })
  assert.ok(lowest >= 0, `lower bound: ${lowest}`)
  const peak = computeMemorySignificance({ energy: 1, warmth: 1, curiosity: 1, concern: 1 })
  assert.ok(peak <= 1, `upper bound: ${peak}`)
})

test('getRankingScore: significance multiplies up to +40%', () => {
  const now = Date.now()
  const baseMemory: MemoryItem = {
    id: 'm1',
    content: 'x',
    category: 'profile',
    source: 'chat',
    createdAt: new Date(now).toISOString(),
    importance: 'normal',
    importanceScore: 0.5,
  }
  const baseline = getRankingScore(baseMemory, now)
  const significant = getRankingScore({ ...baseMemory, significance: 1 }, now)
  // 1 + 1 * 0.4 = 1.4× boost at peak significance.
  assert.ok(Math.abs(significant - baseline * 1.4) < 1e-6, `expected ${baseline * 1.4}, got ${significant}`)
})

test('getRankingScore: significance=0 matches plain decayed score', () => {
  const now = Date.now()
  const memory: MemoryItem = {
    id: 'm2',
    content: 'x',
    category: 'profile',
    source: 'chat',
    createdAt: new Date(now).toISOString(),
    importance: 'normal',
    importanceScore: 0.5,
    significance: 0,
  }
  const withField = getRankingScore(memory, now)
  const withoutField = getRankingScore({ ...memory, significance: undefined }, now)
  assert.equal(withField, withoutField)
})
