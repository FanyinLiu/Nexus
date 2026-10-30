import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decideTurnEnd,
  normalizeTurnEndLanguage,
  TURN_END_COMPLETE_SILENCE_MS,
  TURN_END_MODEL_CEILING_SILENCE_MS,
  TURN_END_MODEL_COMPLETE_SILENCE_MS,
  TURN_END_TRAILING_SILENCE_MS,
  turnEndMaxSilenceMs,
} from '../src/features/hearing/turnEnd.ts'

type LocaleCase = {
  locale: string
  language: 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
  complete: string
  shortComplete: string
  trailing: string
  neutral: string
}

const CASES: LocaleCase[] = [
  { locale: 'zh-CN', language: 'zh-CN', complete: '今天天气不错。', shortComplete: '好的', trailing: '然后', neutral: '今天天气不错' },
  { locale: 'zh-TW', language: 'zh-TW', complete: '今天天氣不錯。', shortComplete: '好的', trailing: '然後', neutral: '今天天氣不錯' },
  { locale: 'en-US', language: 'en', complete: 'That sounds good.', shortComplete: 'okay', trailing: 'and', neutral: 'I was thinking about tomorrow' },
  { locale: 'ja-JP', language: 'ja', complete: '今日はいい天気ですね。', shortComplete: 'はい', trailing: 'えっと', neutral: '今日はいい天気ですね' },
  { locale: 'ko-KR', language: 'ko', complete: '오늘 날씨가 좋네요.', shortComplete: '네', trailing: '그리고', neutral: '오늘 날씨가 좋네요' },
]

test('complete text ends at about 600 ms and waits just below it', () => {
  for (const item of CASES) {
    const below = decideTurnEnd({
      partialTranscript: item.complete,
      silenceMs: TURN_END_COMPLETE_SILENCE_MS - 1,
      locale: item.locale,
      presetSilenceMs: 900,
    })
    const at = decideTurnEnd({
      partialTranscript: item.complete,
      silenceMs: TURN_END_COMPLETE_SILENCE_MS,
      locale: item.locale,
      presetSilenceMs: 900,
    })

    assert.equal(below.action, 'wait', `${item.language} below complete threshold`)
    assert.equal(below.reason, 'complete', item.language)
    assert.equal(at.action, 'end', `${item.language} at complete threshold`)
    assert.equal(at.thresholdMs, TURN_END_COMPLETE_SILENCE_MS, item.language)
  }
})

test('a short complete clause counts as finished even without punctuation', () => {
  for (const item of CASES) {
    const decision = decideTurnEnd({
      partialTranscript: item.shortComplete,
      silenceMs: TURN_END_COMPLETE_SILENCE_MS,
      locale: item.locale,
      presetSilenceMs: 900,
    })

    assert.equal(decision.action, 'end', item.language)
    assert.equal(decision.reason, 'complete', item.language)
  }
})

test('trailing connectors and fillers extend the wait to about 1600 ms', () => {
  for (const item of CASES) {
    const early = decideTurnEnd({
      partialTranscript: `${item.neutral}，${item.trailing}`,
      silenceMs: 900,
      locale: item.locale,
      presetSilenceMs: 900,
    })
    const at = decideTurnEnd({
      partialTranscript: `${item.neutral}，${item.trailing}`,
      silenceMs: TURN_END_TRAILING_SILENCE_MS,
      locale: item.locale,
      presetSilenceMs: 900,
    })

    assert.equal(early.action, 'wait', `${item.language} must not cut a trailing connector early`)
    assert.equal(early.reason, 'trailing', item.language)
    assert.equal(at.action, 'end', item.language)
    assert.equal(at.thresholdMs, TURN_END_TRAILING_SILENCE_MS, item.language)
  }
})

test('ordinary text keeps the provider preset', () => {
  for (const item of CASES) {
    const before = decideTurnEnd({
      partialTranscript: item.neutral,
      silenceMs: 899,
      locale: item.locale,
      presetSilenceMs: 900,
    })
    const at = decideTurnEnd({
      partialTranscript: item.neutral,
      silenceMs: 900,
      locale: item.locale,
      presetSilenceMs: 900,
    })

    assert.equal(before.action, 'wait', item.language)
    assert.equal(before.reason, 'default', item.language)
    assert.equal(at.action, 'end', item.language)
    assert.equal(at.thresholdMs, 900, item.language)
  }
})

test('empty partial text always waits for the preset, never the 600 ms shortcut', () => {
  const decision = decideTurnEnd({
    partialTranscript: '   ',
    silenceMs: 700,
    locale: 'zh-CN',
    presetSilenceMs: 1_100,
  })

  assert.equal(decision.action, 'wait')
  assert.equal(decision.reason, 'empty')
  assert.equal(decision.thresholdMs, 1_100)
})

test('the preset is a ceiling for complete text but can be widened for trailing text', () => {
  const complete = decideTurnEnd({
    partialTranscript: '好。',
    silenceMs: 420,
    locale: 'zh-CN',
    presetSilenceMs: 420,
  })
  assert.equal(complete.thresholdMs, 420)
  assert.equal(complete.action, 'end')

  const trailing = decideTurnEnd({
    partialTranscript: '我觉得，但是',
    silenceMs: 1_750,
    locale: 'zh-CN',
    presetSilenceMs: 1_800,
  })
  assert.equal(trailing.thresholdMs, 1_800)
  assert.equal(trailing.action, 'wait')
})

