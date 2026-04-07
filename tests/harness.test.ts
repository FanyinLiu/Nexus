import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkConvergence, computeScoreTrend } from '../src/features/harness/convergence.ts'
import {
  withAntiInflation,
  createPassFailEvaluation,
  createNumericEvaluation,
} from '../src/features/harness/evaluation.ts'
import {
  createConstraintSet,
  applyConstraints,
  validateConstraintIsolation,
} from '../src/features/harness/constraints.ts'
import {
  createHarnessMemory,
  appendToMemory,
  bestEntry,
  scoreHistory,
} from '../src/features/harness/memory.ts'
import { executeWithHarness } from '../src/features/harness/executeWithHarness.ts'

import type {
  ConvergenceConfig,
  EvaluationScore,
  HarnessArtifact,
} from '../src/features/harness/types.ts'

// ── Helpers ──

function fakeScore(overall: number, deterministic = true): EvaluationScore {
  return { overall, components: {}, penaltyApplied: false, deterministic }
}

function fakeArtifact<T>(value: T, round = 1, candidateId = 'test'): HarnessArtifact<T> {
  return { value, round, candidateId, producedAt: Date.now() }
}

// ── Convergence ──

describe('checkConvergence', () => {
  const baseConfig: ConvergenceConfig = {
    maxRounds: 10,
    plateauWindowSize: 3,
    plateauTolerance: 0.02,
  }

  it('returns not converged when below minRounds', () => {
    const scores = [fakeScore(0.9)]
    const result = checkConvergence(scores, { ...baseConfig, minRounds: 2, scoreThreshold: 0.8 })
    assert.equal(result.converged, false)
  })

  it('converges when score threshold met', () => {
    const scores = [fakeScore(0.5), fakeScore(0.95)]
    const result = checkConvergence(scores, { ...baseConfig, scoreThreshold: 0.9 })
    assert.equal(result.converged, true)
    if (result.converged) assert.equal(result.reason, 'threshold_met')
  })

  it('converges on score plateau', () => {
    const scores = [fakeScore(0.7), fakeScore(0.71), fakeScore(0.705)]
    const result = checkConvergence(scores, baseConfig)
    assert.equal(result.converged, true)
    if (result.converged) assert.equal(result.reason, 'score_plateau')
  })

  it('does not converge when scores are improving', () => {
    const scores = [fakeScore(0.3), fakeScore(0.5), fakeScore(0.7)]
    const result = checkConvergence(scores, baseConfig)
    assert.equal(result.converged, false)
  })

  it('converges at max rounds', () => {
    const scores = Array.from({ length: 10 }, (_, i) => fakeScore(0.1 * i))
    const result = checkConvergence(scores, { ...baseConfig, maxRounds: 10 })
    assert.equal(result.converged, true)
    if (result.converged) assert.equal(result.reason, 'max_rounds')
  })
})

describe('computeScoreTrend', () => {
  it('detects improving trend', () => {
    const scores = [fakeScore(0.2), fakeScore(0.4), fakeScore(0.6), fakeScore(0.8)]
    const trend = computeScoreTrend(scores, 4)
    assert.equal(trend.improving, true)
    assert.equal(trend.stagnating, false)
  })

  it('detects stagnation', () => {
    const scores = [fakeScore(0.5), fakeScore(0.5), fakeScore(0.5)]
    const trend = computeScoreTrend(scores, 3)
    assert.equal(trend.stagnating, true)
    assert.equal(trend.improving, false)
  })

  it('handles single score as stagnating', () => {
    const trend = computeScoreTrend([fakeScore(0.5)], 3)
    assert.equal(trend.stagnating, true)
  })

  it('detects degrading trend', () => {
    const scores = [fakeScore(0.8), fakeScore(0.6), fakeScore(0.4), fakeScore(0.2)]
    const trend = computeScoreTrend(scores, 4)
    assert.equal(trend.improving, false)
    assert.equal(trend.stagnating, false)
    assert.ok(trend.slope < 0)
  })
})

// ── Evaluation ──

describe('withAntiInflation', () => {
  it('caps score improvement per round', async () => {
    const base = () => fakeScore(0.9)
    const wrapped = withAntiInflation(base, { maxScoreStepPerRound: 0.1 })

    const history = [fakeScore(0.3)]
    const result = await wrapped(fakeArtifact('test'), history)

    assert.equal(result.overall, 0.4) // 0.3 + 0.1 cap
    assert.equal(result.penaltyApplied, true)
  })

  it('applies deterministic ceiling', async () => {
    const base = () => fakeScore(0.8)
    const wrapped = withAntiInflation(base, {
      maxScoreStepPerRound: 1,
      deterministicCeiling: () => 0.5,
    })

    const result = await wrapped(fakeArtifact('test'), [])
    assert.equal(result.overall, 0.5)
    assert.equal(result.penaltyApplied, true)
  })

  it('skips ceiling when it returns null', async () => {
    const base = () => fakeScore(0.8)
    const wrapped = withAntiInflation(base, {
      maxScoreStepPerRound: 1,
      deterministicCeiling: () => null,
    })

    const result = await wrapped(fakeArtifact('test'), [])
    assert.equal(result.overall, 0.8)
    assert.equal(result.penaltyApplied, false)
  })
})

