import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  type GuardrailStrictness,
  type JudgeCaller,
  runPatternChecks,
  runPersonaGuardrail,
} from '../src/features/autonomy/v2/personaGuardrail.ts'
import type { DecisionResult } from '../src/features/autonomy/v2/decisionEngine.ts'
import {
  createEmptyLoadedPersona,
  type LoadedPersona,
} from '../src/features/autonomy/v2/personaTypes.ts'

// ── Fixtures ────────────────────────────────────────────────────────────

function makePersona(overrides: Partial<LoadedPersona> = {}): LoadedPersona {
  return {
    ...createEmptyLoadedPersona('xinghui', '/fake'),
    soul: '你是星绘。',
    style: {
      signaturePhrases: ['嗯', '好', '其实', '知道了'],
      forbiddenPhrases: ['作为 AI', '主人大人', '喵'],
      toneTags: ['calm'],
    },
    examples: [
      { user: '早', assistant: '醒啦。' },
      { user: '累', assistant: '嗯，先坐会儿。' },
    ],
    present: true,
    ...overrides,
  }
}

function speak(text: string): DecisionResult {
  return { kind: 'speak', text, rawResponse: `{"action":"speak","text":"${text}"}` }
}

function silent(reason?: string): DecisionResult {
  return { kind: 'silent', reason, rawResponse: '{"action":"silent"}' }
}

// ── Pattern checks (unit) ───────────────────────────────────────────────

test('runPatternChecks passes a short reply with a signature', () => {
  const r = runPatternChecks('嗯。', makePersona())
  assert.equal(r.verdict, 'pass')
})

test('runPatternChecks passes a short reply even without any signature', () => {
  // Under SIGNATURE_DENSITY_MIN_LENGTH — signature check doesn't fire.
  const r = runPatternChecks('醒啦', makePersona())
  assert.equal(r.verdict, 'pass')
})

test('runPatternChecks fails on a forbidden phrase (Chinese)', () => {
  const r = runPatternChecks('作为 AI 我建议你', makePersona())
  assert.equal(r.verdict, 'fail')
  assert.equal(r.reason, 'forbidden_phrase:作为 AI')
})

test('runPatternChecks fails on a forbidden phrase even when mixed with signature', () => {
  // Even if the reply *also* contains signatures, forbidden wins.
  const r = runPatternChecks('嗯，作为 AI 我觉得可以。', makePersona())
  assert.equal(r.verdict, 'fail')
  assert.ok(r.reason?.startsWith('forbidden_phrase:'))
})

test('runPatternChecks is case-insensitive for ASCII', () => {
  const persona = makePersona({
    style: { forbiddenPhrases: ['AS AN AI'], signaturePhrases: [], toneTags: [] },
  })
  const r = runPatternChecks('actually as an ai I think so', persona)
  assert.equal(r.verdict, 'fail')
})

test('runPatternChecks fails long reply with zero signatures (low density)', () => {
  // >= 40 graphemes, no signature words present
  const text = '让我来为您详细阐述一下这个问题的背景、现状、可能的解决方案方向、优先级排序、预期收益以及可能遇到的阻塞。'
  assert.ok([...text].length >= 40, `length was ${[...text].length}`)
  const r = runPatternChecks(text, makePersona())
  assert.equal(r.verdict, 'fail')
  assert.equal(r.reason, 'low_signature_density')
})

test('runPatternChecks passes long reply when a signature is present', () => {
  const text = '嗯，这个问题其实我昨晚还真的认真想过一次，大概的方向是这样的，后面我再帮你仔细细化一下流程好吗。'
  assert.ok([...text].length >= 40, `length was ${[...text].length}`)
  const r = runPatternChecks(text, makePersona())
  assert.equal(r.verdict, 'pass')
})

test('runPatternChecks with no signaturePhrases skips density check entirely', () => {
  const persona = makePersona({ style: { signaturePhrases: [], forbiddenPhrases: [] } })
  const text = '让我来为您详细阐述一下这个问题的背景、现状、可能的解决方案方向、优先级排序、预期收益以及可能遇到的阻塞。'
  const r = runPatternChecks(text, persona)
  assert.equal(r.verdict, 'pass')
})

// ── runPersonaGuardrail tiers ───────────────────────────────────────────

async function run(
  result: DecisionResult,
  strictness: GuardrailStrictness,
  judge?: JudgeCaller,
) {
  return runPersonaGuardrail({
    result,
    persona: makePersona(),
    strictness,
    judge,
  })
}

test('silent always passes at every tier', async () => {
  for (const tier of ['loose', 'med', 'strict'] as const) {
    const r = await run(silent(), tier)
    assert.equal(r.verdict, 'pass')
    assert.equal(r.result.kind, 'silent')
  }
})

test('loose tier passes even clearly off-character text', async () => {
  const r = await run(speak('作为 AI 我建议'), 'loose')
  assert.equal(r.verdict, 'pass')
})

test('med tier catches forbidden phrase', async () => {
  const r = await run(speak('作为 AI 我建议'), 'med')
  assert.equal(r.verdict, 'fail')
  assert.ok(r.reason?.startsWith('forbidden_phrase:'))
})

test('med tier passes clean text', async () => {
  const r = await run(speak('嗯，知道了。'), 'med')
  assert.equal(r.verdict, 'pass')
})

test('strict tier runs judge only after pattern-pass', async () => {
  let judgeCalls = 0
  const judge: JudgeCaller = async () => {
    judgeCalls += 1
    return { verdict: 'yes' }
  }
  // Pattern-fail: judge should NOT be called.
  await run(speak('作为 AI 我建议'), 'strict', judge)
  assert.equal(judgeCalls, 0)

  // Pattern-pass: judge should be called.
  await run(speak('嗯，知道了。'), 'strict', judge)
  assert.equal(judgeCalls, 1)
})

test('strict tier fails when judge returns no', async () => {
  const judge: JudgeCaller = async () => ({ verdict: 'no' })
  const r = await run(speak('嗯，知道了。'), 'strict', judge)
  assert.equal(r.verdict, 'fail')
  assert.equal(r.reason, 'judge_rejected')
})

test('strict tier passes when judge returns yes', async () => {
  const judge: JudgeCaller = async () => ({ verdict: 'yes' })
  const r = await run(speak('嗯，知道了。'), 'strict', judge)
  assert.equal(r.verdict, 'pass')
})

test('strict tier without a judge falls back to pattern-only', async () => {
  // Missing judge is a config error, not a persona violation — text that
  // would have been judged is still allowed through.
  const r = await run(speak('嗯，知道了。'), 'strict' /* no judge */)
  assert.equal(r.verdict, 'pass')
})

test('strict tier fails open when judge throws', async () => {
  const judge: JudgeCaller = async () => {
    throw new Error('judge provider 503')
  }
  const errors: unknown[] = []
  const outcome = await runPersonaGuardrail({
    result: speak('嗯，知道了。'),
    persona: makePersona(),
    strictness: 'strict',
    judge,
    onError: (e) => errors.push(e),
  })
  assert.equal(outcome.verdict, 'pass')
  assert.equal(outcome.reason, 'judge_call_failed_fallthrough')
  assert.equal(errors.length, 1)
})

test('strict tier: judge unknown verdict is treated as pass', async () => {
  // Defensive: if we ever extend the judge shape, an unrecognised
  // verdict should not silently reject valid output.
  const judge: JudgeCaller = async () => ({ verdict: 'unknown' })
  const r = await run(speak('嗯，知道了。'), 'strict', judge)
  assert.equal(r.verdict, 'pass')
})
