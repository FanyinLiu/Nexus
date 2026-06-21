import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  countMemoryKinds,
  resolveMemorySettingsSummary,
  resolveMemoryTransparencySummary,
} from '../src/features/memory/memorySettingsView.ts'
import type { DailyMemoryEntry, MemoryItem } from '../src/types/memory.ts'

function memory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: overrides.id ?? 'memory-a',
    category: overrides.category ?? 'profile',
    content: overrides.content ?? 'memory',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    enabled: overrides.enabled,
    kind: overrides.kind,
    source: overrides.source ?? 'chat',
  }
}

const dailyEntry: DailyMemoryEntry = {
  id: 'daily-a',
  content: 'today',
  createdAt: '2026-01-01T00:00:00.000Z',
  day: '2026-01-01',
  role: 'user',
  source: 'chat',
}

test('countMemoryKinds counts enabled memories by user-facing layer', () => {
  const counts = countMemoryKinds([
    memory({ id: 'a', kind: 'preference' }),
    memory({ id: 'b', kind: 'relationship' }),
    memory({ id: 'c' }),
    memory({ id: 'd', kind: 'knowledge', enabled: false }),
  ])

  assert.equal(counts.preference, 1)
  assert.equal(counts.relationship, 1)
  assert.equal(counts.fact, 1)
  assert.equal(counts.knowledge, 0)
})

test('resolveMemorySettingsSummary keeps active, disabled and daily counts separate', () => {
  const summary = resolveMemorySettingsSummary({
    dailyEntries: [dailyEntry],
    memories: [
      memory({ id: 'a', kind: 'preference' }),
      memory({ id: 'b', kind: 'fact', enabled: false }),
      memory({ id: 'c', kind: 'relationship' }),
    ],
    searchMode: 'hybrid',
  })

  assert.equal(summary.activeLongTermCount, 2)
  assert.equal(summary.disabledLongTermCount, 1)
  assert.equal(summary.dailyEntryCount, 1)
  assert.equal(summary.kindCounts.preference, 1)
  assert.equal(summary.kindCounts.relationship, 1)
  assert.equal(summary.searchMode, 'hybrid')
})

test('resolveMemoryTransparencySummary reports active recall, capture and storage authority', () => {
  const summary = resolveMemoryTransparencySummary({
    activeWindowContextEnabled: true,
    clipboardContextEnabled: false,
    companionAwarenessPaused: false,
    contextAwarenessEnabled: true,
    dailyEntries: [dailyEntry],
    memories: [
      memory({ id: 'a', kind: 'preference' }),
      memory({ id: 'b', kind: 'fact', enabled: false }),
    ],
    memoryDailyRecallCount: 2,
    memoryLongTermRecallCount: 3,
    memoryPaused: false,
    memorySemanticRecallCount: 4,
    screenContextEnabled: false,
    searchMode: 'hybrid',
  })

  assert.equal(summary.memoryPaused, false)
  assert.equal(summary.automaticCaptureEnabled, true)
  assert.equal(summary.longTermRecallEnabled, true)
  assert.equal(summary.dailyRecallEnabled, true)
  assert.equal(summary.semanticRecallEnabled, true)
  assert.equal(summary.contextReadEnabled, true)
  assert.equal(summary.companionAwareness.status, 'watching_for_away_activity')
  assert.deepEqual(summary.companionAwareness.observes, ['active_window_class', 'coarse_elapsed_time'])
  assert.equal(summary.activeLongTermCount, 1)
  assert.equal(summary.disabledLongTermCount, 1)
  assert.equal(summary.storageAuthority, 'renderer-localStorage')
  assert.equal(summary.sqliteAuthorityEnabled, false)
})

test('resolveMemoryTransparencySummary makes pause state explicit without deleting counts', () => {
  const summary = resolveMemoryTransparencySummary({
    activeWindowContextEnabled: true,
    clipboardContextEnabled: true,
    companionAwarenessPaused: true,
    contextAwarenessEnabled: true,
    dailyEntries: [dailyEntry],
    memories: [memory({ id: 'a', kind: 'relationship' })],
    memoryDailyRecallCount: 4,
    memoryLongTermRecallCount: 4,
    memoryPaused: true,
    memorySemanticRecallCount: 4,
    screenContextEnabled: true,
    searchMode: 'vector',
  })

  assert.equal(summary.memoryPaused, true)
  assert.equal(summary.automaticCaptureEnabled, false)
  assert.equal(summary.longTermRecallEnabled, false)
  assert.equal(summary.dailyRecallEnabled, false)
  assert.equal(summary.semanticRecallEnabled, false)
  assert.equal(summary.contextReadEnabled, true)
  assert.equal(summary.companionAwareness.status, 'paused')
  assert.deepEqual(summary.companionAwareness.reachesModel, [])
  assert.equal(summary.activeLongTermCount, 1)
  assert.equal(summary.dailyEntryCount, 1)
})
