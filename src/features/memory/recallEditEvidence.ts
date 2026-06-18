import type { MemoryItem } from '../../types/index.ts'
import {
  normalizeText,
  rankMemories,
  scoreLexicalSimilarity,
} from './memory.ts'

export type MemoryRecallEditEvidenceCheckId =
  | 'target-present-before'
  | 'target-present-after'
  | 'target-is-reflection'
  | 'content-changed'
  | 'reflection-metadata-preserved'
  | 'edited-query-improves-target'
  | 'edited-query-ranks-target'
  | 'previous-query-deprioritizes-target'

export type MemoryRecallEditEvidenceCheck = {
  id: MemoryRecallEditEvidenceCheckId
  pass: boolean
  detail: string
}

export type MemoryRecallEditEvidenceReport = {
  schemaVersion: 1
  gate: 'memory-recall-edit-effect'
  generatedAt: string
  target: {
    presentBefore: boolean
    presentAfter: boolean
    reflectionBefore: boolean
    reflectionAfter: boolean
    enabledAfter: boolean | null
    contentChanged: boolean
    metadataPreserved: boolean
  }
  ranking: {
    beforeQueryBeforeEditRank: number | null
    beforeQueryAfterEditRank: number | null
    afterQueryBeforeEditRank: number | null
    afterQueryAfterEditRank: number | null
    beforeQuerySimilarityDelta: number
    afterQuerySimilarityDelta: number
  }
  overallPass: boolean
  checks: MemoryRecallEditEvidenceCheck[]
}

export type BuildMemoryRecallEditEvidenceReportInput = {
  beforeMemories: readonly MemoryItem[]
  afterMemories: readonly MemoryItem[]
  targetMemoryId: string
  beforeQuery: string
  afterQuery: string
}

function normalizeIso(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}

function findMemory(memories: readonly MemoryItem[], id: string): MemoryItem | null {
  return memories.find((memory) => memory.id === id) ?? null
}

function getRankSnapshot(
  memories: readonly MemoryItem[],
  targetMemoryId: string,
  query: string,
): { rank: number | null; similarity: number } {
  const target = findMemory(memories, targetMemoryId)
  const rankedIndex = rankMemories([...memories], query).findIndex((memory) => memory.id === targetMemoryId)

  return {
    rank: rankedIndex >= 0 ? rankedIndex + 1 : null,
    similarity: target ? roundScore(scoreLexicalSimilarity(target.content, query)) : 0,
  }
}

function sameOptionalNumber(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return Math.abs(left - right) < 0.000_001
}

function hasReflectionMetadataPreserved(before: MemoryItem | null, after: MemoryItem | null): boolean {
  if (!before || !after) return false
  return before.importance === after.importance
    && before.category === after.category
    && before.kind === after.kind
    && before.source === after.source
    && before.sourceRef === after.sourceRef
    && before.reflectionTopic === after.reflectionTopic
    && sameOptionalNumber(before.reflectionConfidence, after.reflectionConfidence)
}

function buildCheck(
  id: MemoryRecallEditEvidenceCheckId,
  pass: boolean,
  detail: string,
): MemoryRecallEditEvidenceCheck {
  return { id, pass, detail }
}

