import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  normalizeText,
  scoreLexicalSimilarity,
  scoreContainment,
  extractMemoriesFromMessage,
  mergeMemories,
  rankMemories,
  getLocalDayKey,
  createDailyMemoryEntry,
  mergeDailyMemories,
  pruneDailyMemories,
  clearDailyMemoriesForDay,
  getRecentDailyEntries,
  removeDailyMemoryEntry,
  updateDailyMemoryEntry,
} from '../src/features/memory/memory.ts'
import { parseMemorySourceRef } from '../src/features/memory/sourceRefs.ts'
import type { ChatMessage, DailyMemoryStore, MemoryItem } from '../src/types/index.ts'

// ── normalizeText ──

test('normalizeText lowercases and collapses whitespace', () => {
  assert.equal(normalizeText('  Hello   World  '), 'hello world')
})

test('normalizeText trims the result', () => {
  assert.equal(normalizeText('\tFoo\n'), 'foo')
})

// ── scoreLexicalSimilarity ──

test('identical strings score 1.0', () => {
  assert.equal(scoreLexicalSimilarity('hello world', 'hello world'), 1)
})

test('completely disjoint strings score 0', () => {
  assert.equal(scoreLexicalSimilarity('apple orange', 'banana kiwi'), 0)
})

test('partial overlap gives fractional score', () => {
  const score = scoreLexicalSimilarity('hello world foo', 'hello world bar')
  assert.ok(score > 0 && score < 1, `expected fractional, got ${score}`)
})

test('empty input returns 0', () => {
  assert.equal(scoreLexicalSimilarity('', 'hello'), 0)
  assert.equal(scoreLexicalSimilarity('hello', ''), 0)
  assert.equal(scoreLexicalSimilarity('', ''), 0)
})

// ── scoreContainment ──

test('full containment scores 1', () => {
  assert.equal(scoreContainment('hello', 'hello world'), 1)
})

test('no overlap returns 0', () => {
  assert.equal(scoreContainment('apple', 'banana kiwi'), 0)
})

// ── extractMemoriesFromMessage ──

test('extracts memories from user messages with self-referential patterns', () => {
  const msg: ChatMessage = {
    id: 'test-1',
    role: 'user',
    content: '我喜欢吃四川菜。我打算明年去日本旅行。',
    createdAt: '2026-04-01T00:00:00Z',
  }

  const memories = extractMemoriesFromMessage(msg)
  assert.ok(memories.length >= 1, `expected at least 1 memory, got ${memories.length}`)
  assert.ok(memories.every((m) => m.id.startsWith('memory-')))
  assert.ok(memories.every((m) => m.source === 'chat'))
  assert.ok(memories.every((m) => m.sourceRef === 'chat:test-1'))
  assert.ok(memories.every((m) => m.enabled === true))
  assert.ok(memories.every((m) => m.kind))
})

test('long-term memories carry chat source refs that can jump back to history', () => {
  const msg: ChatMessage = {
    id: 'source-message-1',
    role: 'user',
    content: '我喜欢在晚上写代码。',
    createdAt: '2026-04-01T00:00:00Z',
  }

  const memory = extractMemoriesFromMessage(msg)[0]
  const parsed = parseMemorySourceRef(memory?.sourceRef)

  assert.equal(memory?.sourceRef, 'chat:source-message-1')
  assert.equal(parsed?.kind, 'chat')
  assert.equal(parsed?.id, 'source-message-1')
  assert.equal(parsed?.canOpenHistory, true)
  assert.equal(parsed?.canOpenAutonomy, false)
})

test('ignores assistant messages', () => {
  const msg: ChatMessage = {
    id: 'test-2',
    role: 'assistant',
    content: '我喜欢吃四川菜',
    createdAt: '2026-04-01T00:00:00Z',
  }

  assert.deepEqual(extractMemoriesFromMessage(msg), [])
})

test('ignores segments that are too short', () => {
  const msg: ChatMessage = {
    id: 'test-3',
    role: 'user',
    content: '我是好的',
    createdAt: '2026-04-01T00:00:00Z',
  }

  assert.deepEqual(extractMemoriesFromMessage(msg), [])
})

// ── mergeMemories ──

test('appends non-duplicate memories', () => {
  const existing: MemoryItem[] = [{
    id: 'mem-1', content: '我喜欢猫', category: 'preference', source: 'chat',
    createdAt: '2026-04-01T00:00:00Z',
  }]

  const incoming: MemoryItem[] = [{
    id: 'mem-2', content: '我住在上海', category: 'profile', source: 'chat',
    createdAt: '2026-04-01T01:00:00Z',
  }]

  const merged = mergeMemories(existing, incoming)
  assert.equal(merged.length, 2)
})

test('deduplicates highly similar memories', () => {
  const existing: MemoryItem[] = [{
    id: 'mem-1', content: '我非常喜欢吃辣的食物', category: 'preference', source: 'chat',
    createdAt: '2026-04-01T00:00:00Z',
  }]

  const incoming: MemoryItem[] = [{
    id: 'mem-2', content: '我非常喜欢吃辣的食物', category: 'preference', source: 'chat',
    createdAt: '2026-04-01T01:00:00Z',
  }]

  const merged = mergeMemories(existing, incoming)
  assert.equal(merged.length, 1)
  assert.ok(merged[0].lastUsedAt, 'duplicate should update lastUsedAt')
})

