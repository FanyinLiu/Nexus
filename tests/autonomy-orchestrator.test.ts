import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runAutonomyDecision } from '../src/features/autonomy/v2/orchestrator.ts'
import type { AutonomyContextV2 } from '../src/features/autonomy/v2/contextGatherer.ts'
import type { ChatCaller, ChatCallerPayload, DecisionEngineConfig } from '../src/features/autonomy/v2/decisionEngine.ts'
import type { JudgeCaller } from '../src/features/autonomy/v2/personaGuardrail.ts'
import { createDefaultEmotionState } from '../src/features/autonomy/emotionModel.ts'
import { createEmptyLoadedPersona, type LoadedPersona } from '../src/features/autonomy/v2/personaTypes.ts'

// ── Fixtures ────────────────────────────────────────────────────────────

function makeContext(): AutonomyContextV2 {
  return {
    timestamp: '2026-04-19T10:15:00.000Z',
    hour: 18,
    dayOfWeek: 0,
    focusState: 'idle',
    activeWindowTitle: null,
    activityClass: 'unknown',
    userDeepFocused: false,
    idleSeconds: 120,
    consecutiveIdleTicks: 4,
    phase: 'awake',
    lastWakeAt: '2026-04-19T09:00:00.000Z',
    lastSleepAt: null,
    emotion: createDefaultEmotionState(),
    relationshipLevel: 'friend',
    relationshipScore: 35,
    daysInteracted: 20,
    streak: 3,
    recentMessages: [],
    topMemories: [],
    nearReminders: [],
    activeGoals: [],
    activityWindow: 'medium',
    lastProactiveUtterance: null,
  }
}

function makePersona(): LoadedPersona {
  return {
    ...createEmptyLoadedPersona('xinghui', '/fake'),
    soul: '你是星绘。短句。',
    style: {
      signaturePhrases: ['嗯', '好'],
      forbiddenPhrases: ['作为 AI'],
      toneTags: [],
    },
    examples: [{ user: '早', assistant: '醒啦。' }],
    present: true,
  }
}

const CONFIG: DecisionEngineConfig = {
  providerId: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'k',
  model: 'claude-haiku-4-5',
}

/** Mock chat caller that returns a scripted response per call. */
function scriptedChat(responses: string[]): ChatCaller {
  const calls: ChatCallerPayload[] = []
  let idx = 0
  const fn: ChatCaller = async (payload) => {
    calls.push(payload)
    const body = responses[idx] ?? responses[responses.length - 1] ?? '{"action":"silent"}'
    idx += 1
    return { content: body }
  }
  ;(fn as unknown as { calls: ChatCallerPayload[] }).calls = calls
  return fn
}

// ── first-try happy path ────────────────────────────────────────────────

test('orchestrator: clean speak passes guardrail on first try', async () => {
  const chat = scriptedChat(['{"action":"speak","text":"嗯。"}'])
  const out = await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'med',
  })
  assert.equal(out.result.kind, 'speak')
  if (out.result.kind === 'speak') assert.equal(out.result.text, '嗯。')
  assert.equal(out.telemetry.attempts, 1)
  assert.equal(out.telemetry.guardrail.length, 1)
  assert.equal(out.telemetry.guardrail[0].verdict, 'pass')
})

test('orchestrator: first-try silent skips guardrail', async () => {
  const chat = scriptedChat(['{"action":"silent"}'])
  const out = await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'med',
  })
  assert.equal(out.result.kind, 'silent')
  assert.equal(out.telemetry.attempts, 1)
  assert.equal(out.telemetry.guardrail.length, 0, 'silent should not be guard-checked')
})

// ── retry path ──────────────────────────────────────────────────────────

