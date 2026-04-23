import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildReflectionPrompt,
  extractReflectionsFromMemories,
  mergeReflections,
  parseReflectionResponse,
} from '../src/features/memory/reflectionGenerator.ts'
import type { DailyMemoryEntry, MemoryItem } from '../src/types/memory.ts'

function diary(day: string, content: string, id?: string): DailyMemoryEntry {
  return {
    id: id ?? `d-${day}-${content.slice(0, 6)}`,
    day,
    role: 'user',
    content,
    source: 'chat',
    createdAt: `${day}T00:00:00Z`,
  }
}

test('buildReflectionPrompt returns null when diary is too sparse', () => {
  const p = buildReflectionPrompt({
    uiLanguage: 'en-US',
    dailyEntries: [diary('2026-04-20', 'hi')],
    relationshipTrend: null,
    emotionTrend: null,
    existingReflections: [],
  })
  assert.equal(p, null)
})

test('buildReflectionPrompt emits JSON-requesting system prompt when enough entries exist', () => {
  const entries = Array.from({ length: 8 }, (_, i) => diary(`2026-04-${10 + i}`, `note ${i}`))
  const p = buildReflectionPrompt({
    uiLanguage: 'en-US',
    dailyEntries: entries,
    relationshipTrend: 'score 40 → 55',
    emotionTrend: 'energy rising',
    existingReflections: [{ topic: 'routine', content: 'codes late at night' }],
  })
  assert.ok(p)
  assert.match(p!.system, /reflections/i)
  assert.match(p!.system, /JSON/)
  assert.match(p!.user, /score 40/)
  assert.match(p!.user, /\[routine\]/)
})

test('parseReflectionResponse handles clean JSON', () => {
  const raw = JSON.stringify({
    reflections: [
      { content: 'user codes late at night', topic: 'schedule', confidence: 0.8 },
      { content: 'user enjoys cooking', topic: 'hobbies', confidence: 0.6 },
    ],
  })
  const parsed = parseReflectionResponse(raw)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].topic, 'schedule')
})

test('parseReflectionResponse extracts JSON from noisy wrappers', () => {
  const raw = 'Here are my reflections:\n\n{"reflections":[{"content":"x","topic":"t","confidence":0.5}]}\n\nLet me know.'
  const parsed = parseReflectionResponse(raw)
  assert.equal(parsed.length, 1)
})

test('parseReflectionResponse drops low-confidence entries', () => {
  const raw = JSON.stringify({
    reflections: [
      { content: 'solid', topic: 'a', confidence: 0.9 },
      { content: 'flaky', topic: 'b', confidence: 0.2 },
    ],
  })
  const parsed = parseReflectionResponse(raw)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].topic, 'a')
})

test('parseReflectionResponse drops entries missing content or topic', () => {
  const raw = JSON.stringify({
    reflections: [
      { content: '', topic: 't', confidence: 0.8 },
      { content: 'x', topic: '', confidence: 0.8 },
      { content: 'y', topic: 'good', confidence: 0.8 },
    ],
  })
  const parsed = parseReflectionResponse(raw)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].topic, 'good')
})

test('parseReflectionResponse caps at 3 per cycle', () => {
  const raw = JSON.stringify({
    reflections: Array.from({ length: 10 }, (_, i) => ({
      content: `r${i}`,
      topic: `t${i}`,
      confidence: 0.8,
    })),
  })
  const parsed = parseReflectionResponse(raw)
  assert.equal(parsed.length, 3)
})

test('mergeReflections is a no-op when candidates are empty', () => {
  const memories: MemoryItem[] = [
    { id: 'm1', content: 'fact', category: 'profile', source: 'chat', createdAt: '2026-04-20T00:00:00Z' },
  ]
  assert.deepEqual(mergeReflections(memories, [], '2026-04-21T00:00:00Z'), memories)
})

test('mergeReflections appends a fresh reflection and preserves unrelated memories', () => {
  const memories: MemoryItem[] = [
    { id: 'm1', content: 'fact', category: 'profile', source: 'chat', createdAt: '2026-04-20T00:00:00Z' },
  ]
  const next = mergeReflections(
    memories,
    [{ content: 'late coder', topic: 'schedule', confidence: 0.7 }],
    '2026-04-21T00:00:00Z',
  )
  assert.equal(next.length, 2)
  const reflection = next.find((m) => m.importance === 'reflection')
  assert.ok(reflection)
  assert.equal(reflection!.reflectionTopic, 'schedule')
  assert.equal(reflection!.reflectionConfidence, 0.7)
})

test('mergeReflections replaces existing reflection on same topic', () => {
  const memories: MemoryItem[] = [
    {
      id: 'r1',
      content: 'old phrasing',
      category: 'reference',
      source: 'dream',
      importance: 'reflection',
      reflectionTopic: 'schedule',
      reflectionConfidence: 0.5,
      createdAt: '2026-04-20T00:00:00Z',
    },
  ]
  const next = mergeReflections(
    memories,
    [{ content: 'new phrasing', topic: 'schedule', confidence: 0.85 }],
    '2026-04-21T00:00:00Z',
  )
  assert.equal(next.length, 1)
  assert.equal(next[0].content, 'new phrasing')
  assert.equal(next[0].reflectionConfidence, 0.85)
})

test('mergeReflections caps reflection memories at 20 and keeps newest', () => {
  const older: MemoryItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`,
    content: `old ${i}`,
    category: 'reference' as const,
    source: 'dream',
    importance: 'reflection' as const,
    reflectionTopic: `topic-${i}`,
    reflectionConfidence: 0.6,
    createdAt: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }))
  const next = mergeReflections(
    older,
    [{ content: 'brand new', topic: 'new', confidence: 0.8 }],
    '2026-04-25T00:00:00Z',
  )
  const reflections = next.filter((m) => m.importance === 'reflection')
  assert.equal(reflections.length, 20)
  assert.ok(reflections.some((r) => r.reflectionTopic === 'new'))
  // Oldest one (r0) should be the one evicted.
  assert.ok(!reflections.some((r) => r.reflectionTopic === 'topic-0'))
})

test('extractReflectionsFromMemories pulls only reflections with topic set', () => {
  const memories: MemoryItem[] = [
    { id: 'm1', content: 'fact', category: 'profile', source: 'chat', createdAt: '2026-04-20T00:00:00Z' },
    {
      id: 'r1',
      content: 'observation',
      category: 'reference',
      source: 'dream',
      importance: 'reflection',
      reflectionTopic: 'routine',
      createdAt: '2026-04-20T00:00:00Z',
    },
    // Edge case: importance is 'reflection' but topic missing → skip.
    {
      id: 'r2',
      content: 'stray',
      category: 'reference',
      source: 'dream',
      importance: 'reflection',
      createdAt: '2026-04-20T00:00:00Z',
    },
  ]
  const extracted = extractReflectionsFromMemories(memories)
  assert.equal(extracted.length, 1)
  assert.equal(extracted[0].topic, 'routine')
})
