import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildMemoryRecallEditEvidenceReport } from '../src/features/memory/recallEditEvidence.ts'
import type { MemoryItem } from '../src/types/index.ts'

const baseReflection: MemoryItem = {
  id: 'private-reflection-1',
  content: 'User protects night focus with review planning.',
  category: 'feedback',
  kind: 'relationship',
  source: 'dream',
  createdAt: '2026-06-16T09:00:00Z',
  importance: 'reflection',
  reflectionTopic: 'private-topic',
  reflectionConfidence: 0.82,
  sourceRef: 'arc:private-arc-1',
}

const unchangedMemories: MemoryItem[] = [
  {
    id: 'private-old-distractor',
    content: 'Planning archive item with no focus signal.',
    category: 'project',
    source: 'chat',
    createdAt: '2026-06-16T08:00:00Z',
  },
  {
    id: 'private-neutral-distractor',
    content: 'Morning archive placeholder.',
    category: 'profile',
    source: 'manual',
    createdAt: '2026-06-16T07:00:00Z',
  },
]

test('buildMemoryRecallEditEvidenceReport proves reflection edits affect recall without leaking content', () => {
  const beforeMemories = [baseReflection, ...unchangedMemories]
  const afterMemories = [
    {
      ...baseReflection,
      content: 'User restores morning energy through sunrise walks.',
      lastUsedAt: '2026-06-16T10:00:00Z',
    },
    ...unchangedMemories,
  ]

  const report = buildMemoryRecallEditEvidenceReport({
    beforeMemories,
    afterMemories,
    targetMemoryId: baseReflection.id,
    beforeQuery: 'night focus review planning',
    afterQuery: 'morning energy sunrise walks',
  }, '2026-06-16T11:00:00Z')
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))
  const json = JSON.stringify(report)

  assert.equal(report.gate, 'memory-recall-edit-effect')
  assert.equal(report.generatedAt, '2026-06-16T11:00:00.000Z')
  assert.equal(report.overallPass, true)
  assert.equal(report.target.presentBefore, true)
  assert.equal(report.target.presentAfter, true)
  assert.equal(report.target.reflectionBefore, true)
  assert.equal(report.target.reflectionAfter, true)
  assert.equal(report.target.contentChanged, true)
  assert.equal(report.target.metadataPreserved, true)
  assert.equal(report.ranking.beforeQueryBeforeEditRank, 1)
  assert.notEqual(report.ranking.beforeQueryAfterEditRank, 1)
  assert.notEqual(report.ranking.afterQueryBeforeEditRank, 1)
  assert.equal(report.ranking.afterQueryAfterEditRank, 1)
  assert.equal(report.ranking.beforeQuerySimilarityDelta < 0, true)
  assert.equal(report.ranking.afterQuerySimilarityDelta > 0, true)
  assert.equal(checks.get('edited-query-improves-target'), true)
  assert.equal(checks.get('edited-query-ranks-target'), true)
  assert.equal(checks.get('previous-query-deprioritizes-target'), true)
  assert.equal(
    /night|focus|review|planning|morning|energy|sunrise|walks|private-reflection|private-topic|private-arc/.test(json),
    false,
  )
})

test('buildMemoryRecallEditEvidenceReport keeps recall pause visible after an edit', () => {
  const beforeMemories = [baseReflection, ...unchangedMemories]
  const afterMemories = [
    {
      ...baseReflection,
      content: 'User restores morning energy through sunrise walks.',
      enabled: false,
      lastUsedAt: '2026-06-16T10:00:00Z',
    },
    ...unchangedMemories,
  ]

  const report = buildMemoryRecallEditEvidenceReport({
    beforeMemories,
    afterMemories,
    targetMemoryId: baseReflection.id,
    beforeQuery: 'night focus review planning',
    afterQuery: 'morning energy sunrise walks',
  }, 'bad-date')
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))

  assert.equal(report.target.enabledAfter, false)
  assert.equal(report.target.contentChanged, true)
  assert.equal(report.target.metadataPreserved, true)
  assert.equal(report.ranking.afterQueryAfterEditRank, null)
  assert.equal(checks.get('edited-query-ranks-target'), false)
  assert.equal(report.overallPass, false)
  assert.equal(Number.isFinite(Date.parse(report.generatedAt)), true)
})
