import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findOnThisDayCandidate } from '../src/features/memory/onThisDay.ts'
import { formatOnThisDayPromptHint } from '../src/features/memory/onThisDayPrompt.ts'
import type { MemoryItem } from '../src/types'

const DAY_MS = 24 * 60 * 60 * 1000

function memoryAt(daysAgo: number, overrides: Partial<MemoryItem> = {}, nowMs = NOW): MemoryItem {
  return {
    id: overrides.id ?? `m-${daysAgo}`,
    content: overrides.content ?? `memory from ${daysAgo} days ago`,
    createdAt: new Date(nowMs - daysAgo * DAY_MS).toISOString(),
    ...overrides,
  } as MemoryItem
}

const NOW = Date.parse('2026-04-27T10:00:00.000Z')

test('findOnThisDayCandidate: matches a memory exactly one year old', () => {
  const memories = [memoryAt(365, { id: 'a', significance: 0.6 })]
  const candidate = findOnThisDayCandidate(memories, NOW)
  assert.ok(candidate, 'expected a candidate')
  assert.equal(candidate!.memoryId, 'a')
  assert.equal(candidate!.gap, 'year')
})

test('findOnThisDayCandidate: matches within ±2 day tolerance for year window', () => {
  const memories = [memoryAt(367, { id: 'b', significance: 0.5 })]
  const candidate = findOnThisDayCandidate(memories, NOW)
  assert.ok(candidate)
  assert.equal(candidate!.gap, 'year')
})

test('findOnThisDayCandidate: rejects beyond tolerance window', () => {
  const memories = [memoryAt(370, { id: 'c', significance: 0.9 })] // 5 days off
  const candidate = findOnThisDayCandidate(memories, NOW)
  assert.equal(candidate, null)
})

test('findOnThisDayCandidate: prefers the year window over month when both exist', () => {
  const memories = [
    memoryAt(30, { id: 'recent', significance: 0.9 }),
    memoryAt(365, { id: 'old', significance: 0.5 }),
  ]
  const candidate = findOnThisDayCandidate(memories, NOW)
  assert.ok(candidate)
  // year weight = 4, month weight = 1.5; 0.5*4=2 vs 0.9*1.5=1.35 — year wins
  assert.equal(candidate!.memoryId, 'old')
  assert.equal(candidate!.gap, 'year')
})

test('findOnThisDayCandidate: skips ids in excludeIds', () => {
  const memories = [memoryAt(365, { id: 'fired', significance: 0.6 })]
  const candidate = findOnThisDayCandidate(memories, NOW, new Set(['fired']))
  assert.equal(candidate, null)
})

test('findOnThisDayCandidate: skips reflections (importance="reflection")', () => {
  const memories = [memoryAt(365, { id: 'r', importance: 'reflection' })]
  const candidate = findOnThisDayCandidate(memories, NOW)
  assert.equal(candidate, null)
})

test('findOnThisDayCandidate: skips memories newer than the smallest window', () => {
  const memories = [memoryAt(3, { id: 'too-young', significance: 0.9 })]
  const candidate = findOnThisDayCandidate(memories, NOW)
  assert.equal(candidate, null)
})

test('findOnThisDayCandidate: matches week window exactly', () => {
  const memories = [memoryAt(7, { id: 'lastweek', significance: 0.7 })]
  const candidate = findOnThisDayCandidate(memories, NOW)
  assert.ok(candidate)
  assert.equal(candidate!.gap, 'week')
})

test('findOnThisDayCandidate: returns null for empty pool', () => {
  assert.equal(findOnThisDayCandidate([], NOW), null)
})

test('formatOnThisDayPromptHint: includes memory excerpt and recall tag', () => {
  const candidate = {
    memoryId: 'mem-x',
    content: 'I want to learn Japanese this year',
    gap: 'year' as const,
    createdAt: new Date(NOW - 365 * DAY_MS).toISOString(),
  }
  const hint = formatOnThisDayPromptHint(candidate, 'en-US')
  assert.match(hint, /one year/i)
  assert.match(hint, /learn Japanese/)
  assert.match(hint, /\[recall:mem-x\]/)
})

test('formatOnThisDayPromptHint: localizes (zh-CN)', () => {
  const candidate = {
    memoryId: 'm1',
    content: '今天是个好天气',
    gap: 'month' as const,
    createdAt: new Date(NOW - 30 * DAY_MS).toISOString(),
  }
  const hint = formatOnThisDayPromptHint(candidate, 'zh-CN')
  assert.match(hint, /一个月前/)
  assert.match(hint, /今天是个好天气/)
})

test('formatOnThisDayPromptHint: trims very long content', () => {
  const longContent = 'x'.repeat(500)
  const candidate = {
    memoryId: 'long',
    content: longContent,
    gap: 'week' as const,
    createdAt: new Date(NOW - 7 * DAY_MS).toISOString(),
  }
  const hint = formatOnThisDayPromptHint(candidate, 'en-US')
  // Trim cap is 120 chars; allow some slack for ellipsis + locale chrome.
  assert.ok(!hint.includes('x'.repeat(200)), 'expected the snippet to be trimmed')
  assert.match(hint, /…/)
})

test('formatOnThisDayPromptHint: falls back to English for unknown locale', () => {
  const candidate = {
    memoryId: 'fb',
    content: 'something',
    gap: 'year' as const,
    createdAt: new Date(NOW - 365 * DAY_MS).toISOString(),
  }
  const hint = formatOnThisDayPromptHint(candidate, 'eo')
  assert.match(hint, /one year/i)
})
