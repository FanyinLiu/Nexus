import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveReminderCenterSummary } from '../src/features/reminders/reminderCenterView.ts'
import type { ReminderTask } from '../src/types'

function makeTask(input: Partial<ReminderTask> & Pick<ReminderTask, 'id'>): ReminderTask {
  return {
    id: input.id,
    title: input.title ?? input.id,
    prompt: input.prompt ?? input.id,
    action: input.action ?? { kind: 'notice' },
    enabled: input.enabled ?? true,
    createdAt: input.createdAt ?? '2026-05-08T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-05-08T00:00:00.000Z',
    schedule: input.schedule ?? { kind: 'at', at: '2026-05-09T00:00:00.000Z' },
    nextRunAt: input.nextRunAt,
    lastTriggeredAt: input.lastTriggeredAt,
    speechText: input.speechText,
  }
}

test('resolveReminderCenterSummary counts total and enabled tasks', () => {
  const summary = resolveReminderCenterSummary([
    makeTask({ id: 'enabled' }),
    makeTask({ id: 'disabled', enabled: false }),
  ])

  assert.equal(summary.totalCount, 2)
  assert.equal(summary.enabledCount, 1)
})

test('resolveReminderCenterSummary picks earliest enabled next run', () => {
  const summary = resolveReminderCenterSummary([
    makeTask({ id: 'later', nextRunAt: '2026-05-08T12:00:00.000Z' }),
    makeTask({ id: 'disabled-earlier', enabled: false, nextRunAt: '2026-05-08T08:00:00.000Z' }),
    makeTask({ id: 'earliest', nextRunAt: '2026-05-08T09:00:00.000Z' }),
  ])

  assert.equal(summary.nextTask?.id, 'earliest')
})

test('resolveReminderCenterSummary returns no next task when nothing is scheduled', () => {
  const summary = resolveReminderCenterSummary([
    makeTask({ id: 'missing-next' }),
    makeTask({ id: 'disabled', enabled: false, nextRunAt: '2026-05-08T09:00:00.000Z' }),
  ])

  assert.equal(summary.nextTask, undefined)
})
