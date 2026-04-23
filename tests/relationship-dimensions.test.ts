import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  type RelationshipSignal,
  type SubDimensions,
  applyRelationshipSignals,
  classifyRelationshipSignals,
  computeCompositeScore,
  createDefaultSubDimensions,
  decaySubDimensions,
  formatSubDimensionsForPrompt,
} from '../src/features/autonomy/relationshipDimensions.ts'
import {
  createDefaultRelationshipState,
  formatRelationshipForPrompt,
  markDailyInteraction,
} from '../src/features/autonomy/relationshipTracker.ts'

describe('classifyRelationshipSignals', () => {
  test('returns empty array for empty input', () => {
    assert.deepEqual(classifyRelationshipSignals(''), [])
  })

  test('detects shared_problem (Chinese)', () => {
    const signals = classifyRelationshipSignals('我想问你一个问题，帮我看看')
    assert.ok(signals.includes('shared_problem'))
  })

  test('detects shared_problem (English)', () => {
    const signals = classifyRelationshipSignals('I need help with something')
    assert.ok(signals.includes('shared_problem'))
  })

  test('detects accepted_help', () => {
    const signals = classifyRelationshipSignals('谢谢你的帮助，问题解决了')
    assert.ok(signals.includes('accepted_help'))
  })

  test('detects shared_feeling', () => {
    const signals = classifyRelationshipSignals('我最近感觉很焦虑')
    assert.ok(signals.includes('shared_feeling'))
  })

  test('detects personal_story', () => {
    const signals = classifyRelationshipSignals('我小时候和我爸爸去过那个地方')
    assert.ok(signals.includes('personal_story'))
  })

  test('detects expressed_sadness', () => {
    const signals = classifyRelationshipSignals('我今天真的很难过')
    assert.ok(signals.includes('expressed_sadness'))
  })

  test('expressed_sadness requires first-person (not "my friend is sad")', () => {
    const zhSignals = classifyRelationshipSignals('我朋友最近特别难过')
    // "我朋友" is personal_story territory, but should not credit the user's
    // own vulnerability on behalf of their friend.
    assert.ok(!zhSignals.includes('expressed_sadness'),
      `expected no expressed_sadness for "my friend is sad", got ${zhSignals.join(',')}`)
    const enSignals = classifyRelationshipSignals('my friend is sad')
    assert.ok(!enSignals.includes('expressed_sadness'),
      `expected no expressed_sadness for "my friend is sad", got ${enSignals.join(',')}`)
  })

  test('detects joke', () => {
    const signals = classifyRelationshipSignals('哈哈哈哈笑死我了')
    assert.ok(signals.includes('joke'))
  })

  test('detects teasing', () => {
    const signals = classifyRelationshipSignals('别闹，逗你玩的')
    assert.ok(signals.includes('teasing'))
  })

  test('detects asked_deep_question', () => {
    const signals = classifyRelationshipSignals('你觉得这件事是不是本质上挺荒谬的')
    assert.ok(signals.includes('asked_deep_question'))
  })

  test('detects debated', () => {
    const signals = classifyRelationshipSignals('我觉得不对，其实应该这样看')
    assert.ok(signals.includes('debated'))
  })

  test('detects taught_something', () => {
    const signals = classifyRelationshipSignals('你知道吗，我发现一件很有意思的事')
    assert.ok(signals.includes('taught_something'))
  })

  test('can detect multiple signals in one message', () => {
    const signals = classifyRelationshipSignals('哈哈哈，你觉得这是不是很离谱')
    assert.ok(signals.includes('joke'))
    assert.ok(signals.includes('asked_deep_question'))
  })

  test('does not misfire on plain small talk', () => {
    const signals = classifyRelationshipSignals('今天天气不错')
    assert.equal(signals.length, 0)
  })
})

