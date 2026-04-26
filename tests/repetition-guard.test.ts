import assert from 'node:assert/strict'
import { test } from 'node:test'

import { analyzeRecentReplies } from '../src/features/autonomy/v2/repetitionGuard.ts'

test('returns null when fewer than 3 replies', () => {
  assert.equal(analyzeRecentReplies([]), null)
  assert.equal(analyzeRecentReplies(['hi']), null)
  assert.equal(analyzeRecentReplies(['hi', 'yo']), null)
})

test('returns null when nothing repeats', () => {
  const out = analyzeRecentReplies([
    '今天的咖啡有点苦',
    '我刚走过那家书店，门口的猫还在',
    '那个项目终于跑通了，松了口气',
  ])
  assert.equal(out, null)
})

test('flags repeated 2-char openings', () => {
  const out = analyzeRecentReplies([
    '嗯嗯，我懂',
    '嗯嗯，那个，没关系的',
    '嗯嗯，可以呀',
    '不一样的开头长一点也没关系',
  ])
  assert.ok(out)
  assert.deepEqual(out!.avoidOpenings, ['嗯嗯'])
})

test('flags repeated 4-char endings', () => {
  const out = analyzeRecentReplies([
    '今天感觉还不错呢',
    '咖啡的味道还不错呢',
    '那家书店气氛还不错呢',
    '完全 different ending here longer',
  ])
  assert.ok(out)
  assert.ok(out!.avoidEndings.includes('还不错呢'))
})

test('flags monotone length when all replies are similar length', () => {
  const out = analyzeRecentReplies([
    '今天过得还可以哈', // 8 chars
    '吃完饭出去走一走', // 8 chars
    '工作的事先放一放', // 8 chars
  ])
  assert.ok(out)
  assert.equal(out!.lengthMonotone, true)
})

test('does not flag length when one reply breaks the pattern', () => {
  const out = analyzeRecentReplies([
    '今天过得还可以',
    '吃完饭出去走一走，看看夜景，顺便整理一下脑子里的事，好像还挺好的',
    '嗯',
  ])
  // Other signals may still fire, but lengthMonotone should be false here.
  assert.ok(out === null || out.lengthMonotone === false)
})

test('flags punctuation overuse when >=50% of replies use it >=2 times', () => {
  const out = analyzeRecentReplies([
    '哇！太棒了！',
    '是啊！我也觉得！',
    '挺好的，不用太担心',
    '可以的！这个就好！',
  ])
  assert.ok(out)
  assert.ok(out!.avoidPunctuation.includes('！'))
})

test('does not flag mild punctuation use', () => {
  const out = analyzeRecentReplies([
    '今天还行吧',
    '啊！吓我一跳',
    '那挺好的',
  ])
  assert.equal(out?.avoidPunctuation.length ?? 0, 0)
})

test('strips leading/trailing punctuation before opening/ending detection', () => {
  const out = analyzeRecentReplies([
    '——好的，明白',
    '——好的，那我先去做',
    '——好的，没问题',
  ])
  assert.ok(out)
  assert.ok(out!.avoidOpenings.includes('好的'))
})

test('handles English replies', () => {
  const out = analyzeRecentReplies([
    'I see, that makes sense to me really',
    'I see, that does ring familiar honestly',
    'I see, that lines up with what I felt indeed',
  ])
  assert.ok(out)
  assert.ok(out!.avoidOpenings.includes('I '))
})

test('skips empty / whitespace replies', () => {
  const out = analyzeRecentReplies([
    '嗯嗯，懂了',
    '   ',
    '',
    '嗯嗯，明白',
    '嗯嗯，没事',
  ])
  assert.ok(out)
  assert.deepEqual(out!.avoidOpenings, ['嗯嗯'])
})