test('respects max capacity (500)', () => {
  const existing: MemoryItem[] = Array.from({ length: 500 }, (_, i) => ({
    id: `mem-${i}`, content: `记忆内容 ${i} 独特的单词${i}`, category: 'profile' as const,
    source: 'chat', createdAt: new Date(Date.now() - i * 60_000).toISOString(),
  }))

  const incoming: MemoryItem[] = [{
    id: 'mem-new', content: '全新的记忆内容', category: 'profile', source: 'chat',
    createdAt: new Date().toISOString(),
  }]

  const merged = mergeMemories(existing, incoming)
  assert.equal(merged.length, 500)
})

// ── rankMemories ──

test('ranks relevant memories higher', () => {
  const memories: MemoryItem[] = [
    { id: 'm1', content: 'I like cats and dogs', category: 'preference', source: 'chat', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'm2', content: 'I live in Beijing city', category: 'profile', source: 'chat', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'm3', content: 'My cat is named Mimi', category: 'profile', source: 'chat', createdAt: '2026-01-01T00:00:00Z' },
  ]

  const ranked = rankMemories(memories, 'What is your cat name')
  // m3 mentions 'cat' and 'name'; m1 mentions 'cats' (partial); m2 is irrelevant
  assert.notEqual(ranked[0].id, 'm2')
})

test('rankMemories ignores disabled memories', () => {
  const memories: MemoryItem[] = [
    { id: 'm1', content: 'My cat is named Mimi', category: 'profile', source: 'chat', createdAt: '2026-01-01T00:00:00Z', enabled: false },
    { id: 'm2', content: 'I live in Beijing city', category: 'profile', source: 'chat', createdAt: '2026-01-01T00:00:00Z' },
  ]

  const ranked = rankMemories(memories, 'cat name')
  assert.equal(ranked.some((memory) => memory.id === 'm1'), false)
})

// ── getLocalDayKey ──

test('formats date as YYYY-MM-DD', () => {
  const key = getLocalDayKey(new Date(2026, 3, 2))
  assert.equal(key, '2026-04-02')
})

test('accepts ISO string', () => {
  const key = getLocalDayKey('2026-01-15T10:30:00Z')
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(key))
})

// ── createDailyMemoryEntry ──

test('creates daily entry from user message', () => {
  const msg: ChatMessage = {
    id: 'c1', role: 'user', content: '今天天气真好', createdAt: '2026-04-02T10:00:00Z',
  }
  const entry = createDailyMemoryEntry(msg, 'chat')
  assert.ok(entry)
  assert.equal(entry.role, 'user')
  assert.equal(entry.source, 'chat')
  assert.equal(entry.sourceRef, 'chat:c1')
  assert.ok(entry.id.startsWith('daily-memory-'))
})

test('creates voice daily source refs that can jump back to chat history', () => {
  const msg: ChatMessage = {
    id: 'voice-turn-1', role: 'assistant', content: '收到，我会记得。', createdAt: '2026-04-02T10:00:00Z',
  }
  const entry = createDailyMemoryEntry(msg, 'voice')
  const parsed = parseMemorySourceRef(entry?.sourceRef)

  assert.equal(entry?.sourceRef, 'voice:voice-turn-1')
  assert.equal(parsed?.kind, 'voice')
  assert.equal(parsed?.id, 'voice-turn-1')
  assert.equal(parsed?.canOpenHistory, true)
  assert.equal(parsed?.canOpenAutonomy, false)
})

test('parseMemorySourceRef keeps non-chat source refs visible but not jumpable', () => {
  const parsed = parseMemorySourceRef('telegram:chat-123:msg-456')

  assert.equal(parsed?.kind, 'telegram')
  assert.equal(parsed?.id, 'chat-123:msg-456')
  assert.equal(parsed?.canOpenHistory, false)
  assert.equal(parsed?.canOpenAutonomy, false)
})

test('parseMemorySourceRef marks proactive object refs as autonomy-jumpable', () => {
  const scheduler = parseMemorySourceRef('scheduler:daily_bracket')
  const errand = parseMemorySourceRef('errand:errand-1')
  const arc = parseMemorySourceRef('arc:arc-1')
  const capsule = parseMemorySourceRef('capsule:capsule-1')

  assert.equal(scheduler?.canOpenHistory, false)
  assert.equal(scheduler?.canOpenAutonomy, true)
  assert.equal(errand?.canOpenAutonomy, true)
  assert.equal(arc?.canOpenAutonomy, true)
  assert.equal(capsule?.canOpenAutonomy, true)
})

test('returns null for system messages', () => {
  const msg: ChatMessage = {
    id: 'c2', role: 'system', content: '系统消息', createdAt: '2026-04-02T10:00:00Z',
  }
  assert.equal(createDailyMemoryEntry(msg, 'chat'), null)
})

