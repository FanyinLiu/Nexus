import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildBracketNotification,
  getBracketTemplates,
  pickFromPool,
  pickGoDeeperFollowup,
  pickMorningPrompt,
} from '../src/features/proactive/bracketCopy.ts'
import type { UiLanguage } from '../src/types/app.ts'

const LOCALES: UiLanguage[] = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']

test('every locale has 12 morning open questions and 8 go-deeper followups', () => {
  for (const locale of LOCALES) {
    const t = getBracketTemplates(locale)
    assert.equal(t.morningOpenQuestions.length, 12, `${locale} morning count`)
    assert.equal(t.eveningGoDeeperPool.length, 8, `${locale} go-deeper count`)
    assert.equal(t.eveningHighlightPool.length, 4, `${locale} highlight count`)
    assert.equal(t.eveningStressfulPool.length, 4, `${locale} stressful count`)
    assert.ok(t.morningCallback.includes('{topic}'), `${locale} callback has placeholder`)
  }
})

test('pickMorningPrompt uses callback when topic is given', () => {
  const out = pickMorningPrompt({
    uiLanguage: 'en-US',
    previousEveningTopic: 'the deadline that was stressing you',
  })
  assert.match(out.value, /the deadline that was stressing you/)
  assert.doesNotMatch(out.value, /\{topic\}/)
  assert.equal(out.isCallback, true)
  assert.equal(out.idx, -1)
})

test('pickMorningPrompt falls back to open question when topic is null', () => {
  const out = pickMorningPrompt({
    uiLanguage: 'en-US',
    previousEveningTopic: null,
    randomFn: () => 0,
  })
  assert.equal(out.value, 'What’s the first thing you noticed this morning?')
  assert.equal(out.isCallback, false)
  assert.equal(out.idx, 0)
})

test('pickMorningPrompt treats whitespace topic as empty', () => {
  const out = pickMorningPrompt({
    uiLanguage: 'en-US',
    previousEveningTopic: '   ',
    randomFn: () => 0,
  })
  assert.doesNotMatch(out.value, /\{topic\}/)
  assert.equal(out.value, 'What’s the first thing you noticed this morning?')
})

test('pickGoDeeperFollowup is deterministic with seeded RNG', () => {
  const out = pickGoDeeperFollowup('en-US', () => 0)
  assert.equal(out.value, 'What was your first reaction in the moment?')
  assert.equal(out.idx, 0)
})

test('pickMorningPrompt RNG=0.99 stays in bounds', () => {
  const out = pickMorningPrompt({
    uiLanguage: 'zh-CN',
    previousEveningTopic: null,
    randomFn: () => 0.99,
  })
  assert.ok(out.value.length > 0)
  assert.ok(!out.value.includes('{topic}'))
})

test('every locale has notification titles + evening joiner', () => {
  for (const locale of LOCALES) {
    const t = getBracketTemplates(locale)
    assert.ok(t.morningNotificationTitle.includes('{companionName}'), `${locale} morning title placeholder`)
    assert.ok(t.eveningNotificationTitle.includes('{companionName}'), `${locale} evening title placeholder`)
    assert.ok(t.eveningJoiner.length > 0, `${locale} joiner non-empty`)
  }
})

test('buildBracketNotification renders morning with companion name', () => {
  const out = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: '星绘',
    bracket: 'morning',
    previousEveningTopic: null,
    randomFn: () => 0,
  })
  assert.match(out.title, /星绘/)
  assert.equal(out.body, 'What’s the first thing you noticed this morning?')
  assert.equal(out.pickedIndices.morning, 0)
})

test('buildBracketNotification morning uses callback when topic given', () => {
  const out = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'morning',
    previousEveningTopic: 'the work deadline',
    randomFn: () => 0,
  })
  assert.match(out.body, /the work deadline/)
})

test('buildBracketNotification evening joins highlight + stressful', () => {
  const out = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: 'X',
    bracket: 'evening',
    randomFn: () => 0,
  })
  assert.match(out.body, /highlight/i)
  assert.match(out.body, /stressful/i)
  assert.equal(out.pickedIndices.highlight, 0)
  assert.equal(out.pickedIndices.stressful, 0)
})

test('buildBracketNotification falls back to "Nexus" when companionName empty', () => {
  const out = buildBracketNotification({
    uiLanguage: 'en-US',
    companionName: '   ',
    bracket: 'morning',
    previousEveningTopic: null,
    randomFn: () => 0,
  })
  assert.match(out.title, /Nexus/)
})

// ── Dedup tests ─────────────────────────────────────────────────────────────

test('pickFromPool avoids the last-used index', () => {
  const pool = ['a', 'b', 'c', 'd']
  const picks = new Set<string>()
  for (let i = 0; i < 100; i++) {
    const pick = pickFromPool(pool, 0, Math.random)
    picks.add(pick.value)
    assert.notEqual(pick.idx, 0, 'should never pick avoided index')
  }
  assert.ok(picks.size >= 2, 'should pick from remaining items')
  assert.ok(!picks.has('a'), 'should never pick the avoided item')
})

test('pickFromPool handles null/undefined avoidIdx as no constraint', () => {
  const pool = ['a', 'b']
  const pick1 = pickFromPool(pool, null, () => 0)
  assert.equal(pick1.value, 'a')
  const pick2 = pickFromPool(pool, undefined, () => 0)
  assert.equal(pick2.value, 'a')
})

test('pickFromPool handles single-item pool', () => {
  const pick = pickFromPool(['only'], 0, Math.random)
  assert.equal(pick.value, 'only')
  assert.equal(pick.idx, 0)
})

test('buildBracketNotification morning dedup avoids last pick', () => {
  const results = new Set<number>()
  for (let i = 0; i < 200; i++) {
    const out = buildBracketNotification({
      uiLanguage: 'en-US',
      companionName: 'X',
      bracket: 'morning',
      previousEveningTopic: null,
      lastPicks: { morning: 0 },
    })
    results.add(out.pickedIndices.morning!)
  }
  assert.ok(!results.has(0), 'should never repeat last morning pick')
})

test('buildBracketNotification evening dedup avoids last picks', () => {
  const highlights = new Set<number>()
  const stressfuls = new Set<number>()
  for (let i = 0; i < 200; i++) {
    const out = buildBracketNotification({
      uiLanguage: 'en-US',
      companionName: 'X',
      bracket: 'evening',
      lastPicks: { highlight: 1, stressful: 2 },
    })
    highlights.add(out.pickedIndices.highlight!)
    stressfuls.add(out.pickedIndices.stressful!)
  }
  assert.ok(!highlights.has(1), 'should never repeat last highlight')
  assert.ok(!stressfuls.has(2), 'should never repeat last stressful')
})
