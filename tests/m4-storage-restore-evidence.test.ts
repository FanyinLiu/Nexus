import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import packageJson from '../package.json' with { type: 'json' }
import {
  buildM4StorageRestoreEvidenceReport,
  DEFAULT_M4_STORAGE_RESTORE_EVIDENCE_FILE,
  M4_STORAGE_RESTORE_EVIDENCE_GATE,
  parseM4StorageRestoreEvidenceArgs,
} from '../scripts/m4-storage-restore-evidence.mjs'

const execFileAsync = promisify(execFile)
const PRIVATE_SENTINEL = 'M4_RESTORE_TEST_PRIVATE_SENTINEL_DO_NOT_COPY'

test('m4 storage restore evidence args support sample, input, and readiness gates', () => {
  assert.deepEqual(parseM4StorageRestoreEvidenceArgs([
    '--sample',
    '--generated-at=2026-06-18T12:40:00Z',
    '--output',
    'artifacts/v1/m4-storage-restore-evidence.json',
    '--database',
    'artifacts/v1/private.sqlite3',
    '--backup-directory',
    'artifacts/v1/backups',
    '--backup-id',
    'backup-test',
    '--restore-id',
    'restore-test',
    '--keep-private-artifacts',
    '--require-ready',
  ]), {
    backupDirectory: 'artifacts/v1/backups',
    backupId: 'backup-test',
    databasePath: 'artifacts/v1/private.sqlite3',
    generatedAt: '2026-06-18T12:40:00Z',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: true,
    outputPath: 'artifacts/v1/m4-storage-restore-evidence.json',
    requireReady: true,
    restoreId: 'restore-test',
    sample: true,
  })
})

test('m4 storage restore evidence sample exports restore bundle without leaking values', async () => {
  const report = await buildM4StorageRestoreEvidenceReport({
    sample: true,
  }, {
    now: '2026-06-18T12:40:00Z',
  })
  const json = JSON.stringify(report)

  assert.equal(report.gate, M4_STORAGE_RESTORE_EVIDENCE_GATE)
  assert.equal(report.generatedAt, '2026-06-18T12:40:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'restore-evidence-ready')
  assert.equal(report.input.entryCount, 3)
  assert.equal(report.backup.ok, true)
  assert.equal(report.restore.ok, true)
  assert.equal(report.restore.entryCount, 3)
  assert.equal(report.restore.hashesVerified, true)
  assert.equal(report.restore.restoreBundleContainsValues, true)
  assert.equal(report.restore.sourceLocalStorageMutated, false)
  assert.equal(report.migrationPlan.restoreEvidenceReady, true)
  assert.equal(report.migrationPlan.rollbackFixtureReady, true)
  assert.equal(report.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(report.migrationPlan.readThroughMigrationEnabled, false)
  assert.equal(report.privacy.localStorageValuesCopiedToReport, false)
  assert.equal(report.privacy.absolutePathsExposed, false)
  assert.equal(report.privacy.sourceLocalStorageMutated, false)
  assert.equal(json.includes('M4_RESTORE_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'), false)
})

test('m4 storage restore evidence CLI persists private-safe input report', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-restore-evidence-'))
  try {
    const inputPath = path.join(directoryPath, 'input.json')
    const outputPath = path.join(directoryPath, 'restore-evidence.json')
    const databasePath = path.join(directoryPath, 'private.sqlite3')
    const backupDirectory = path.join(directoryPath, 'backups')
    await writeFile(inputPath, JSON.stringify({
      evidenceSource: 'private-test-export',
      entries: [
        {
          key: 'nexus:chat',
          value: JSON.stringify([
            { id: 'restore-private-chat', role: 'user', content: `${PRIVATE_SENTINEL}: chat text` },
          ]),
        },
        {
          key: 'nexus:memory:long-term',
          value: JSON.stringify([
            { id: 'restore-private-memory', content: `${PRIVATE_SENTINEL}: memory text`, category: 'preference', source: 'chat' },
          ]),
        },
      ],
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m4-storage-restore-evidence.mjs',
      '--input',
      inputPath,
      '--database',
      databasePath,
      '--backup-directory',
      backupDirectory,
      '--backup-id',
      'restore-evidence-backup',
      '--restore-id',
      'restore-evidence-restore',
      '--generated-at',
      '2026-06-18T12:40:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], {
      cwd: process.cwd(),
    })

    const report = JSON.parse(stdout) as {
      ok?: boolean
      input?: { keys?: string[] }
      restore?: { entryCount?: number; keys?: string[]; hashesVerified?: boolean }
      privateArtifacts?: { persisted?: boolean; restoreBundlePathExposed?: boolean }
      privacy?: { localStorageValuesCopiedToReport?: boolean; absolutePathsExposed?: boolean }
    }
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    assert.deepEqual(fileReport, report)
    assert.equal(report.ok, true)
    assert.deepEqual(report.input?.keys, ['nexus:chat', 'nexus:memory:long-term'])
    assert.equal(report.restore?.entryCount, 2)
    assert.deepEqual(report.restore?.keys, ['nexus:chat', 'nexus:memory:long-term'])
    assert.equal(report.restore?.hashesVerified, true)
    assert.equal(report.privateArtifacts?.persisted, true)
    assert.equal(report.privateArtifacts?.restoreBundlePathExposed, false)
    assert.equal(report.privacy?.localStorageValuesCopiedToReport, false)
    assert.equal(report.privacy?.absolutePathsExposed, false)
    assert.equal(stdout.includes(PRIVATE_SENTINEL), false)
    assert.equal(stdout.includes(directoryPath), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 storage restore evidence package wiring stays available', async () => {
  assert.equal(
    packageJson.scripts['m4:storage:restore:evidence'],
    'node scripts/m4-storage-restore-evidence.mjs',
  )
  assert.equal(
    DEFAULT_M4_STORAGE_RESTORE_EVIDENCE_FILE,
    'artifacts/v1/m4-storage-restore-evidence.json',
  )
})
