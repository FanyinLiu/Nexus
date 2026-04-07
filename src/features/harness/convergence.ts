import type { ConvergenceConfig, ConvergenceVerdict, EvaluationScore } from './types.ts'

export function checkConvergence(
  scores: EvaluationScore[],
  config: ConvergenceConfig,
): ConvergenceVerdict {
  const round = scores.length

  if (round < (config.minRounds ?? 1)) {
    return { converged: false }
  }

  const latest = scores[round - 1]
  if (
    config.scoreThreshold !== undefined
    && latest.overall >= config.scoreThreshold
  ) {
    return { converged: true, reason: 'threshold_met' }
  }

  if (round >= config.plateauWindowSize && config.plateauWindowSize >= 2) {
    const window = scores.slice(-config.plateauWindowSize)
    let isStagnant = true

    for (let i = 1; i < window.length; i += 1) {
      const delta = Math.abs(window[i].overall - window[i - 1].overall)
      if (delta > config.plateauTolerance) {
        isStagnant = false
        break
      }
    }

    if (isStagnant) {
      return { converged: true, reason: 'score_plateau' }
    }
  }

  if (round >= config.maxRounds) {
    return { converged: true, reason: 'max_rounds' }
  }

  return { converged: false }
}

/** Linear regression slope over the last `windowSize` scores. */
export function computeScoreTrend(
  scores: EvaluationScore[],
  windowSize: number,
): { slope: number; improving: boolean; stagnating: boolean } {
  const window = scores.slice(-Math.max(windowSize, 2))
  if (window.length < 2) {
    return { slope: 0, improving: false, stagnating: true }
  }

  // Simple linear regression: y = score, x = index
  const n = window.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0

  for (let i = 0; i < n; i += 1) {
    sumX += i
    sumY += window[i].overall
    sumXY += i * window[i].overall
    sumXX += i * i
  }

  const denominator = n * sumXX - sumX * sumX
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator

  return {
    slope,
    improving: slope > 0.01,
    stagnating: Math.abs(slope) <= 0.01,
  }
}
