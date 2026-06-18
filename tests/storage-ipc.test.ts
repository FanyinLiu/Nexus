import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildLocalStorageReadThroughPreviewResponse,
  buildLocalStorageSnapshotBackupResponse,
  buildLocalStorageSnapshotCopyResponse,
  buildStorageStatusResponse,
  STORAGE_BACKUP_LOCAL_SNAPSHOT_CHANNEL,
  STORAGE_COPY_LOCAL_SNAPSHOT_CHANNEL,
  STORAGE_READ_THROUGH_PREVIEW_CHANNEL,
  register,
  STORAGE_STATUS_CHANNEL,
  validateLocalStorageReadThroughPreviewResponse,
  validateLocalStorageSnapshotBackupResponse,
  validateLocalStorageSnapshotCopyResponse,
  validateStorageStatusResponse,
} from '../electron/ipc/storageIpc.js'
import {
  M4_SQLITE_FOUNDATION_GATE,
  M4_SQLITE_FOUNDATION_TABLES,
  M4_SQLITE_SCHEMA_VERSION,
} from '../electron/services/sqliteStorage.js'

function foundationStatus(overrides = {}) {
  return {
    ok: true,
    status: 'foundation-ready',
    runtime: {
      engine: 'node:sqlite',
      available: true,
      experimental: true,
      externalDependencyAdded: false,
    },
    databasePath: '/Users/example/Library/Application Support/Nexus/storage/nexus.sqlite3',
    schemaVersion: M4_SQLITE_SCHEMA_VERSION,
    journalMode: 'wal',
    tables: M4_SQLITE_FOUNDATION_TABLES,
    counts: {
      schemaMigrations: 3,
      backups: 0,
      localStorageLedgerItems: 0,
      migrationEvents: 0,
      localStorageBackupRuns: 0,
      localStorageBackupItems: 0,
      localStorageCopyRuns: 0,
      localStorageCopyItems: 0,
      chatSessions: 0,
      chatMessages: 0,
      memories: 0,
      dailyMemoryEntries: 0,
      memorySources: 0,
    },
    ...overrides,
  }
}

const appLike = {
  getPath(name: string) {
    assert.equal(name, 'userData')
    return '/Users/example/Library/Application Support/Nexus'
  },
}

