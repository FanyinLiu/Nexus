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
    '--snapshot-copy-evidence-file',
    'artifacts/v1/m4-storage-snapshot-copy-evidence.json',
    '--restore-evidence-file',
    'artifacts/v1/m4-storage-restore-evidence.json',
    '--read-through-evidence-file',
    'artifacts/v1/m4-storage-read-through-evidence.json',
    '--downgrade-evidence-file',
    'artifacts/v1/m4-storage-downgrade-evidence.json',
    '--require-inventory-ready',
    '--require-migration-ready',
  ]), {
    downgradeEvidenceFile: 'artifacts/v1/m4-storage-downgrade-evidence.json',
    generatedAt: '2026-06-18T11:00:00Z',
    help: false,
    outputPath: 'artifacts/v1/m4-storage-migration.json',
    readThroughEvidenceFile: 'artifacts/v1/m4-storage-read-through-evidence.json',
    requireInventoryReady: true,
    requireMigrationReady: true,
    restoreEvidenceFile: 'artifacts/v1/m4-storage-restore-evidence.json',
    snapshotCopyEvidenceFile: 'artifacts/v1/m4-storage-snapshot-copy-evidence.json',
    sqliteFoundationFile: 'artifacts/v1/m4-sqlite-foundation.json',
  })
})

