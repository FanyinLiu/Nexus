import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDecisionPrompt } from '../src/features/autonomy/v2/decisionPrompt.ts'
import {
  extractDecisionJson,
  runDecisionEngine,
  type ChatCaller,
  type ChatCallerPayload,
  type DecisionEngineConfig,
} from '../src/features/autonomy/v2/decisionEngine.ts'
import type { AutonomyContextV2 } from '../src/features/autonomy/v2/contextGatherer.ts'
import { createDefaultEmotionState } from '../src/features/autonomy/emotionModel.ts'
import { createEmptyLoadedPersona, type LoadedPersona } from '../src/features/autonomy/v2/personaTypes.ts'

// ── Fixtures ────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<AutonomyContextV2> = {}): AutonomyContextV2 {
  return {
    timestamp: '2026-04-19T10:15:00.000Z',
    hour: 18,
    dayOfWeek: 0,
    focusState: 'active',
    activeWindowTitle: 'Cursor — autonomy.ts',
    activityClass: 'coding',
    userDeepFocused: true,
    idleSeconds: 4,
    consecutiveIdleTicks: 0,
    phase: 'awake',
    lastWakeAt: '2026-04-19T09:00:00.000Z',
    lastSleepAt: null,
    emotion: createDefaultEmotionState(),
    relationshipLevel: 'friend',
    relationshipScore: 35,
    daysInteracted: 20,
    streak: 3,
    recentMessages: [
      { role: 'user', content: '帮我看下这段', at: '2026-04-19T10:14:00.000Z' },
      { role: 'assistant', content: '发我。', at: '2026-04-19T10:14:05.000Z' },
    ],
    topMemories: [
      { id: 'm1', content: '主人在做 Nexus 桌宠项目', category: 'project', importanceScore: 1.5 },
    ],
    nearReminders: [],
    activeGoals: [],
    activityWindow: 'medium',
    lastProactiveUtterance: null,
    ...overrides,
  }
}

function makePersona(overrides: Partial<LoadedPersona> = {}): LoadedPersona {
  return {
    ...createEmptyLoadedPersona('xinghui', '/fake/personas/xinghui'),
    soul: '你是星绘。短句、直接、不铺排。',
    style: {
      signaturePhrases: ['嗯', '好'],
      forbiddenPhrases: ['作为 AI', '主人大人'],
      toneTags: ['calm'],
    },
    examples: [
      { user: '早', assistant: '醒啦。' },
      { user: '夸夸我', assistant: '没看见你做什么，夸不动。' },
    ],
    present: true,
    ...overrides,
  }
}

// ── Prompt builder ──────────────────────────────────────────────────────

test('buildDecisionPrompt emits system + few-shot + user in that order', () => {
  const msgs = buildDecisionPrompt(makeContext(), makePersona())

  // 1 system + 2 few-shot pairs (4 messages) + 1 user = 6
  assert.equal(msgs.length, 6)
  assert.equal(msgs[0].role, 'system')
  assert.equal(msgs[1].role, 'user')
  assert.equal(msgs[2].role, 'assistant')
  assert.equal(msgs[3].role, 'user')
  assert.equal(msgs[4].role, 'assistant')
  assert.equal(msgs[5].role, 'user')
})

test('buildDecisionPrompt system prompt includes soul + forbidden phrases + contract', () => {
  const msgs = buildDecisionPrompt(makeContext(), makePersona())
  const system = msgs[0].content
  assert.ok(system.includes('你是星绘'))
  assert.ok(system.includes('作为 AI'))
  assert.ok(system.includes('Response contract'))
  assert.ok(system.includes('{"action": "silent"}'))
})

test('buildDecisionPrompt few-shot assistant turns are JSON, not raw text', () => {
  const msgs = buildDecisionPrompt(makeContext(), makePersona())
  const firstFewshotAssistant = msgs[2].content
  const parsed = JSON.parse(firstFewshotAssistant)
  assert.equal(parsed.action, 'speak')
  assert.equal(parsed.text, '醒啦。')
})

