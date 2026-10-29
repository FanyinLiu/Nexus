import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyRecallConfidence } from '../src/features/memory/recallConfidence.ts'
import { QWEN3_MEMORY_EMBEDDING_MODEL_ID } from '../src/features/memory/ollamaEmbedding.ts'
import { buildHotTierMemorySections } from '../src/features/chat/memoryInjection.ts'
import { getChatPromptStrings } from '../src/features/chat/prompts/index.ts'
import type { AppLocale } from '../src/types/i18n.ts'
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

test('a single weak memory is flagged low, never suppressed', () => {
  // With no runner-up there is no margin evidence, and the memory may be the
  // only place that fact lives. Losing it silently is worse than a caveat.
  assert.equal(classifyRecallConfidence([0.30], QWEN3), 'low')
  assert.equal(classifyRecallConfidence([0.60], QWEN3), 'high')
})

test('duplicate copies of one weak memory are flagged, not suppressed', () => {
  // Duplicates flatten the top-two margin; that is not evidence of a miss.
  assert.equal(classifyRecallConfidence([0.35, 0.35, 0.35], QWEN3), 'low')
  assert.equal(classifyRecallConfidence([0.60, 0.60, 0.60], QWEN3), 'high')
})

test('non-finite scores are ignored instead of poisoning the margin', () => {
  assert.equal(classifyRecallConfidence([Number.NaN, 0.60, Number.POSITIVE_INFINITY], QWEN3), 'high')
  assert.equal(classifyRecallConfidence([Number.NaN, 0.30], QWEN3), 'low')
  assert.equal(classifyRecallConfidence([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY], QWEN3), undefined)
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

test('suppressed recall gives in-character honesty, not a refusal script', () => {
  const { longTermSection } = buildHotTierMemorySections(context({ recallConfidence: 'none' }), 2000)
  assert.match(longTermSection, /I don't remember that yet/)
  assert.match(longTermSection, /remind me/)
  assert.doesNotMatch(longTermSection, /as an AI|I'd be happy to help/i)
})

test('low-confidence recall keeps memories with a caveat', () => {
  const memory = { id: 'm1', content: '在杭州当产品经理' } as MemoryRecallContext['longTerm'][number]
  const low = buildHotTierMemorySections(context({ recallConfidence: 'low', longTerm: [memory] }), 2000)
  assert.match(low.longTermSection, /might not be exactly what they mean/)
  assert.match(low.longTermSection, /产品经理/)
  const high = buildHotTierMemorySections(context({ recallConfidence: 'high', longTerm: [memory] }), 2000)
  assert.doesNotMatch(high.longTermSection, /might not be exactly what they mean/)
})

test('no confidence and no memories leaves the section empty', () => {
  assert.equal(buildHotTierMemorySections(context({}), 2000).longTermSection, '')
})

const LOCALES: AppLocale[] = ['en-US', 'ja', 'ko', 'zh-CN', 'zh-TW']

test('every locale has in-character low and empty recall guidance', () => {
  for (const locale of LOCALES) {
    const prompts = getChatPromptStrings(locale)
    assert.ok(prompts.memoryLongTermHeader.length > 0, locale)
    assert.ok(prompts.memoryLongTermLowNote.length > 0, locale)
    assert.ok(prompts.memoryLongTermEmptyNote.length > 0, locale)
    assert.doesNotMatch(prompts.memoryLongTermEmptyNote, /as an AI|How can I help/i, locale)

    const none = buildHotTierMemorySections(context({ recallConfidence: 'none' }), 2000, prompts)
    assert.equal(none.longTermSection, prompts.memoryLongTermEmptyNote, locale)

    const memory = { id: 'm1', content: 'a remembered detail' } as MemoryRecallContext['longTerm'][number]
    const low = buildHotTierMemorySections(context({ recallConfidence: 'low', longTerm: [memory] }), 2000, prompts)
    assert.match(low.longTermSection, /a remembered detail/, locale)
    assert.ok(low.longTermSection.includes(prompts.memoryLongTermLowNote), locale)
  }
})
