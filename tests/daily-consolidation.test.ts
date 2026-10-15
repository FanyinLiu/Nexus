import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONSOLIDATION_IDLE_SECONDS,
  consolidateDailyMemory,
  decideDailyConsolidation,
} from '../src/features/memory/dailyConsolidation.ts'
import type { DailyMemoryEntry, MemoryItem } from '../src/types/memory.ts'

function atLocal(year: number, month: number, day: number, hour = 10): number {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime()
}

const NOW = atLocal(2026, 10, 15, 21)

function decide(patch: Partial<Parameters<typeof decideDailyConsolidation>[0]> = {}) {
  return decideDailyConsolidation({
    nowMs: NOW,
    lastRunAtMs: null,
    focusState: 'active',
    idleSeconds: 0,
    memoryPaused: false,
    chatBusy: false,
    launching: false,
    ...patch,
  })
}

test('idle, screen lock, and the first launch of the day can run consolidation', () => {
  assert.equal(decide({ focusState: 'idle', idleSeconds: CONSOLIDATION_IDLE_SECONDS }).trigger, 'idle')
  assert.equal(decide({ focusState: 'away', idleSeconds: 0 }).trigger, 'idle')
  assert.equal(decide({ focusState: 'locked', idleSeconds: 0 }).trigger, 'locked')
  assert.equal(decide({ launching: true }).trigger, 'first-launch')
})

test('consolidation waits while the user is active, chatting, paused, or already ran today', () => {
  assert.equal(decide({ focusState: 'active', idleSeconds: CONSOLIDATION_IDLE_SECONDS }).reason, 'waiting')
  assert.equal(decide({ focusState: 'idle', idleSeconds: CONSOLIDATION_IDLE_SECONDS - 1 }).reason, 'waiting')
  assert.equal(decide({ chatBusy: true, focusState: 'locked' }).reason, 'chatting')
  assert.equal(decide({ memoryPaused: true, launching: true }).reason, 'paused')
  assert.equal(decide({ lastRunAtMs: atLocal(2026, 10, 15, 8), focusState: 'locked' }).reason, 'already-ran')
  assert.equal(decide({ lastRunAtMs: atLocal(2026, 10, 14, 23), launching: true }).trigger, 'first-launch')
})

function diary(content: string, createdAt: string): DailyMemoryEntry {
  return {
    id: `daily-${content.length}`,
    day: '2026-10-15',
    role: 'user',
    content,
    source: 'chat',
    createdAt,
  }
}

test('a day pass without a model still records an open loop and can close it later', async () => {
  const createdAt = new Date(atLocal(2026, 10, 15, 10)).toISOString()
  const added = await consolidateDailyMemory({
    memories: [],
    diaryEntries: [diary("I'll send the report Friday", createdAt)],
    sinceMs: null,
    now: new Date(atLocal(2026, 10, 15, 21)).toISOString(),
  })
  assert.equal(added.decisionSource, 'fallback')
  assert.equal(added.fallbackReason, 'no-model')
  const loop = added.memories.find((memory) => memory.kind === 'open_loop')
  assert.ok(loop)
  assert.equal(loop.loopStatus, 'open')

  const closed = await consolidateDailyMemory({
    memories: added.memories,
    diaryEntries: [diary('I sent the report', new Date(atLocal(2026, 10, 16, 11)).toISOString())],
    sinceMs: atLocal(2026, 10, 15, 21),
    now: new Date(atLocal(2026, 10, 16, 12)).toISOString(),
  })
  assert.equal(closed.memories.find((memory) => memory.id === loop.id)?.loopStatus, 'done')
})

test('a missing or failing model never throws and leaves the store readable', async () => {
  const existing: MemoryItem[] = []
  const broken = await consolidateDailyMemory({
    memories: existing,
    diaryEntries: [diary("I'll send the report Friday", new Date(NOW).toISOString())],
    sinceMs: null,
    now: new Date(NOW).toISOString(),
    complete: async () => {
      throw new Error('model down')
    },
  })
  assert.equal(broken.decisionSource, 'fallback')
  assert.ok(broken.memories.some((memory) => memory.kind === 'open_loop'))

  const empty = await consolidateDailyMemory({
    memories: existing,
    diaryEntries: [{ ...diary('ok', new Date(NOW).toISOString()), role: 'assistant' }],
    sinceMs: null,
  })
  assert.deepEqual(empty.memories, [])
  assert.equal(empty.ops.length, 0)
})
