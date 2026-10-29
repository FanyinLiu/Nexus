import { QWEN3_MEMORY_EMBEDDING_MODEL_ID } from './ollamaEmbedding.ts'

/**
 * Low-confidence recall rule, after MemX (arXiv 2603.16171, section 3.6):
 * when nothing in the store is about the query, return no long-term
 * memories instead of the four least-bad ones. MemX rejects when keyword
 * recall is empty and the best cosine is under a threshold. Chinese CJK
 * bigrams make keyword recall almost never empty ("我的", "什么" match
 * everything), so here the second signal is the margin between the best
 * and second-best cosine: a real match stands out from the rest, a miss is
 * a flat field of 0.35–0.45 neighbours.
 *
 * Two tiers, because for a companion a forgotten fact ("what do I do for
 * work?") hurts more than an irrelevant memory the model can ignore:
 *   none -> clearly nothing relevant: inject no long-term memories;
 *   low  -> borderline: keep them, but tell the model they may not fit
 *           and that "I don't remember" is an acceptable answer.
 *
 * When the margin cannot be trusted — a single memory, or duplicate copies
 * of one memory — the rule stops at 'low'. Suppressing there would silently
 * forget a fact for no better reason than a missing second opinion.
 *
 * Thresholds are per embedding model (cosine ranges differ by model) and
 * were picked on the tuning split tests/fixtures/memory-recall-zh/dataset.json
 * (41 answerable, 20 with no answer). The held-out split is never used to
 * pick them. A model without calibrated thresholds is never rejected.
 */

export type MemoryRecallConfidence = 'high' | 'low' | 'none'

type Thresholds = { rejectBelow: number; rejectMargin: number; lowBelow: number; lowMargin: number }

const THRESHOLDS: Record<string, Thresholds> = {
  // Tuned on the tuning split after the hybrid weights changed (41
  // answerable, 20 with no answer). The low band was widened from 0.47/0.07:
  // it flags one more no-answer query while keeping every answerable query
  // out of 'none'. Held-out is reported by memory-recall-benchmark, never used
  // to pick these.
  [QWEN3_MEMORY_EMBEDDING_MODEL_ID]: { rejectBelow: 0.40, rejectMargin: 0.045, lowBelow: 0.52, lowMargin: 0.10 },
}

export function getRecallConfidenceThresholds(model: string): Thresholds | null {
  return THRESHOLDS[model] ?? null
}

/**
 * Classify one recall by the raw cosine of every long-term memory. Duplicate
 * copies of the same memory should already be removed by the caller; exact
 * ties that remain are treated as one match rather than a flat field.
 */
export function classifyRecallConfidence(rawCosines: readonly number[], model: string): MemoryRecallConfidence | undefined {
  const thresholds = getRecallConfidenceThresholds(model)
  if (!thresholds) return undefined
  const sorted = rawCosines.filter((value) => Number.isFinite(value)).sort((a, b) => b - a)
  if (!sorted.length) return undefined
  const top = sorted[0]!
  const runnerUp = sorted[1]
  // No runner-up: no margin evidence. A weak single memory is flagged, never
  // suppressed — it may be the only place that fact lives.
  if (runnerUp === undefined) return top < thresholds.lowBelow ? 'low' : 'high'
  const margin = top - runnerUp
  // Exact ties are duplicate copies (or the same score twice). Treat them as
  // one match: a duplicate must not make a real fact look like a flat field.
  if (margin === 0) return top < thresholds.lowBelow ? 'low' : 'high'
  if (top < thresholds.rejectBelow && margin < thresholds.rejectMargin) return 'none'
  if (top < thresholds.lowBelow && margin < thresholds.lowMargin) return 'low'
  return 'high'
}
