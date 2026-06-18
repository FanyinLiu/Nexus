import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  buildLocalStorageSnapshotBackupResponse,
  validateLocalStorageSnapshotBackupResponse,
} from '../electron/ipc/storageIpc.js'
import {
  backupLocalStorageSnapshot,
  initializeNexusStorageDatabase,
  M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRY_BYTES,
  M4_SQLITE_SCHEMA_VERSION,
  summarizeNexusStorageDatabase,
  validateLocalStorageSnapshotRequest,
} from '../electron/services/sqliteStorage.js'

test('local storage snapshot request validation allows only bounded chat and memory keys', () => {
  const normalized = validateLocalStorageSnapshotRequest({
    reason: 'pre-migration',
    entries: [
      { key: 'nexus:chat', value: '[{"role":"user","content":"hi"}]' },
      { key: 'nexus:memory:long-term', value: '[]', sourceUpdatedAt: '2026-06-18T12:00:00Z' },
    ],
  })

  assert.equal(normalized.reason, 'pre-migration')
  assert.equal(normalized.entryCount, 2)
  assert.deepEqual(normalized.entries.map((entry) => entry.storageKey), [
    'nexus:chat',
    'nexus:memory:long-term',
  ])

  assert.throws(
    () => validateLocalStorageSnapshotRequest({
      entries: [{ key: 'nexus:settings', value: '{}' }],
    }),
    /not allowed/,
  )
  assert.throws(
    () => validateLocalStorageSnapshotRequest({
      entries: [
        { key: 'nexus:chat', value: '[]' },
        { key: 'nexus:chat', value: '[]' },
      ],
    }),
    /duplicate storage key/,
  )
  assert.throws(
    () => validateLocalStorageSnapshotRequest({
      entries: [{ key: 'nexus:chat', value: 'x'.repeat(M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRY_BYTES + 1) }],
    }),
    /per-entry byte limit/,
  )
  assert.throws(
    () => validateLocalStorageSnapshotRequest({
      entries: [{ key: 'nexus:memory:daily', value: '{}', sourceUpdatedAt: 'not a date' }],
    }),
    /sourceUpdatedAt must be an ISO timestamp/,
  )
})

test('local storage snapshot backup writes file, sqlite rows, and private-safe response', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-storage-snapshot-'))
  try {
    const databasePath = path.join(directoryPath, 'storage.sqlite3')
    const backupDirectory = path.join(directoryPath, 'backups')
    const result = await backupLocalStorageSnapshot({
      reason: 'pre-migration',
      entries: [
        {
          key: 'nexus:chat',
          value: '[{"id":"private-chat","role":"user","content":"private user chat sample"}]',
        },
        {
          key: 'nexus:memory:daily',
          value: '{"2026-06-18":[{"id":"private-memory","content":"private memory sample"}]}',
        },
      ],
    }, {
      databasePath,
      backupDirectory,
      generatedAt: '2026-06-18T12:15:00Z',
      backupId: 'local-storage-backup-test',
    })

    assert.equal(result.ok, true)
    assert.equal(result.sourceLocalStoragePreserved, true)
    assert.equal(result.runtimeMigrationEnabled, false)
    assert.equal(result.readThroughMigrationEnabled, false)
    assert.equal(result.valuesCopiedToResponse, false)

    const backupText = await readFile(result.backupPath, 'utf8')
    assert.ok(backupText.includes('private user chat sample'))
    assert.ok(backupText.includes('private memory sample'))

    const status = await initializeNexusStorageDatabase({
      databasePath,
      generatedAt: '2026-06-18T12:16:00Z',
    })
    try {
      const summary = summarizeNexusStorageDatabase(status.database)
      assert.equal(summary.schemaVersion, M4_SQLITE_SCHEMA_VERSION)
      assert.equal(summary.counts.schemaMigrations, 2)
      assert.equal(summary.counts.backups, 1)
      assert.equal(summary.counts.localStorageBackupRuns, 1)
      assert.equal(summary.counts.localStorageBackupItems, 2)
      assert.equal(summary.counts.localStorageLedgerItems, 2)
      assert.equal(summary.counts.migrationEvents, 1)

      const runRow = status.database
        .prepare('SELECT entry_count, total_bytes, source_local_storage_preserved FROM local_storage_backup_runs WHERE backup_id = ?')
        .get('local-storage-backup-test') as { entry_count?: number; total_bytes?: number; source_local_storage_preserved?: number } | undefined
      assert.equal(runRow?.entry_count, 2)
      assert.equal(runRow?.source_local_storage_preserved, 1)

      const itemRow = status.database
        .prepare('SELECT source_value_text, source_value_sha256 FROM local_storage_backup_items WHERE backup_id = ? AND storage_key = ?')
        .get('local-storage-backup-test', 'nexus:chat') as { source_value_text?: string; source_value_sha256?: string } | undefined
      assert.ok(itemRow?.source_value_text?.includes('private user chat sample'))
      assert.match(itemRow?.source_value_sha256 ?? '', /^[a-f0-9]{64}$/)
    } finally {
      status.close?.()
    }

    const appLike = {
      getPath(name: string) {
        assert.equal(name, 'userData')
        return directoryPath
      },
    }
    const response = buildLocalStorageSnapshotBackupResponse(result, { appLike })
    const responseJson = JSON.stringify(response)

    assert.equal(validateLocalStorageSnapshotBackupResponse(response), response)
    assert.equal(response.backup.pathKind, 'userData')
    assert.equal(response.backup.fileName, 'local-storage-backup-test.local-storage-snapshot.json')
    assert.equal(response.privacy.localStorageValuesReturned, false)
    assert.equal(response.privacy.absoluteBackupPathExposed, false)
    assert.equal(response.privacy.sourceLocalStorageMutated, false)
    assert.equal(response.privacy.valuesCopiedToResponse, false)
    assert.equal(responseJson.includes(directoryPath), false)
    assert.equal(responseJson.includes('private user chat sample'), false)
    assert.equal(responseJson.includes('private memory sample'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})
