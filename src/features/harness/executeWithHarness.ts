import type {
  ExecuteWithHarnessOptions,
  HarnessArtifact,
  HarnessResult,
} from './types.ts'
import { applyConstraints } from './constraints.ts'
import { checkConvergence } from './convergence.ts'
import { appendToMemory, bestEntry, createHarnessMemory, scoreHistory } from './memory.ts'

export async function executeWithHarness<TPayload, TResult>(
  options: ExecuteWithHarnessOptions<TPayload, TResult>,
): Promise<HarnessResult<TResult>> {
  const {
    domain,
    candidates,
    produce,
    evaluate,
    constraints = [],
    convergence,
    memoryRetention = convergence.maxRounds,
    onEvent,
  } = options

  let memory = createHarnessMemory<TResult>(memoryRetention)
  let round = 0

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < convergence.maxRounds; attempt += 1) {
      round += 1

      onEvent?.({ type: 'round_start', round, candidateId: candidate.id })

      const constrained = applyConstraints(
        candidate.payload,
        candidate.id,
        domain,
        constraints,
      )

      for (const key of constrained.applied) {
        onEvent?.({ type: 'constraint_applied', round, constraintKey: key, domain })
      }

      let artifact: HarnessArtifact<TResult>
      try {
        const value = await produce(constrained.payload, round, memory)
        artifact = {
          value,
          round,
          candidateId: candidate.id,
          producedAt: Date.now(),
        }
      } catch (error) {
        // Production failure — try next candidate (if any)
        onEvent?.({
          type: 'exhausted',
          reason: error instanceof Error ? error.message : String(error),
        })
        break
      }

      const scores = scoreHistory(memory)
      const score = await evaluate(artifact, scores)

      onEvent?.({ type: 'round_evaluated', round, score })

      memory = appendToMemory(memory, artifact, score)

      const verdict = checkConvergence(scoreHistory(memory), convergence)
      onEvent?.({ type: 'convergence_check', round, verdict })

      if (verdict.converged) {
        const best = bestEntry(memory)!
        onEvent?.({ type: 'completed', artifact: best.artifact, totalRounds: round })

        return {
          artifact: best.artifact,
          score: best.score,
          totalRounds: round,
          converged: true,
          convergenceReason: verdict.reason,
          memory,
        }
      }
    }
  }

  // All candidates exhausted without convergence — return best so far
  const best = bestEntry(memory)
  if (best) {
    return {
      artifact: best.artifact,
      score: best.score,
      totalRounds: round,
      converged: false,
      memory,
    }
  }

  throw new Error(`[harness:${domain}] All candidates exhausted without producing a valid result.`)
}
