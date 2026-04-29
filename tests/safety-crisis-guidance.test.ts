// Snapshot-style tests for buildCrisisGuidance — checks the prompt
// fragment carries the safety-critical instructions and that null
// signals produce an empty string (so the prompt-builder's
// filter(Boolean) drops the section cleanly).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCrisisGuidance } from '../src/features/safety/crisisGuidance.ts'
import type { CrisisSignal } from '../src/features/safety/types.ts'

const SAMPLE_HIGH: CrisisSignal = {
  severity: 'high',
  matchedPhrase: 'I want to kill myself',
  locale: 'en-US',
}
const SAMPLE_MEDIUM: CrisisSignal = {
  severity: 'medium',
  matchedPhrase: '我想死',
  locale: 'zh-CN',
}
const SAMPLE_LOW: CrisisSignal = {
  severity: 'low',
  matchedPhrase: "I can't go on",
  locale: 'en-US',
}

test('buildCrisisGuidance: null signal returns empty string', () => {
  assert.equal(
    buildCrisisGuidance({ signal: null, uiLanguage: 'en-US' }),
    '',
  )
})

test('buildCrisisGuidance: produces non-empty text on signal', () => {
  for (const sig of [SAMPLE_HIGH, SAMPLE_MEDIUM, SAMPLE_LOW]) {
    const text = buildCrisisGuidance({ signal: sig, uiLanguage: sig.locale })
    assert.ok(text.length > 200, `expected substantial text for ${sig.severity}`)
  }
})

test('buildCrisisGuidance: includes the safety-critical "do NOT" bullets', () => {
  const text = buildCrisisGuidance({ signal: SAMPLE_HIGH, uiLanguage: 'en-US' })
  // Each of these lines is a regulatory / clinical-safety must-have.
  // Removing one is a behaviour change that needs review.
  for (const must of [
    'Do NOT minimise',
    'Do NOT joke',
    'Do NOT discuss methods',
    'Do NOT give medical advice',
    'Stay in character',
    '2 to 3 sentences',
  ]) {
    assert.ok(
      text.includes(must),
      `crisis guidance missing required directive: "${must}"`,
    )
  }
})

test('buildCrisisGuidance: tags the severity into the prompt', () => {
  const high = buildCrisisGuidance({ signal: SAMPLE_HIGH, uiLanguage: 'en-US' })
  const medium = buildCrisisGuidance({ signal: SAMPLE_MEDIUM, uiLanguage: 'zh-CN' })
  const low = buildCrisisGuidance({ signal: SAMPLE_LOW, uiLanguage: 'en-US' })
  assert.ok(high.includes('high'), 'high-severity label missing')
  assert.ok(medium.includes('medium'), 'medium-severity label missing')
  assert.ok(low.includes('low'), 'low-severity label missing')
})
