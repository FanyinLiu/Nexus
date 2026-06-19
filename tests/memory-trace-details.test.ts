import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildChatMemoryTraceFocus,
  mergeFocusedDailyEntries,
  resolveChatMemoryTraceDetails,
} from '../src/features/memory/traceDetails.ts'
import type { ChatMemoryTrace } from '../src/types/chat.ts'
import type { DailyMemoryStore, MemoryItem } from '../src/types/memory.ts'

const memories: MemoryItem[] = [{
  id: 'memory-1',
  category: 'preference',
  content: 'User likes quiet, companion-style replies with no task-agent framing.',
  source: 'chat',
  createdAt: '2026-06-19T08:00:00.000Z',
  enabled: true,
}, {
  id: 'memory-disabled',
  category: 'goal',
  content: 'This memory is paused by the user.',
  source: 'manual',
  createdAt: '2026-06-19T08:02:00.000Z',
  enabled: false,
}]

const dailyMemories: DailyMemoryStore = {
  '2026-06-19': [{
    id: 'daily-1',
    day: '2026-06-19',
    role: 'user',
    content: 'A daily note that can be shown as a short runtime preview.',
    source: 'chat',
    createdAt: '2026-06-19T08:01:00.000Z',
  }],
  '2026-06-18': [{
    id: 'daily-old',
    day: '2026-06-18',
    role: 'assistant',
    content: 'An older diary fragment referenced by the reply trace.',
    source: 'chat',
    createdAt: '2026-06-18T22:00:00.000Z',
  }],
}

test('resolveChatMemoryTraceDetails resolves trace ids to current memory previews', () => {
  const trace: ChatMemoryTrace = {
    status: 'active',
    searchModeUsed: 'hybrid',
    vectorSearchAvailable: true,
    longTermIds: ['memory-1', 'memory-missing', 'memory-disabled'],
    dailyEntryIds: ['daily-1', 'daily-missing'],
    semanticIds: ['memory-1', 'daily-1', 'semantic-missing'],
  }

  const details = resolveChatMemoryTraceDetails({ trace, memories, dailyMemories })

  assert.equal(details?.status, 'active')
  assert.equal(details?.availableCount, 5)
  assert.equal(details?.missingCount, 3)
  assert.deepEqual(details?.longTerm.map((item) => item.status), ['available', 'missing', 'available'])
  assert.equal(details?.longTerm[0]?.preview?.includes('quiet, companion-style'), true)
  assert.equal(details?.longTerm[2]?.enabled, false)
  assert.equal(details?.daily[0]?.day, '2026-06-19')
  assert.equal(details?.semantic[0]?.preview, details?.longTerm[0]?.preview)
  assert.equal(details?.semantic[1]?.preview, details?.daily[0]?.preview)
})

test('resolveChatMemoryTraceDetails keeps paused traces explicit and empty', () => {
  const trace: ChatMemoryTrace = {
    status: 'paused',
    searchModeUsed: 'keyword',
    vectorSearchAvailable: false,
    longTermIds: [],
    dailyEntryIds: [],
    semanticIds: [],
  }

  const details = resolveChatMemoryTraceDetails({ trace, memories, dailyMemories })

  assert.equal(details?.status, 'paused')
  assert.equal(details?.searchModeUsed, 'keyword')
  assert.equal(details?.availableCount, 0)
  assert.equal(details?.missingCount, 0)
  assert.deepEqual(details?.longTerm, [])
  assert.deepEqual(details?.daily, [])
  assert.deepEqual(details?.semantic, [])
})

test('resolveChatMemoryTraceDetails returns null when a message has no trace', () => {
  assert.equal(resolveChatMemoryTraceDetails({ memories, dailyMemories }), null)
})

test('buildChatMemoryTraceFocus returns deduped ids and skips paused traces', () => {
  const trace: ChatMemoryTrace = {
    status: 'active',
    searchModeUsed: 'hybrid',
    vectorSearchAvailable: true,
    longTermIds: ['memory-1', ' memory-1 ', ''],
    dailyEntryIds: ['daily-1', 'daily-1'],
    semanticIds: ['daily-old', ' daily-old '],
  }

  assert.deepEqual(buildChatMemoryTraceFocus(trace), {
    longTermIds: ['memory-1'],
    dailyEntryIds: ['daily-1'],
    semanticIds: ['daily-old'],
  })

  assert.equal(buildChatMemoryTraceFocus({
    ...trace,
    status: 'paused',
    longTermIds: ['memory-1'],
  }), null)
})

test('mergeFocusedDailyEntries includes focused diary entries outside the recent preview', () => {
  const baseEntries = [dailyMemories['2026-06-19']![0]!]

  const merged = mergeFocusedDailyEntries({
    baseEntries,
    dailyMemories,
    focus: {
      longTermIds: [],
      dailyEntryIds: ['daily-old', 'daily-1'],
      semanticIds: ['daily-old'],
    },
  })

  assert.deepEqual(merged.map((entry) => entry.id), ['daily-1', 'daily-old'])
  assert.equal(mergeFocusedDailyEntries({ baseEntries, dailyMemories }), baseEntries)
})
