import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyRecallConfidence } from '../src/features/memory/recallConfidence.ts'
import { QWEN3_MEMORY_EMBEDDING_MODEL_ID } from '../src/features/memory/ollamaEmbedding.ts'
import { buildHotTierMemorySections } from '../src/features/chat/memoryInjection.ts'
import type { MemoryRecallContext } from '../src/types/memory.ts'

const QWEN3 = QWEN3_MEMORY_EMBEDDING_MODEL_ID

test('a flat field of weak cosines is rejected', () => {
  assert.equal(classifyRecallConfidence([0.33, 0.326, 0.31, 0.3], QWEN3), 'none')
})

test('a weak but standing-out match is only flagged low', () => {
  // best 0.413, runner-up 0.401: "我做什么工作的来着？" -> the job memory
  assert.equal(classifyRecallConfidence([0.413, 0.401, 0.39], QWEN3), 'low')
})

test('a clear match is high confidence', () => {
  assert.equal(classifyRecallConfidence([0.62, 0.39, 0.37], QWEN3), 'high')
  // weak absolute score but a wide margin still counts as a real match
  assert.equal(classifyRecallConfidence([0.39, 0.3, 0.29], QWEN3), 'high')
})

test('models without calibrated thresholds are never classified', () => {
  assert.equal(classifyRecallConfidence([0.01, 0.009], 'local-hash-v1'), undefined)
  assert.equal(classifyRecallConfidence([], QWEN3), undefined)
})

function context(overrides: Partial<MemoryRecallContext>): MemoryRecallContext {
  return {
    longTerm: [],
    daily: [],
    semantic: [],
    searchModeUsed: 'hybrid',
    vectorSearchAvailable: true,
    ...overrides,
  }
}

test('suppressed recall tells the model not to invent memories', () => {
  const { longTermSection } = buildHotTierMemorySections(context({ recallConfidence: 'none' }), 2000)
  assert.match(longTermSection, /don't remember/)
  assert.match(longTermSection, /never invent/)
})

test('low-confidence recall keeps memories with a caveat', () => {
  const memory = { id: 'm1', content: '在杭州当产品经理' } as MemoryRecallContext['longTerm'][number]
  const low = buildHotTierMemorySections(context({ recallConfidence: 'low', longTerm: [memory] }), 2000)
  assert.match(low.longTermSection, /None of these clearly matches/)
  assert.match(low.longTermSection, /产品经理/)
  const high = buildHotTierMemorySections(context({ recallConfidence: 'high', longTerm: [memory] }), 2000)
  assert.doesNotMatch(high.longTermSection, /None of these clearly matches/)
})

test('no confidence and no memories leaves the section empty', () => {
  assert.equal(buildHotTierMemorySections(context({}), 2000).longTermSection, '')
})
