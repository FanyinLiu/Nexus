import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  initializeNexusStorageDatabase,
  M4_SQLITE_FOUNDATION_GATE,
  M4_SQLITE_FOUNDATION_TABLES,
  M4_SQLITE_SCHEMA_VERSION,
  recordStorageMigrationEvent,
  summarizeNexusStorageDatabase,
  upsertLocalStorageMigrationLedgerItem,
} from '../electron/services/sqliteStorage.js'
import {
  buildM4SqliteFoundationReport,
  DEFAULT_M4_SQLITE_FOUNDATION_DATABASE,
  DEFAULT_M4_SQLITE_FOUNDATION_FILE,
  parseM4SqliteFoundationArgs,
} from '../scripts/m4-sqlite-foundation-audit.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

test('m4 sqlite foundation args support database, output, and readiness gate', () => {
  assert.deepEqual(parseM4SqliteFoundationArgs([
    '--generated-at=2026-06-18T12:00:00Z',
    '--database',
    'artifacts/v1/storage.sqlite3',
    '--output',
    'artifacts/v1/foundation.json',
    '--require-ready',
  ]), {
    databasePath: 'artifacts/v1/storage.sqlite3',
    generatedAt: '2026-06-18T12:00:00Z',
    help: false,
    outputPath: 'artifacts/v1/foundation.json',
    requireReady: true,
  })
})

