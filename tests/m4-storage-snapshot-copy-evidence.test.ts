import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildM4StorageSnapshotCopyEvidenceReport,
  DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE,
  M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_GATE,
  parseM4StorageSnapshotCopyEvidenceArgs,
} from '../scripts/m4-storage-snapshot-copy-evidence.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const PRIVATE_SENTINEL = 'M4_PRIVATE_EVIDENCE_SENTINEL_DO_NOT_COPY'

function privateInputPayload(generatedAt = '2026-06-18T15:00:00Z') {
  return {
    evidenceSource: 'test-renderer-export',
    entries: [
      {
        key: 'nexus:chat',
        value: JSON.stringify([
          {
            id: 'test-flat-user',
            role: 'user',
            content: `${PRIVATE_SENTINEL}: flat chat`,
            createdAt: generatedAt,
          },
        ]),
      },
      {
        key: 'nexus:memory:long-term',
        value: JSON.stringify([
          {
            id: 'test-memory',
            content: `${PRIVATE_SENTINEL}: long memory`,
            category: 'preference',
            source: 'chat',
            createdAt: generatedAt,
          },
        ]),
      },
      {
        key: 'nexus:memory:daily',
        value: JSON.stringify({
          [generatedAt.slice(0, 10)]: [
            {
              id: 'test-daily',
              role: 'user',
              content: `${PRIVATE_SENTINEL}: daily memory`,
              source: 'chat',
              createdAt: generatedAt,
            },
          ],
        }),
      },
    ],
  }
}

test('m4 storage snapshot copy evidence args support sample, input, and readiness gates', () => {
  assert.deepEqual(parseM4StorageSnapshotCopyEvidenceArgs([
    '--sample',
    '--generated-at=2026-06-18T15:00:00Z',
    '--output',
    'artifacts/v1/m4-storage-snapshot-copy-evidence.json',
    '--database',
    'artifacts/v1/private.sqlite3',
    '--backup-directory',
    'artifacts/v1/private-backups',
    '--backup-id',
    'backup-test',
    '--copy-id',
    'copy-test',
    '--keep-private-artifacts',
    '--require-ready',
  ]), {
    backupDirectory: 'artifacts/v1/private-backups',
    backupId: 'backup-test',
    copyId: 'copy-test',
    databasePath: 'artifacts/v1/private.sqlite3',
    generatedAt: '2026-06-18T15:00:00Z',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: true,
    outputPath: 'artifacts/v1/m4-storage-snapshot-copy-evidence.json',
    requireReady: true,
    sample: true,
  })

  assert.deepEqual(parseM4StorageSnapshotCopyEvidenceArgs([
    '--json',
    'local-storage-export.json',
  ]), {
    backupDirectory: '',
    backupId: '',
    copyId: '',
    databasePath: '',
    generatedAt: '',
    help: false,
    inputPath: 'local-storage-export.json',
    keepPrivateArtifacts: false,
    outputPath: DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE,
    requireReady: false,
    sample: false,
  })
})

test('m4 storage snapshot copy evidence sample runs backup and structured copy without leaking values', async () => {
  const report = await buildM4StorageSnapshotCopyEvidenceReport({
    sample: true,
    generatedAt: '2026-06-18T15:00:00Z',
    backupId: 'sample-backup-test',
    copyId: 'sample-copy-test',
  })
  const json = JSON.stringify(report)

  assert.equal(report.gate, M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_GATE)
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'snapshot-copy-evidence-ready')
  assert.equal(report.input.sample, true)
  assert.equal(report.input.entryCount, 5)
  assert.equal(report.backup.ok, true)
  assert.equal(report.backup.sourceLocalStoragePreserved, true)
  assert.equal(report.copy.ok, true)
  assert.equal(report.copy.copiedItemCount, 4)
  assert.equal(report.copy.skippedItemCount, 1)
  assert.deepEqual(report.copy.skippedKeys, ['nexus:autonomy:relationship'])
  assert.equal(report.copy.chatSessionCount, 2)
  assert.equal(report.copy.chatMessageCount, 3)
  assert.equal(report.copy.memoryCount, 1)
  assert.equal(report.copy.dailyMemoryEntryCount, 1)
  assert.equal(report.database.counts.localStorageCopyItems, 5)
  assert.equal(report.migrationPlan.snapshotBackupEvidenceReady, true)
  assert.equal(report.migrationPlan.structuredCopyEvidenceReady, true)
  assert.equal(report.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(report.migrationPlan.readThroughMigrationEnabled, false)
  assert.equal(report.privacy.localStorageValuesCopiedToReport, false)
  assert.equal(report.privacy.absolutePathsExposed, false)
  assert.equal(report.privacy.sourceLocalStorageMutated, false)
  assert.equal(json.includes('M4_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'), false)
})

test('m4 storage snapshot copy evidence CLI persists private-safe input report', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-copy-evidence-'))
  try {
    const inputPath = path.join(directoryPath, 'local-storage-export.json')
    const outputPath = path.join(directoryPath, 'm4-storage-snapshot-copy-evidence.json')
    await writeFile(inputPath, `${JSON.stringify(privateInputPayload(), null, 2)}\n`, 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m4-storage-snapshot-copy-evidence.mjs',
      '--input',
      inputPath,
      '--generated-at',
      '2026-06-18T15:00:00Z',
      '--backup-id',
      'input-backup-test',
      '--copy-id',
      'input-copy-test',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 8 })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_GATE)
    assert.equal(fileReport.input.sample, false)
    assert.equal(fileReport.input.entryCount, 3)
    assert.deepEqual(fileReport.input.keys, [
      'nexus:chat',
      'nexus:memory:daily',
      'nexus:memory:long-term',
    ])
    assert.equal(fileReport.backup.ok, true)
    assert.equal(fileReport.copy.ok, true)
    assert.equal(fileReport.copy.copiedItemCount, 3)
    assert.equal(fileReport.copy.failedItemCount, 0)
    assert.equal(fileReport.privateArtifacts.databasePathExposed, false)
    assert.equal(fileReport.privateArtifacts.backupDirectoryExposed, false)
    assert.equal(json.includes(PRIVATE_SENTINEL), false)
    assert.equal(json.includes(directoryPath), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 storage snapshot copy evidence package wiring stays available', () => {
  assert.equal(
    packageJson.scripts['m4:storage:snapshot-copy:evidence'],
    'node scripts/m4-storage-snapshot-copy-evidence.mjs',
  )
})
