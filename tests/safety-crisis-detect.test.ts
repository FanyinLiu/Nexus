// Behaviour tests for src/features/safety/crisisDetect.ts.
//
// Two thrusts:
//   - Positive cases per locale: known crisis utterances must produce
//     a signal at the expected severity.
//   - Negative cases per locale: figurative idioms ("X 死了", "killing
//     it", "死ぬほど〜") must not produce a signal.
//
// When tuning patterns, run this suite first — every commit that
// touches crisisDetect.ts should pass it. Adding a regression case
// here is preferred over re-thinking the regex from scratch.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectCrisisSignal } from '../src/features/safety/crisisDetect.ts'
import type { CrisisSeverity } from '../src/features/safety/types.ts'
import type { AppLocale } from '../src/types/i18n.ts'

interface PositiveCase { text: string; expected: CrisisSeverity }
interface NegativeCase { text: string }

const POSITIVE: Record<AppLocale, PositiveCase[]> = {
  'en-US': [
    { text: 'I want to kill myself', expected: 'high' },
    { text: "I'm going to end my life tonight", expected: 'high' },
    { text: "I'm gonna take my own life", expected: 'high' },
    { text: 'I want to die', expected: 'medium' },
    { text: "I don't want to live anymore", expected: 'medium' },
    { text: "I don't want to wake up", expected: 'medium' },
    { text: 'There is no point in continuing', expected: 'medium' },
    { text: "I can't go on", expected: 'low' },
    { text: "I can't keep going anymore", expected: 'low' },
    { text: "they'd be better off without me", expected: 'low' },
  ],
  'zh-CN': [
    { text: '我现在就要自杀', expected: 'high' },
    { text: '我今晚就去自杀', expected: 'high' },
    { text: '我想把自己杀了', expected: 'high' },
    { text: '我想死', expected: 'medium' },
    { text: '我真的好想死', expected: 'medium' },
    { text: '我不想活了', expected: 'medium' },
    { text: '我再也不想活', expected: 'medium' },
    { text: '我想自杀', expected: 'medium' },
    { text: '活着没有意义', expected: 'medium' },
    { text: '我撑不住了', expected: 'low' },
    { text: '我熬不下去了', expected: 'low' },
  ],
  'zh-TW': [
    { text: '我現在就要自殺', expected: 'high' },
    { text: '我想死', expected: 'medium' },
    { text: '我不想活了', expected: 'medium' },
    { text: '我想自殺', expected: 'medium' },
    { text: '活著沒有意義', expected: 'medium' },
    { text: '我撐不下去了', expected: 'low' },
  ],
  'ja': [
    { text: '今すぐ死にたい', expected: 'high' },
    { text: '自殺したい', expected: 'high' },
    { text: '死にたい', expected: 'medium' },
    { text: '消えたい', expected: 'medium' },
    { text: 'もう生きていけない', expected: 'medium' },
    { text: '生きる意味がない', expected: 'medium' },
    { text: 'もう限界です', expected: 'low' },
    { text: 'いない方がいい', expected: 'low' },
  ],
  'ko': [
    { text: '오늘 죽을 거야', expected: 'high' },
    { text: '자살하고 싶어', expected: 'high' },
    { text: '죽고 싶다', expected: 'medium' },
    { text: '살기 싫다', expected: 'medium' },
    { text: '사라지고 싶어', expected: 'medium' },
    { text: '살 이유가 없어', expected: 'medium' },
    { text: '내가 없어야 더 나아', expected: 'low' },
  ],
}

// Idioms / figurative usage / unrelated talk that must NOT trigger.
const NEGATIVE: Record<AppLocale, NegativeCase[]> = {
  'en-US': [
    { text: "I'm killing it on the test" },
    { text: "I'm dying laughing" },
    { text: "I'm dying for a coffee" },
    { text: 'let me kill the bug in this test' },
    { text: 'kill two birds with one stone' },
    { text: 'I had a great day at work' },
    { text: 'the build is failing' },
  ],
  'zh-CN': [
    { text: '笑死了' },
    { text: '累死我了' },
    { text: '热死了，开空调吧' },
    { text: '气死了，他怎么这样' },
    { text: '困死我了' },
    { text: '今天天气真好' },
    { text: '我去上班了' },
  ],
  'zh-TW': [
    { text: '笑死' },
    { text: '熱死了' },
    { text: '累死了' },
    { text: '今天好開心' },
  ],
  'ja': [
    { text: '死ぬほど疲れた' },
    { text: '死ぬほど美味しい' },
    { text: '笑い死にしそう' },
    { text: '今日は楽しかった' },
  ],
  'ko': [
    { text: '웃겨 죽겠어' },
    { text: '죽도록 일했어' },
    { text: '오늘 날씨 좋다' },
  ],
}

const ALL_LOCALES: AppLocale[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']

for (const locale of ALL_LOCALES) {
  test(`detectCrisisSignal[${locale}]: positive cases produce expected severity`, () => {
    for (const c of POSITIVE[locale]) {
      const signal = detectCrisisSignal(c.text, locale)
      assert.ok(signal, `expected signal for "${c.text}" but got null`)
      assert.equal(signal.severity, c.expected,
        `severity mismatch for "${c.text}": got ${signal.severity}, expected ${c.expected}`)
      assert.equal(signal.locale, locale)
      assert.ok(signal.matchedPhrase.length > 0, 'matchedPhrase must be non-empty')
    }
  })

  test(`detectCrisisSignal[${locale}]: negative cases do not trigger`, () => {
    for (const c of NEGATIVE[locale]) {
      const signal = detectCrisisSignal(c.text, locale)
      assert.equal(signal, null, `unexpected signal for "${c.text}": ${JSON.stringify(signal)}`)
    }
  })
}

test('detectCrisisSignal: empty input returns null', () => {
  for (const locale of ALL_LOCALES) {
    assert.equal(detectCrisisSignal('', locale), null)
  }
})

test('detectCrisisSignal: figurative idiom suppresses adjacent positive', () => {
  // The same window shouldn't trigger when a figurative marker is
  // close to a positive token.
  assert.equal(detectCrisisSignal('我笑死了', 'zh-CN'), null)
  assert.equal(detectCrisisSignal("I'm killing it today!", 'en-US'), null)
})

test('detectCrisisSignal: positive wins when figurative is far away', () => {
  // Two paragraphs apart: the negative window doesn't reach the
  // positive match, so the signal stands.
  const text = "今天工作累死了。但是说真的，我想死。这种感觉持续好几天了。"
  const signal = detectCrisisSignal(text, 'zh-CN')
  assert.ok(signal, 'expected signal in long mixed text')
  assert.equal(signal.severity, 'medium')
})

test('detectCrisisSignal: returns highest-priority match when multiple apply', () => {
  // "I want to kill myself, I want to die" — the high-severity
  // pattern is listed first in the positive list and should win.
  const signal = detectCrisisSignal('I want to kill myself, I want to die', 'en-US')
  assert.ok(signal)
  assert.equal(signal.severity, 'high')
})