test('storage status response is private-safe and validates its shape', () => {
  const response = buildStorageStatusResponse(foundationStatus(), { appLike })
  const json = JSON.stringify(response)

  assert.equal(response.gate, M4_SQLITE_FOUNDATION_GATE)
  assert.equal(response.ok, true)
  assert.equal(response.database.pathKind, 'userData')
  assert.equal(response.database.fileName, 'nexus.sqlite3')
  assert.equal(response.database.schemaVersion, M4_SQLITE_SCHEMA_VERSION)
  assert.deepEqual(response.database.missingTables, [])
  assert.equal(response.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(response.migrationPlan.readThroughMigrationEnabled, false)
  assert.equal(response.migrationPlan.localStorageSnapshotBackupReady, true)
  assert.equal(response.migrationPlan.localStorageStructuredCopyReady, true)
  assert.equal(response.privacy.userDataCopied, false)
  assert.equal(response.privacy.localStorageValuesRead, false)
  assert.equal(response.privacy.absoluteDatabasePathExposed, false)
  assert.equal(json.includes('/Users/example'), false)
  assert.equal(validateStorageStatusResponse(response), response)
})

test('storage status response reports missing foundation tables without user data', () => {
  const response = buildStorageStatusResponse(foundationStatus({
    ok: false,
    status: 'schema-incomplete',
    tables: ['storage_schema_migrations'],
  }), { appLike })

  assert.equal(response.ok, false)
  assert.ok(response.blockingIssueIds.includes('sqlite-foundation-schema-not-ready'))
  assert.ok(response.blockingIssueIds.includes('missing-table:storage_backups'))
  assert.equal(response.database.expectedTables.find((entry) => entry.table === 'storage_backups')?.ready, false)
  assert.equal(response.privacy.absoluteDatabasePathExposed, false)
})

test('storage status validator rejects malformed responses before renderer exposure', () => {
  assert.throws(
    () => validateStorageStatusResponse({
      gate: M4_SQLITE_FOUNDATION_GATE,
      ok: true,
      status: 'foundation-ready',
      schemaVersion: M4_SQLITE_SCHEMA_VERSION,
      runtime: {
        engine: 'node:sqlite',
        available: true,
        experimental: true,
        externalDependencyAdded: false,
      },
      database: {
        pathKind: 'userData',
        fileName: '/private/nexus.sqlite3',
        schemaVersion: M4_SQLITE_SCHEMA_VERSION,
        journalMode: 'wal',
        expectedTables: [],
        missingTables: [],
        counts: {
          schemaMigrations: 1,
          backups: 0,
          localStorageLedgerItems: 0,
          migrationEvents: 0,
          localStorageBackupRuns: 0,
          localStorageBackupItems: 0,
          localStorageCopyRuns: 0,
          localStorageCopyItems: 0,
          chatSessions: 0,
          chatMessages: 0,
          memories: 0,
          dailyMemoryEntries: 0,
          memorySources: 0,
        },
      },
      migrationPlan: {},
      privacy: {},
      blockingIssueIds: [],
      nextActions: [],
    }),
    /database\.fileName must not include path separators/,
  )
})

test('local storage snapshot copy response redacts values and keeps runtime migration disabled', () => {
  const response = buildLocalStorageSnapshotCopyResponse({
    ok: true,
    status: 'snapshot-copied',
    copyId: 'local-storage-copy-test',
    backupId: 'local-storage-backup-test',
    copiedAt: '2026-06-18T12:35:00.000Z',
    itemCount: 2,
    copiedItemCount: 2,
    skippedItemCount: 0,
    failedItemCount: 0,
    chatSessionCount: 1,
    chatMessageCount: 2,
    memoryCount: 1,
    dailyMemoryEntryCount: 0,
    keys: ['nexus:chat', 'nexus:memory:long-term'],
    copiedKeys: ['nexus:chat', 'nexus:memory:long-term'],
    skippedKeys: [],
    failedKeys: [],
    sourceLocalStoragePreserved: true,
    valuesCopiedToResponse: false,
  })
  const json = JSON.stringify(response)

  assert.equal(response.gate, 'nexus-v1-m4-local-storage-snapshot-copy')
  assert.equal(response.ok, true)
  assert.equal(response.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(response.migrationPlan.readThroughMigrationEnabled, false)
  assert.equal(response.migrationPlan.sourceLocalStoragePreserved, true)
  assert.equal(response.migrationPlan.structuredSqliteCopyCompleted, true)
  assert.equal(response.privacy.localStorageValuesReturned, false)
  assert.equal(response.privacy.absolutePathExposed, false)
  assert.equal(response.privacy.sourceLocalStorageMutated, false)
  assert.equal(response.privacy.valuesCopiedToResponse, false)
  assert.equal(json.includes('private user chat sample'), false)
  assert.equal(validateLocalStorageSnapshotCopyResponse(response), response)
})

test('local storage snapshot backup response redacts paths and values', () => {
  const response = buildLocalStorageSnapshotBackupResponse({
    ok: true,
    status: 'snapshot-backed-up',
    backupId: 'local-storage-backup-test',
    createdAt: '2026-06-18T12:30:00.000Z',
    reason: 'manual',
    entryCount: 1,
    totalBytes: 23,
    keys: ['nexus:chat'],
    domains: ['chat'],
    backupFileName: 'local-storage-backup-test.local-storage-snapshot.json',
    backupPath: '/Users/example/Library/Application Support/Nexus/storage/backups/local-storage-backup-test.local-storage-snapshot.json',
    sha256: 'a'.repeat(64),
    sourceLocalStoragePreserved: true,
    runtimeMigrationEnabled: false,
    readThroughMigrationEnabled: false,
    valuesCopiedToResponse: false,
  }, { appLike })
  const json = JSON.stringify(response)

  assert.equal(response.gate, 'nexus-v1-m4-local-storage-snapshot-backup')
  assert.equal(response.ok, true)
  assert.equal(response.backup.pathKind, 'userData')
  assert.equal(response.backup.fileName, 'local-storage-backup-test.local-storage-snapshot.json')
  assert.equal(response.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(response.migrationPlan.readThroughMigrationEnabled, false)
  assert.equal(response.migrationPlan.sourceLocalStoragePreserved, true)
  assert.equal(response.privacy.localStorageValuesReturned, false)
  assert.equal(response.privacy.absoluteBackupPathExposed, false)
  assert.equal(response.privacy.sourceLocalStorageMutated, false)
  assert.equal(response.privacy.valuesCopiedToResponse, false)
  assert.equal(json.includes('/Users/example'), false)
  assert.equal(validateLocalStorageSnapshotBackupResponse(response), response)
})

test('local storage read-through preview response redacts content and keeps runtime migration disabled', () => {
  const response = buildLocalStorageReadThroughPreviewResponse({
    ok: true,
    status: 'read-through-preview-ready',
    generatedAt: '2026-06-18T12:40:00.000Z',
    backupId: 'local-storage-backup-read-through-test',
    copyId: 'local-storage-copy-read-through-test',
    copiedAt: '2026-06-18T12:39:00.000Z',
    copyStatus: 'snapshot-copied',
    domains: ['chat', 'memory'],
    limit: 5,
    chat: {
      selected: true,
      hasReadableRows: true,
      sessionCount: 1,
      messageCount: 2,
      sampledMessageCount: 2,
      latestMessageAt: '2026-06-18T12:38:00.000Z',
      roleCounts: { assistant: 1, user: 1 },
      valuesCopiedToResponse: false,
    },
    memory: {
      selected: true,
      hasReadableRows: true,
      memoryCount: 1,
      dailyMemoryEntryCount: 1,
      sampledMemoryCount: 1,
      sampledDailyMemoryEntryCount: 1,
      latestMemoryCreatedAt: '2026-06-18T12:20:00.000Z',
      latestDailyMemoryEntryAt: '2026-06-18T12:30:00.000Z',
      categoryCounts: { preference: 1 },
      dailyRoleCounts: { user: 1 },
      valuesCopiedToResponse: false,
    },
    source: {
      sourceStorageKeyCount: 2,
      sourceStorageKeys: ['nexus:chat', 'nexus:memory:long-term'],
      copyItemCount: 2,
      copyItems: [
        {
          storageKey: 'nexus:chat',
          domain: 'chat',
          status: 'copied',
          insertedRows: 3,
          skippedRows: 0,
        },
        {
          storageKey: 'nexus:memory:long-term',
          domain: 'memory',
          status: 'copied',
          insertedRows: 2,
          skippedRows: 0,
        },
      ],
    },
    totals: {
      readableRowCount: 5,
      sourceStorageKeyCount: 2,
      copyItemCount: 2,
    },
    previewQueryEnabled: true,
    runtimeMigrationEnabled: false,
    readThroughMigrationEnabled: false,
    sourceLocalStoragePreserved: true,
    valuesCopiedToResponse: false,
  })
  const json = JSON.stringify(response)

  assert.equal(response.gate, 'nexus-v1-m4-local-storage-read-through-preview')
  assert.equal(response.ok, true)
  assert.equal(response.chat.messageCount, 2)
  assert.equal(response.chat.latestMessageAtPresent, true)
  assert.equal(response.memory.latestMemoryCreatedAtPresent, true)
  assert.equal(response.migrationPlan.previewQueryEnabled, true)
  assert.equal(response.migrationPlan.runtimeMigrationEnabled, false)
  assert.equal(response.migrationPlan.readThroughMigrationEnabled, false)
  assert.equal(response.migrationPlan.sourceLocalStoragePreserved, true)
  assert.equal(response.privacy.localStorageValuesReturned, false)
  assert.equal(response.privacy.absolutePathExposed, false)
  assert.equal(response.privacy.sourceLocalStorageMutated, false)
  assert.equal(response.privacy.valuesCopiedToResponse, false)
  assert.equal(json.includes('private user chat sample'), false)
  assert.equal(json.includes('/Users/example'), false)
  assert.equal(validateLocalStorageReadThroughPreviewResponse(response), response)
  assert.throws(
    () => validateLocalStorageReadThroughPreviewResponse({
      ...response,
      privacy: {
        ...response.privacy,
        localStorageValuesReturned: true,
      },
    }),
    /must not return values/,
  )
})

test('storage IPC registers trusted sender checks for status and snapshot backup', async () => {
  const registeredHandlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
  let trustedSenderChecked = false
  let closeCalled = false
  let readThroughPreviewCalled = false

  const ipcMainLike = {
    handle(channel: string, handler: (event: unknown) => Promise<unknown>) {
      registeredHandlers.set(channel, handler)
    },
  }

  register({
    ipcMainLike,
    appLike,
    trustedSenderCheck() {
      trustedSenderChecked = true
    },
    async initializeStorageDatabase() {
      return {
        ...foundationStatus(),
        close() {
          closeCalled = true
        },
      }
    },
    async queryLocalStorageReadThroughPreview() {
      readThroughPreviewCalled = true
      return {
        ok: true,
        status: 'read-through-preview-ready',
        generatedAt: '2026-06-18T12:40:00.000Z',
        backupId: 'local-storage-backup-read-through-test',
        copyId: 'local-storage-copy-read-through-test',
        copiedAt: '2026-06-18T12:39:00.000Z',
        copyStatus: 'snapshot-copied',
        domains: ['chat'],
        limit: 2,
        chat: {
          selected: true,
          hasReadableRows: true,
          sessionCount: 1,
          messageCount: 2,
          sampledMessageCount: 2,
          roleCounts: { assistant: 1, user: 1 },
          valuesCopiedToResponse: false,
        },
        memory: {
          selected: false,
          hasReadableRows: false,
          valuesCopiedToResponse: false,
        },
        source: {
          sourceStorageKeyCount: 1,
          sourceStorageKeys: ['nexus:chat'],
          copyItemCount: 1,
          copyItems: [{
            storageKey: 'nexus:chat',
            domain: 'chat',
            status: 'copied',
            insertedRows: 3,
            skippedRows: 0,
          }],
        },
        totals: {
          readableRowCount: 3,
          sourceStorageKeyCount: 1,
          copyItemCount: 1,
        },
        previewQueryEnabled: true,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        sourceLocalStoragePreserved: true,
        valuesCopiedToResponse: false,
      }
    },
  })

  assert.equal(typeof registeredHandlers.get(STORAGE_STATUS_CHANNEL), 'function')
  assert.equal(typeof registeredHandlers.get(STORAGE_BACKUP_LOCAL_SNAPSHOT_CHANNEL), 'function')
  assert.equal(typeof registeredHandlers.get(STORAGE_COPY_LOCAL_SNAPSHOT_CHANNEL), 'function')
  assert.equal(typeof registeredHandlers.get(STORAGE_READ_THROUGH_PREVIEW_CHANNEL), 'function')
  const response = await registeredHandlers.get(STORAGE_STATUS_CHANNEL)?.({})
  const previewResponse = await registeredHandlers.get(STORAGE_READ_THROUGH_PREVIEW_CHANNEL)?.({}, {
    domains: ['chat'],
    limit: 2,
  })

  assert.equal(trustedSenderChecked, true)
  assert.equal(closeCalled, true)
  assert.equal(readThroughPreviewCalled, true)
  assert.equal((response as { ok?: boolean })?.ok, true)
  assert.equal((response as { database?: { fileName?: string } })?.database?.fileName, 'nexus.sqlite3')
  assert.equal((previewResponse as { ok?: boolean })?.ok, true)
  assert.equal((previewResponse as { chat?: { messageCount?: number } })?.chat?.messageCount, 2)
})