test('buildDecisionPrompt user message surfaces deep-focus signal + relationship + context', () => {
  const msgs = buildDecisionPrompt(makeContext(), makePersona())
  const user = msgs[msgs.length - 1].content
  assert.ok(user.includes('用户当前在专注状态'))
  assert.ok(user.includes('friend'))
  assert.ok(user.includes('最近对话'))
  assert.ok(user.includes('Cursor'))
  assert.ok(user.includes('主人在做 Nexus'))
})

test('buildDecisionPrompt forceSilent disables few-shot + injects override line', () => {
  const msgs = buildDecisionPrompt(makeContext(), makePersona(), { forceSilent: true })
  assert.equal(msgs.length, 2, 'system + one user message only, few-shot dropped')
  assert.ok(msgs[0].content.includes('强制静默'))
})

test('buildDecisionPrompt with empty persona falls back to default identity line', () => {
  // Default locale is zh-CN — fallback identity is Chinese.
  const msgs = buildDecisionPrompt(makeContext(), createEmptyLoadedPersona('empty', '/x'))
  assert.ok(msgs[0].content.includes('桌面陪伴体'))

  // Passing uiLanguage=en-US switches to the English fallback.
  const enMsgs = buildDecisionPrompt(
    makeContext(),
    createEmptyLoadedPersona('empty', '/x'),
    { uiLanguage: 'en-US' },
  )
  assert.ok(enMsgs[0].content.includes('desktop companion'))
})

// ── Response parser ─────────────────────────────────────────────────────

test('extractDecisionJson accepts a clean JSON body', () => {
  const r = extractDecisionJson('{"action": "silent"}')
  assert.deepEqual(r, { action: 'silent' })
})

test('extractDecisionJson accepts a JSON object with text field', () => {
  const r = extractDecisionJson('{"action":"speak","text":"嗯。"}')
  assert.deepEqual(r, { action: 'speak', text: '嗯。' })
})

test('extractDecisionJson strips markdown code fences', () => {
  const r = extractDecisionJson('```json\n{"action":"silent"}\n```')
  assert.deepEqual(r, { action: 'silent' })
})

test('extractDecisionJson recovers from leading reasoning text', () => {
  const raw = 'I think I should stay quiet.\n\n{"action": "silent"}'
  assert.deepEqual(extractDecisionJson(raw), { action: 'silent' })
})

test('extractDecisionJson recovers with trailing commentary', () => {
  const raw = '{"action": "speak", "text": "早"}\n\n(reasoning: morning greeting)'
  assert.deepEqual(extractDecisionJson(raw), { action: 'speak', text: '早' })
})

test('extractDecisionJson returns null for garbage', () => {
  assert.equal(extractDecisionJson('not json at all'), null)
  assert.equal(extractDecisionJson(''), null)
  assert.equal(extractDecisionJson('{}'), null) // no action field
})

test('extractDecisionJson handles nested braces in text values', () => {
  const raw = '{"action":"speak","text":"看看 {foo:bar} 这个"}'
  const r = extractDecisionJson(raw)
  assert.equal(r?.action, 'speak')
  assert.equal(r?.text, '看看 {foo:bar} 这个')
})

// ── Orchestrator ────────────────────────────────────────────────────────

const BASE_CONFIG: DecisionEngineConfig = {
  providerId: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'test-key',
  model: 'claude-haiku-4-5',
}

test('runDecisionEngine returns silent when chat returns action=silent', async () => {
  const chat: ChatCaller = async () => ({ content: '{"action":"silent"}' })
  const result = await runDecisionEngine({
    context: makeContext(),
    persona: makePersona(),
    config: BASE_CONFIG,
    chat,
  })
  assert.equal(result.kind, 'silent')
})

