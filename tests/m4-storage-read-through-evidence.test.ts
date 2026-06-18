import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import packageJson from '../package.json' with { type: 'json' }
import {
  buildM4StorageReadThroughEvidenceReport,
  DEFAULT_M4_STORAGE_READ_THROUGH_EVIDENCE_FILE,
  M4_STORAGE_READ_THROUGH_EVIDENCE_GATE,
  parseM4StorageReadThroughEvidenceArgs,
} from '../scripts/m4-storage-read-through-evidence.mjs'

const execFileAsync = promisify(execFile)
const PRIVATE_SENTINEL = 'M4_READ_THROUGH_TEST_PRIVATE_SENTINEL_DO_NOT_COPY'

function privateInputPayload(generatedAt = '2026-06-18T16:00:00Z') {
  return {
    evidenceSource: 'test-read-through-renderer-export',
    entries: [
      {
        key: 'nexus:chat',
        value: JSON.stringify([
          {
            id: 'read-through-test-chat',
            role: 'user',
            content: `${PRIVATE_SENTINEL}: chat text`,
            createdAt: generatedAt,
          },
        ]),
      },
      {
        key: 'nexus:memory:long-term',
        value: JSON.stringify([
          {
            id: 'read-through-test-memory',
            content: `${PRIVATE_SENTINEL}: memory text`,
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
              id: 'read-through-test-daily',
              role: 'user',
              content: `${PRIVATE_SENTINEL}: daily text`,
              source: 'chat',
              createdAt: generatedAt,
            },
          ],
        }),
      },
    ],
  }
}

test('m4 storage read-through evidence args support sample, input, limit, and readiness gate', () => {
  assert.deepEqual(parseM4StorageReadThroughEvidenceArgs([
    '--sample',
    '--generated-at=2026-06-18T16:00:00Z',
    '--output',
    'artifacts/v1/m4-storage-read-through-evidence.json',
    '--database',
    'artifacts/v1/private.sqlite3',
    '--backup-directory',
    'artifacts/v1/private-backups',
    '--backup-id',
    'backup-test',
    '--copy-id',
    'copy-test',
    '--limit',
    '12',
    '--keep-private-artifacts',
    '--require-ready',
  ]), {
    backupDirectory: 'artifacts/v1/private-backups',
    backupId: 'backup-test',
    copyId: 'copy-test',
    databasePath: 'artifacts/v1/private.sqlite3',
    generatedAt: '2026-06-18T16:00:00Z',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: true,
    limit: 12,
    outputPath: 'artifacts/v1/m4-storage-read-through-evidence.json',
    requireReady: true,
    sample: true,
  })

  assert.deepEqual(parseM4StorageReadThroughEvidenceArgs([
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
    limit: 100,
    outputPath: DEFAULT_M4_STORAGE_READ_THROUGH_EVIDENCE_FILE,
    requireReady: false,
    sample: false,
  })
})

test('m4 storage read-through evidence sample queries structured copy without leaking values', async () => {
  const report = await buildM4StorageReadThroughEvidenceReport({
    sample: true,
    generatedAt: '2026-06-18T16:00:00Z',
    backupId: 'read-through-sample-backup-test',
    copyId: 'read-through-sample-copy-test',
  })
  const json = JSON.stringify(report)

  assert.equal(report.gate, M4_STORAGE_READ_THROUGH_EVIDENCE_GATE)
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'read-through-evidence-ready')
  assert.equal(report.input.sample, true)
  assert.equal(report.backup.ok, true)
  assert.equal(report.copy.ok, true)
  assert.equal(report.copy.copiedItemCount, 3)
  assert.equal(report.copy.skippedItemCount, 1)
  assert.equal(report.readThrough.ok, true)
  assert.equal(report.readThrough.previewQueryEnabled, true)
  assert.equal(report.readThrough.chatReadable, true)
  assert.equal(report.readThrough.memoryReadable, true)
  assert.equal(report.readThrough.chatMessageCount, 2)
  assert.equal(report.readThrough.memoryCount, 1)
  assert.equal(report.readThrough.dailyMemoryEntryCount, 1)
  assert.equal(report.readThrough.runtimeMigrationEnabled, false)
  assert.equal(report.readThrough.readThroughMigrationEnabled, false)
  assert.equal(report.migrationPlan.readThroughPreviewEvidenceReady, true)
  assert.equal(report.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(report.migrationPlan.readThroughMigrationEnabled, false)
  assert.equal(report.migrationPlan.previewQueryEnabled, true)
  assert.equal(report.privacy.localStorageValuesCopiedToReport, false)
  assert.equal(report.privacy.absolutePathsExposed, false)
  assert.equal(report.privacy.sourceLocalStorageMutated, false)
  assert.equal(json.includes('M4_READ_THROUGH_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'), false)
})

test('m4 storage read-through evidence CLI persists private-safe input report', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-read-through-evidence-'))
  try {
    const inputPath = path.join(directoryPath, 'local-storage-export.json')
    const outputPath = path.join(directoryPath, 'm4-storage-read-through-evidence.json')
    await writeFile(inputPath, `${JSON.stringify(privateInputPayload(), null, 2)}\n`, 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m4-storage-read-through-evidence.mjs',
      '--input',
      inputPath,
      '--generated-at',
      '2026-06-18T16:00:00Z',
      '--backup-id',
      'read-through-input-backup-test',
      '--copy-id',
      'read-through-input-copy-test',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 8 })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, M4_STORAGE_READ_THROUGH_EVIDENCE_GATE)
    assert.equal(fileReport.input.sample, false)
    assert.equal(fileReport.input.entryCount, 3)
    assert.deepEqual(fileReport.input.keys, [
      'nexus:chat',
      'nexus:memory:daily',
      'nexus:memory:long-term',
    ])
    assert.equal(fileReport.readThrough.ok, true)
    assert.equal(fileReport.readThrough.chatReadable, true)
    assert.equal(fileReport.readThrough.memoryReadable, true)
    assert.equal(fileReport.readThrough.sourceStorageKeyCount, 3)
    assert.equal(fileReport.privateArtifacts.databasePathExposed, false)
    assert.equal(fileReport.privateArtifacts.backupDirectoryExposed, false)
    assert.equal(json.includes(PRIVATE_SENTINEL), false)
    assert.equal(json.includes(directoryPath), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 storage read-through evidence package wiring stays available', () => {
  assert.equal(
    packageJson.scripts['m4:storage:read-through:evidence'],
    'node scripts/m4-storage-read-through-evidence.mjs',
  )
  assert.ok(packageJson.build?.files?.includes('scripts/m4-storage-read-through-evidence.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-storage-read-through-evidence.mjs'))
})
