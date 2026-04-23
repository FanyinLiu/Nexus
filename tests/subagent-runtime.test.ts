import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSubagentRuntime } from '../src/features/autonomy/subagents/subagentRuntime.ts'
import {
  SUBAGENT_DEFAULTS,
  type SubagentSettings,
} from '../src/types/subagent.ts'

function freshSettings(overrides: Partial<SubagentSettings> = {}): SubagentSettings {
  return { ...SUBAGENT_DEFAULTS, enabled: true, ...overrides }
}

test('admitTask is rejected when the dispatcher is disabled', () => {
  const runtime = createSubagentRuntime({
    settings: freshSettings({ enabled: false }),
  })
  const result = runtime.admitTask({ parentTurnId: 't1', task: 'anything', purpose: 'anything' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'disabled')
})

test('admitTask enforces concurrency cap (3 by default)', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings() })
  for (let i = 0; i < 3; i += 1) {
    const ok = runtime.admitTask({ parentTurnId: 't', task: `task-${i}`, purpose: 'p' })
    assert.equal(ok.ok, true)
  }
  const blocked = runtime.admitTask({ parentTurnId: 't', task: 'task-4', purpose: 'p' })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.equal(blocked.reason, 'at_capacity')
})

test('completed tasks free up capacity for new admissions', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings() })
  const ids: string[] = []
  for (let i = 0; i < 3; i += 1) {
    const res = runtime.admitTask({ parentTurnId: 't', task: `task-${i}`, purpose: 'p' })
    if (res.ok) ids.push(res.task.id)
  }
  assert.equal(runtime.activeCount(), 3)
  runtime.completeTask(ids[0], 'done')
  assert.equal(runtime.activeCount(), 2)
  const next = runtime.admitTask({ parentTurnId: 't', task: 'task-4', purpose: 'p' })
  assert.equal(next.ok, true)
})

test('admitTask rejects when the daily budget is already exhausted', () => {
  const runtime = createSubagentRuntime({
    settings: freshSettings({ dailyBudgetUsd: 0.50 }),
  })
  const first = runtime.admitTask({ parentTurnId: 't', task: 'a', purpose: 'p' })
  if (!first.ok) throw new Error('initial admit should succeed')
  runtime.startTask(first.task.id)
  runtime.recordUsage(first.task.id, 1000, 500, 0.50)
  runtime.completeTask(first.task.id, 'done')

  const next = runtime.admitTask({ parentTurnId: 't', task: 'b', purpose: 'p' })
  assert.equal(next.ok, false)
  if (!next.ok) assert.equal(next.reason, 'daily_budget_exceeded')
})

test('isOverPerTaskBudget flags a runaway task', () => {
  const runtime = createSubagentRuntime({
    settings: freshSettings({ perTaskBudgetUsd: 0.05 }),
  })
  const res = runtime.admitTask({ parentTurnId: 't', task: 'a', purpose: 'p' })
  if (!res.ok) throw new Error('admit should succeed')
  runtime.startTask(res.task.id)
  assert.equal(runtime.isOverPerTaskBudget(res.task.id), false)
  runtime.recordUsage(res.task.id, 2000, 500, 0.05)
  assert.equal(runtime.isOverPerTaskBudget(res.task.id), true)
})

test('onChange fires after each mutation with a fresh snapshot', () => {
  const snapshots: number[] = []
  const runtime = createSubagentRuntime({
    settings: freshSettings(),
    onChange: (tasks) => snapshots.push(tasks.length),
  })
  runtime.admitTask({ parentTurnId: 't', task: 'a', purpose: 'p' })
  runtime.admitTask({ parentTurnId: 't', task: 'b', purpose: 'p' })
  assert.deepEqual(snapshots, [1, 2])
})

