import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  serializeMemoryArchive,
  parseMemoryArchive,
} from '../src/features/memory/archive.ts'
import type { DailyMemoryStore, MemoryItem } from '../src/types/index.ts'

// ── serializeMemoryArchive ──

test('produces valid JSON with schema marker', () => {
  const memories: MemoryItem[] = [{
    id: 'mem-1', content: '我喜欢猫', category: 'preference', source: 'chat',
    createdAt: '2026-04-01T00:00:00Z',
  }]
  const daily: DailyMemoryStore = {}

  const json = serializeMemoryArchive(memories, daily)
  const parsed = JSON.parse(json)
  assert.equal(parsed.schema, 'nexus.memory-archive')
  assert.equal(parsed.version, 1)
  assert.equal(parsed.longTermCount, 1)
  assert.equal(parsed.memories.length, 1)
})

// ── parseMemoryArchive ──

test('round-trips through serialize → parse', () => {
  const memories: MemoryItem[] = [{
    id: 'mem-1', content: '我住在上海', category: 'profile', source: 'chat',
    createdAt: '2026-04-01T00:00:00Z',
  }]
  const daily: DailyMemoryStore = {
    '2026-04-01': [{
      id: 'd1', day: '2026-04-01', role: 'user', content: '你好',
      source: 'chat', createdAt: '2026-04-01T10:00:00Z',
    }],
  }

  const json = serializeMemoryArchive(memories, daily)
  const result = parseMemoryArchive(json)
  assert.equal(result.memories.length, 1)
  assert.equal(result.memories[0].content, '我住在上海')
  assert.ok(result.dailyMemories['2026-04-01'])
  assert.equal(result.dailyMemories['2026-04-01'].length, 1)
})

test('handles plain array format (legacy)', () => {
  const json = JSON.stringify([
    { content: '记忆一', category: 'profile', source: 'chat', createdAt: '2026-01-01T00:00:00Z' },
    { content: '记忆二', category: 'goal', source: 'chat', createdAt: '2026-01-02T00:00:00Z' },
  ])

  const result = parseMemoryArchive(json)
  assert.equal(result.memories.length, 2)
  assert.ok(result.memories[0].id)
  assert.deepEqual(result.dailyMemories, {})
})

test('rejects invalid JSON', () => {
  assert.throws(() => parseMemoryArchive('not json'), {
    message: /JSON 解析失败/,
  })
})

test('normalizes unknown categories to manual', () => {
  const json = JSON.stringify({
    memories: [
      { content: '未知类型的记忆', category: 'unknown_category', source: 'import', createdAt: '2026-01-01T00:00:00Z' },
    ],
  })
  const result = parseMemoryArchive(json)
  assert.equal(result.memories[0].category, 'manual')
})

test('generates ids for entries without them', () => {
  const json = JSON.stringify({
    memories: [{ content: '没有ID的记忆', createdAt: '2026-01-01T00:00:00Z' }],
  })
  const result = parseMemoryArchive(json)
  assert.ok(result.memories[0].id)
  assert.ok(result.memories[0].id.startsWith('memory-'))
})

test('skips entries with empty content', () => {
  const json = JSON.stringify({
    memories: [
      { content: '', createdAt: '2026-01-01T00:00:00Z' },
      { content: '有内容', createdAt: '2026-01-01T00:00:00Z' },
    ],
  })
  const result = parseMemoryArchive(json)
  assert.equal(result.memories.length, 1)
})

test('filters invalid daily entries (wrong role)', () => {
  const json = JSON.stringify({
    memories: [],
    dailyMemories: {
      '2026-04-01': [
        { role: 'system', content: '系统消息', createdAt: '2026-04-01T10:00:00Z' },
        { role: 'user', content: '用户消息', createdAt: '2026-04-01T10:01:00Z' },
      ],
    },
  })
  const result = parseMemoryArchive(json)
  assert.equal(result.dailyMemories['2026-04-01'].length, 1)
  assert.equal(result.dailyMemories['2026-04-01'][0].role, 'user')
})
