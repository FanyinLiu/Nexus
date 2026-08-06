import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyContradictionResolutions,
  detectContradictions,
  getSupersededRecallPenalty,
  judgeContradictionPair,
  LIKELY_SIMILARITY_THRESHOLD,
  PENDING_SUPERSEDED_RECALL_PENALTY,
  POSSIBLE_SIMILARITY_THRESHOLD,
  rankContradictionCandidates,
  SUPERSEDED_RECALL_PENALTY,
} from '../src/features/memory/contradictionDetector.ts'
import { rankMemories } from '../src/features/memory/memory.ts'
import { normalizeMemoryItemsForStorage } from '../src/lib/storage/memory.ts'
import type { MemoryItem } from '../src/types/memory.ts'

function memory(partial: Partial<MemoryItem> & { id: string; content: string }): MemoryItem {
  return {
    id: partial.id,
    content: partial.content,
    category: 'reference',
    source: 'chat',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    enabled: true,
    ...partial,
  }
}

// ── rankContradictionCandidates ─────────────────────────────────────────

test('rank: returns pairs sorted by similarity, highest first', () => {
  const newMemories = [memory({ id: 'n1', content: 'new' })]
  const existing = [
    memory({ id: 'e1', content: 'a' }),
    memory({ id: 'e2', content: 'b' }),
    memory({ id: 'e3', content: 'c' }),
  ]
  const similarityFn = (left: MemoryItem, right: MemoryItem) => {
    if (right.id === 'e1') return 0.9
    if (right.id === 'e2') return 0.95
    return 0.5
  }
  const candidates = rankContradictionCandidates(newMemories, existing, similarityFn)
  assert.deepEqual(candidates.map((c) => c.existingMemory.id), ['e2', 'e1', 'e3'])
})

test('rank: skips already-superseded existing memories', () => {
  const newMemories = [memory({ id: 'n1', content: 'new' })]
  const existing = [
    memory({ id: 'e1', content: 'a', supersededBy: 'other' }),
    memory({ id: 'e2', content: 'b' }),
  ]
  const candidates = rankContradictionCandidates(newMemories, existing, () => 0.99)
  assert.deepEqual(candidates.map((c) => c.existingMemory.id), ['e2'])
})

test('rank: skips pairs already linked through relatedIds', () => {
  const newMemories = [memory({ id: 'n1', content: 'new', relatedIds: ['e1'] })]
  const existing = [
    memory({ id: 'e1', content: 'a' }),
    memory({ id: 'e2', content: 'b' }),
  ]
  const candidates = rankContradictionCandidates(newMemories, existing, () => 0.99)
  assert.deepEqual(candidates.map((c) => c.existingMemory.id), ['e2'])
})

test('rank: respects maxCandidates cap', () => {
  const newMemories = [memory({ id: 'n1', content: 'new' })]
  const existing = Array.from({ length: 10 }, (_, index) => memory({ id: `e${index}`, content: `m${index}` }))
  const candidates = rankContradictionCandidates(newMemories, existing, () => 0.9, 3)
  assert.equal(candidates.length, 3)
})

test('rank: skips self-pairs and non-finite similarities', () => {
  const newMemories = [memory({ id: 'n1', content: 'new' })]
  const existing = [
    memory({ id: 'n1', content: 'new' }), // same id
    memory({ id: 'e1', content: 'a' }),
  ]
  const candidates = rankContradictionCandidates(
    newMemories,
    existing,
    (left, right) => (right.id === 'e1' ? Number.NaN : 0.9),
  )
  assert.deepEqual(candidates, [])
})

// ── judgeContradictionPair ──────────────────────────────────────────────

test('judge: likely when similarity high AND valence opposite', () => {
  const newMemory = memory({ id: 'n1', content: 'I quit coffee', emotionalValence: 'negative' })
  const existing = memory({ id: 'e1', content: 'I love coffee', emotionalValence: 'positive' })
  assert.equal(judgeContradictionPair(newMemory, existing, 0.95), 'likely')
})

test('judge: possible when similarity high but valence not opposite', () => {
  const newMemory = memory({ id: 'n1', content: 'I quit coffee', emotionalValence: 'negative' })
  const existing = memory({ id: 'e1', content: 'I love coffee', emotionalValence: 'negative' })
  assert.equal(judgeContradictionPair(newMemory, existing, 0.95), 'possible')
})

test('judge: possible when similarity high and valence unknown', () => {
  const newMemory = memory({ id: 'n1', content: 'I quit coffee' })
  const existing = memory({ id: 'e1', content: 'I love coffee' })
  assert.equal(judgeContradictionPair(newMemory, existing, 0.82), 'possible')
})