test('runDecisionEngine returns speak with text when chat returns action=speak', async () => {
  const chat: ChatCaller = async () => ({ content: '{"action":"speak","text":"在的"}' })
  const result = await runDecisionEngine({
    context: makeContext(),
    persona: makePersona(),
    config: BASE_CONFIG,
    chat,
  })
  assert.equal(result.kind, 'speak')
  if (result.kind === 'speak') assert.equal(result.text, '在的')
})

test('runDecisionEngine passes provider config through to the chat caller', async () => {
  let received: ChatCallerPayload | null = null
  const chat: ChatCaller = async (payload) => {
    received = payload
    return { content: '{"action":"silent"}' }
  }
  await runDecisionEngine({
    context: makeContext(),
    persona: makePersona(),
    config: BASE_CONFIG,
    chat,
  })
  assert.ok(received)
  assert.equal(received!.providerId, 'anthropic')
  assert.equal(received!.model, 'claude-haiku-4-5')
  assert.ok(received!.messages.length >= 2)
  assert.equal(received!.messages[0].role, 'system')
  // Default sampling bounds
  assert.equal(received!.temperature, 0.7)
  assert.equal(received!.maxTokens, 256)
})

test('runDecisionEngine downgrades empty speak text to silent', async () => {
  const chat: ChatCaller = async () => ({ content: '{"action":"speak","text":"   "}' })
  const result = await runDecisionEngine({
    context: makeContext(),
    persona: makePersona(),
    config: BASE_CONFIG,
    chat,
  })
  assert.equal(result.kind, 'silent')
  if (result.kind === 'silent') assert.equal(result.reason, 'empty_speak_text')
})

test('runDecisionEngine silently absorbs a thrown chat call + reports via onError', async () => {
  const chat: ChatCaller = async () => {
    throw new Error('upstream 503')
  }
  const errors: unknown[] = []
  const result = await runDecisionEngine({
    context: makeContext(),
    persona: makePersona(),
    config: BASE_CONFIG,
    chat,
    onError: (err) => errors.push(err),
  })
  assert.equal(result.kind, 'silent')
  if (result.kind === 'silent') assert.ok(result.reason?.includes('upstream 503'))
  assert.equal(errors.length, 1)
})

test('runDecisionEngine treats unparseable response as silent with reason', async () => {
  const chat: ChatCaller = async () => ({ content: 'uhh I dunno maybe?' })
  const result = await runDecisionEngine({
    context: makeContext(),
    persona: makePersona(),
    config: BASE_CONFIG,
    chat,
  })
  assert.equal(result.kind, 'silent')
  if (result.kind === 'silent') assert.equal(result.reason, 'unparseable_response')
})

// ── idle_motion action ──────────────────────────────────────────────────

test('runDecisionEngine parses idle_motion action with motion value', async () => {
  const chat: ChatCaller = async () => ({
    content: '{"action":"idle_motion","motion":"stretch"}',
  })
  const result = await runDecisionEngine({
    context: makeContext(),
    persona: makePersona(),
    config: BASE_CONFIG,
    chat,
  })
  assert.equal(result.kind, 'idle_motion')
  if (result.kind === 'idle_motion') {
    assert.equal(result.motion, 'stretch')
  }
})

test('runDecisionEngine: idle_motion without motion field falls back to silent', async () => {
  const chat: ChatCaller = async () => ({
    content: '{"action":"idle_motion"}',
  })
  const result = await runDecisionEngine({
    context: makeContext(),
    persona: makePersona(),
    config: BASE_CONFIG,
    chat,
  })
  assert.equal(result.kind, 'silent')
  if (result.kind === 'silent') {
    assert.equal(result.reason, 'idle_motion_missing_value')
  }
})

test('buildDecisionPrompt: idle_motion contract appears only when allowIdleMotion true', () => {
  const without = buildDecisionPrompt(makeContext(), makePersona())
  assert.ok(!without[0].content.includes('idle_motion'))

  const withFlag = buildDecisionPrompt(makeContext(), makePersona(), { allowIdleMotion: true })
  assert.ok(withFlag[0].content.includes('idle_motion'))
})
