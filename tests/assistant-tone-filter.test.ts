import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  ASSISTANT_TONE_OVERLONG_CHARS,
  analyzeAssistantTone,
  applyAssistantToneFilter,
  flattenMarkdownForChat,
  getLastAssistantToneFeedback,
  recordAssistantToneReport,
  resetAssistantToneSignal,
  speechLength,
} from '../src/features/persona/assistantToneFilter.ts'
import { buildPersonaReminder } from '../src/features/persona/personaReminder.ts'
import type { LoadedPersona } from '../src/features/autonomy/v2/personaTypes.ts'
import type { UiLanguage } from '../src/types'

const LOCALES: UiLanguage[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']

const ASSISTANT_SAMPLES: Record<UiLanguage, string> = {
  'zh-CN': '作为一个 AI，当然可以！总之，希望对你有帮助。',
  'zh-TW': '作為一個 AI，當然可以！總之，希望對你有幫助。',
  'en-US': 'As an AI, of course! In conclusion, I hope this helps.',
  ja: 'AIとして、もちろんです！要するに、お役に立てれば。',
  ko: 'AI로서 물론이죠! 결론적으로 도움이 되셨길 바랍니다.',
}

const CLEAN_SAMPLES: Record<UiLanguage, string> = {
  'zh-CN': '嗯，知道了。',
  'zh-TW': '嗯，知道了。',
  'en-US': 'mm. okay.',
  ja: 'うん、わかった。',
  ko: '응, 알았어.',
}

function makePersona(overrides: Partial<LoadedPersona> = {}): LoadedPersona {
  return {
    id: 'aster',
    rootDir: '/personas/aster',
    soul: '',
    memory: '',
    examplesRaw: '',
    examples: [],
    style: {},
    voice: {},
    tools: {},
    present: true,
    ...overrides,
  }
}

beforeEach(() => {
  resetAssistantToneSignal()
})

test('every locale catches its own assistant-tone phrases and ignores clean chat', () => {
  for (const uiLanguage of LOCALES) {
    const dirty = analyzeAssistantTone(ASSISTANT_SAMPLES[uiLanguage], { uiLanguage })
    assert.ok(dirty.hitCount > 0, `${uiLanguage} sample produced no hits`)
    assert.ok(dirty.densityPer1k > 0, `${uiLanguage} sample produced no density`)

    const clean = analyzeAssistantTone(CLEAN_SAMPLES[uiLanguage], { uiLanguage })
    assert.equal(clean.hitCount, 0, `${uiLanguage} clean sample was flagged: ${JSON.stringify(clean.hits)}`)
    assert.equal(clean.worthReporting, false)
  }
})

test('the reviewed structure list is detected, but parallelism and dashes are not', () => {
  const structures = [
    '总之，先这样。',
    '综上所述，问题不大。',
    '值得一提的是，她来过。',
    '总的来说，还行。',
    '由此可见，他懂了。',
    '这件事具有重要的意义。',
  ]
  for (const text of structures) {
    const report = analyzeAssistantTone(text, { uiLanguage: 'zh-CN' })
    assert.ok(report.hitCount > 0, `missed: ${text}`)
  }

  const firstOnly = analyzeAssistantTone('首先，先休息。', { uiLanguage: 'zh-CN' })
  assert.equal(firstOnly.hitCount, 0, '首先 alone is not a paired structure')
  const paired = analyzeAssistantTone('首先休息，其次喝水。', { uiLanguage: 'zh-CN' })
  assert.ok(paired.hits.some((hit) => hit.label === '首先…其次'))

  const parallelAndDash = analyzeAssistantTone(
    '不是累了，是不想说话——很累，也很烦。',
    { uiLanguage: 'zh-CN' },
  )
  assert.equal(parallelAndDash.hitCount, 0, 'parallelism and dashes are not assistant-tone evidence')
})

test('a closing elevation is caught without flagging an ordinary short line', () => {
  const elevated = analyzeAssistantTone('嗯。这就是陪伴的意义。', { uiLanguage: 'zh-CN' })
  assert.ok(elevated.hits.some((hit) => hit.category === 'elevation'))

  const ordinary = analyzeAssistantTone('嗯，陪你一会儿。', { uiLanguage: 'zh-CN' })
  assert.equal(ordinary.hitCount, 0)
})

test('persona style bans are detected instead of prompted', () => {
  const report = analyzeAssistantTone('喵，好啦。', {
    uiLanguage: 'zh-CN',
    personaForbiddenPhrases: ['喵'],
  })
  assert.ok(report.hits.some((hit) => hit.category === 'persona' && hit.label === '喵'))

  // A ban that duplicates the built-in lexicon is counted once.
  const deduped = analyzeAssistantTone('当然可以！', {
    uiLanguage: 'zh-CN',
    personaForbiddenPhrases: ['当然可以'],
  })
  assert.equal(deduped.hits.filter((hit) => hit.label.includes('当然可以')).length, 1)
})

test('density is reported per thousand characters, not as a raw count', () => {
  const text = `${'总之'.repeat(5)}${'嗯'.repeat(95)}`
  const report = analyzeAssistantTone(text, { uiLanguage: 'zh-CN' })
  assert.equal(report.hitCount, 5)
  assert.equal(report.chars, 105)
  assert.ok(Math.abs(report.densityPer1k - (5 / 105) * 1000) < 1e-9)
})

test('density uses only the reviewed AI-tone list, not every assistant phrase', () => {
  const report = analyzeAssistantTone('作为 AI，当然可以！', { uiLanguage: 'zh-CN' })
  assert.ok(report.hitCount > 0)
  assert.equal(report.aiToneHitCount, 0)
  assert.equal(report.densityPer1k, 0)
})

test('over-long is measured in Chinese-character units and never truncates', () => {
  const short = analyzeAssistantTone('嗯，知道了。', { uiLanguage: 'zh-CN' })
  assert.equal(short.overLong, false)

  const longChinese = '嗯'.repeat(ASSISTANT_TONE_OVERLONG_CHARS + 10)
  const long = analyzeAssistantTone(longChinese, { uiLanguage: 'zh-CN' })
  assert.equal(long.overLong, true)

  const englishText = 'word '.repeat(120)
  const english = analyzeAssistantTone(englishText, { uiLanguage: 'en-US' })
  assert.equal(english.overLong, true)
  assert.ok(speechLength(englishText) >= ASSISTANT_TONE_OVERLONG_CHARS)
})

test('markdown flattening removes headings, bullets and bold but keeps code fences', () => {
  const input = [
    '## 建议',
    '',
    '1. **先休息**',
    '2. 喝点水',
    '',
    '就这样。',
  ].join('\n')
  const output = flattenMarkdownForChat(input, 'zh-CN')

  assert.doesNotMatch(output, /#/)
  assert.doesNotMatch(output, /\*\*/)
  assert.doesNotMatch(output, /^\s*\d+[.)]\s/m)
  assert.match(output, /建议。/)
  assert.match(output, /先休息，喝点水。/)
  assert.match(output, /就这样。/)

  const withCode = [
    '看这个：',
    '```ts',
    '- not a list',
    '# not a heading',
    '**not bold**',
    '```',
    '- 真的列表',
  ].join('\n')
  const codeOutput = flattenMarkdownForChat(withCode, 'zh-CN')
  assert.ok(codeOutput.includes('- not a list'), 'list-looking code stays intact')
  assert.ok(codeOutput.includes('# not a heading'), 'heading-looking code stays intact')
  assert.ok(codeOutput.includes('**not bold**'), 'bold-looking code stays intact')
  assert.doesNotMatch(codeOutput, /^- 真的列表$/m)
  assert.match(codeOutput, /真的列表。/)
})

test('flattening is a no-op on clean text and never touches non-markdown content', () => {
  for (const text of ['嗯，知道了。', 'mm. okay.', 'うん、わかった。']) {
    assert.equal(flattenMarkdownForChat(text, 'zh-CN'), text)
  }
})

test('only two output changes are possible: markdown flatten and the length flag', () => {
  const dirty = '作为 AI 我建议你这样做。希望对你有帮助。'
  const observed = applyAssistantToneFilter(dirty, {
    uiLanguage: 'zh-CN',
    markdownOk: true,
  })
  assert.equal(observed.text, dirty, 'tone words are never rewritten')
  assert.ok(observed.hitCount > 0)
  assert.equal(observed.changed, false)

  const overlyLong = applyAssistantToneFilter('嗯'.repeat(140), {
    uiLanguage: 'zh-CN',
    markdownOk: true,
  })
  assert.equal(overlyLong.text, '嗯'.repeat(140), 'an over-long reply is flagged, not truncated')
  assert.equal(overlyLong.overLong, true)

  const markdown = applyAssistantToneFilter('## 标题\n\n- 一条', {
    uiLanguage: 'zh-CN',
    markdownOk: false,
  })
  assert.doesNotMatch(markdown.text, /#|^- /m)
  assert.equal(markdown.changed, true)
})

test('strictness loose observes without reshaping; med and strict apply the safe fixes', () => {
  const input = '## 标题\n\n- 一条'
  const loose = applyAssistantToneFilter(input, {
    uiLanguage: 'zh-CN',
    markdownOk: false,
    strictness: 'loose',
  })
  assert.equal(loose.text, input)
  assert.equal(loose.changed, false)

  for (const strictness of ['med', 'strict'] as const) {
    const shaped = applyAssistantToneFilter(input, {
      uiLanguage: 'zh-CN',
      markdownOk: false,
      strictness,
    })
    assert.equal(shaped.changed, true)
    assert.doesNotMatch(shaped.text, /#|^- /m)
  }
})

test('the previous reply leaves one positive nudge, not a ban list', () => {
  recordAssistantToneReport(analyzeAssistantTone('总之，希望对你有帮助。', {
    uiLanguage: 'zh-CN',
  }))
  const feedback = getLastAssistantToneFeedback()
  assert.ok(feedback)
  assert.ok(feedback.hitCount > 0)

  for (const uiLanguage of LOCALES) {
    const block = buildPersonaReminder({
      persona: makePersona(),
      companionName: 'Aster',
      uiLanguage,
      toneFeedback: { hitCount: 1, overLong: true },
    })
    assert.match(block, /<character-reminder>/, `${uiLanguage} must keep the reminder tag`)
    assert.doesNotMatch(block, /客服|customer service|不要像|don't sound|don't say/i, `${uiLanguage} used a ban-style nudge`)
  }

  // A clean reply clears the signal.
  recordAssistantToneReport(analyzeAssistantTone('嗯，知道了。', { uiLanguage: 'zh-CN' }))
  assert.equal(getLastAssistantToneFeedback(), null)
})