test('turnEndMaxSilenceMs gives the detector room for the widest window', () => {
  // 1.8 s covers both the trailing-connector wait and the model's
  // not-finished ceiling, so the VAD never cuts the turn first.
  assert.equal(turnEndMaxSilenceMs(420), TURN_END_MODEL_CEILING_SILENCE_MS)
  assert.equal(turnEndMaxSilenceMs(720), TURN_END_MODEL_CEILING_SILENCE_MS)
  assert.equal(turnEndMaxSilenceMs(1_800), 1_800)
  assert.equal(turnEndMaxSilenceMs(Number.NaN), TURN_END_MODEL_CEILING_SILENCE_MS)
})

test('locale tags normalize to the five maintained rule sets', () => {
  assert.equal(normalizeTurnEndLanguage('zh-TW'), 'zh-TW')
  assert.equal(normalizeTurnEndLanguage('zh-Hant-HK'), 'zh-TW')
  assert.equal(normalizeTurnEndLanguage('zh-CN'), 'zh-CN')
  assert.equal(normalizeTurnEndLanguage('ja-JP'), 'ja')
  assert.equal(normalizeTurnEndLanguage('ko-KR'), 'ko')
  assert.equal(normalizeTurnEndLanguage('en-US'), 'en')
  assert.equal(normalizeTurnEndLanguage('fr-FR'), 'en')
})

test('a confident model complete ends at about 300 ms even without text', () => {
  const below = decideTurnEnd({
    partialTranscript: '',
    silenceMs: TURN_END_MODEL_COMPLETE_SILENCE_MS - 1,
    locale: 'zh-CN',
    presetSilenceMs: 1_800,
    modelProbability: 0.91,
  })
  const at = decideTurnEnd({
    partialTranscript: '',
    silenceMs: TURN_END_MODEL_COMPLETE_SILENCE_MS,
    locale: 'zh-CN',
    presetSilenceMs: 1_800,
    modelProbability: 0.91,
  })

  assert.equal(below.action, 'wait')
  assert.equal(below.reason, 'model_complete')
  assert.equal(below.thresholdMs, TURN_END_MODEL_COMPLETE_SILENCE_MS)
  assert.equal(at.action, 'end')
  assert.equal(at.thresholdMs, TURN_END_MODEL_COMPLETE_SILENCE_MS)
})

test('the model complete shortcut beats the 600 ms text shortcut', () => {
  const decision = decideTurnEnd({
    partialTranscript: '今天天气不错。',
    silenceMs: 350,
    locale: 'zh-CN',
    presetSilenceMs: 900,
    modelProbability: 0.8,
  })

  assert.equal(decision.action, 'end')
  assert.equal(decision.reason, 'model_complete')
  assert.equal(decision.thresholdMs, TURN_END_MODEL_COMPLETE_SILENCE_MS)
})

test('only a trailing connector may lengthen a confident model complete', () => {
  for (const [locale, trailing] of [
    ['zh-CN', '然后'],
    ['zh-TW', '然後'],
    ['en-US', 'and'],
    ['ja-JP', 'えっと'],
    ['ko-KR', '그리고'],
  ] as const) {
    const decision = decideTurnEnd({
      partialTranscript: `我先想一下，${trailing}`,
      silenceMs: 400,
      locale,
      presetSilenceMs: 900,
      modelProbability: 0.9,
    })

    assert.equal(decision.action, 'wait', locale)
    assert.equal(decision.reason, 'trailing', locale)
    assert.equal(decision.thresholdMs, TURN_END_TRAILING_SILENCE_MS, locale)
  }
})

test('a model not-finished keeps waiting to the ceiling and ignores text shortcuts', () => {
  const early = decideTurnEnd({
    partialTranscript: '今天天气不错。',
    silenceMs: TURN_END_COMPLETE_SILENCE_MS,
    locale: 'zh-CN',
    presetSilenceMs: 900,
    modelProbability: 0.12,
  })
  const at = decideTurnEnd({
    partialTranscript: '今天天气不错。',
    silenceMs: TURN_END_MODEL_CEILING_SILENCE_MS,
    locale: 'zh-CN',
    presetSilenceMs: 900,
    modelProbability: 0.12,
  })

  assert.equal(early.action, 'wait')
  assert.equal(early.reason, 'model_incomplete')
  assert.equal(early.thresholdMs, TURN_END_MODEL_CEILING_SILENCE_MS)
  assert.equal(at.action, 'end')
  assert.equal(at.thresholdMs, TURN_END_MODEL_CEILING_SILENCE_MS)
})

test('an exact 0.5 is complete; invalid probabilities fall back to the text rules', () => {
  const exact = decideTurnEnd({
    partialTranscript: '',
    silenceMs: 300,
    locale: 'zh-CN',
    presetSilenceMs: 1_800,
    modelProbability: 0.5,
  })
  assert.equal(exact.reason, 'model_complete')
  assert.equal(exact.action, 'end')

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
    const fallback = decideTurnEnd({
      partialTranscript: '好的',
      silenceMs: 650,
      locale: 'zh-CN',
      presetSilenceMs: 900,
      modelProbability: value,
    })
    assert.equal(fallback.reason, 'complete', String(value))
    assert.equal(fallback.thresholdMs, TURN_END_COMPLETE_SILENCE_MS, String(value))
  }
})

test('the provider preset still bounds the model thresholds', () => {
  const fast = decideTurnEnd({
    partialTranscript: '',
    silenceMs: 250,
    locale: 'zh-CN',
    presetSilenceMs: 250,
    modelProbability: 0.9,
  })
  assert.equal(fast.thresholdMs, 250)
  assert.equal(fast.action, 'end')

  const slow = decideTurnEnd({
    partialTranscript: '',
    silenceMs: 1_900,
    locale: 'zh-CN',
    presetSilenceMs: 2_000,
    modelProbability: 0.1,
  })
  assert.equal(slow.thresholdMs, 2_000)
  assert.equal(slow.action, 'wait')
})
