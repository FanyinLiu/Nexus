import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCrisisSecondPassPrompt,
  classifyCrisisSecondPass,
  clearResolvedCrisisSignalCache,
  getRememberedCrisisSignal,
  mergeCrisisSecondPassDecision,
  parseCrisisSecondPassResponse,
} from '../src/features/safety/crisisSecondPass.ts'
import type { CrisisSignal } from '../src/features/safety/types.ts'

const PATTERN_LOW: CrisisSignal = {
  severity: 'low',
  matchedPhrase: "I can't go on",
  locale: 'en-US',
}

const PATTERN_MEDIUM: CrisisSignal = {
  severity: 'medium',
  matchedPhrase: '我想死',
  locale: 'zh-CN',
}

test('parseCrisisSecondPassResponse accepts strict JSON and trims reason', () => {
  const decision = parseCrisisSecondPassResponse(
    '{"crisis":true,"severity":"medium","reason":"clear ideation"}',
  )
  assert.deepEqual(decision, {
    crisis: true,
    severity: 'medium',
    reason: 'clear ideation',
  })
})

test('parseCrisisSecondPassResponse extracts JSON from noisy model text', () => {
  const decision = parseCrisisSecondPassResponse(
    'Sure.\n{"crisis":false,"severity":"low","reason":"quoted phrase"}\nDone.',
  )
  assert.deepEqual(decision, {
    crisis: false,
    severity: 'low',
    reason: 'quoted phrase',
  })
})

test('parseCrisisSecondPassResponse rejects malformed decisions', () => {
  assert.equal(parseCrisisSecondPassResponse(''), null)
  assert.equal(parseCrisisSecondPassResponse('{"crisis":"yes","severity":"high"}'), null)
  assert.equal(parseCrisisSecondPassResponse('{"crisis":true,"severity":"urgent"}'), null)
})

test('mergeCrisisSecondPassDecision can suppress a false positive', () => {
  assert.equal(
    mergeCrisisSecondPassDecision(PATTERN_LOW, {
      crisis: false,
      severity: 'low',
      reason: 'figurative',
    }),
    null,
  )
})

test('mergeCrisisSecondPassDecision never downgrades the rule severity', () => {
  const signal = mergeCrisisSecondPassDecision(PATTERN_MEDIUM, {
    crisis: true,
    severity: 'low',
    reason: 'ambiguous',
  })
  assert.ok(signal)
  assert.equal(signal.severity, 'medium')
  assert.equal(signal.source, 'llm')
})

test('mergeCrisisSecondPassDecision can upgrade rule severity', () => {
  const signal = mergeCrisisSecondPassDecision(PATTERN_LOW, {
    crisis: true,
    severity: 'high',
    reason: 'imminent intent',
  })
  assert.ok(signal)
  assert.equal(signal.severity, 'high')
  assert.equal(signal.classificationReason, 'imminent intent')
})

test('classifyCrisisSecondPass caches LLM result for the reply prompt path', async () => {
  clearResolvedCrisisSignalCache()
  const text = "I can't go on tonight"
  const signal = await classifyCrisisSecondPass({
    locale: 'en-US',
    text,
    patternSignal: PATTERN_LOW,
    runner: async () => '{"crisis":true,"severity":"medium","reason":"ongoing distress"}',
  })
  assert.ok(signal)
  assert.equal(signal.severity, 'medium')
  assert.equal(getRememberedCrisisSignal(text, 'en-US'), signal)
})

test('classifyCrisisSecondPass caches null when LLM suppresses a candidate', async () => {
  clearResolvedCrisisSignalCache()
  const text = 'The character said I want to die in the movie.'
  const signal = await classifyCrisisSecondPass({
    locale: 'en-US',
    text,
    patternSignal: PATTERN_MEDIUM,
    runner: async () => '{"crisis":false,"severity":"low","reason":"fictional reference"}',
  })
  assert.equal(signal, null)
  assert.equal(getRememberedCrisisSignal(text, 'en-US'), null)
})

test('classifyCrisisSecondPass falls back to pattern signal when runner fails', async () => {
  clearResolvedCrisisSignalCache()
  const signal = await classifyCrisisSecondPass({
    locale: 'zh-CN',
    text: '我想死',
    patternSignal: PATTERN_MEDIUM,
    runner: async () => { throw new Error('offline') },
  })
  assert.ok(signal)
  assert.equal(signal.severity, 'medium')
  assert.equal(signal.source, 'pattern')
})

test('buildCrisisSecondPassPrompt requests strict JSON and includes candidate evidence', () => {
  const prompt = buildCrisisSecondPassPrompt({
    locale: 'zh-CN',
    text: '我想死',
    patternSignal: PATTERN_MEDIUM,
  })
  assert.match(prompt.system, /strict JSON/)
  assert.match(prompt.user, /Pattern severity: medium/)
  assert.match(prompt.user, /我想死/)
})