describe('createPassFailEvaluation', () => {
  it('returns 1 for truthy, 0 for falsy', () => {
    const evaluate = createPassFailEvaluation<string>()
    assert.equal(evaluate(fakeArtifact('hello'), []).overall, 1)
    assert.equal(evaluate(fakeArtifact(''), []).overall, 0)
  })
})

describe('createNumericEvaluation', () => {
  it('normalizes score to 0–1', () => {
    const evaluate = createNumericEvaluation<number>((v) => v, { min: 0, max: 100 })
    const result = evaluate(fakeArtifact(75), [])
    assert.equal(result.overall, 0.75)
    assert.equal((result.components as Record<string, number>).raw, 75)
  })

  it('clamps out-of-range values', () => {
    const evaluate = createNumericEvaluation<number>((v) => v, { min: 0, max: 10 })
    assert.equal(evaluate(fakeArtifact(15), []).overall, 1)
    assert.equal(evaluate(fakeArtifact(-5), []).overall, 0)
  })

  it('returns 0 when range span is zero', () => {
    const evaluate = createNumericEvaluation<number>((v) => v, { min: 5, max: 5 })
    assert.equal(evaluate(fakeArtifact(5), []).overall, 0)
  })
})

// ── Constraints ──

describe('applyConstraints', () => {
  type Payload = { voice: string; clonedVoiceId: string }

  it('applies matching domain constraints', () => {
    const set = createConstraintSet<Payload>('speech-output', [
      {
        key: 'clonedVoiceId',
        apply: (p, candidateId) =>
          candidateId === 'elevenlabs-tts' ? p : { ...p, clonedVoiceId: '' },
      },
    ])

    const result = applyConstraints(
      { voice: 'alice', clonedVoiceId: 'clone-123' },
      'minimax-tts',
      'speech-output',
      [set],
    )

    assert.equal(result.payload.clonedVoiceId, '')
    assert.deepEqual(result.applied, ['clonedVoiceId'])
  })

  it('preserves clonedVoiceId for elevenlabs', () => {
    const set = createConstraintSet<Payload>('speech-output', [
      {
        key: 'clonedVoiceId',
        apply: (p, candidateId) =>
          candidateId === 'elevenlabs-tts' ? p : { ...p, clonedVoiceId: '' },
      },
    ])

    const result = applyConstraints(
      { voice: 'alice', clonedVoiceId: 'clone-123' },
      'elevenlabs-tts',
      'speech-output',
      [set],
    )

    assert.equal(result.payload.clonedVoiceId, 'clone-123')
    assert.deepEqual(result.applied, [])
  })

  it('skips constraints from non-matching domains', () => {
    const set = createConstraintSet<Payload>('chat', [
      {
        key: 'clonedVoiceId',
        apply: (p) => ({ ...p, clonedVoiceId: 'SHOULD_NOT_APPLY' }),
      },
    ])

    const result = applyConstraints(
      { voice: 'alice', clonedVoiceId: 'original' },
      'minimax-tts',
      'speech-output',
      [set],
    )

    assert.equal(result.payload.clonedVoiceId, 'original')
    assert.deepEqual(result.applied, [])
  })
})

describe('validateConstraintIsolation', () => {
  it('detects cross-domain key prefixes', () => {
    const sets = [
      createConstraintSet<unknown>('speech-output', [
        { key: 'chat:temperature', apply: (p) => p },
      ]),
      createConstraintSet<unknown>('chat', [
        { key: 'chat:model', apply: (p) => p },
      ]),
    ]

    const violations = validateConstraintIsolation(sets)
    assert.equal(violations.length, 1)
    assert.equal(violations[0].key, 'chat:temperature')
    assert.equal(violations[0].declaredDomain, 'speech-output')
  })
})

// ── Memory ──

describe('memory', () => {
  it('appends entries and trims to maxRetention', () => {
    let mem = createHarnessMemory<string>(2)
    mem = appendToMemory(mem, fakeArtifact('a', 1), fakeScore(0.3))
    mem = appendToMemory(mem, fakeArtifact('b', 2), fakeScore(0.5))
    mem = appendToMemory(mem, fakeArtifact('c', 3), fakeScore(0.7))

    assert.equal(mem.entries.length, 2)
    assert.equal(mem.entries[0].artifact.value, 'b')
    assert.equal(mem.entries[1].artifact.value, 'c')
  })

  it('bestEntry returns highest scoring entry', () => {
    let mem = createHarnessMemory<string>(10)
    mem = appendToMemory(mem, fakeArtifact('low', 1), fakeScore(0.2))
    mem = appendToMemory(mem, fakeArtifact('high', 2), fakeScore(0.9))
    mem = appendToMemory(mem, fakeArtifact('mid', 3), fakeScore(0.5))

    const best = bestEntry(mem)
    assert.equal(best?.artifact.value, 'high')
  })

  it('scoreHistory extracts scores in order', () => {
    let mem = createHarnessMemory<string>(10)
    mem = appendToMemory(mem, fakeArtifact('a', 1), fakeScore(0.1))
    mem = appendToMemory(mem, fakeArtifact('b', 2), fakeScore(0.9))

    const history = scoreHistory(mem)
    assert.equal(history.length, 2)
    assert.equal(history[0].overall, 0.1)
    assert.equal(history[1].overall, 0.9)
  })
})

