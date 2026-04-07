import type { EvaluationFunction, HarnessArtifact } from './types.ts'

export type AntiInflationConfig = {
  maxScoreStepPerRound: number
  /** Hard ceiling from deterministic heuristics. Return null to skip. */
  deterministicCeiling?: (artifact: HarnessArtifact<unknown>) => number | null
}

export function withAntiInflation<T>(
  evaluate: EvaluationFunction<T>,
  config: AntiInflationConfig,
): EvaluationFunction<T> {
  return async (artifact, history) => {
    const raw = await evaluate(artifact, history)
    let adjusted = raw.overall
    let penaltyApplied = false

    if (config.deterministicCeiling) {
      const ceiling = config.deterministicCeiling(artifact as HarnessArtifact<unknown>)
      if (ceiling !== null && adjusted > ceiling) {
        adjusted = ceiling
        penaltyApplied = true
      }
    }

    if (history.length > 0) {
      const previousBest = Math.max(...history.map((h) => h.overall))
      const maxAllowed = previousBest + config.maxScoreStepPerRound

      if (adjusted > maxAllowed) {
        adjusted = maxAllowed
        penaltyApplied = true
      }
    }

    adjusted = Math.max(0, Math.min(1, adjusted))

    return {
      ...raw,
      overall: adjusted,
      penaltyApplied: penaltyApplied || raw.penaltyApplied,
    }
  }
}

/** Returns 1.0 when the artifact value is truthy, 0.0 otherwise. */
export function createPassFailEvaluation<T>(): EvaluationFunction<T> {
  return (artifact) => ({
    overall: artifact.value ? 1 : 0,
    components: {},
    penaltyApplied: false,
    deterministic: true,
  })
}

/** Normalize a numeric scoring function to 0-1 using the provided min/max range. */
export function createNumericEvaluation<T>(
  score: (value: T) => number,
  range: { min: number; max: number },
): EvaluationFunction<T> {
  const span = range.max - range.min
  return (artifact) => {
    const raw = score(artifact.value)
    const normalized = span === 0 ? 0 : Math.max(0, Math.min(1, (raw - range.min) / span))
    return {
      overall: normalized,
      components: { raw },
      penaltyApplied: false,
      deterministic: true,
    }
  }
}
