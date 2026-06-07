import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pickTier, scoreComplexity } from '../src/core/routing/SmartModelRouting.ts'

test('smart model routing sends short simple requests to the cheap tier', () => {
  const result = pickTier({
    userMessage: 'hello',
    historyLength: 1,
    hasToolCalls: false,
    hasImages: false,
  })

  assert.equal(result.tier, 'cheap')
  assert.match(result.reason, /cheap tier/)
})

test('smart model routing promotes tool-heavy or reasoning requests to standard', () => {
  const result = pickTier({
    userMessage: 'please explain this issue',
    historyLength: 1,
    hasToolCalls: true,
    hasImages: false,
  })

  assert.equal(result.tier, 'standard')
})

test('smart model routing promotes long code and reasoning requests to heavy', () => {
  const result = pickTier({
    userMessage: [
      'Please explain why this TypeScript bug happens.',
      'Design a refactor plan and compare the tradeoffs.',
      'Include code-level architecture analysis for the migration path.',
    ].join(' '),
    historyLength: 12,
    hasToolCalls: true,
    hasImages: true,
  })

  assert.equal(result.tier, 'heavy')
})

test('smart model routing clamps heavy requests when budget requires downgrade', () => {
  const result = pickTier(
    {
      userMessage: 'Please reason about this architecture tradeoff and produce a detailed analysis.',
      historyLength: 40,
      hasToolCalls: true,
      hasImages: true,
    },
    { maxTier: 'standard' },
  )

  assert.equal(result.tier, 'standard')
  assert.match(result.reason, /clamped to standard/)
})

test('smart model routing clamps explicit tiers against configured limits', () => {
  assert.equal(
    pickTier({
      userMessage: 'quick reply',
      historyLength: 1,
      hasToolCalls: false,
      hasImages: false,
      explicitTier: 'cheap',
    }, { minTier: 'standard' }).tier,
    'standard',
  )

  assert.equal(
    pickTier({
      userMessage: 'deep analysis',
      historyLength: 40,
      hasToolCalls: true,
      hasImages: true,
      explicitTier: 'heavy',
    }, { maxTier: 'standard' }).tier,
    'standard',
  )
})

test('smart model routing exposes factor-level complexity signals', () => {
  const score = scoreComplexity({
    userMessage: 'analyze code architecture',
    historyLength: 20,
    hasToolCalls: true,
    hasImages: true,
  })

  assert.equal(score.factors.tools, 2)
  assert.equal(score.factors.images, 1)
  assert.ok(score.factors.history > 0)
  assert.ok(score.factors.reasoning > 0)
  assert.ok(score.factors.code > 0)
  assert.ok(score.total >= 6)
})
