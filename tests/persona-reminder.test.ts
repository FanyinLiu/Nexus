import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { buildChatRequestPayload } from '../src/features/chat/systemPromptBuilder.ts'
import { getChatPromptStrings } from '../src/features/chat/prompts/index.ts'
import { estimateTokensFromText } from '../src/features/chat/tokenEstimate.ts'
import {
  PERSONA_REMINDER_ESCALATE_AFTER_TURNS,
  PERSONA_REMINDER_ESCALATED_TOKEN_CAP,
  PERSONA_REMINDER_FORBIDDEN_LIMIT,
  PERSONA_REMINDER_TOKEN_CAP,
  buildPersonaReminder,
  extractSoulStyleRules,
  shouldEscalatePersonaReminder,
} from '../src/features/persona/personaReminder.ts'
import { invalidateResolvedPersonaCache } from '../src/features/persona/resolveActivePersona.ts'
import { mapCardToPersona } from '../electron/services/characterCardMapper.js'
import { loadPersonaProfileFromReader } from '../electron/services/personaProfileLoader.js'
import { loadSettings } from '../src/lib/storage.ts'
import type { LoadedPersona } from '../src/features/autonomy/v2/personaTypes.ts'
import type { ChatMessage, MemoryRecallContext, UiLanguage } from '../src/types'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
  clear() { this.data.clear() }
}

const LOCALES: UiLanguage[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']

const memoryContext: MemoryRecallContext = {
  longTerm: [],
  daily: [],
  semantic: [],
  searchModeUsed: 'keyword',
  vectorSearchAvailable: false,
}

function makePersona(overrides: Partial<LoadedPersona> = {}): LoadedPersona {
  return {
    id: 'aster',
    rootDir: '/personas/aster',
    soul: [
      '# Aster',
      '',
      'You are Aster, a quiet companion who lives on the desktop.',
      '',
      '## Speech',
      '',
      '- Answers in one or two sentences, never a list.',
      '- Says the honest thing before the kind thing.',
    ].join('\n'),
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

function userMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, createdAt: '2026-10-29T08:00:00.000Z' }
}

function assistantMessage(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content, createdAt: '2026-10-29T08:01:00.000Z' }
}

function installPersonaBridge(persona: LoadedPersona): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: new MemoryStorage(),
      desktopPet: {
        personaLoadSoul: async () => '',
        personaLoadMemory: async () => '',
        personaLoadProfile: async (id: string) => ({ ...persona, id }),
      },
    },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  invalidateResolvedPersonaCache()
  installPersonaBridge(makePersona())
})

test('the character reminder rides on the last user message, after the time block', async () => {
  const settings = {
    ...loadSettings(),
    uiLanguage: 'en-US' as const,
    companionName: 'Aster',
    userName: 'Klein',
    systemPrompt: 'PERSONA-SENTINEL: quiet, terse, secretly soft.',
  }
  const history: ChatMessage[] = [
    userMessage('u1', 'first turn'),
    assistantMessage('a1', 'mm.'),
    userMessage('u2', 'second turn'),
  ]

  const payload = await buildChatRequestPayload(settings, history, memoryContext, {})
  const userTurns = payload.messages.filter((message) => message.role === 'user')
  const latest = String(userTurns.at(-1)?.content ?? '')
  const earliest = String(userTurns[0]?.content ?? '')
  const system = String(payload.messages[0]?.content ?? '')

  assert.ok(latest.includes('<character-reminder>'), 'last user turn must carry the reminder')
  assert.ok(latest.includes('Aster'), 'the reminder must name the character')
  assert.ok(
    latest.indexOf('<system-reminder>') < latest.indexOf('<character-reminder>'),
    'the time block stays first; identity is the freshest instruction',
  )
  assert.match(latest, /second turn$/)
  assert.doesNotMatch(earliest, /<character-reminder>/, 'older turns stay byte-stable')
  assert.doesNotMatch(system, /<character-reminder>/, 'the reminder is post-history, not system prompt')
})

test('the reminder core stays inside its token budget in every locale', () => {
  const longSoul = [
    '# Aster',
    '',
    '## Speech',
    '',
    ...Array.from({ length: 20 }, (_, index) =>
      `- Rule ${index}: answer briefly and never turn a conversation into a lecture.`),
  ].join('\n')
  const persona = makePersona({
    soul: longSoul,
    style: {
      forbiddenPhrases: ['as an AI', 'of course', 'sure thing', 'happy to help', 'great question', 'let me know', 'feel free', 'I am here to'],
    },
  })

  for (const uiLanguage of LOCALES) {
    const base = buildPersonaReminder({ persona, companionName: 'Aster', uiLanguage })
    const escalated = buildPersonaReminder({
      persona,
      companionName: 'Aster',
      uiLanguage,
      compacted: true,
    })

    assert.ok(
      estimateTokensFromText(base) <= PERSONA_REMINDER_TOKEN_CAP,
      `${uiLanguage} base reminder is ${estimateTokensFromText(base)} tokens`,
    )
    assert.ok(
      estimateTokensFromText(escalated) <= PERSONA_REMINDER_ESCALATED_TOKEN_CAP,
      `${uiLanguage} escalated reminder is ${estimateTokensFromText(escalated)} tokens`,
    )
    assert.ok(escalated.length > base.length, `${uiLanguage} escalation adds the drift warning`)
  }
})

