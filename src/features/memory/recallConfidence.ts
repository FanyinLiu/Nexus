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
 * Thresholds are per embedding model (cosine ranges differ by model) and
 * were picked on tests/fixtures/memory-recall-zh (41 answerable, 20 with
 * no answer). A model without calibrated thresholds is never rejected.
 */

export type MemoryRecallConfidence = 'high' | 'low' | 'none'

type Thresholds = { rejectBelow: number; rejectMargin: number; lowBelow: number; lowMargin: number }

const THRESHOLDS: Record<string, Thresholds> = {
  [QWEN3_MEMORY_EMBEDDING_MODEL_ID]: { rejectBelow: 0.40, rejectMargin: 0.045, lowBelow: 0.47, lowMargin: 0.07 },
}

export function getRecallConfidenceThresholds(model: string): Thresholds | null {
  return THRESHOLDS[model] ?? null
}

export function classifyRecallConfidence(rawCosines: number[], model: string): MemoryRecallConfidence | undefined {
  const thresholds = getRecallConfidenceThresholds(model)
  if (!thresholds) return undefined
  const sorted = rawCosines.filter((value) => Number.isFinite(value)).sort((a, b) => b - a)
  if (!sorted.length) return undefined
  const top = sorted[0]
  const margin = top - (sorted[1] ?? 0)
  if (top < thresholds.rejectBelow && margin < thresholds.rejectMargin) return 'none'
  if (top < thresholds.lowBelow && margin < thresholds.lowMargin) return 'low'
  return 'high'
}