test('judge: none below the possible threshold', () => {
  const newMemory = memory({ id: 'n1', content: 'I quit coffee' })
  const existing = memory({ id: 'e1', content: 'I love coffee' })
  assert.equal(judgeContradictionPair(newMemory, existing, 0.79), 'none')
  assert.equal(judgeContradictionPair(newMemory, existing, Number.NaN), 'none')
})

test('judge: threshold boundary behaves as documented', () => {
  const a = memory({ id: 'n1', content: 'x', emotionalValence: 'positive' })
  const b = memory({ id: 'e1', content: 'y', emotionalValence: 'negative' })
  assert.equal(judgeContradictionPair(a, b, LIKELY_SIMILARITY_THRESHOLD), 'likely')
  assert.equal(judgeContradictionPair(a, b, POSSIBLE_SIMILARITY_THRESHOLD), 'possible')
})

// ── applyContradictionResolutions ───────────────────────────────────────

test('apply: writes superseded markers onto the old memory', () => {
  const memories = [
    memory({ id: 'e1', content: 'I love coffee' }),
    memory({ id: 'e2', content: 'unrelated' }),
    memory({ id: 'n1', content: 'I quit coffee' }),
  ]
  const next = applyContradictionResolutions(
    memories,
    [{ newId: 'n1', existingId: 'e1', judgement: 'likely' }],
    '2026-08-03T00:00:00.000Z',
  )
  const e1 = next.find((m) => m.id === 'e1')!
  assert.equal(e1.supersededBy, 'n1')
  assert.equal(e1.supersededAt, '2026-08-03T00:00:00.000Z')
  assert.equal(e1.supersededPending, undefined)
  // Untouched memories keep their identity (immutability for the rest).
  assert.equal(next.find((m) => m.id === 'e2'), memories[1])
})

test('apply: possible judgement records a mild (pending) supersession', () => {
  const memories = [memory({ id: 'e1', content: 'I love coffee' })]
  const next = applyContradictionResolutions(
    memories,
    [{ newId: 'n1', existingId: 'e1', judgement: 'possible' }],
    '2026-08-03T00:00:00.000Z',
  )
  const e1 = next[0]!
  assert.equal(e1.supersededBy, 'n1')
  assert.equal(e1.supersededPending, true)
  // Both tiers are automatic — pending gets a milder penalty, not none.
  assert.equal(getSupersededRecallPenalty(e1), PENDING_SUPERSEDED_RECALL_PENALTY)
})

test('apply: confirmed supersession is never overwritten', () => {
  const memories = [
    memory({ id: 'e1', content: 'I love coffee', supersededBy: 'n1', supersededAt: '2026-08-01T00:00:00.000Z' }),
  ]
  const next = applyContradictionResolutions(
    memories,
    [{ newId: 'n2', existingId: 'e1', judgement: 'likely' }],
    '2026-08-03T00:00:00.000Z',
  )
  assert.equal(next[0]!.supersededBy, 'n1')
})

test('apply: pending may be upgraded to confirmed by a later likely resolution', () => {
  const memories = [
    memory({ id: 'e1', content: 'I love coffee', supersededBy: 'n1', supersededPending: true }),
  ]
  const next = applyContradictionResolutions(
    memories,
    [{ newId: 'n2', existingId: 'e1', judgement: 'likely' }],
    '2026-08-03T00:00:00.000Z',
  )
  assert.equal(next[0]!.supersededBy, 'n2')
  assert.equal(next[0]!.supersededPending, undefined)
})

test('apply: idempotent — same resolution twice yields identical output', () => {
  const memories = [memory({ id: 'e1', content: 'I love coffee' })]
  const resolutions = [{ newId: 'n1', existingId: 'e1', judgement: 'likely' }]
  const once = applyContradictionResolutions(memories, resolutions, '2026-08-03T00:00:00.000Z')
  const twice = applyContradictionResolutions(once, resolutions, '2026-08-03T00:00:00.000Z')
  assert.deepEqual(twice, once)
})

// ── detectContradictions (orchestration) ────────────────────────────────

test('detect: returns judged resolutions, dropping none', async () => {
  const newMemories = [
    memory({ id: 'n1', content: 'I quit coffee', emotionalValence: 'negative' }),
    memory({ id: 'n2', content: 'totally unrelated topic', emotionalValence: 'positive' }),
  ]
  const existing = [
    memory({ id: 'e1', content: 'I love coffee', emotionalValence: 'positive' }),
    memory({ id: 'e2', content: 'another thing' }),
  ]
  const embed = async (text: string) => {
    // Deterministic fake embedding: coffee-ish texts land close together,
    // everything else lands on its own axis.
    if (text.includes('coffee')) return [1, 0, 0]
    if (text.includes('unrelated')) return [0, 1, 0]
    return [0, 0, 1]
  }
  const dot = (left: number[], right: number[]) =>
    left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0)
  const resolutions = await detectContradictions(newMemories, existing, {
    embedText: embed,
    cosine: dot,
    keywordRank: (memories, query) => rankMemories(memories, query),
  })
  // n1 ("quit coffee") vs e1 ("love coffee"): similarity 1.0, opposite
  // valence → likely. n2 vs anything: similarity 0 → dropped.
  assert.deepEqual(resolutions, [{ newId: 'n1', existingId: 'e1', judgement: 'likely' }])
})