test('updateSettings tightens the cap on subsequent admissions', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings() })
  // Initial 3-way cap fills up.
  for (let i = 0; i < 3; i += 1) {
    runtime.admitTask({ parentTurnId: 't', task: `${i}`, purpose: 'p' })
  }
  runtime.updateSettings(freshSettings({ maxConcurrent: 1 }))
  // Already admitted tasks aren't kicked; but new ones still rejected.
  const next = runtime.admitTask({ parentTurnId: 't', task: 'tightened', purpose: 'p' })
  assert.equal(next.ok, false)
})

test('concurrency cap is clamped to the hard ceiling of 3', () => {
  const runtime = createSubagentRuntime({
    settings: freshSettings({ maxConcurrent: 99 }),
  })
  // The runtime should clamp to 3 regardless of user-supplied value.
  for (let i = 0; i < 3; i += 1) {
    const res = runtime.admitTask({ parentTurnId: 't', task: `${i}`, purpose: 'p' })
    assert.equal(res.ok, true)
  }
  const overflow = runtime.admitTask({ parentTurnId: 't', task: 'overflow', purpose: 'p' })
  assert.equal(overflow.ok, false)
})

// ── cancelTask ──────────────────────────────────────────────────────────────

test('cancelTask moves a queued task to cancelled with a default reason', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings() })
  const admit = runtime.admitTask({ parentTurnId: 't', task: 'research X', purpose: 'p' })
  assert.equal(admit.ok, true)
  if (!admit.ok) return

  const result = runtime.cancelTask(admit.task.id)
  assert.ok(result, 'expected cancelTask to return the updated task')
  assert.equal(result!.status, 'cancelled')
  assert.equal(result!.failureReason, 'cancelled by user')
  assert.ok(result!.finishedAt, 'finishedAt should be set')
})

test('cancelTask honours an explicit reason string', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings() })
  const admit = runtime.admitTask({ parentTurnId: 't', task: 'a', purpose: 'p' })
  if (!admit.ok) throw new Error('admit failed')
  runtime.startTask(admit.task.id)

  const result = runtime.cancelTask(admit.task.id, 'budget exceeded by user')
  assert.equal(result!.failureReason, 'budget exceeded by user')
})

test('cancelTask frees up concurrency capacity', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings({ maxConcurrent: 1 }) })
  const first = runtime.admitTask({ parentTurnId: 't', task: 'a', purpose: 'p' })
  assert.equal(first.ok, true)
  if (!first.ok) return

  const blocked = runtime.admitTask({ parentTurnId: 't', task: 'b', purpose: 'p' })
  assert.equal(blocked.ok, false)

  runtime.cancelTask(first.task.id)
  const retry = runtime.admitTask({ parentTurnId: 't', task: 'c', purpose: 'p' })
  assert.equal(retry.ok, true)
})

test('cancelTask is a no-op on already-completed tasks', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings() })
  const admit = runtime.admitTask({ parentTurnId: 't', task: 'a', purpose: 'p' })
  if (!admit.ok) throw new Error('admit failed')
  runtime.startTask(admit.task.id)
  runtime.completeTask(admit.task.id, 'done')

  const result = runtime.cancelTask(admit.task.id)
  assert.equal(result!.status, 'completed', 'completed task must not become cancelled')
})

test('cancelTask is a no-op on a previously failed task (preserves failureReason)', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings() })
  const admit = runtime.admitTask({ parentTurnId: 't', task: 'a', purpose: 'p' })
  if (!admit.ok) throw new Error('admit failed')
  runtime.startTask(admit.task.id)
  runtime.failTask(admit.task.id, 'LLM timed out')

  const result = runtime.cancelTask(admit.task.id, 'user pressed cancel')
  assert.equal(result!.status, 'failed')
  assert.equal(result!.failureReason, 'LLM timed out')
})

test('cancelTask returns null for an unknown id', () => {
  const runtime = createSubagentRuntime({ settings: freshSettings() })
  assert.equal(runtime.cancelTask('does-not-exist'), null)
})
