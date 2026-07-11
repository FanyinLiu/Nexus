import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  applyCompanionLocalDataMigration,
  compareCompanionLocalData,
  getCompanionLocalDataMigrationStatus,
  mirrorCompanionLocalDataDataset,
  normalizeCompanionDataset,
  planCompanionLocalDataMigration,
  readCompanionLocalData,
  rollbackCompanionLocalDataMigration,
} from '../electron/services/localDataCompanionMigration.js'

async function withTempUserData<T>(callback: (userDataPath: string) => Promise<T>): Promise<T> {
  const userDataPath = await mkdtemp(join(tmpdir(), 'nexus-companion-migration-'))
  try {
    return await callback(userDataPath)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
}

function createMigrationPackage() {
  return {
    schemaVersion: 1,
    createdAt: '2026-07-09T20:00:00.000Z',
    source: {
      relationshipKeysPresent: ['nexus:autonomy:relationship'],
      taskKeysPresent: ['nexus:plans'],
      invalidKeys: [],
    },
    relationship: [{
      id: 'relationship-state',
      storageKey: 'nexus:autonomy:relationship',
      value: { type: 'friend', trust: 0.8, history: ['hello'] },
    }],
    tasks: [{
      id: 'plans',
      storageKey: 'nexus:plans',
      value: [{ id: 'plan-1', title: 'Review settings', done: false }],
    }],
  } as const
}

test('companion migration plan is bounded, explicit, and rejects duplicate datasets', () => {
  const plan = planCompanionLocalDataMigration(createMigrationPackage())

  assert.equal(plan.ok, true)
  assert.equal(plan.relationshipDatasetCount, 1)
  assert.equal(plan.taskDatasetCount, 1)
  assert.equal(plan.totalRecordCount, 2)
  assert.equal(plan.requiresConfirmation, true)
  assert.equal(plan.writesData, true)

  const duplicate = createMigrationPackage()
  const invalidDuplicate = {
    ...duplicate,
    tasks: [{ ...duplicate.tasks[0], id: 'relationship-state', storageKey: 'nexus:autonomy:relationship' }],
  }
  assert.equal(planCompanionLocalDataMigration(invalidDuplicate).ok, false)

  assert.throws(
    () => normalizeCompanionDataset({
      storageKey: 'nexus:plans',
      value: Array.from({ length: 501 }, () => 'x'.repeat(4_000)),
    }),
    /size limit/,
  )
})

test('companion migration applies, reads back, mirrors updates, and rolls back', async () => {
  await withTempUserData(async (userDataPath) => {
    const migrationPackage = createMigrationPackage()
    const notConfirmed = await applyCompanionLocalDataMigration({ userDataPath, migrationPackage, confirmed: false })
    assert.equal(notConfirmed.ok, false)
    assert.equal(notConfirmed.errorKind, 'local-data-companion-migration-confirmation-required')

    const applied = await applyCompanionLocalDataMigration({
      userDataPath,
      migrationPackage,
      confirmed: true,
      now: new Date('2026-07-09T20:01:00.000Z'),
    })
    assert.equal(applied.ok, true)
    assert.equal(applied.applied, true)
    assert.equal(applied.recordsWritten, 2)
    assert.ok(applied.auditRecordId)

    const status = await getCompanionLocalDataMigrationStatus({ userDataPath })
    assert.equal(status.ok, true)
    assert.equal(status.relationshipDatasetCount, 1)
    assert.equal(status.taskDatasetCount, 1)
    assert.equal(status.totalRecordCount, 2)
    assert.equal(status.recordPayloadsIncluded, false)
    assert.equal(JSON.stringify(status).includes('Review settings'), false)

  const read = await readCompanionLocalData({ userDataPath })
    assert.equal(read.ok, true)
    assert.deepEqual(read.relationship[0].value, { type: 'friend', trust: 0.8, history: ['hello'] })
    assert.deepEqual(read.tasks[0].value, [{ id: 'plan-1', title: 'Review settings', done: false }])

    const comparison = await compareCompanionLocalData({
      userDataPath,
      confirmed: true,
      source: {
        schemaVersion: 1,
        generatedAt: '2026-07-09T20:01:30.000Z',
        relationship: [{ id: 'relationship-state', storageKey: 'nexus:autonomy:relationship', recordCount: 1, payloadBytes: JSON.stringify({ type: 'friend', trust: 0.8, history: ['hello'] }).length }],
        tasks: [{ id: 'plans', storageKey: 'nexus:plans', recordCount: 1, payloadBytes: JSON.stringify([{ id: 'plan-1', title: 'Review settings', done: false }]).length }],
      },
      now: new Date('2026-07-09T20:01:30.000Z'),
    })
    assert.equal(comparison.ok, true)
    assert.equal(comparison.status, 'aligned')
    assert.equal(comparison.matchedDatasetCount, 2)
    assert.equal(comparison.recordPayloadsIncluded, false)
    assert.equal(JSON.stringify(comparison).includes('Review settings'), false)

    const mirrored = await mirrorCompanionLocalDataDataset({
      userDataPath,
      confirmed: true,
      storageKey: 'nexus:plans',
      value: [{ id: 'plan-1', title: 'Review settings', done: true }],
      now: new Date('2026-07-09T20:02:00.000Z'),
    })
    assert.equal(mirrored.ok, true)
    assert.equal(mirrored.mirrored, true)

    const updated = await readCompanionLocalData({ userDataPath })
    assert.deepEqual(updated.tasks[0].value, [{ id: 'plan-1', title: 'Review settings', done: true }])

    const rolledBack = await rollbackCompanionLocalDataMigration({
      userDataPath,
      confirmed: true,
      now: new Date('2026-07-09T20:03:00.000Z'),
    })
    assert.equal(rolledBack.ok, true)
    assert.equal(rolledBack.recordsDeleted, 2)
    assert.ok(rolledBack.auditRecordId)

    const afterRollback = await getCompanionLocalDataMigrationStatus({ userDataPath })
    assert.equal(afterRollback.totalRecordCount, 0)
    assert.equal(afterRollback.lastAuditAction, 'companion-migration-rolled-back')
  })
})

test('companion dual-write remains aligned across a long deterministic update run', async () => {
  await withTempUserData(async (userDataPath) => {
    const migrationPackage = createMigrationPackage()
    const applied = await applyCompanionLocalDataMigration({
      userDataPath,
      migrationPackage,
      confirmed: true,
      now: new Date('2026-07-09T21:00:00.000Z'),
    })
    assert.equal(applied.ok, true)

    for (let index = 0; index < 240; index += 1) {
      const now = new Date(Date.parse('2026-07-09T21:00:00.000Z') + index * 1_000)
      const tasks = [{ id: 'plan-1', title: `Review settings ${index}`, done: index % 3 === 0 }]
      const mirrored = await mirrorCompanionLocalDataDataset({
        userDataPath,
        confirmed: true,
        storageKey: 'nexus:plans',
        value: tasks,
        now,
      })
      assert.equal(mirrored.ok, true)

      const comparison = await compareCompanionLocalData({
        userDataPath,
        confirmed: true,
        source: {
          schemaVersion: 1,
          generatedAt: now.toISOString(),
          relationship: [{
            id: 'relationship-state',
            storageKey: 'nexus:autonomy:relationship',
            recordCount: 1,
            payloadBytes: JSON.stringify(migrationPackage.relationship[0].value).length,
          }],
          tasks: [{
            id: 'plans',
            storageKey: 'nexus:plans',
            recordCount: 1,
            payloadBytes: JSON.stringify(tasks).length,
          }],
        },
        now,
      })
      assert.equal(comparison.ok, true)
      assert.equal(comparison.status, 'aligned')
      assert.equal(comparison.metadataMismatchCount, 0)
      assert.equal(comparison.missingSqliteDatasetCount, 0)
      assert.equal(comparison.extraSqliteDatasetCount, 0)
    }

    const finalRead = await readCompanionLocalData({ userDataPath })
    assert.equal(finalRead.ok, true)
    assert.deepEqual(finalRead.tasks[0].value, [{ id: 'plan-1', title: 'Review settings 239', done: false }])
    assert.equal(JSON.stringify(await getCompanionLocalDataMigrationStatus({ userDataPath })).includes('Review settings 239'), false)
  })
})
