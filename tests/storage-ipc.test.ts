import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildStorageStatusResponse,
  register,
  STORAGE_STATUS_CHANNEL,
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

test('storage status IPC registers trusted sender check and closes database status', async () => {
  let registeredChannel = ''
  let registeredHandler: ((event: unknown) => Promise<unknown>) | null = null
  let trustedSenderChecked = false
  let closeCalled = false

  const ipcMainLike = {
    handle(channel: string, handler: (event: unknown) => Promise<unknown>) {
      registeredChannel = channel
      registeredHandler = handler
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

  assert.equal(registeredChannel, STORAGE_STATUS_CHANNEL)
  assert.equal(typeof registeredHandler, 'function')
  const response = await registeredHandler?.({})

  assert.equal(trustedSenderChecked, true)
  assert.equal(closeCalled, true)
  assert.equal((response as { ok?: boolean })?.ok, true)
  assert.equal((response as { database?: { fileName?: string } })?.database?.fileName, 'nexus.sqlite3')
})
