import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  createReminderDeliveryLedger,
  REMINDER_DELIVERY_FILE_NAME,
  REMINDER_DELIVERY_MAX_PER_TASK,
  REMINDER_DELIVERY_RETENTION_MS,
} from '../electron/services/reminderDeliveryLedger.js'

const NOW = 1_700_000_000_000

async function createTempStore(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-reminder-ledger-'))
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })
  return path.join(directory, REMINDER_DELIVERY_FILE_NAME)
}

test('an occurrence is remembered across a ledger restart', async (t) => {
  const storePath = await createTempStore(t)
  const first = createReminderDeliveryLedger({ getStorePath: () => storePath, now: () => NOW })

  assert.equal(await first.has('task-1', NOW + 1_000), false)
  await first.record('task-1', NOW + 1_000)
  assert.equal(await first.has('task-1', NOW + 1_000), true)
  assert.equal(await first.has('task-1', NOW + 2_000), false, 'other occurrences stay open')
  assert.equal(await first.has('task-2', NOW + 1_000), false, 'other tasks stay open')

  const restarted = createReminderDeliveryLedger({ getStorePath: () => storePath, now: () => NOW })
  assert.equal(await restarted.has('task-1', NOW + 1_000), true)
  assert.equal(await restarted.has('task-1', NOW + 2_000), false)
})

test('expired occurrence keys are pruned on the next record', async (t) => {
  const storePath = await createTempStore(t)
  let now = NOW
  const ledger = createReminderDeliveryLedger({
    getStorePath: () => storePath,
    now: () => now,
    retentionMs: 1_000,
    maxPerTask: REMINDER_DELIVERY_MAX_PER_TASK,
  })

  await ledger.record('task-old', NOW)
  now += 1_001
  await ledger.record('task-new', now)

  const entries = await ledger.snapshot()
  assert.deepEqual(entries.map((entry) => entry.taskId), ['task-new'])
})

test('the per-task cap keeps only the newest occurrences', async (t) => {
  const storePath = await createTempStore(t)
  let now = NOW
  const ledger = createReminderDeliveryLedger({
    getStorePath: () => storePath,
    now: () => now,
    retentionMs: REMINDER_DELIVERY_RETENTION_MS,
    maxPerTask: 3,
  })

  for (let index = 0; index < 5; index += 1) {
    now += 1
    await ledger.record('task-cap', NOW + index)
  }

  const entries = await ledger.snapshot()
  assert.deepEqual(entries.map((entry) => entry.dueAt), [NOW + 2, NOW + 3, NOW + 4])
  assert.equal(await ledger.has('task-cap', NOW), false)
  assert.equal(await ledger.has('task-cap', NOW + 4), true)
})

test('the default retention constant is seven days', () => {
  assert.equal(REMINDER_DELIVERY_RETENTION_MS, 7 * 24 * 60 * 60 * 1000)
  assert.equal(REMINDER_DELIVERY_MAX_PER_TASK, 50)
})