test('orchestrator: guardrail-fail triggers retry with previousFailure hint', async () => {
  const chat = scriptedChat([
    '{"action":"speak","text":"作为 AI 我觉得"}',  // fails forbidden_phrase
    '{"action":"speak","text":"嗯，这样吧。"}',     // retry passes
  ])
  const out = await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'med',
  })
  assert.equal(out.result.kind, 'speak')
  if (out.result.kind === 'speak') assert.equal(out.result.text, '嗯，这样吧。')
  assert.equal(out.telemetry.attempts, 2)
  // First attempt: speak → guard fail
  assert.equal(out.telemetry.decisions[0].kind, 'speak')
  assert.equal(out.telemetry.guardrail[0].verdict, 'fail')
  assert.ok(out.telemetry.guardrail[0].reason?.startsWith('forbidden_phrase'))
  // Retry: speak → guard pass
  assert.equal(out.telemetry.decisions[1].kind, 'speak')
  assert.equal(out.telemetry.guardrail[1].verdict, 'pass')
})

test('orchestrator: retry prompt carries the previousFailure hint', async () => {
  const payloads: ChatCallerPayload[] = []
  const chat: ChatCaller = async (payload) => {
    payloads.push(payload)
    const body = payloads.length === 1
      ? '{"action":"speak","text":"作为 AI 我觉得"}'
      : '{"action":"speak","text":"嗯，这样吧。"}'
    return { content: body }
  }
  await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'med',
  })
  assert.equal(payloads.length, 2)
  const retryUserMessage = payloads[1].messages[payloads[1].messages.length - 1].content
  assert.ok(retryUserMessage.includes('重试提示'))
  assert.ok(retryUserMessage.includes('作为 AI 我觉得'))
  assert.ok(retryUserMessage.includes('forbidden_phrase'))
})

test('orchestrator: retry also failing → final silent with reason', async () => {
  const chat = scriptedChat([
    '{"action":"speak","text":"作为 AI 我觉得"}',
    '{"action":"speak","text":"作为 AI 再次"}',
  ])
  const out = await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'med',
  })
  assert.equal(out.result.kind, 'silent')
  if (out.result.kind === 'silent') {
    assert.ok(out.result.reason?.startsWith('guardrail_failed_twice:'))
  }
  assert.equal(out.telemetry.attempts, 2)
  assert.equal(out.telemetry.guardrail.length, 2)
})

test('orchestrator: retry returning silent is respected (no third attempt)', async () => {
  const chat = scriptedChat([
    '{"action":"speak","text":"作为 AI 我觉得"}',
    '{"action":"silent"}',
  ])
  const out = await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'med',
  })
  assert.equal(out.result.kind, 'silent')
  assert.equal(out.telemetry.attempts, 2)
})

// ── retry disabled ──────────────────────────────────────────────────────

test('orchestrator: retryOnGuardFail=false drops to silent without second attempt', async () => {
  const chat = scriptedChat([
    '{"action":"speak","text":"作为 AI 我觉得"}',
  ])
  const out = await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'med',
    retryOnGuardFail: false,
  })
  assert.equal(out.result.kind, 'silent')
  assert.equal(out.telemetry.attempts, 1)
  if (out.result.kind === 'silent') {
    assert.ok(out.result.reason?.startsWith('guardrail_failed:'))
  }
})

// ── strict tier + judge ─────────────────────────────────────────────────

test('orchestrator: strict tier runs judge on pattern-clean speak', async () => {
  const chat = scriptedChat(['{"action":"speak","text":"嗯，好的。"}'])
  let judgeCalled = false
  const judge: JudgeCaller = async () => {
    judgeCalled = true
    return { verdict: 'yes' }
  }
  const out = await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'strict',
    judge,
  })
  assert.equal(out.result.kind, 'speak')
  assert.equal(judgeCalled, true)
})

test('orchestrator: onError splits decision vs guardrail origin', async () => {
  const errors: Array<{ err: unknown; origin: string }> = []
  let chatCalls = 0
  const chat: ChatCaller = async () => {
    chatCalls += 1
    if (chatCalls === 1) throw new Error('decision 503')
    return { content: '{"action":"silent"}' }
  }
  await runAutonomyDecision({
    context: makeContext(),
    persona: makePersona(),
    decisionConfig: CONFIG,
    chat,
    strictness: 'med',
    onError: (err, origin) => errors.push({ err, origin }),
  })
  assert.equal(errors.length, 1)
  assert.equal(errors[0].origin, 'decision')
})
