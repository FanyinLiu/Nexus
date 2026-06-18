import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import packageJson from '../package.json' with { type: 'json' }
import {
  buildM4StorageRendererHydrationEvidenceReport,
  DEFAULT_M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_FILE,
  M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_GATE,
  parseM4StorageRendererHydrationEvidenceArgs,
} from '../scripts/m4-storage-renderer-hydration-evidence.mjs'

const execFileAsync = promisify(execFile)
const PRIVATE_SENTINEL = 'M4_RENDERER_HYDRATION_TEST_PRIVATE_SENTINEL_DO_NOT_COPY'

function privateInputPayload(generatedAt = '2026-06-18T17:00:00Z') {
  return {
    evidenceSource: 'test-renderer-hydration-export',
    entries: [
      {
        key: 'nexus:chat',
        value: JSON.stringify([
          {
            id: 'renderer-hydration-test-chat',
            role: 'user',
            content: ` ${PRIVATE_SENTINEL}: chat text `,
            createdAt: generatedAt,
          },
        ]),
      },
      {
        key: 'nexus:memory:long-term',
        value: JSON.stringify([
          {
            id: 'renderer-hydration-test-memory',
            content: ` ${PRIVATE_SENTINEL}: memory text `,
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
              id: 'renderer-hydration-test-daily',
              role: 'assistant',
              content: ` ${PRIVATE_SENTINEL}: daily text `,
              source: 'chat',
              createdAt: generatedAt,
            },
          ],
        }),
      },
    ],
  }
}

test('m4 storage renderer hydration evidence args support sample, input, and readiness gate', () => {
  assert.deepEqual(parseM4StorageRendererHydrationEvidenceArgs([
    '--sample',
    '--generated-at=2026-06-18T17:00:00Z',
    '--output',
    'artifacts/v1/m4-storage-renderer-hydration-evidence.json',
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
    generatedAt: '2026-06-18T17:00:00Z',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: true,
    limit: 12,
    outputPath: 'artifacts/v1/m4-storage-renderer-hydration-evidence.json',
    requireReady: true,
    sample: true,
  })

  assert.deepEqual(parseM4StorageRendererHydrationEvidenceArgs([
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
    limit: 500,
    outputPath: DEFAULT_M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_FILE,
    requireReady: false,
    sample: false,
  })
})

test('m4 storage renderer hydration evidence sample proves safe renderer adapter hydration', async () => {
  const report = await buildM4StorageRendererHydrationEvidenceReport({
    sample: true,
    generatedAt: '2026-06-18T17:00:00Z',
    backupId: 'renderer-hydration-sample-backup-test',
    copyId: 'renderer-hydration-sample-copy-test',
  })
  const json = JSON.stringify(report)

  assert.equal(report.gate, M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_GATE)
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'renderer-hydration-evidence-ready')
  assert.equal(report.input.sample, true)
  assert.equal(report.backup.ok, true)
  assert.equal(report.copy.ok, true)
  assert.equal(report.mode.ok, true)
  assert.equal(report.mode.enabled, true)
  assert.equal(report.mode.userConfirmed, true)
  assert.equal(report.data.ok, true)
  assert.equal(report.data.containsUserData, true)
  assert.equal(report.data.sqliteValuesReturned, true)
  assert.equal(report.data.localStorageRawValuesReturned, false)
  assert.equal(report.renderer.ok, true)
  assert.deepEqual(report.renderer.requestDomains, ['chat', 'memory'])
  assert.equal(report.renderer.requestLimit, 500)
  assert.equal(report.renderer.chatMessageCount, 2)
  assert.equal(report.renderer.memoryCount, 1)
  assert.equal(report.renderer.dailyMemoryEntryCount, 1)
  assert.equal(report.renderer.fallbackLocalStorageSetCount, 0)
  assert.equal(report.renderer.fallbackLocalStorageRemoveCount, 0)
  assert.equal(report.renderer.fallbackLocalStorageClearCount, 0)
  assert.equal(report.renderer.unsafePrivacyResponseRejected, true)
  assert.equal(report.migrationPlan.rendererReadThroughHydrationEvidenceReady, true)
  assert.equal(report.migrationPlan.rendererFallbackLocalStorageWritebackBlocked, true)
  assert.equal(report.privacy.localStorageValuesCopiedToReport, false)
  assert.equal(report.privacy.rendererHydratedContentCopiedToReport, false)
  assert.equal(report.privacy.rendererFallbackLocalStorageWritten, false)
  assert.equal(json.includes('M4_RENDERER_HYDRATION_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'), false)
})

test('m4 storage renderer hydration evidence CLI persists private-safe input report', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-renderer-hydration-evidence-'))
  try {
    const inputPath = path.join(directoryPath, 'local-storage-export.json')
    const outputPath = path.join(directoryPath, 'm4-storage-renderer-hydration-evidence.json')
    await writeFile(inputPath, `${JSON.stringify(privateInputPayload(), null, 2)}\n`, 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/m4-storage-renderer-hydration-evidence.mjs',
      '--input',
      inputPath,
      '--generated-at',
      '2026-06-18T17:00:00Z',
      '--backup-id',
      'renderer-hydration-input-backup-test',
      '--copy-id',
      'renderer-hydration-input-copy-test',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 8 })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_GATE)
    assert.equal(fileReport.input.sample, false)
    assert.equal(fileReport.input.entryCount, 3)
    assert.deepEqual(fileReport.input.keys, [
      'nexus:chat',
      'nexus:memory:daily',
      'nexus:memory:long-term',
    ])
    assert.equal(fileReport.renderer.snapshotReturned, true)
    assert.equal(fileReport.renderer.fallbackLocalStorageWritten, false)
    assert.equal(fileReport.privateArtifacts.databasePathExposed, false)
    assert.equal(fileReport.privateArtifacts.backupDirectoryExposed, false)
    assert.equal(json.includes(PRIVATE_SENTINEL), false)
    assert.equal(json.includes(directoryPath), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 storage renderer hydration evidence package wiring stays available', () => {
  assert.equal(
    packageJson.scripts['m4:storage:renderer-hydration:evidence'],
    'node --experimental-strip-types scripts/m4-storage-renderer-hydration-evidence.mjs',
  )
  assert.ok(packageJson.build?.files?.includes('scripts/m4-storage-renderer-hydration-evidence.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-storage-renderer-hydration-evidence.mjs'))
})
