import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildLetterPrompt,
  parseLetterResponse,
} from '../src/features/letter/letterPromptBuilder.ts'
import type { SundayLetterDataReady } from '../src/features/letter/aggregator.ts'
import type { LoadedPersona } from '../src/features/autonomy/v2/personaTypes.ts'
import type { UiLanguage } from '../src/types/app.ts'

const LOCALES: UiLanguage[] = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']

function persona(overrides: Partial<LoadedPersona> = {}): LoadedPersona {
  return {
    id: 'xinghui',
    rootDir: '/tmp/personas/xinghui',
    soul: 'You are a warm, attentive companion who notices small things.',
    memory: '',
    style: {
      signaturePhrases: ['一起看看', '慢慢来'],
      forbiddenPhrases: ['作为 AI'],
      toneTags: ['warm', 'attentive'],
    },
    examples: [],
    voice: undefined,
    tools: undefined,
    ...overrides,
  } as LoadedPersona
}

function dataReady(overrides: Partial<SundayLetterDataReady> = {}): SundayLetterDataReady {
  return {
    shouldFire: true,
    themes: ['project', 'preference'],
    highlights: [
      { id: 'a', content: '搞定了那个 bug', significance: 0.8 },
      { id: 'b', content: '约朋友吃了饭', significance: 0.5 },
    ],
    stressors: [
      { id: 'c', content: '会议拖到九点', significance: 0.7 },
    ],
    reflectionLines: ['用户在压力期更需要被允许休息'],
    milestonesNotedThisWeek: [],
    weekDayCount: 5,
    ...overrides,
  }
}

test('builds [system, user] message pair', () => {
  const messages = buildLetterPrompt({
    persona: persona(),
    data: dataReady(),
    uiLanguage: 'en-US',
    letterDate: '2026-04-26',
  })
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].role, 'user')
})

test('system message contains persona soul + signature phrases', () => {
  const messages = buildLetterPrompt({
    persona: persona({ soul: 'I am Stardust, soft and curious.' }),
    data: dataReady(),
    uiLanguage: 'en-US',
  })
  assert.match(messages[0].content, /Stardust, soft and curious/)
  assert.match(messages[0].content, /一起看看/)
})

test('system message contains JSON contract with all 6 keys', () => {
  const messages = buildLetterPrompt({
    persona: persona(),
    data: dataReady(),
    uiLanguage: 'en-US',
  })
  for (const key of ['greeting', 'summary', 'suggestion', 'intention', 'experiment', 'closing']) {
    assert.match(messages[0].content, new RegExp(key), `system has ${key}`)
  }
})

test('user message inlines highlights, stressors, themes, reflections', () => {
  const messages = buildLetterPrompt({
    persona: persona(),
    data: dataReady(),
    uiLanguage: 'zh-CN',
    letterDate: '2026-04-26',
  })
  const userMsg = messages[1].content
  assert.match(userMsg, /搞定了那个 bug/)
  assert.match(userMsg, /会议拖到九点/)
  assert.match(userMsg, /project/)
  assert.match(userMsg, /用户在压力期更需要被允许休息/)
  assert.match(userMsg, /2026-04-26/)
})

test('skips empty optional sections', () => {
  const messages = buildLetterPrompt({
    persona: persona(),
    data: dataReady({ stressors: [], reflectionLines: [], milestonesNotedThisWeek: [] }),
    uiLanguage: 'en-US',
  })
  const userMsg = messages[1].content
  assert.doesNotMatch(userMsg, /Stressful pieces/)
  assert.doesNotMatch(userMsg, /earlier reflections/i)
  assert.doesNotMatch(userMsg, /milestones/i)
})

test('every locale registers with task framing + contract', () => {
  for (const locale of LOCALES) {
    const messages = buildLetterPrompt({
      persona: persona(),
      data: dataReady(),
      uiLanguage: locale,
    })
    assert.ok(messages[0].content.length > 100, `${locale} system non-trivial`)
    assert.match(messages[0].content, /greeting/, `${locale} contract present`)
  }
})

test('parseLetterResponse accepts a complete JSON', () => {
  const out = parseLetterResponse(JSON.stringify({
    greeting: 'Hi.',
    summary: 'Your week had X.',
    suggestion: 'Try slowing down.',
    intention: 'Rest.',
    experiment: 'Take Wednesday off.',
    closing: 'See you Monday.',
  }))
  assert.ok(out)
  assert.equal(out!.greeting, 'Hi.')
  assert.equal(out!.closing, 'See you Monday.')
})

test('parseLetterResponse strips ```json fences', () => {
  const fenced = '```json\n{"greeting":"a","summary":"b","suggestion":"c","intention":"d","experiment":"e","closing":"f"}\n```'
  const out = parseLetterResponse(fenced)
  assert.ok(out)
  assert.equal(out!.greeting, 'a')
})

test('parseLetterResponse rejects missing key', () => {
  const out = parseLetterResponse(JSON.stringify({
    greeting: 'a', summary: 'b', suggestion: 'c', intention: 'd', experiment: 'e',
    // closing missing
  }))
  assert.equal(out, null)
})

test('parseLetterResponse rejects empty-string field', () => {
  const out = parseLetterResponse(JSON.stringify({
    greeting: 'a', summary: 'b', suggestion: 'c', intention: 'd', experiment: 'e', closing: '',
  }))
  assert.equal(out, null)
})

test('parseLetterResponse rejects non-JSON garbage', () => {
  assert.equal(parseLetterResponse('hi there'), null)
  assert.equal(parseLetterResponse(''), null)
  assert.equal(parseLetterResponse('   '), null)
})

test('parseLetterResponse rejects non-string field', () => {
  const out = parseLetterResponse(JSON.stringify({
    greeting: 'a', summary: 42, suggestion: 'c', intention: 'd', experiment: 'e', closing: 'f',
  }))
  assert.equal(out, null)
})