test('m4 sqlite foundation initializes schema and migration ledgers', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-sqlite-'))
  try {
    const databasePath = path.join(directoryPath, 'nexus.sqlite3')
    const status = await initializeNexusStorageDatabase({
      databasePath,
      generatedAt: '2026-06-18T12:00:00Z',
    })

    try {
      assert.equal(status.gate, M4_SQLITE_FOUNDATION_GATE)
      assert.equal(status.ok, true)
      assert.equal(status.status, 'foundation-ready')
      assert.equal(status.schemaVersion, M4_SQLITE_SCHEMA_VERSION)
      assert.deepEqual(
        M4_SQLITE_FOUNDATION_TABLES.filter((table) => !status.tables.includes(table)),
        [],
      )

      upsertLocalStorageMigrationLedgerItem(status.database, {
        storageKey: 'nexus:chat',
        domain: 'chat',
        migrationPriority: 'p0',
        sourceKind: 'storage-core',
        firstSeenFile: 'src/lib/storage/core.ts',
        firstSeenLine: 4,
        status: 'planned',
      }, { now: '2026-06-18T12:01:00Z' })
      recordStorageMigrationEvent(status.database, {
        eventId: 'evt-foundation-ready',
        eventType: 'foundation-ready',
        level: 'info',
        storageKey: 'nexus:chat',
        details: { copiedUserData: false },
      }, { now: '2026-06-18T12:02:00Z' })

      const summary = summarizeNexusStorageDatabase(status.database)
      assert.equal(summary.ok, true)
      assert.equal(summary.counts.schemaMigrations, 3)
      assert.equal(summary.counts.localStorageLedgerItems, 1)
      assert.equal(summary.counts.migrationEvents, 1)
      assert.equal(summary.counts.localStorageBackupRuns, 0)
      assert.equal(summary.counts.localStorageBackupItems, 0)
      assert.equal(summary.counts.localStorageCopyRuns, 0)
      assert.equal(summary.counts.localStorageCopyItems, 0)
      assert.equal(summary.counts.chatSessions, 0)
      assert.equal(summary.counts.chatMessages, 0)
      assert.equal(summary.counts.memories, 0)
      assert.equal(summary.counts.dailyMemoryEntries, 0)
      assert.equal(summary.counts.memorySources, 0)
    } finally {
      status.close?.()
    }
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 sqlite foundation report is private-safe and non-migrating', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-sqlite-report-'))
  try {
    const report = await buildM4SqliteFoundationReport({
      databasePath: path.join(directoryPath, 'storage.sqlite3'),
      generatedAt: '2026-06-18T12:00:00Z',
    }, { rootDir: process.cwd() })
    const json = JSON.stringify(report)

    assert.equal(report.gate, M4_SQLITE_FOUNDATION_GATE)
    assert.equal(report.generatedAt, '2026-06-18T12:00:00.000Z')
    assert.equal(report.ok, true)
    assert.equal(report.status, 'foundation-ready')
    assert.equal(report.sqlite.engine, 'node:sqlite')
    assert.equal(report.sqlite.externalDependencyAdded, false)
    assert.equal(report.migrationPlan.runtimeMigrationEnabled, false)
    assert.equal(report.migrationPlan.backupLedgerReady, true)
    assert.equal(report.migrationPlan.rollbackLedgerReady, true)
    assert.equal(report.migrationPlan.localStorageSnapshotBackupReady, true)
    assert.equal(report.migrationPlan.localStorageStructuredCopyReady, true)
    assert.equal(report.migrationPlan.localStorageReadThroughPreviewIpcReady, true)
    assert.equal(report.migrationPlan.localStorageReadThroughModeIpcReady, true)
    assert.equal(report.ipcStatus.ready, true)
    assert.equal(report.ipcStatus.channel, 'storage:status')
    assert.equal(report.ipcStatus.preloadExposed, true)
    assert.equal(report.ipcStatus.handlerRegistered, true)
    assert.equal(report.ipcStatus.registryRegistered, true)
    assert.equal(report.ipcStatus.trustedSenderCheck, true)
    assert.equal(report.ipcStatus.responseValidationReady, true)
    assert.equal(report.ipcStatus.rendererTypeDeclared, true)
    assert.equal(report.ipcStatus.absolutePathRedactionReady, true)
    assert.equal(report.ipcStatus.snapshotBackup.ready, true)
    assert.equal(report.ipcStatus.snapshotBackup.channel, 'storage:backup-local-snapshot')
    assert.equal(report.ipcStatus.snapshotBackup.preloadExposed, true)
    assert.equal(report.ipcStatus.snapshotBackup.handlerRegistered, true)
    assert.equal(report.ipcStatus.snapshotBackup.trustedSenderCheck, true)
    assert.equal(report.ipcStatus.snapshotBackup.responseValidationReady, true)
    assert.equal(report.ipcStatus.snapshotBackup.rendererTypeDeclared, true)
    assert.equal(report.ipcStatus.snapshotBackup.absolutePathRedactionReady, true)
    assert.equal(report.ipcStatus.snapshotBackup.valuesRedactionReady, true)
    assert.equal(report.ipcStatus.snapshotBackup.sourcePreservationReady, true)
    assert.equal(report.ipcStatus.structuredCopy.ready, true)
    assert.equal(report.ipcStatus.structuredCopy.channel, 'storage:copy-local-snapshot')
    assert.equal(report.ipcStatus.structuredCopy.preloadExposed, true)
    assert.equal(report.ipcStatus.structuredCopy.handlerRegistered, true)
    assert.equal(report.ipcStatus.structuredCopy.trustedSenderCheck, true)
    assert.equal(report.ipcStatus.structuredCopy.requestValidationReady, true)
    assert.equal(report.ipcStatus.structuredCopy.responseValidationReady, true)
    assert.equal(report.ipcStatus.structuredCopy.rendererTypeDeclared, true)
    assert.equal(report.ipcStatus.structuredCopy.valuesRedactionReady, true)
    assert.equal(report.ipcStatus.structuredCopy.sourcePreservationReady, true)
    assert.equal(report.ipcStatus.structuredCopy.runtimeMigrationDisabled, true)
    assert.equal(report.ipcStatus.readThroughPreview.ready, true)
    assert.equal(report.ipcStatus.readThroughPreview.channel, 'storage:read-through-preview')
    assert.equal(report.ipcStatus.readThroughPreview.preloadExposed, true)
    assert.equal(report.ipcStatus.readThroughPreview.handlerRegistered, true)
    assert.equal(report.ipcStatus.readThroughPreview.trustedSenderCheck, true)
    assert.equal(report.ipcStatus.readThroughPreview.requestValidationReady, true)
    assert.equal(report.ipcStatus.readThroughPreview.responseValidationReady, true)
    assert.equal(report.ipcStatus.readThroughPreview.rendererTypeDeclared, true)
    assert.equal(report.ipcStatus.readThroughPreview.valuesRedactionReady, true)
    assert.equal(report.ipcStatus.readThroughPreview.sourcePreservationReady, true)
    assert.equal(report.ipcStatus.readThroughPreview.runtimeMigrationDisabled, true)
    assert.equal(report.ipcStatus.readThroughMode.ready, true)
    assert.equal(report.ipcStatus.readThroughMode.channel, 'storage:set-read-through-mode')
    assert.equal(report.ipcStatus.readThroughMode.preloadExposed, true)
    assert.equal(report.ipcStatus.readThroughMode.handlerRegistered, true)
    assert.equal(report.ipcStatus.readThroughMode.trustedSenderCheck, true)
    assert.equal(report.ipcStatus.readThroughMode.requestValidationReady, true)
    assert.equal(report.ipcStatus.readThroughMode.responseValidationReady, true)
    assert.equal(report.ipcStatus.readThroughMode.rendererTypeDeclared, true)
    assert.equal(report.ipcStatus.readThroughMode.userConfirmationRequired, true)
    assert.equal(report.ipcStatus.readThroughMode.valuesRedactionReady, true)
    assert.equal(report.ipcStatus.readThroughMode.sourcePreservationReady, true)
    assert.equal(report.ipcStatus.readThroughMode.runtimeMigrationDisabled, true)
    assert.equal(report.ipcStatus.readThroughMode.rollbackReady, true)
    assert.equal(report.privacy.userDataCopied, false)
    assert.equal(report.privacy.localStorageValuesRead, false)
    assert.equal(json.includes('private user chat sample'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 sqlite foundation CLI persists report and enforces readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m4-sqlite-cli-'))
  try {
    const outputPath = path.join(directoryPath, 'foundation.json')
    const databasePath = path.join(directoryPath, 'foundation.sqlite3')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m4-sqlite-foundation-audit.mjs',
      '--generated-at',
      '2026-06-18T12:00:00Z',
      '--database',
      databasePath,
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 8 })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, M4_SQLITE_FOUNDATION_GATE)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m4 sqlite foundation package wiring stays available', () => {
  assert.equal(packageJson.scripts?.['m4:sqlite:foundation'], 'node scripts/m4-sqlite-foundation-audit.mjs')
  assert.ok(packageJson.build?.files?.includes('scripts/m4-sqlite-foundation-audit.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m4-sqlite-foundation-audit.mjs'))
  assert.equal(DEFAULT_M4_SQLITE_FOUNDATION_FILE, 'artifacts/v1/m4-sqlite-foundation.json')
  assert.equal(DEFAULT_M4_SQLITE_FOUNDATION_DATABASE, 'artifacts/v1/m4-sqlite-foundation.sqlite3')
})