describe('applyRelationshipSignals', () => {
  test('does nothing with empty signal list', () => {
    const dims = createDefaultSubDimensions()
    const next = applyRelationshipSignals(dims, [])
    assert.equal(next, dims, 'expected same reference when no signals')
  })

  test('increments trust on shared_problem', () => {
    const dims = createDefaultSubDimensions()
    const next = applyRelationshipSignals(dims, ['shared_problem'])
    assert.ok(next.trust > dims.trust)
    assert.equal(next.vulnerability, dims.vulnerability)
  })

  test('diminishing returns: high value grows slower than low value', () => {
    const low: SubDimensions = { trust: 0.1, vulnerability: 0, playfulness: 0, intellectual: 0 }
    const high: SubDimensions = { trust: 0.9, vulnerability: 0, playfulness: 0, intellectual: 0 }

    const lowGain = applyRelationshipSignals(low, ['shared_problem']).trust - low.trust
    const highGain = applyRelationshipSignals(high, ['shared_problem']).trust - high.trust

    assert.ok(lowGain > highGain, `expected diminishing returns (lowGain=${lowGain}, highGain=${highGain})`)
  })

  test('clamps to 1.0 maximum', () => {
    let dims: SubDimensions = { trust: 0.98, vulnerability: 0, playfulness: 0, intellectual: 0 }
    for (let i = 0; i < 100; i++) {
      dims = applyRelationshipSignals(dims, ['shared_problem'])
    }
    assert.ok(dims.trust <= 1.0)
    assert.ok(dims.trust > 0.98)
  })

  test('multiple signals in one pass all apply', () => {
    const dims = createDefaultSubDimensions()
    const next = applyRelationshipSignals(dims, ['shared_problem', 'joke'])
    assert.ok(next.trust > dims.trust)
    assert.ok(next.playfulness > dims.playfulness)
  })

  test('all signals route to the correct dimension', () => {
    const routing: Array<[RelationshipSignal, keyof SubDimensions]> = [
      ['shared_problem', 'trust'],
      ['accepted_help', 'trust'],
      ['shared_feeling', 'vulnerability'],
      ['personal_story', 'vulnerability'],
      ['expressed_sadness', 'vulnerability'],
      ['joke', 'playfulness'],
      ['teasing', 'playfulness'],
      ['asked_deep_question', 'intellectual'],
      ['debated', 'intellectual'],
      ['taught_something', 'intellectual'],
    ]

    for (const [signal, expectedDim] of routing) {
      const dims = createDefaultSubDimensions()
      const next = applyRelationshipSignals(dims, [signal])
      for (const key of Object.keys(dims) as Array<keyof SubDimensions>) {
        if (key === expectedDim) {
          assert.ok(next[key] > dims[key], `${signal} should raise ${key}`)
        } else {
          assert.equal(next[key], dims[key], `${signal} should not touch ${key}`)
        }
      }
    }
  })
})

describe('computeCompositeScore', () => {
  test('defaults produce a low score', () => {
    const score = computeCompositeScore(createDefaultSubDimensions())
    assert.ok(score <= 10, `expected low default composite, got ${score}`)
  })

  test('all-ones produces 100', () => {
    const score = computeCompositeScore({ trust: 1, vulnerability: 1, playfulness: 1, intellectual: 1 })
    assert.equal(score, 100)
  })

  test('all-zeros produces 0', () => {
    const score = computeCompositeScore({ trust: 0, vulnerability: 0, playfulness: 0, intellectual: 0 })
    assert.equal(score, 0)
  })

  test('weights sum to 1 (trust*0.3 + vulnerability*0.25 + playfulness*0.2 + intellectual*0.25)', () => {
    // Only trust = 1 → score = 30
    assert.equal(computeCompositeScore({ trust: 1, vulnerability: 0, playfulness: 0, intellectual: 0 }), 30)
    assert.equal(computeCompositeScore({ trust: 0, vulnerability: 1, playfulness: 0, intellectual: 0 }), 25)
    assert.equal(computeCompositeScore({ trust: 0, vulnerability: 0, playfulness: 1, intellectual: 0 }), 20)
    assert.equal(computeCompositeScore({ trust: 0, vulnerability: 0, playfulness: 0, intellectual: 1 }), 25)
  })
})

describe('decaySubDimensions', () => {
  test('leaves baseline values essentially unchanged', () => {
    const base = createDefaultSubDimensions()
    const decayed = decaySubDimensions(base)
    assert.ok(Math.abs(decayed.trust - base.trust) < 1e-6)
    assert.ok(Math.abs(decayed.playfulness - base.playfulness) < 1e-6)
  })

  test('pulls elevated values toward baseline', () => {
    const high: SubDimensions = { trust: 0.9, vulnerability: 0.9, playfulness: 0.9, intellectual: 0.9 }
    const decayed = decaySubDimensions(high)
    assert.ok(decayed.trust < high.trust)
    assert.ok(decayed.trust > 0.85, 'decay should be slow')
  })

  test('lifts sub-baseline values back up toward baseline', () => {
    const low: SubDimensions = { trust: 0, vulnerability: 0, playfulness: 0, intellectual: 0 }
    const decayed = decaySubDimensions(low)
    assert.ok(decayed.trust > low.trust)
  })

  test('200 days of absence cuts elevated trust by a meaningful fraction', () => {
    let dims: SubDimensions = { trust: 0.8, vulnerability: 0.5, playfulness: 0.5, intellectual: 0.5 }
    for (let i = 0; i < 200; i++) {
      dims = decaySubDimensions(dims)
    }
    // Decay is 0.5% per day toward 0.1 baseline, so after 200 days:
    // trust ≈ 0.1 + (0.8 - 0.1) * 0.995^200 ≈ 0.1 + 0.7 * 0.367 ≈ 0.36
    assert.ok(dims.trust < 0.4, `expected significant decay, got ${dims.trust}`)
    assert.ok(dims.trust > 0.2, `decay should be gradual, got ${dims.trust}`)
  })
})

