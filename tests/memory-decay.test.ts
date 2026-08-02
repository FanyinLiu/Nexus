import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyDecayBatch, getDecayedScore } from '../src/features/memory/decay.ts'
import type { MemoryItem } from '../src/types/memory.ts'

const MS_PER_DAY = 86_400_000
const DECAY_FACTOR = 0.97

function makeMemory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'm1',
    content: 'x',
    category: 'profile',
    source: 'chat',
    createdAt: new Date(0).toISOString(),
    importance: 'normal',
    importanceScore: 0.5,
    ...overrides,
  }
}

test('applyDecayBatch: advances decay anchor (decayedAt) to now', () => {
  const now = 10 * MS_PER_DAY
  const [decayed] = applyDecayBatch([makeMemory()], now)
  assert.equal(decayed.decayedAt, new Date(now).toISOString())
})

test('applyDecayBatch: repeated apply is idempotent at the same instant', () => {
  const now = 10 * MS_PER_DAY
  const [once] = applyDecayBatch([makeMemory()], now)
  const [twice] = applyDecayBatch([once], now)
  assert.equal(twice.importanceScore, once.importanceScore)
})

test('applyDecayBatch: sequential dreams decay per-day, not compounded from createdAt', () => {
  // Day 10 dream, then day 20 dream: total must equal a single 20-day decay
  // (0.5 * 0.97^20), not 0.5 * 0.97^(10+20) from re-anchoring at createdAt.
  const [day10] = applyDecayBatch([makeMemory()], 10 * MS_PER_DAY)
  const [day20] = applyDecayBatch([day10], 20 * MS_PER_DAY)
  const expected = 0.5 * DECAY_FACTOR ** 20
  assert.ok(
    Math.abs(day20.importanceScore! - expected) < 1e-12,
    `expected ${expected}, got ${day20.importanceScore}`,
  )
})

test('getDecayedScore: anchors at decayedAt when decay ran after the last recall', () => {
  // Recall on day 10, dream persists decay on day 15. Decay on day 20 must
  // cover only days 15→20 — the 10→15 span is already in importanceScore.
  const memory = makeMemory({
    lastRecalledAt: new Date(10 * MS_PER_DAY).toISOString(),
    decayedAt: new Date(15 * MS_PER_DAY).toISOString(),
  })
  const expected = 0.5 * DECAY_FACTOR ** 5
  const score = getDecayedScore(memory, 20 * MS_PER_DAY)
  assert.ok(Math.abs(score - expected) < 1e-12, `expected ${expected}, got ${score}`)
})

test('getDecayedScore: legacy data without decayedAt still decays from createdAt', () => {
  const score = getDecayedScore(makeMemory(), 30 * MS_PER_DAY)
  const expected = 0.5 * DECAY_FACTOR ** 30
  assert.ok(Math.abs(score - expected) < 1e-12, `expected ${expected}, got ${score}`)
})

test('getDecayedScore: malformed timestamp returns base score instead of NaN', () => {
  const memory = makeMemory({ createdAt: 'not-a-date' })
  const score = getDecayedScore(memory, 10 * MS_PER_DAY)
  assert.ok(Number.isFinite(score), `score must be finite, got ${score}`)
  assert.equal(score, 0.5)
})

test('getDecayedScore: malformed decayedAt falls back to createdAt', () => {
  const memory = makeMemory({ decayedAt: 'garbage' })
  const score = getDecayedScore(memory, 30 * MS_PER_DAY)
  const expected = 0.5 * DECAY_FACTOR ** 30
  assert.ok(Math.abs(score - expected) < 1e-12, `expected ${expected}, got ${score}`)
})