test('detect: keyword pre-filter bounds embedding calls', async () => {
  const newMemories = [memory({ id: 'n1', content: 'coffee' })]
  const existing = Array.from({ length: 20 }, (_, index) => memory({ id: `e${index}`, content: `topic ${index}` }))
  let embedCalls = 0
  const resolutions = await detectContradictions(newMemories, existing, {
    embedText: async () => { embedCalls += 1; return [1] },
    cosine: () => 0.9,
    keywordRank: (memories, query) => rankMemories(memories, query),
    prefilterPerNew: 5,
  })
  // 1 (new) + 5 (pre-filtered existing) — not 21.
  assert.equal(embedCalls, 6)
  assert.ok(resolutions.length <= 5)
})

// ── recall penalty integration ──────────────────────────────────────────

test('recall: confirmed superseded memories rank below their replacement', () => {
  const superseded = memory({ id: 'e1', content: 'I prefer dark roast coffee', supersededBy: 'n1', supersededAt: '2026-08-01T00:00:00.000Z' })
  const replacement = memory({ id: 'n1', content: 'I quit coffee entirely', createdAt: '2026-08-02T00:00:00.000Z' })
  const ranked = rankMemories([superseded, replacement], 'coffee')
  assert.equal(ranked[0]!.id, 'n1')
})

test('recall: pending supersession gets a milder penalty than confirmed', () => {
  // Lexical similarity (shared/max): e1 = 2/2 = 1.0, n1 = 2/4 = 0.5 — a
  // ratio of 2.0, inside the (1/0.6, 1/0.3) band where the two penalty
  // tiers behave differently: ×0.6 keeps the old memory on top, ×0.3
  // flips the order in favor of the replacement.
  const pending = memory({
    id: 'e1',
    content: 'dark roast',
    supersededBy: 'n1',
    supersededPending: true,
  })
  const confirmed = memory({
    id: 'e1',
    content: 'dark roast',
    supersededBy: 'n1',
    supersededAt: '2026-08-01T00:00:00.000Z',
  })
  const replacement = memory({ id: 'n1', content: 'dark roast tea latte' })

  const rankedPending = rankMemories([pending, replacement], 'dark roast')
  assert.equal(rankedPending[0]!.id, 'e1', 'mild penalty keeps the strongly relevant old memory on top')

  const rankedConfirmed = rankMemories([confirmed, replacement], 'dark roast')
  assert.equal(rankedConfirmed[0]!.id, 'n1', 'confirmed penalty flips the order in favor of the replacement')
})

test('recall: penalty tiers are applied multiplicatively (0.3 / 0.6)', () => {
  assert.equal(SUPERSEDED_RECALL_PENALTY, 0.3)
  assert.equal(PENDING_SUPERSEDED_RECALL_PENALTY, 0.6)
  assert.equal(getSupersededRecallPenalty(memory({ id: 'x', content: 'plain' })), 1)
})

// ── storage normalisation ───────────────────────────────────────────────

test('storage: normalise preserves supersession fields (allowlist)', () => {
  const raw = [{
    id: 'e1',
    content: 'I love coffee',
    category: 'preference',
    source: 'chat',
    createdAt: '2026-01-01T00:00:00.000Z',
    supersededBy: 'n1',
    supersededAt: '2026-08-03T00:00:00.000Z',
    supersededPending: true,
  }]
  const normalized = normalizeMemoryItemsForStorage(raw)
  assert.equal(normalized[0]!.supersededBy, 'n1')
  assert.equal(normalized[0]!.supersededAt, '2026-08-03T00:00:00.000Z')
  assert.equal(normalized[0]!.supersededPending, true)
})

test('storage: normalise drops malformed supersession fields', () => {
  const raw = [{
    id: 'e1',
    content: 'I love coffee',
    category: 'preference',
    source: 'chat',
    createdAt: '2026-01-01T00:00:00.000Z',
    supersededBy: 42,
    supersededAt: 'not-a-date',
    supersededPending: 'yes',
  }]
  const normalized = normalizeMemoryItemsForStorage(raw)
  assert.equal(normalized[0]!.supersededBy, undefined)
  assert.equal(normalized[0]!.supersededAt, undefined)
  assert.equal(normalized[0]!.supersededPending, undefined)
})