describe('formatSubDimensionsForPrompt', () => {
  test('returns empty string when all dimensions are mid-range', () => {
    const dims: SubDimensions = { trust: 0.5, vulnerability: 0.4, playfulness: 0.5, intellectual: 0.5 }
    assert.equal(formatSubDimensionsForPrompt(dims, 'friend'), '')
  })

  test('surfaces high trust guidance', () => {
    const dims: SubDimensions = { trust: 0.8, vulnerability: 0.3, playfulness: 0.3, intellectual: 0.3 }
    const text = formatSubDimensionsForPrompt(dims, 'friend')
    assert.ok(/trust you deeply/i.test(text))
  })

  test('surfaces low-trust guidance only above stranger level', () => {
    const dims: SubDimensions = { trust: 0.1, vulnerability: 0.3, playfulness: 0.3, intellectual: 0.3 }
    assert.equal(formatSubDimensionsForPrompt(dims, 'stranger'), '')
    const text = formatSubDimensionsForPrompt(dims, 'friend')
    assert.ok(/haven['’]t opened up/i.test(text))
  })

  test('surfaces high vulnerability guidance', () => {
    const dims: SubDimensions = { trust: 0.3, vulnerability: 0.7, playfulness: 0.3, intellectual: 0.3 }
    const text = formatSubDimensionsForPrompt(dims, 'friend')
    assert.ok(/vulnerable sides/i.test(text))
  })

  test('surfaces high and low playfulness', () => {
    const highDims: SubDimensions = { trust: 0.3, vulnerability: 0.3, playfulness: 0.8, intellectual: 0.3 }
    const lowDims: SubDimensions = { trust: 0.3, vulnerability: 0.3, playfulness: 0.1, intellectual: 0.3 }
    assert.ok(/playful dynamic/i.test(formatSubDimensionsForPrompt(highDims, 'friend')))
    assert.ok(/more serious/i.test(formatSubDimensionsForPrompt(lowDims, 'friend')))
  })

  test('combines multiple dimensions when multiple thresholds hit', () => {
    const dims: SubDimensions = { trust: 0.8, vulnerability: 0.7, playfulness: 0.3, intellectual: 0.8 }
    const text = formatSubDimensionsForPrompt(dims, 'close_friend')
    assert.ok(/trust you deeply/i.test(text))
    assert.ok(/vulnerable sides/i.test(text))
    assert.ok(/intellectual exchanges/i.test(text))
  })
})

describe('backward compatibility', () => {
  test('formatRelationshipForPrompt tolerates missing subDimensions', () => {
    const state = { ...createDefaultRelationshipState(), score: 40 }
    const text = formatRelationshipForPrompt(state)
    assert.ok(text.length > 0)
    assert.ok(/Relationship stage/.test(text))
  })

  test('formatRelationshipForPrompt appends sub-dimension guidance when present', () => {
    const state = {
      ...createDefaultRelationshipState(),
      score: 40,
      subDimensions: { trust: 0.8, vulnerability: 0.3, playfulness: 0.3, intellectual: 0.3 },
    }
    const text = formatRelationshipForPrompt(state)
    assert.ok(/trust you deeply/i.test(text))
  })

  test('markDailyInteraction blends composite when subDimensions lift score', () => {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const state = {
      ...createDefaultRelationshipState(),
      score: 20,
      lastInteractionDate: yesterday.toISOString().slice(0, 10),
      subDimensions: { trust: 0.9, vulnerability: 0.9, playfulness: 0.9, intellectual: 0.9 },
    }
    const next = markDailyInteraction(state)
    // Composite of all-0.9 = 0.9 * 100 = 90; the daily increment would only
    // yield 20 + 1 = 21. Score should jump to the composite.
    assert.ok(next.score >= 85, `expected composite blend, got ${next.score}`)
  })

  test('markDailyInteraction does not regress when subDimensions are low', () => {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const state = {
      ...createDefaultRelationshipState(),
      score: 40,
      lastInteractionDate: yesterday.toISOString().slice(0, 10),
      subDimensions: createDefaultSubDimensions(),
    }
    const next = markDailyInteraction(state)
    assert.ok(next.score >= 40, `score should not regress below its previous value, got ${next.score}`)
  })
})
