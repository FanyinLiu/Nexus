import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  buildLocalStorageSnapshotBackupResponse,
  buildLocalStorageSnapshotCopyResponse,
  validateLocalStorageSnapshotBackupResponse,
  validateLocalStorageSnapshotCopyResponse,
} from '../electron/ipc/storageIpc.js'
import {
  backupLocalStorageSnapshot,
  copyLocalStorageSnapshotToStructuredSqlite,
  initializeNexusStorageDatabase,
  M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRY_BYTES,
  M4_SQLITE_SCHEMA_VERSION,
  summarizeNexusStorageDatabase,
  validateLocalStorageSnapshotCopyRequest,
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

test('local storage snapshot copy request validation requires a safe backup id', () => {
  assert.deepEqual(validateLocalStorageSnapshotCopyRequest({
    backupId: 'local-storage-backup-test',
    copyId: 'local-storage-copy-test',
  }), {
    backupId: 'local-storage-backup-test',
    copyId: 'local-storage-copy-test',
  })

  assert.throws(
    () => validateLocalStorageSnapshotCopyRequest({ backupId: '../private' }),
    /backupId must be a short id/,
  )
  assert.throws(
    () => validateLocalStorageSnapshotCopyRequest({ backupId: 'ok', copyId: '../private' }),
    /copyId must be a short id/,
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
      assert.equal(summary.counts.schemaMigrations, 3)
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

test('local storage snapshot copy writes structured chat and memory tables without exposing values', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-storage-copy-'))
  try {
    const databasePath = path.join(directoryPath, 'storage.sqlite3')
    const backupDirectory = path.join(directoryPath, 'backups')
    await backupLocalStorageSnapshot({
      reason: 'pre-migration',
      entries: [
        {
          key: 'nexus:chat',
          value: JSON.stringify([
            { id: 'flat-user', role: 'user', content: 'private flat chat sample\nwith preserved spacing', createdAt: '2026-06-18T12:00:00Z' },
            { id: 'flat-assistant', role: 'assistant', content: 'private assistant sample', createdAt: '2026-06-18T12:01:00Z' },
          ]),
        },
        {
          key: 'nexus:chat:sessions',
          value: JSON.stringify([
            {
              id: 'session-1',
              title: 'Private session',
              startedAt: Date.parse('2026-06-18T12:00:00Z'),
              lastActiveAt: Date.parse('2026-06-18T12:02:00Z'),
              messages: [
                { id: 'session-user', role: 'user', content: 'private session chat', createdAt: '2026-06-18T12:02:00Z' },
              ],
            },
          ]),
        },
        {
          key: 'nexus:memory:long-term',
          value: JSON.stringify([
            {
              id: 'memory-1',
              content: 'private long term memory sample',
              category: 'preference',
              source: 'chat',
              createdAt: '2026-06-18T12:03:00Z',
              importance: 'high',
            },
          ]),
        },
        {
          key: 'nexus:memory:daily',
          value: JSON.stringify({
            '2026-06-18': [
              {
                id: 'daily-1',
                role: 'user',
                content: 'private daily memory sample',
                source: 'chat',
                createdAt: '2026-06-18T12:04:00Z',
              },
            ],
          }),
        },
        {
          key: 'nexus:autonomy:relationship',
          value: JSON.stringify({ warmth: 0.8, note: 'private relationship sample' }),
        },
      ],
    }, {
      databasePath,
      backupDirectory,
      generatedAt: '2026-06-18T12:20:00Z',
      backupId: 'local-storage-backup-copy-test',
    })

    const result = await copyLocalStorageSnapshotToStructuredSqlite({
      backupId: 'local-storage-backup-copy-test',
      copyId: 'local-storage-copy-test',
    }, {
      databasePath,
      generatedAt: '2026-06-18T12:25:00Z',
    })

    assert.equal(result.ok, true)
    assert.equal(result.status, 'snapshot-copy-partial')
    assert.equal(result.copiedItemCount, 4)
    assert.equal(result.skippedItemCount, 1)
    assert.equal(result.failedItemCount, 0)
    assert.equal(result.chatSessionCount, 2)
    assert.equal(result.chatMessageCount, 3)
    assert.equal(result.memoryCount, 1)
    assert.equal(result.dailyMemoryEntryCount, 1)
    assert.deepEqual(result.skippedKeys, ['nexus:autonomy:relationship'])
    assert.equal(result.runtimeMigrationEnabled, false)
    assert.equal(result.readThroughMigrationEnabled, false)
    assert.equal(result.sourceLocalStoragePreserved, true)

    const status = await initializeNexusStorageDatabase({
      databasePath,
      generatedAt: '2026-06-18T12:26:00Z',
    })
    try {
      const summary = summarizeNexusStorageDatabase(status.database)
      assert.equal(summary.schemaVersion, M4_SQLITE_SCHEMA_VERSION)
      assert.equal(summary.counts.schemaMigrations, 3)
      assert.equal(summary.counts.localStorageCopyRuns, 1)
      assert.equal(summary.counts.localStorageCopyItems, 5)
      assert.equal(summary.counts.chatSessions, 2)
      assert.equal(summary.counts.chatMessages, 3)
      assert.equal(summary.counts.memories, 1)
      assert.equal(summary.counts.dailyMemoryEntries, 1)
      assert.equal(summary.counts.memorySources, 4)

      const copiedLedgerRow = status.database
        .prepare('SELECT status FROM local_storage_migration_ledger WHERE storage_key = ?')
        .get('nexus:memory:long-term') as { status?: string } | undefined
      assert.equal(copiedLedgerRow?.status, 'copied')

      const skippedCopyItem = status.database
        .prepare('SELECT status, inserted_rows FROM local_storage_copy_items WHERE copy_id = ? AND storage_key = ?')
        .get('local-storage-copy-test', 'nexus:autonomy:relationship') as { status?: string; inserted_rows?: number } | undefined
      assert.equal(skippedCopyItem?.status, 'skipped')
      assert.equal(skippedCopyItem?.inserted_rows, 0)

      const messageRow = status.database
        .prepare('SELECT content FROM chat_messages WHERE message_id = ?')
        .get('flat-user') as { content?: string } | undefined
      assert.equal(messageRow?.content, 'private flat chat sample\nwith preserved spacing')
    } finally {
      status.close?.()
    }

    const response = buildLocalStorageSnapshotCopyResponse(result)
    const responseJson = JSON.stringify(response)
    assert.equal(validateLocalStorageSnapshotCopyResponse(response), response)
    assert.equal(response.gate, 'nexus-v1-m4-local-storage-snapshot-copy')
    assert.equal(response.ok, true)
    assert.equal(response.migrationPlan.runtimeMigrationEnabled, false)
    assert.equal(response.migrationPlan.readThroughMigrationEnabled, false)
    assert.equal(response.migrationPlan.sourceLocalStoragePreserved, true)
    assert.equal(response.privacy.localStorageValuesReturned, false)
    assert.equal(response.privacy.absolutePathExposed, false)
    assert.equal(response.privacy.sourceLocalStorageMutated, false)
    assert.equal(response.privacy.valuesCopiedToResponse, false)
    assert.equal(responseJson.includes('private flat chat sample'), false)
    assert.equal(responseJson.includes('private long term memory sample'), false)
    assert.equal(responseJson.includes(directoryPath), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})
