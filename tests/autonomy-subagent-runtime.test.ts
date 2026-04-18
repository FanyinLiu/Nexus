import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSubagentRuntime } from '../src/features/autonomy/subagents/subagentRuntime.ts'
import type { SubagentSettings } from '../src/types/subagent.ts'

function makeSettings(overrides: Partial<SubagentSettings> = {}): SubagentSettings {
  return {
    enabled: true,
    maxConcurrent: 3,
    perTaskBudgetUsd: 0.1,
    dailyBudgetUsd: 1.0,
    modelOverride: '',
    ...overrides,
  }
}

test('runtime rejects admission when disabled', () => {
  const runtime = createSubagentRuntime({ settings: makeSettings({ enabled: false }) })
  const result = runtime.admitTask({ parentTurnId: 't1', task: 'x', purpose: 'y' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'disabled')
})

test('runtime admits and tracks tasks through the happy path', () => {
  const runtime = createSubagentRuntime({ settings: makeSettings() })
  const admit = runtime.admitTask({ parentTurnId: 't1', task: '查天气', purpose: 'user asked' })
  assert.equal(admit.ok, true)
  if (!admit.ok) return

  const id = admit.task.id
  assert.equal(admit.task.status, 'queued')
  assert.equal(runtime.activeCount(), 1)

  const started = runtime.startTask(id)
  assert.equal(started?.status, 'running')

  runtime.recordUsage(id, 100, 50, 0.01)
  const completed = runtime.completeTask(id, 'result summary')
  assert.equal(completed?.status, 'completed')
  assert.equal(completed?.resultSummary, 'result summary')
  assert.equal(runtime.activeCount(), 0)
  assert.ok((completed?.usage.costUsd ?? 0) >= 0.01)
})

test('runtime rejects when at concurrency cap', () => {
  const runtime = createSubagentRuntime({ settings: makeSettings({ maxConcurrent: 2 }) })
  runtime.admitTask({ parentTurnId: 't1', task: 'a', purpose: '' })
  runtime.admitTask({ parentTurnId: 't1', task: 'b', purpose: '' })
  const third = runtime.admitTask({ parentTurnId: 't1', task: 'c', purpose: '' })
  assert.equal(third.ok, false)
  if (!third.ok) assert.equal(third.reason, 'at_capacity')
})

test('runtime respects per-task budget', () => {
  const runtime = createSubagentRuntime({ settings: makeSettings({ perTaskBudgetUsd: 0.05 }) })
  const admit = runtime.admitTask({ parentTurnId: 't1', task: 'x', purpose: 'y' })
  assert.equal(admit.ok, true)
  if (!admit.ok) return
  const id = admit.task.id
  runtime.startTask(id)

  assert.equal(runtime.isOverPerTaskBudget(id), false)
  runtime.recordUsage(id, 0, 0, 0.04)
  assert.equal(runtime.isOverPerTaskBudget(id), false)
  runtime.recordUsage(id, 0, 0, 0.02)
  assert.equal(runtime.isOverPerTaskBudget(id), true)
})

test('runtime rejects when over daily budget', () => {
  const now = new Date('2026-04-19T10:00:00Z')
  const runtime = createSubagentRuntime({
    settings: makeSettings({ dailyBudgetUsd: 0.05 }),
    now: () => now,
  })
  const first = runtime.admitTask({ parentTurnId: 't1', task: 'a', purpose: '' })
  assert.equal(first.ok, true)
  if (!first.ok) return
  runtime.recordUsage(first.task.id, 0, 0, 0.1)

  const second = runtime.admitTask({ parentTurnId: 't1', task: 'b', purpose: '' })
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.reason, 'daily_budget_exceeded')
})

test('runtime onChange fires on every mutation', () => {
  const changes: number[] = []
  const runtime = createSubagentRuntime({
    settings: makeSettings(),
    onChange: (tasks) => changes.push(tasks.length),
  })
  const admit = runtime.admitTask({ parentTurnId: 't1', task: 'x', purpose: 'y' })
  if (!admit.ok) return
  runtime.startTask(admit.task.id)
  runtime.completeTask(admit.task.id, 'done')
  // admit + start + complete
  assert.equal(changes.length, 3)
})
