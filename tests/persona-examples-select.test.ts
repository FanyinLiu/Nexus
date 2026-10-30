import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadPersonaProfileFromReader } from '../electron/services/personaProfileLoader.js'
import { buildDecisionPrompt } from '../src/features/autonomy/v2/decisionPrompt.ts'
import {
  createEmptyLoadedPersona,
  type LoadedPersona,
  type PersonaFewShotExample,
} from '../src/features/autonomy/v2/personaTypes.ts'
import type { AutonomyContextV2 } from '../src/features/autonomy/v2/contextGatherer.ts'
import { createDefaultEmotionState } from '../src/features/autonomy/emotionModel.ts'
import { getChatPromptStrings } from '../src/features/chat/prompts/index.ts'
import { estimateTokensFromText } from '../src/features/chat/tokenEstimate.ts'
import {
  formatPersonaExamplesForChat,
  PERSONA_EXAMPLE_MOOD_LIMIT,
  PERSONA_EXAMPLE_TOKEN_CAP,
  selectPersonaExamples,
} from '../src/features/persona/exampleSelector.ts'
import type { UiLanguage } from '../src/types'

const LOCALES: UiLanguage[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']

function reply(user: string, assistant: string, mood?: string): PersonaFewShotExample {
  return { user, assistant, kind: 'reply', ...(mood ? { mood } : {}) }
}

function proactive(assistant: string): PersonaFewShotExample {
  return { user: '', assistant, kind: 'proactive' }
}

async function parseExamples(raw: string): Promise<PersonaFewShotExample[]> {
  const loaded = await loadPersonaProfileFromReader({
    id: 'examples-test',
    rootDir: '/examples-test',
    read: async (relative: string) => (relative === 'examples.md' ? raw : null),
  })
  return loaded.examples
}

function makeContext(): AutonomyContextV2 {
  return {
    timestamp: '2026-10-29T10:00:00.000Z',
    hour: 19,
    dayOfWeek: 4,
    focusState: 'active',
    activeWindowTitle: 'Nexus',
    activityClass: 'coding',
    userDeepFocused: false,
    idleSeconds: 3,
    consecutiveIdleTicks: 0,
    phase: 'awake',
    lastWakeAt: '2026-10-29T09:00:00.000Z',
    lastSleepAt: null,
    emotion: createDefaultEmotionState(),
    relationshipLevel: 'friend',
    relationshipScore: 40,
    daysInteracted: 30,
    streak: 4,
    recentMessages: [
      { role: 'user', content: '在吗', at: '2026-10-29T09:59:00.000Z' },
    ],
    topMemories: [],
    nearReminders: [],
    activeGoals: [],
    activityWindow: 'short',
    lastProactiveUtterance: null,
  }
}

function personaWith(examples: PersonaFewShotExample[]): LoadedPersona {
  return {
    ...createEmptyLoadedPersona('examples', '/examples'),
    soul: '你是星绘。',
    examples,
    present: true,
  }
}

// ── Parser ──────────────────────────────────────────────────────────────

test('examples.md mood and proactive headings tag the samples that follow', async () => {
  const examples = await parseExamples(`
## mood: affectionate

### a
User: 在吗
Assistant: 在。

## proactive

### b
Assistant: 三点了，还不睡？

## 通用

### c
User: 早
Assistant: 醒啦。
`)

  assert.deepEqual(examples, [
    { user: '在吗', assistant: '在。', mood: 'affectionate', kind: 'reply' },
    { user: '', assistant: '三点了，还不睡？', kind: 'proactive' },
    { user: '早', assistant: '醒啦。', kind: 'reply' },
  ])
})

test('a later mood heading replaces the previous group', async () => {
  const examples = await parseExamples(`
## mood: sulky
User: 生气了？
Assistant: 没有。

## mood: playful
User: 我帅吗
Assistant: 灯太暗。
`)

  assert.deepEqual(examples.map((example) => example.mood), ['sulky', 'playful'])
})

// ── Selector ────────────────────────────────────────────────────────────

test('the selector puts mood-matched samples first and adds one random sample', () => {
  const examples = [
    reply('a1', '撒娇一', 'affectionate'),
    reply('a2', '撒娇二', 'affectionate'),
    reply('a3', '撒娇三', 'affectionate'),
    reply('a4', '撒娇四', 'affectionate'),
    reply('p1', '玩笑', 'playful'),
    reply('u1', '普通'),
    proactive('主动'),
  ]

  const picked = selectPersonaExamples(examples, {
    mood: 'affectionate',
    limit: PERSONA_EXAMPLE_MOOD_LIMIT,
    random: () => 0,
  })

  assert.equal(picked.length, PERSONA_EXAMPLE_MOOD_LIMIT + 1)
  assert.deepEqual(
    picked.slice(0, PERSONA_EXAMPLE_MOOD_LIMIT).map((example) => example.assistant),
    ['撒娇一', '撒娇二', '撒娇三', '撒娇四'],
  )
  assert.ok(picked.every((example) => example.kind === 'reply'))
})

test('an unmatched mood falls back to untagged samples before other groups', () => {
  const picked = selectPersonaExamples([
    reply('u1', '普通'),
    reply('p1', '玩笑', 'playful'),
    reply('a1', '撒娇', 'affectionate'),
  ], {
    mood: 'worried',
    limit: 4,
    random: () => 0,
  })

  assert.equal(picked[0].assistant, '普通')
})

test('the selector respects the token budget', () => {
  const long = '长'.repeat(300)
  const examples = Array.from({ length: 10 }, (_, index) => reply(`u${index}`, long))

  const block = formatPersonaExamplesForChat(examples, {
    header: getChatPromptStrings('zh-CN').personaExamplesHeader,
    tokenCap: PERSONA_EXAMPLE_TOKEN_CAP,
    random: () => 0,
  })

  assert.ok(block.length > 0)
  assert.ok(
    estimateTokensFromText(block) <= PERSONA_EXAMPLE_TOKEN_CAP,
    `block used ${estimateTokensFromText(block)} tokens`,
  )
})

// ── Chat block ──────────────────────────────────────────────────────────

test('chat gets plain voice samples, never proactive openers or fake role turns', () => {
  const block = formatPersonaExamplesForChat([
    reply('在吗', '在。', 'affectionate'),
    reply('我帅吗', '灯太暗。', 'playful'),
    reply('早', '醒啦。'),
    proactive('三点了，还不睡？'),
  ], {
    header: getChatPromptStrings('zh-CN').personaExamplesHeader,
    mood: 'affectionate',
    random: () => 0,
  })

  assert.match(block, /她平时这样说话/)
  assert.match(block, /在吗 → 在。/)
  assert.doesNotMatch(block, /三点了，还不睡？/)
  assert.doesNotMatch(block, /^(?:User|Assistant):/m)
})

test('the voice-sample header exists in every locale', () => {
  for (const uiLanguage of LOCALES) {
    const header = getChatPromptStrings(uiLanguage).personaExamplesHeader
    assert.equal(typeof header, 'string', `${uiLanguage} header must be a string`)
    assert.ok(header.trim().length > 0, `${uiLanguage} header must not be empty`)
  }
})

// ── Decision prompt ─────────────────────────────────────────────────────

test('the V2 decision prompt prefers proactive examples', () => {
  const messages = buildDecisionPrompt(
    makeContext(),
    personaWith([
      reply('早', '回复例句'),
      proactive('主动例句一'),
      proactive('主动例句二'),
    ]),
    { uiLanguage: 'zh-CN' },
  )

  const assistantPayloads = messages
    .slice(1, -1)
    .filter((message) => message.role === 'assistant')
    .map((message) => JSON.parse(String(message.content)))

  assert.equal(assistantPayloads[0].text, '主动例句一')
  assert.equal(assistantPayloads[1].text, '主动例句二')
  assert.ok(assistantPayloads.length <= PERSONA_EXAMPLE_MOOD_LIMIT + 1)
})