test('m4 storage migration report inventories localStorage keys without user data', async () => {
  const report = await buildM4StorageMigrationReport({
    generatedAt: '2026-06-18T11:00:00Z',
    sqliteFoundationFile: 'artifacts/v1/m4-sqlite-foundation-missing-for-test.json',
    snapshotCopyEvidenceFile: 'artifacts/v1/m4-storage-snapshot-copy-evidence-missing-for-test.json',
    restoreEvidenceFile: 'artifacts/v1/m4-storage-restore-evidence-missing-for-test.json',
    readThroughEvidenceFile: 'artifacts/v1/m4-storage-read-through-evidence-missing-for-test.json',
    downgradeEvidenceFile: 'artifacts/v1/m4-storage-downgrade-evidence-missing-for-test.json',
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
  assert.equal(report.migrationPlan.localStorageReadThroughPreviewIpcReady, false)
  assert.equal(report.migrationPlan.localStorageSnapshotCopyEvidenceReady, false)
  assert.equal(report.migrationPlan.localStorageRestoreEvidenceReady, false)
  assert.equal(report.migrationPlan.localStorageReadThroughEvidenceReady, false)
  assert.equal(report.migrationPlan.localStorageSchemaDowngradeEvidenceReady, false)
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
    const evidencePath = path.join(directoryPath, 'm4-storage-snapshot-copy-evidence.json')
    const restoreEvidencePath = path.join(directoryPath, 'm4-storage-restore-evidence.json')
    const readThroughEvidencePath = path.join(directoryPath, 'm4-storage-read-through-evidence.json')
    const downgradeEvidencePath = path.join(directoryPath, 'm4-storage-downgrade-evidence.json')
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
        localStorageReadThroughPreviewIpcReady: true,
      },
      ipcStatus: {
        snapshotBackup: {
          ready: true,
        },
        structuredCopy: {
          ready: true,
        },
        readThroughPreview: {
          ready: true,
        },
      },
    }), 'utf8')

    const report = await buildM4StorageMigrationReport({
      generatedAt: '2026-06-18T11:00:00Z',
      sqliteFoundationFile: foundationPath,
      snapshotCopyEvidenceFile: path.join(directoryPath, 'missing-evidence.json'),
      restoreEvidenceFile: path.join(directoryPath, 'missing-restore-evidence.json'),
      readThroughEvidenceFile: path.join(directoryPath, 'missing-read-through-evidence.json'),
      downgradeEvidenceFile: path.join(directoryPath, 'missing-downgrade-evidence.json'),
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
    assert.equal(report.migrationPlan.localStorageReadThroughPreviewIpcReady, true)
    assert.equal(report.migrationPlan.localStorageSnapshotCopyEvidenceReady, false)
    assert.equal(report.migrationPlan.localStorageRestoreEvidenceReady, false)
    assert.equal(report.migrationPlan.localStorageReadThroughEvidenceReady, false)
    assert.equal(report.migrationPlan.localStorageSchemaDowngradeEvidenceReady, false)
    assert.deepEqual(report.nextActions, [
      'capture-chat-memory-local-storage-snapshot-backup-evidence',
      'capture-chat-memory-structured-copy-evidence',
      'implement-read-through-migration-with-localstorage-preservation',
      'add-backup-restore-and-rollback-fixtures',
    ])

    await writeFile(evidencePath, JSON.stringify({
      gate: 'nexus-v1-m4-storage-snapshot-copy-evidence',
      ok: true,
      backup: {
        ok: true,
      },
      copy: {
        ok: true,
        copiedItemCount: 4,
        failedItemCount: 0,
      },
      migrationPlan: {
        snapshotBackupEvidenceReady: true,
        structuredCopyEvidenceReady: true,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        sourceLocalStoragePreserved: true,
      },
      privacy: {
        localStorageValuesCopiedToReport: false,
        absolutePathsExposed: false,
        sourceLocalStorageMutated: false,
      },
    }), 'utf8')
    const evidenceReadyReport = await buildM4StorageMigrationReport({
      generatedAt: '2026-06-18T11:00:00Z',
      sqliteFoundationFile: foundationPath,
      snapshotCopyEvidenceFile: evidencePath,
      restoreEvidenceFile: path.join(directoryPath, 'missing-restore-evidence.json'),
      readThroughEvidenceFile: path.join(directoryPath, 'missing-read-through-evidence.json'),
      downgradeEvidenceFile: path.join(directoryPath, 'missing-downgrade-evidence.json'),
    })
    assert.equal(evidenceReadyReport.migrationPlan.localStorageSnapshotCopyEvidenceReady, true)
    assert.equal(evidenceReadyReport.migrationPlan.localStorageReadThroughPreviewIpcReady, true)
    assert.equal(evidenceReadyReport.migrationPlan.localStorageRestoreEvidenceReady, false)
    assert.equal(evidenceReadyReport.migrationPlan.localStorageReadThroughEvidenceReady, false)
    assert.equal(evidenceReadyReport.migrationPlan.localStorageSchemaDowngradeEvidenceReady, false)
    assert.deepEqual(evidenceReadyReport.nextActions, [
      'capture-local-storage-restore-evidence',
      'implement-read-through-migration-with-localstorage-preservation',
      'add-backup-restore-and-rollback-fixtures',
    ])

    await writeFile(restoreEvidencePath, JSON.stringify({
      gate: 'nexus-v1-m4-storage-restore-evidence',
      ok: true,
      backup: {
        ok: true,
      },
      restore: {
        ok: true,
        entryCount: 4,
        hashesVerified: true,
      },
      migrationPlan: {
        restoreEvidenceReady: true,
        rollbackFixtureReady: true,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        sourceLocalStoragePreserved: true,
      },
      privacy: {
        localStorageValuesCopiedToReport: false,
        absolutePathsExposed: false,
        sourceLocalStorageMutated: false,
      },
    }), 'utf8')
    const restoreReadyReport = await buildM4StorageMigrationReport({
      generatedAt: '2026-06-18T11:00:00Z',
      sqliteFoundationFile: foundationPath,
      snapshotCopyEvidenceFile: evidencePath,
      restoreEvidenceFile: restoreEvidencePath,
      readThroughEvidenceFile: path.join(directoryPath, 'missing-read-through-evidence.json'),
      downgradeEvidenceFile: path.join(directoryPath, 'missing-downgrade-evidence.json'),
    })
    assert.equal(restoreReadyReport.migrationPlan.localStorageSnapshotCopyEvidenceReady, true)
    assert.equal(restoreReadyReport.migrationPlan.localStorageRestoreEvidenceReady, true)
    assert.equal(restoreReadyReport.migrationPlan.localStorageReadThroughPreviewIpcReady, true)
    assert.equal(restoreReadyReport.migrationPlan.localStorageReadThroughEvidenceReady, false)
    assert.equal(restoreReadyReport.migrationPlan.localStorageSchemaDowngradeEvidenceReady, false)
    assert.deepEqual(restoreReadyReport.nextActions, [
      'capture-main-process-read-through-evidence',
      'implement-read-through-migration-with-localstorage-preservation',
      'add-schema-downgrade-cli-fixtures',
    ])

    await writeFile(readThroughEvidencePath, JSON.stringify({
      gate: 'nexus-v1-m4-storage-read-through-evidence',
      ok: true,
      backup: {
        ok: true,
      },
      copy: {
        ok: true,
        copiedItemCount: 3,
        failedItemCount: 0,
      },
      readThrough: {
        ok: true,
        previewQueryEnabled: true,
        chatReadable: true,
        memoryReadable: true,
        readableRowCount: 4,
      },
      migrationPlan: {
        snapshotBackupEvidenceReady: true,
        structuredCopyEvidenceReady: true,
        readThroughPreviewEvidenceReady: true,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        previewQueryEnabled: true,
        sourceLocalStoragePreserved: true,
      },
      privacy: {
        localStorageValuesCopiedToReport: false,
        absolutePathsExposed: false,
        sourceLocalStorageMutated: false,
      },
    }), 'utf8')
    const readThroughReadyReport = await buildM4StorageMigrationReport({
      generatedAt: '2026-06-18T11:00:00Z',
      sqliteFoundationFile: foundationPath,
      snapshotCopyEvidenceFile: evidencePath,
      restoreEvidenceFile: restoreEvidencePath,
      readThroughEvidenceFile: readThroughEvidencePath,
      downgradeEvidenceFile: path.join(directoryPath, 'missing-downgrade-evidence.json'),
    })
    assert.equal(readThroughReadyReport.migrationPlan.localStorageSnapshotCopyEvidenceReady, true)
    assert.equal(readThroughReadyReport.migrationPlan.localStorageRestoreEvidenceReady, true)
    assert.equal(readThroughReadyReport.migrationPlan.localStorageReadThroughPreviewIpcReady, true)
    assert.equal(readThroughReadyReport.migrationPlan.localStorageReadThroughEvidenceReady, true)
    assert.equal(readThroughReadyReport.migrationPlan.localStorageSchemaDowngradeEvidenceReady, false)
    assert.deepEqual(readThroughReadyReport.nextActions, [
      'capture-schema-downgrade-evidence',
      'add-schema-downgrade-cli-fixtures',
    ])

    await writeFile(downgradeEvidencePath, JSON.stringify({
      gate: 'nexus-v1-m4-storage-downgrade-evidence',
      ok: true,
      backup: {
        ok: true,
      },
      copy: {
        ok: true,
        failedItemCount: 0,
      },
      restore: {
        ok: true,
        hashesVerified: true,
      },
      downgrade: {
        ok: true,
        fromSchemaVersion: 3,
        targetSchemaVersion: 2,
        remainingStructuredTableCount: 0,
        databaseBackupSha256Present: true,
        restoreBundleSha256Present: true,
      },
      migrationPlan: {
        schemaDowngradeEvidenceReady: true,
        structuredCopyTablesRemoved: true,
        restoreBundleReady: true,
        databaseBackupBeforeDowngradeCompleted: true,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        sourceLocalStoragePreserved: true,
      },
      privacy: {
        localStorageValuesCopiedToReport: false,
        absolutePathsExposed: false,
        sourceLocalStorageMutated: false,
      },
    }), 'utf8')
    const downgradeReadyReport = await buildM4StorageMigrationReport({
      generatedAt: '2026-06-18T11:00:00Z',
      sqliteFoundationFile: foundationPath,
      snapshotCopyEvidenceFile: evidencePath,
      restoreEvidenceFile: restoreEvidencePath,
      readThroughEvidenceFile: readThroughEvidencePath,
      downgradeEvidenceFile: downgradeEvidencePath,
    })
    assert.equal(downgradeReadyReport.migrationPlan.localStorageSchemaDowngradeEvidenceReady, true)
    assert.deepEqual(downgradeReadyReport.nextActions, [
      'wire-runtime-read-through-behind-user-confirmed-feature-flag',
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
    downgradeEvidenceFile: 'artifacts/v1/m4-storage-downgrade-evidence.json',
    requireInventoryReady: false,
    requireMigrationReady: true,
    readThroughEvidenceFile: 'artifacts/v1/m4-storage-read-through-evidence.json',
    restoreEvidenceFile: 'artifacts/v1/m4-storage-restore-evidence.json',
    snapshotCopyEvidenceFile: 'artifacts/v1/m4-storage-snapshot-copy-evidence.json',
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
  assert.equal(packageJson.scripts?.['m4:storage:restore:evidence'], 'node scripts/m4-storage-restore-evidence.mjs')
  assert.equal(packageJson.scripts?.['m4:storage:read-through:evidence'], 'node scripts/m4-storage-read-through-evidence.mjs')
  assert.equal(packageJson.scripts?.['m4:storage:downgrade:evidence'], 'node scripts/m4-storage-downgrade-evidence.mjs')
  assert.ok(packageJson.build?.files?.includes('scripts/m4-storage-migration-audit.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/m4-sqlite-foundation-audit.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/m4-storage-restore-evidence.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/m4-storage-read-through-evidence.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/m4-storage-downgrade-evidence.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-storage-migration-audit.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-sqlite-foundation-audit.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-storage-restore-evidence.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-storage-read-through-evidence.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-storage-downgrade-evidence.mjs'))
  assert.equal(DEFAULT_M4_STORAGE_MIGRATION_FILE, 'artifacts/v1/m4-storage-migration.json')
})
