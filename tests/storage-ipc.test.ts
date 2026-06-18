import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildLocalStorageSnapshotBackupResponse,
  buildStorageStatusResponse,
  STORAGE_BACKUP_LOCAL_SNAPSHOT_CHANNEL,
  register,
  STORAGE_STATUS_CHANNEL,
  validateLocalStorageSnapshotBackupResponse,
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
      schemaMigrations: 1,
      backups: 0,
      localStorageLedgerItems: 0,
      migrationEvents: 0,
      localStorageBackupRuns: 0,
      localStorageBackupItems: 0,
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

test('storage IPC registers trusted sender checks for status and snapshot backup', async () => {
  const registeredHandlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()
  let trustedSenderChecked = false
  let closeCalled = false

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
  })

  assert.equal(typeof registeredHandlers.get(STORAGE_STATUS_CHANNEL), 'function')
  assert.equal(typeof registeredHandlers.get(STORAGE_BACKUP_LOCAL_SNAPSHOT_CHANNEL), 'function')
  const response = await registeredHandlers.get(STORAGE_STATUS_CHANNEL)?.({})

  assert.equal(trustedSenderChecked, true)
  assert.equal(closeCalled, true)
  assert.equal((response as { ok?: boolean })?.ok, true)
  assert.equal((response as { database?: { fileName?: string } })?.database?.fileName, 'nexus.sqlite3')
})
