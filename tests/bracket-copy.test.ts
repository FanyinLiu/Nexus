import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getBracketTemplates,
  pickGoDeeperFollowup,
  pickMorningPrompt,
} from '../src/features/proactive/bracketCopy.ts'
import type { UiLanguage } from '../src/types/app.ts'

const LOCALES: UiLanguage[] = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']

test('every locale has 5 morning open questions and 4 go-deeper followups', () => {
  for (const locale of LOCALES) {
    const t = getBracketTemplates(locale)
    assert.equal(t.morningOpenQuestions.length, 5, `${locale} morning count`)
    assert.equal(t.eveningGoDeeperPool.length, 4, `${locale} go-deeper count`)
    assert.ok(t.eveningHighlight.length > 0)
    assert.ok(t.eveningStressful.length > 0)
    assert.ok(t.morningCallback.includes('{topic}'), `${locale} callback has placeholder`)
  }
})

test('pickMorningPrompt uses callback when topic is given', () => {
  const out = pickMorningPrompt({
    uiLanguage: 'en-US',
    previousEveningTopic: 'the deadline that was stressing you',
  })
  assert.match(out, /the deadline that was stressing you/)
  assert.doesNotMatch(out, /\{topic\}/)
})

test('pickMorningPrompt falls back to open question when topic is null', () => {
  const out = pickMorningPrompt({
    uiLanguage: 'en-US',
    previousEveningTopic: null,
    randomFn: () => 0,
  })
  assert.equal(out, 'What’s the first thing you noticed this morning?')
})

test('pickMorningPrompt treats whitespace topic as empty', () => {
  const out = pickMorningPrompt({
    uiLanguage: 'en-US',
    previousEveningTopic: '   ',
    randomFn: () => 0,
  })
  assert.doesNotMatch(out, /\{topic\}/)
  assert.equal(out, 'What’s the first thing you noticed this morning?')
})

test('pickGoDeeperFollowup is deterministic with seeded RNG', () => {
  const out = pickGoDeeperFollowup('en-US', () => 0)
  assert.equal(out, 'What was your first reaction in the moment?')
})

test('pickMorningPrompt RNG=0.99 stays in bounds', () => {
  const out = pickMorningPrompt({
    uiLanguage: 'zh-CN',
    previousEveningTopic: null,
    randomFn: () => 0.99,
  })
  assert.ok(out.length > 0)
  assert.ok(!out.includes('{topic}'))
})
