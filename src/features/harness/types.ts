/**
 * Harness core types.
 *
 * A harness wraps a non-deterministic step with evaluation, constraints,
 * and cross-round memory to drive convergence toward a quality threshold.
 */

export type HarnessDomain =
  | 'chat'
  | 'speech-input'
  | 'speech-output'
  | 'autonomy'

export type HarnessArtifact<T> = {
  value: T
  round: number
  candidateId: string
  producedAt: number
}

export type EvaluationScore = {
  /** Primary score used for convergence decisions (0–1 normalized). */
  overall: number
  /** Named sub-scores for transparency / debugging. */
  components: Record<string, number>
  /** True when anti-inflation penalty was applied to this score. */
  penaltyApplied: boolean
  /** True when score came from deterministic heuristics, not LLM. */
  deterministic: boolean
}

export type EvaluationFunction<T> = (
  artifact: HarnessArtifact<T>,
  history: EvaluationScore[],
) => EvaluationScore | Promise<EvaluationScore>

export type ConstraintCheck<T> = {
  key: string
  apply: (payload: T, candidateId: string) => T
}

export type ConstraintSet<T> = {
  domain: HarnessDomain
  checks: ConstraintCheck<T>[]
}

export type RoundMemoryEntry<T> = {
  round: number
  artifact: HarnessArtifact<T>
  score: EvaluationScore
  timestamp: number
}

export type HarnessMemory<T> = {
  entries: RoundMemoryEntry<T>[]
  maxRetention: number
}

export type ConvergenceVerdict =
  | { converged: true; reason: 'threshold_met' | 'score_plateau' | 'max_rounds' }
  | { converged: false }

export type ConvergenceConfig = {
  maxRounds: number
  /** Stop early if overall score >= this value (0-1). */
  scoreThreshold?: number
  plateauWindowSize: number
  plateauTolerance: number
  /** Minimum rounds before plateau/threshold checks apply. */
  minRounds?: number
}

export type HarnessEvent<T> =
  | { type: 'round_start'; round: number; candidateId: string }
  | { type: 'round_evaluated'; round: number; score: EvaluationScore }
  | { type: 'inflation_detected'; round: number; rawScore: number; adjustedScore: number }
  | { type: 'constraint_applied'; round: number; constraintKey: string; domain: HarnessDomain }
  | { type: 'convergence_check'; round: number; verdict: ConvergenceVerdict }
  | { type: 'completed'; artifact: HarnessArtifact<T>; totalRounds: number }
  | { type: 'exhausted'; reason: string }

export type HarnessCandidate<T> = {
  id: string
  identity: string
  payload: T
}

export type ExecuteWithHarnessOptions<TPayload, TResult> = {
  domain: HarnessDomain
  candidates: HarnessCandidate<TPayload>[]
  produce: (
    payload: TPayload,
    round: number,
    memory: HarnessMemory<TResult>,
  ) => Promise<TResult>
  evaluate: EvaluationFunction<TResult>
  constraints?: ConstraintSet<TPayload>[]
  convergence: ConvergenceConfig
  memoryRetention?: number
  onEvent?: (event: HarnessEvent<TResult>) => void
}

export type HarnessResult<T> = {
  artifact: HarnessArtifact<T>
  score: EvaluationScore
  totalRounds: number
  converged: boolean
  convergenceReason?: string
  memory: HarnessMemory<T>
}
