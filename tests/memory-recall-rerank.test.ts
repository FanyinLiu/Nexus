import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MEMORY_RERANK_TOP_K,
  fuseRecallRerank,
  scoreRerankCandidates,
} from '../src/features/memory/recallRerank.ts'

const items = (ids: string[]) => ids.map((id) => ({ id }))

test('a decisive second-stage score promotes its candidate', () => {
  const ranked = items(['a', 'b', 'c', 'd'])
  const fused = fuseRecallRerank(ranked, new Map([
    ['a', 0.41],
    ['b', 0.62],
    ['c', 0.39],
    ['d', 0.35],
  ]))
  assert.deepEqual(fused.map((item) => item.id), ['b', 'a', 'c', 'd'])
  // The input order is never mutated in place.
  assert.deepEqual(ranked.map((item) => item.id), ['a', 'b', 'c', 'd'])
})

test('without second-stage scores the first-stage order is kept', () => {
  const ranked = items(['a', 'b', 'c'])
  assert.deepEqual(fuseRecallRerank(ranked, new Map()).map((item) => item.id), ['a', 'b', 'c'])
})

test('only the head is reordered; the tail keeps its order', () => {
  const ranked = items(['a', 'b', 'c', 'd', 'e'])
  const fused = fuseRecallRerank(ranked, new Map([['b', 0.9], ['a', 0.2]]), 2)
  assert.deepEqual(fused.map((item) => item.id), ['b', 'a', 'c', 'd', 'e'])
  assert.deepEqual(fused.slice(2).map((item) => item.id), ['c', 'd', 'e'])
})

test('candidates outside the head are never promoted', () => {
  const ranked = items(['a', 'b', 'c'])
  const fused = fuseRecallRerank(ranked, new Map([['c', 0.99], ['a', 0.1], ['b', 0.2]]), 2)
  assert.deepEqual(fused.map((item) => item.id), ['b', 'a', 'c'])
})

test('a head candidate without a finite score earns no second-stage boost', () => {
  const ranked = items(['a', 'b', 'c'])
  const fused = fuseRecallRerank(ranked, new Map([['b', 0.5], ['c', 0.4], ['a', Number.NaN]]))
  assert.deepEqual(fused.map((item) => item.id), ['b', 'c', 'a'])
})

test('too few usable scores falls back to the original order', () => {
  const ranked = items(['a', 'b', 'c'])
  assert.deepEqual(
    fuseRecallRerank(ranked, new Map([['b', Number.NaN]])).map((item) => item.id),
    ['a', 'b', 'c'],
  )
})

test('the head size never exceeds the list', () => {
  const ranked = items(['a', 'b'])
  const fused = fuseRecallRerank(ranked, new Map([['b', 0.9], ['a', 0.1]]), MEMORY_RERANK_TOP_K)
  assert.deepEqual(fused.map((item) => item.id), ['b', 'a'])
})

test('cosine scores skip vectors from another embedding space', () => {
  const scores = scoreRerankCandidates([1, 0, 0], [
    { id: 'same', embedding: [1, 0, 0] },
    { id: 'other-dim', embedding: [1, 0] },
  ])
  assert.equal(scores.get('same'), 1)
  assert.equal(scores.has('other-dim'), false)
  assert.equal(scoreRerankCandidates([], [{ id: 'a', embedding: [1] }]).size, 0)
})
