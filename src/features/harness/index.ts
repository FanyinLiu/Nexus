export type {
  HarnessDomain,
  HarnessArtifact,
  EvaluationScore,
  EvaluationFunction,
  ConstraintCheck,
  ConstraintSet,
  RoundMemoryEntry,
  HarnessMemory,
  ConvergenceVerdict,
  ConvergenceConfig,
  HarnessEvent,
  HarnessCandidate,
  ExecuteWithHarnessOptions,
  HarnessResult,
} from './types.ts'

export type { AntiInflationConfig } from './evaluation.ts'

export { executeWithHarness } from './executeWithHarness.ts'
export { checkConvergence, computeScoreTrend } from './convergence.ts'
export { withAntiInflation, createPassFailEvaluation, createNumericEvaluation } from './evaluation.ts'
export { createConstraintSet, applyConstraints, validateConstraintIsolation } from './constraints.ts'
export {
  createHarnessMemory,
  appendToMemory,
  bestEntry,
  scoreHistory,
  persistHarnessSummary,
  loadPersistedSummary,
  clearPersistedSummary,
} from './memory.ts'