test('the reminder states the name and style rules in all five locales', () => {
  for (const uiLanguage of LOCALES) {
    const block = buildPersonaReminder({
      persona: makePersona(),
      companionName: 'Aster',
      uiLanguage,
    })
    assert.match(block, /^<character-reminder>/, `${uiLanguage} must use the shared tag`)
    assert.match(block, /<\/character-reminder>$/, `${uiLanguage} must close the shared tag`)
    assert.ok(block.includes('Aster'), `${uiLanguage} must name the character`)
    assert.ok(block.length > 20, `${uiLanguage} must carry the style rules`)
  }
})

test('speech dials become rules; a persona without dials falls back to soul.md', () => {
  const dialed = buildPersonaReminder({
    persona: makePersona({
      soul: '# Aster\n\n## Speech\n\n- Never mention this fallback line.',
      style: { speechStyle: { aloof: 3, tsundere: true, maxSentences: 2 } },
    }),
    companionName: 'Aster',
    uiLanguage: 'en-US',
  })
  assert.match(dialed, /few words/)
  assert.match(dialed, /prickly/)
  assert.match(dialed, /at most 2 sentences/)
  assert.doesNotMatch(dialed, /fallback line/, 'dials win over soul extraction')

  const fromSoul = buildPersonaReminder({
    persona: makePersona(),
    companionName: 'Aster',
    uiLanguage: 'en-US',
  })
  assert.match(fromSoul, /one or two sentences/)
})

test('soul extraction prefers the speech section and ignores headings and long paragraphs', () => {
  const rules = extractSoulStyleRules([
    '# Aster',
    '',
    'A very long identity paragraph that goes on and on and should not become a style rule because it is far too long to read quickly.',
    '',
    '## Speech',
    '',
    '- Short answers first.',
    '- No lists.',
  ].join('\n'), 4)

  assert.deepEqual(rules, ['Short answers first', 'No lists'])
})

test('escalation starts after twelve assistant turns or right after compaction', () => {
  assert.equal(shouldEscalatePersonaReminder(PERSONA_REMINDER_ESCALATE_AFTER_TURNS - 1, false), false)
  assert.equal(shouldEscalatePersonaReminder(PERSONA_REMINDER_ESCALATE_AFTER_TURNS, false), true)
  assert.equal(shouldEscalatePersonaReminder(0, true), true)

  const persona = makePersona()
  const early = buildPersonaReminder({ persona, companionName: 'Aster', uiLanguage: 'en-US', assistantTurns: 2 })
  const late = buildPersonaReminder({
    persona,
    companionName: 'Aster',
    uiLanguage: 'en-US',
    assistantTurns: PERSONA_REMINDER_ESCALATE_AFTER_TURNS,
  })
  assert.ok(late.includes('long'), 'the escalated reminder warns about drift')
  assert.ok(!early.includes('long'), 'an early reminder stays short')
})

test('forbidden phrases are capped at the five most important ones', () => {
  const persona = makePersona({
    style: { forbiddenPhrases: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'] },
  })
  const block = buildPersonaReminder({ persona, companionName: 'Aster', uiLanguage: 'en-US' })

  assert.ok(block.includes('one'))
  assert.ok(block.includes('five'))
  assert.ok(!block.includes('six'))
  assert.equal(PERSONA_REMINDER_FORBIDDEN_LIMIT, 5)
})

test('the mood attitude line joins the reminder when the emotion layer provides one', () => {
  const block = buildPersonaReminder({
    persona: makePersona(),
    companionName: 'Aster',
    uiLanguage: 'en-US',
    attitude: 'happy but pretending not to be',
  })
  assert.match(block, /Right now: happy but pretending not to be/)
})

test('a card post-history note round-trips into the reminder instead of soul.md', async () => {
  const mapped = mapCardToPersona({
    data: {
      name: 'Aria',
      description: 'A calm seaside companion.',
      post_history_instructions: 'Never bring up the lighthouse unless the user does.',
    },
  })

  assert.doesNotMatch(mapped.files['soul.md'], /lighthouse/)
  const style = JSON.parse(mapped.files['style.json']) as { postHistory?: string }
  assert.equal(style.postHistory, 'Never bring up the lighthouse unless the user does.')

  const loaded = await loadPersonaProfileFromReader({
    id: 'card-aria',
    rootDir: '/personas/card-aria',
    read: async (relative: string) => mapped.files[relative] ?? null,
  })
  assert.equal(loaded.style.postHistory, style.postHistory)

  const block = buildPersonaReminder({
    persona: loaded,
    companionName: 'Aria',
    uiLanguage: 'en-US',
  })
  assert.ok(block.includes('Never bring up the lighthouse'), 'the note lands after history')
})

test('a very long post-history note is capped instead of flooding the last turn', () => {
  const persona = makePersona({
    style: { postHistory: 'note '.repeat(400) },
  })
  const block = buildPersonaReminder({ persona, companionName: 'Aster', uiLanguage: 'en-US' })
  assert.ok(block.length < 1200, 'the note is shortened')
  assert.ok(block.includes('…'), 'the truncation is visible')
})

test('locale copy for the reminder avoids developer jargon', () => {
  for (const uiLanguage of LOCALES) {
    const block = buildPersonaReminder({
      persona: makePersona(),
      companionName: 'Aster',
      uiLanguage,
      postHistory: '',
    })
    assert.doesNotMatch(
      block,
      /\bprompt\b|\bLLM\b|\bJSON\b|\btoken\b|\bpersona\b/i,
      `${uiLanguage} reminder must stay in plain language`,
    )
    assert.ok(getChatPromptStrings(uiLanguage).characterReminder)
  }
})
