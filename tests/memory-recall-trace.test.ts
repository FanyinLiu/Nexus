import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildChatMemoryTrace } from '../src/features/memory/recallTrace.ts'
import type { MemoryRecallContext } from '../src/types/memory.ts'

const activeContext: MemoryRecallContext = {
  longTerm: [
    {
      id: 'memory-1',
      category: 'preference',
      content: 'Private preference text must not be copied into chat metadata.',
      source: 'chat',
      createdAt: '2026-06-19T08:00:00.000Z',
    },
  ],
  daily: [{
    id: 'daily-1',
    day: '2026-06-19',
    role: 'user',
    content: 'Private daily text must not be copied into chat metadata.',
    source: 'chat',
    createdAt: '2026-06-19T08:01:00.000Z',
  }],
  semantic: [{
    id: 'memory-1',
    layer: 'long_term',
    content: 'Private semantic preview must not be copied into chat metadata.',
    score: 0.91,
  }],
  searchModeUsed: 'hybrid',
  vectorSearchAvailable: true,
  recalledLongTermIds: ['memory-1'],
}

test('buildChatMemoryTrace stores content-minimized memory source ids', () => {
  const trace = buildChatMemoryTrace({
    memoryContext: activeContext,
    memoryPaused: false,
  })

  assert.deepEqual(trace, {
    status: 'active',
    searchModeUsed: 'hybrid',
    vectorSearchAvailable: true,
    longTermIds: ['memory-1'],
    dailyEntryIds: ['daily-1'],
    semanticIds: ['memory-1'],
  })
  assert.equal(JSON.stringify(trace).includes('Private'), false)
})

test('buildChatMemoryTrace makes paused turns explicit and empty', () => {
  const trace = buildChatMemoryTrace({
    memoryContext: activeContext,
    memoryPaused: true,
  })

  assert.deepEqual(trace, {
    status: 'paused',
    searchModeUsed: 'hybrid',
    vectorSearchAvailable: false,
    longTermIds: [],
    dailyEntryIds: [],
    semanticIds: [],
  })
})