// ── executeWithHarness ──

describe('executeWithHarness', () => {
  it('converges when threshold is met on first round', async () => {
    const result = await executeWithHarness<{ n: number }, number>({
      domain: 'chat',
      candidates: [{ id: 'only', identity: 'only', payload: { n: 42 } }],
      produce: async (payload) => payload.n,
      evaluate: () => fakeScore(0.95),
      convergence: {
        maxRounds: 5,
        scoreThreshold: 0.9,
        plateauWindowSize: 3,
        plateauTolerance: 0.02,
      },
    })

    assert.equal(result.converged, true)
    assert.equal(result.convergenceReason, 'threshold_met')
    assert.equal(result.artifact.value, 42)
    assert.equal(result.totalRounds, 1)
  })

  it('iterates and converges on plateau', async () => {
    let callCount = 0
    const result = await executeWithHarness<null, number>({
      domain: 'speech-input',
      candidates: [{ id: 'a', identity: 'a', payload: null }],
      produce: async () => ++callCount,
      evaluate: (artifact) => fakeScore(0.5 + artifact.round * 0.005),
      convergence: {
        maxRounds: 10,
        plateauWindowSize: 3,
        plateauTolerance: 0.02,
      },
    })

    assert.equal(result.converged, true)
    assert.equal(result.convergenceReason, 'score_plateau')
    assert.ok(result.totalRounds >= 3)
  })

  it('falls back to next candidate on production failure', async () => {
    const result = await executeWithHarness<string, string>({
      domain: 'speech-output',
      candidates: [
        { id: 'fail', identity: 'fail', payload: 'bad' },
        { id: 'ok', identity: 'ok', payload: 'good' },
      ],
      produce: async (payload) => {
        if (payload === 'bad') throw new Error('boom')
        return payload
      },
      evaluate: () => fakeScore(1),
      convergence: {
        maxRounds: 1,
        plateauWindowSize: 2,
        plateauTolerance: 0.01,
        scoreThreshold: 0.9,
      },
    })

    assert.equal(result.artifact.value, 'good')
    assert.equal(result.artifact.candidateId, 'ok')
  })

  it('applies constraints to payload', async () => {
    type P = { voice: string; extra: string }

    const constraints = createConstraintSet<P>('speech-output', [
      {
        key: 'extra',
        apply: (p, id) => id === 'a' ? p : { ...p, extra: '' },
      },
    ])

    const payloads: P[] = []

    await executeWithHarness<P, string>({
      domain: 'speech-output',
      candidates: [
        { id: 'b', identity: 'b', payload: { voice: 'v', extra: 'should-clear' } },
      ],
      produce: async (payload) => {
        payloads.push(payload)
        return 'done'
      },
      evaluate: () => fakeScore(1),
      constraints: [constraints],
      convergence: {
        maxRounds: 1,
        scoreThreshold: 0.9,
        plateauWindowSize: 2,
        plateauTolerance: 0.01,
      },
    })

    assert.equal(payloads[0].extra, '')
    assert.equal(payloads[0].voice, 'v')
  })

  it('returns best artifact when exhausted without convergence', async () => {
    let round = 0
    const result = await executeWithHarness<null, number>({
      domain: 'autonomy',
      candidates: [{ id: 'x', identity: 'x', payload: null }],
      produce: async () => ++round,
      evaluate: (a) => fakeScore(a.value === 2 ? 0.8 : 0.3),
      convergence: {
        maxRounds: 3,
        plateauWindowSize: 4,
        plateauTolerance: 0.01,
      },
    })

    assert.equal(result.converged, true) // max_rounds triggers
    assert.equal(result.artifact.value, 2) // best score was round 2
  })

  it('emits events throughout execution', async () => {
    const events: string[] = []

    await executeWithHarness<null, string>({
      domain: 'chat',
      candidates: [{ id: 'c', identity: 'c', payload: null }],
      produce: async () => 'hi',
      evaluate: () => fakeScore(1),
      convergence: {
        maxRounds: 1,
        scoreThreshold: 0.9,
        plateauWindowSize: 2,
        plateauTolerance: 0.01,
      },
      onEvent: (e) => events.push(e.type),
    })

    assert.deepEqual(events, [
      'round_start',
      'round_evaluated',
      'convergence_check',
      'completed',
    ])
  })
})
