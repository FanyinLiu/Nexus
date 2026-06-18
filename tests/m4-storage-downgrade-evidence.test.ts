import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import packageJson from '../package.json' with { type: 'json' }
import {
  buildM4StorageDowngradeEvidenceReport,
  DEFAULT_M4_STORAGE_DOWNGRADE_EVIDENCE_FILE,
  M4_STORAGE_DOWNGRADE_EVIDENCE_GATE,
  parseM4StorageDowngradeEvidenceArgs,
} from '../scripts/m4-storage-downgrade-evidence.mjs'

const execFileAsync = promisify(execFile)
const PRIVATE_SENTINEL = 'M4_DOWNGRADE_TEST_PRIVATE_SENTINEL_DO_NOT_COPY'

test('m4 storage downgrade evidence args support sample, input, and readiness gates', () => {
  assert.deepEqual(parseM4StorageDowngradeEvidenceArgs([
    '--sample',
    '--generated-at=2026-06-18T12:55:00Z',
    '--output',
    'artifacts/v1/m4-storage-downgrade-evidence.json',
    '--database',
    'artifacts/v1/private.sqlite3',
    '--backup-directory',
    'artifacts/v1/backups',
    '--backup-id',
    'backup-test',
    '--copy-id',
    'copy-test',
    '--restore-id',
    'restore-test',
    '--downgrade-id',
    'downgrade-test',
    '--keep-private-artifacts',
    '--require-ready',
  ]), {
    backupDirectory: 'artifacts/v1/backups',
    backupId: 'backup-test',
    copyId: 'copy-test',
    databasePath: 'artifacts/v1/private.sqlite3',
    downgradeId: 'downgrade-test',
    generatedAt: '2026-06-18T12:55:00Z',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: true,
    outputPath: 'artifacts/v1/m4-storage-downgrade-evidence.json',
    requireReady: true,
    restoreId: 'restore-test',
    sample: true,
  })
})

test('m4 storage downgrade evidence sample downgrades schema without leaking values', async () => {
  const report = await buildM4StorageDowngradeEvidenceReport({
    sample: true,
  }, {
    now: '2026-06-18T12:55:00Z',
  })
  const json = JSON.stringify(report)

  assert.equal(report.gate, M4_STORAGE_DOWNGRADE_EVIDENCE_GATE)
  assert.equal(report.generatedAt, '2026-06-18T12:55:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'schema-downgrade-evidence-ready')
  assert.equal(report.input.entryCount, 3)
  assert.equal(report.backup.ok, true)
  assert.equal(report.copy.ok, true)
  assert.equal(report.copy.failedItemCount, 0)
  assert.equal(report.restore.ok, true)
  assert.equal(report.restore.hashesVerified, true)
  assert.equal(report.downgrade.ok, true)
  assert.equal(report.downgrade.fromSchemaVersion, 3)
  assert.equal(report.downgrade.targetSchemaVersion, 2)
  assert.equal(report.downgrade.remainingStructuredTableCount, 0)
  assert.equal(report.downgrade.databaseBackupFileNamePresent, true)
  assert.equal(report.downgrade.databaseBackupSha256Present, true)
  assert.equal(report.migrationPlan.schemaDowngradeEvidenceReady, true)
  assert.equal(report.migrationPlan.structuredCopyTablesRemoved, true)
  assert.equal(report.migrationPlan.restoreBundleReady, true)
  assert.equal(report.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(report.migrationPlan.readThroughMigrationEnabled, false)
  assert.equal(report.privacy.localStorageValuesCopiedToReport, false)
  assert.equal(report.privacy.absolutePathsExposed, false)
  assert.equal(report.privacy.sourceLocalStorageMutated, false)
  assert.equal(json.includes('M4_DOWNGRADE_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'), false)
})

test('m4 storage downgrade evidence CLI persists private-safe input report', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-downgrade-evidence-'))
  try {
    const inputPath = path.join(directoryPath, 'input.json')
    const outputPath = path.join(directoryPath, 'downgrade-evidence.json')
    const databasePath = path.join(directoryPath, 'private.sqlite3')
    const backupDirectory = path.join(directoryPath, 'backups')
    await writeFile(inputPath, JSON.stringify({
      evidenceSource: 'private-test-export',
      entries: [
        {
          key: 'nexus:chat',
          value: JSON.stringify([
            { id: 'downgrade-private-chat', role: 'user', content: `${PRIVATE_SENTINEL}: chat text` },
          ]),
        },
        {
          key: 'nexus:memory:long-term',
          value: JSON.stringify([
            { id: 'downgrade-private-memory', content: `${PRIVATE_SENTINEL}: memory text`, category: 'preference', source: 'chat' },
          ]),
        },
      ],
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m4-storage-downgrade-evidence.mjs',
      '--input',
      inputPath,
      '--database',
      databasePath,
      '--backup-directory',
      backupDirectory,
      '--backup-id',
      'downgrade-evidence-backup',
      '--copy-id',
      'downgrade-evidence-copy',
      '--restore-id',
      'downgrade-evidence-restore',
      '--downgrade-id',
      'downgrade-evidence-schema',
      '--generated-at',
      '2026-06-18T12:55:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], {
      cwd: process.cwd(),
    })

    const report = JSON.parse(stdout) as {
      ok?: boolean
      input?: { keys?: string[] }
      downgrade?: { targetSchemaVersion?: number; remainingStructuredTableCount?: number }
      privateArtifacts?: { persisted?: boolean; downgradeDatabaseBackupPathExposed?: boolean }
      privacy?: { localStorageValuesCopiedToReport?: boolean; absolutePathsExposed?: boolean }
    }
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    assert.deepEqual(fileReport, report)
    assert.equal(report.ok, true)
    assert.deepEqual(report.input?.keys, ['nexus:chat', 'nexus:memory:long-term'])
    assert.equal(report.downgrade?.targetSchemaVersion, 2)
    assert.equal(report.downgrade?.remainingStructuredTableCount, 0)
    assert.equal(report.privateArtifacts?.persisted, true)
    assert.equal(report.privateArtifacts?.downgradeDatabaseBackupPathExposed, false)
    assert.equal(report.privacy?.localStorageValuesCopiedToReport, false)
    assert.equal(report.privacy?.absolutePathsExposed, false)
    assert.equal(stdout.includes(PRIVATE_SENTINEL), false)
    assert.equal(stdout.includes(directoryPath), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 storage downgrade evidence package wiring stays available', () => {
  assert.equal(
    packageJson.scripts['m4:storage:downgrade:evidence'],
    'node scripts/m4-storage-downgrade-evidence.mjs',
  )
  assert.equal(
    DEFAULT_M4_STORAGE_DOWNGRADE_EVIDENCE_FILE,
    'artifacts/v1/m4-storage-downgrade-evidence.json',
  )
  assert.ok(packageJson.build?.files?.includes('scripts/m4-storage-downgrade-evidence.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-storage-downgrade-evidence.mjs'))
})
