import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildM4StorageMigrationReport,
  DEFAULT_M4_STORAGE_MIGRATION_FILE,
  M4_STORAGE_MIGRATION_GATE,
  parseM4StorageMigrationArgs,
} from '../scripts/m4-storage-migration-audit.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

test('m4 storage migration args support inventory and migration gates', () => {
  assert.deepEqual(parseM4StorageMigrationArgs([
    '--generated-at=2026-06-18T11:00:00Z',
    '--output',
    'artifacts/v1/m4-storage-migration.json',
    '--sqlite-foundation-file',
    'artifacts/v1/m4-sqlite-foundation.json',
    '--require-inventory-ready',
    '--require-migration-ready',
  ]), {
    generatedAt: '2026-06-18T11:00:00Z',
    help: false,
    outputPath: 'artifacts/v1/m4-storage-migration.json',
    requireInventoryReady: true,
    requireMigrationReady: true,
    sqliteFoundationFile: 'artifacts/v1/m4-sqlite-foundation.json',
  })
})

test('m4 storage migration report inventories localStorage keys without user data', async () => {
  const report = await buildM4StorageMigrationReport({
    generatedAt: '2026-06-18T11:00:00Z',
    sqliteFoundationFile: 'artifacts/v1/m4-sqlite-foundation-missing-for-test.json',
  })
  const json = JSON.stringify(report)

  assert.equal(report.gate, M4_STORAGE_MIGRATION_GATE)
  assert.equal(report.generatedAt, '2026-06-18T11:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'inventory-ready-migration-not-started')
  assert.equal(report.inventoryReady, true)
  assert.equal(report.migrationReady, false)
  assert.ok(report.totals.uniqueStorageKeyCount >= 30)
  assert.ok(report.totals.directStorageAccessOutsideCoreCount > 0)
  assert.deepEqual(
    report.domainCoverage
      .filter((entry) => ['chat', 'memory', 'permissions-settings', 'audit-logs'].includes(entry.domain))
      .map((entry) => [entry.domain, entry.covered]),
    [
      ['chat', true],
      ['memory', true],
      ['permissions-settings', true],
      ['audit-logs', true],
    ],
  )
  assert.equal(report.sqliteDependency.status, 'not-selected')
  assert.equal(report.sqliteDependency.requiresDependencyReview, true)
  assert.equal(report.sqliteDependency.foundationReady, false)
  assert.equal(report.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(report.migrationPlan.sqliteFoundationReady, false)
  assert.equal(report.migrationPlan.localStorageSnapshotBackupReady, false)
  assert.equal(report.migrationPlan.localStorageStructuredCopyReady, false)
  assert.equal(report.migrationPlan.sourceLocalStoragePreservationRequired, true)
  assert.equal(report.migrationPlan.backupBeforeMutationRequired, true)
  assert.equal(report.migrationPlan.rollbackToolRequired, true)
  assert.equal(report.privacy.artifactContentsCopied, false)
  assert.equal(json.includes('private user chat sample'), false)
})

test('m4 storage migration report consumes SQLite foundation evidence', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-foundation-'))
  try {
    const foundationPath = path.join(directoryPath, 'm4-sqlite-foundation.json')
    await writeFile(foundationPath, JSON.stringify({
      gate: 'nexus-v1-m4-sqlite-foundation',
      ok: true,
      sqlite: {
        engine: 'node:sqlite',
      },
      database: {
        missingTables: [],
      },
      migrationPlan: {
        localStorageSnapshotBackupReady: true,
        localStorageStructuredCopyReady: true,
      },
      ipcStatus: {
        snapshotBackup: {
          ready: true,
        },
        structuredCopy: {
          ready: true,
        },
      },
    }), 'utf8')

    const report = await buildM4StorageMigrationReport({
      generatedAt: '2026-06-18T11:00:00Z',
      sqliteFoundationFile: foundationPath,
    })

    assert.equal(report.inventoryReady, true)
    assert.equal(report.migrationReady, false)
    assert.equal(report.sqliteDependency.status, 'selected-built-in')
    assert.deepEqual(report.sqliteDependency.selectedDependencies, ['node:sqlite'])
    assert.equal(report.sqliteDependency.requiresDependencyReview, false)
    assert.equal(report.sqliteDependency.foundationReady, true)
    assert.equal(report.migrationPlan.sqliteFoundationReady, true)
    assert.equal(report.migrationPlan.localStorageSnapshotBackupReady, true)
    assert.equal(report.migrationPlan.localStorageStructuredCopyReady, true)
    assert.deepEqual(report.nextActions, [
      'capture-chat-memory-local-storage-snapshot-backup-evidence',
      'capture-chat-memory-structured-copy-evidence',
      'implement-read-through-migration-with-localstorage-preservation',
      'add-backup-restore-and-rollback-fixtures',
    ])
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 storage migration strict migration mode blocks until real migration exists', async () => {
  const report = await buildM4StorageMigrationReport({
    generatedAt: '2026-06-18T11:00:00Z',
    requireMigrationReady: true,
  })

  assert.equal(report.ok, false)
  assert.equal(report.inventoryReady, true)
  assert.equal(report.migrationReady, false)
  assert.ok(report.blockingIssueIds.includes('sqlite-migration-not-implemented'))
  assert.deepEqual(report.requirementMode, {
    requireInventoryReady: false,
    requireMigrationReady: true,
  })
})

test('m4 storage migration CLI persists report and enforces inventory readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-'))
  try {
    const outputPath = path.join(directoryPath, 'm4-storage-migration.json')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m4-storage-migration-audit.mjs',
      '--generated-at',
      '2026-06-18T11:00:00Z',
      '--output',
      outputPath,
      '--require-inventory-ready',
    ], { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 8 })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, M4_STORAGE_MIGRATION_GATE)

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/m4-storage-migration-audit.mjs',
        '--require-migration-ready',
      ], { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 8 }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.ok(report.blockingIssueIds.includes('sqlite-migration-not-implemented'))
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 storage migration package wiring stays available', () => {
  assert.equal(packageJson.scripts?.['m4:storage:audit'], 'node scripts/m4-storage-migration-audit.mjs')
  assert.equal(packageJson.scripts?.['m4:sqlite:foundation'], 'node scripts/m4-sqlite-foundation-audit.mjs')
  assert.ok(packageJson.build?.files?.includes('scripts/m4-storage-migration-audit.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/m4-sqlite-foundation-audit.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-storage-migration-audit.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-sqlite-foundation-audit.mjs'))
  assert.equal(DEFAULT_M4_STORAGE_MIGRATION_FILE, 'artifacts/v1/m4-storage-migration.json')
})