test('truncates long content', () => {
  const msg: ChatMessage = {
    id: 'c3', role: 'user', content: 'A'.repeat(200), createdAt: '2026-04-02T10:00:00Z',
  }
  const entry = createDailyMemoryEntry(msg, 'chat')
  assert.ok(entry)
  assert.ok(entry.content.length <= 121)
})

// ── mergeDailyMemories ──

test('adds new entries to store', () => {
  const store: DailyMemoryStore = {}
  const entries = [{
    id: 'd1', day: '2026-04-02', role: 'user' as const, content: '你好',
    source: 'chat' as const, createdAt: '2026-04-02T10:00:00Z',
  }]
  const merged = mergeDailyMemories(store, entries, 7)
  assert.ok(merged['2026-04-02'])
  assert.equal(merged['2026-04-02'].length, 1)
})

test('deduplicates daily entries with same role and similar content', () => {
  const store: DailyMemoryStore = {
    '2026-04-02': [{
      id: 'd1', day: '2026-04-02', role: 'user', content: '今天天气真好',
      source: 'chat', createdAt: '2026-04-02T10:00:00Z',
    }],
  }
  const entries = [{
    id: 'd2', day: '2026-04-02', role: 'user' as const, content: '今天天气真好',
    source: 'chat' as const, createdAt: '2026-04-02T10:01:00Z',
  }]
  const merged = mergeDailyMemories(store, entries, 7)
  assert.equal(merged['2026-04-02'].length, 1)
})

// ── pruneDailyMemories ──

test('prunes days beyond retention limit', () => {
  const store: DailyMemoryStore = {
    '2026-04-01': [{ id: 'd1', day: '2026-04-01', role: 'user', content: '旧', source: 'chat', createdAt: '2026-04-01T10:00:00Z' }],
    '2026-04-02': [{ id: 'd2', day: '2026-04-02', role: 'user', content: '新', source: 'chat', createdAt: '2026-04-02T10:00:00Z' }],
    '2026-04-03': [{ id: 'd3', day: '2026-04-03', role: 'user', content: '最新', source: 'chat', createdAt: '2026-04-03T10:00:00Z' }],
  }
  const pruned = pruneDailyMemories(store, 2)
  assert.ok(pruned['2026-04-03'])
  assert.ok(pruned['2026-04-02'])
  assert.ok(!pruned['2026-04-01'])
})

// ── clearDailyMemoriesForDay ──

test('removes entries for a specific day', () => {
  const store: DailyMemoryStore = {
    '2026-04-01': [{ id: 'd1', day: '2026-04-01', role: 'user', content: '旧', source: 'chat', createdAt: '2026-04-01T10:00:00Z' }],
    '2026-04-02': [{ id: 'd2', day: '2026-04-02', role: 'user', content: '新', source: 'chat', createdAt: '2026-04-02T10:00:00Z' }],
  }
  const result = clearDailyMemoriesForDay(store, '2026-04-01')
  assert.ok(!result['2026-04-01'])
  assert.ok(result['2026-04-02'])
})

// ── getRecentDailyEntries ──

test('returns entries from most recent days sorted by time', () => {
  const store: DailyMemoryStore = {
    '2026-04-01': [{ id: 'd1', day: '2026-04-01', role: 'user', content: '旧', source: 'chat', createdAt: '2026-04-01T10:00:00Z' }],
    '2026-04-02': [{ id: 'd2', day: '2026-04-02', role: 'user', content: '新', source: 'chat', createdAt: '2026-04-02T10:00:00Z' }],
  }
  const entries = getRecentDailyEntries(store, 1)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'd2')
})

// ── removeDailyMemoryEntry ──

test('removes a specific entry by id', () => {
  const store: DailyMemoryStore = {
    '2026-04-02': [
      { id: 'd1', day: '2026-04-02', role: 'user', content: '一', source: 'chat', createdAt: '2026-04-02T10:00:00Z' },
      { id: 'd2', day: '2026-04-02', role: 'user', content: '二', source: 'chat', createdAt: '2026-04-02T11:00:00Z' },
    ],
  }
  const result = removeDailyMemoryEntry(store, '2026-04-02', 'd1')
  assert.equal(result['2026-04-02'].length, 1)
  assert.equal(result['2026-04-02'][0].id, 'd2')
})

test('removes the day key when last entry is removed', () => {
  const store: DailyMemoryStore = {
    '2026-04-02': [{ id: 'd1', day: '2026-04-02', role: 'user', content: '唯一', source: 'chat', createdAt: '2026-04-02T10:00:00Z' }],
  }
  const result = removeDailyMemoryEntry(store, '2026-04-02', 'd1')
  assert.ok(!('2026-04-02' in result))
})

// ── updateDailyMemoryEntry ──

test('updates the content of a specific entry', () => {
  const store: DailyMemoryStore = {
    '2026-04-02': [{ id: 'd1', day: '2026-04-02', role: 'user', content: '旧内容', source: 'chat', createdAt: '2026-04-02T10:00:00Z' }],
  }
  const result = updateDailyMemoryEntry(store, '2026-04-02', 'd1', '新内容')
  assert.equal(result['2026-04-02'][0].content, '新内容')
})