export function buildMemoryRecallEditEvidenceReport(
  input: BuildMemoryRecallEditEvidenceReportInput,
  generatedAt?: string,
): MemoryRecallEditEvidenceReport {
  const beforeTarget = findMemory(input.beforeMemories, input.targetMemoryId)
  const afterTarget = findMemory(input.afterMemories, input.targetMemoryId)
  const beforeQueryBeforeEdit = getRankSnapshot(input.beforeMemories, input.targetMemoryId, input.beforeQuery)
  const beforeQueryAfterEdit = getRankSnapshot(input.afterMemories, input.targetMemoryId, input.beforeQuery)
  const afterQueryBeforeEdit = getRankSnapshot(input.beforeMemories, input.targetMemoryId, input.afterQuery)
  const afterQueryAfterEdit = getRankSnapshot(input.afterMemories, input.targetMemoryId, input.afterQuery)
  const beforeQuerySimilarityDelta = roundScore(
    beforeQueryAfterEdit.similarity - beforeQueryBeforeEdit.similarity,
  )
  const afterQuerySimilarityDelta = roundScore(
    afterQueryAfterEdit.similarity - afterQueryBeforeEdit.similarity,
  )

  const contentChanged = Boolean(beforeTarget && afterTarget
    && normalizeText(beforeTarget.content) !== normalizeText(afterTarget.content))
  const reflectionBefore = beforeTarget?.importance === 'reflection'
  const reflectionAfter = afterTarget?.importance === 'reflection'
  const metadataPreserved = hasReflectionMetadataPreserved(beforeTarget, afterTarget)

  const checks: MemoryRecallEditEvidenceCheck[] = [
    buildCheck(
      'target-present-before',
      Boolean(beforeTarget),
      beforeTarget ? 'Target memory exists before edit.' : 'Target memory is missing before edit.',
    ),
    buildCheck(
      'target-present-after',
      Boolean(afterTarget),
      afterTarget ? 'Target memory exists after edit.' : 'Target memory is missing after edit.',
    ),
    buildCheck(
      'target-is-reflection',
      reflectionBefore && reflectionAfter,
      reflectionBefore && reflectionAfter
        ? 'Target remains a reflection memory.'
        : 'Target is not a reflection memory on both sides of the edit.',
    ),
    buildCheck(
      'content-changed',
      contentChanged,
      contentChanged ? 'Target content changed after edit.' : 'Target content did not change.',
    ),
    buildCheck(
      'reflection-metadata-preserved',
      metadataPreserved,
      metadataPreserved
        ? 'Reflection metadata stayed attached to the edited memory.'
        : 'Reflection metadata changed or could not be compared.',
    ),
    buildCheck(
      'edited-query-improves-target',
      afterQuerySimilarityDelta > 0,
      `${afterQuerySimilarityDelta} similarity delta for the edited query.`,
    ),
    buildCheck(
      'edited-query-ranks-target',
      afterTarget?.enabled !== false
        && afterQueryAfterEdit.rank === 1
        && afterQueryAfterEdit.similarity > 0,
      afterQueryAfterEdit.rank === null
        ? 'Edited target is not recallable for the edited query.'
        : `Edited target rank is ${afterQueryAfterEdit.rank} for the edited query.`,
    ),
    buildCheck(
      'previous-query-deprioritizes-target',
      beforeQuerySimilarityDelta < 0
        && beforeQueryBeforeEdit.rank === 1
        && (beforeQueryAfterEdit.rank === null || beforeQueryAfterEdit.rank > 1),
      beforeQueryAfterEdit.rank === null
        ? 'Previous query no longer recalls the edited target.'
        : `Previous-query target rank moved from ${beforeQueryBeforeEdit.rank ?? 'missing'} to ${beforeQueryAfterEdit.rank}.`,
    ),
  ]

  return {
    schemaVersion: 1,
    gate: 'memory-recall-edit-effect',
    generatedAt: normalizeIso(generatedAt),
    target: {
      presentBefore: Boolean(beforeTarget),
      presentAfter: Boolean(afterTarget),
      reflectionBefore,
      reflectionAfter,
      enabledAfter: afterTarget ? afterTarget.enabled !== false : null,
      contentChanged,
      metadataPreserved,
    },
    ranking: {
      beforeQueryBeforeEditRank: beforeQueryBeforeEdit.rank,
      beforeQueryAfterEditRank: beforeQueryAfterEdit.rank,
      afterQueryBeforeEditRank: afterQueryBeforeEdit.rank,
      afterQueryAfterEditRank: afterQueryAfterEdit.rank,
      beforeQuerySimilarityDelta,
      afterQuerySimilarityDelta,
    },
    overallPass: checks.every((check) => check.pass),
    checks,
  }
}
