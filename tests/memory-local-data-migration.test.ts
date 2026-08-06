import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applyChatLocalDataMigration,
  initializeLocalDataStore,
  mirrorLocalDataOnboardingState,
  readLocalDataDomainRecords,
  readLocalDataManifest,
  readLocalDataSqliteState,
  resolveLocalDataPaths,
} from '../electron/services/localDataStore.js'
import {
  ensureSqliteTables,
  openSqliteDatabase,
  setMeta,
} from '../electron/services/localDataStoreCore.js'
import {
  applyMemoryLocalDataMigration,
  planMemoryLocalDataMigration,
  rollbackMemoryLocalDataMigration,
} from '../electron/services/localDataMemoryStore.js'
import { buildChatStorageMigrationPackage } from '../src/lib/storage/chatMigrationDryRun.ts'
import {
  DAILY_MEMORY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
} from '../src/lib/storage/core.ts'
import {
  buildMemoryLocalDataMigrationPackage,
  buildMemoryMigrationBackupEnvelope,
  buildMemoryMigrationBackupFileName,
  canExportMemoryMigrationBackup,
  isMemoryLocalDataMigrationUiEnabled,
} from '../src/lib/storage/memoryLocalDataMigration.ts'
import { buildMemoryStorageMigrationDryRun } from '../src/lib/storage/memoryMigrationDryRun.ts'
import type { MemoryLocalDataMigrationPackage } from '../src/lib/storage/memoryLocalDataMigration.ts'

type LongTermPackageEntry = MemoryLocalDataMigrationPackage['longTerm'][number]
type DailyPackageEntry = MemoryLocalDataMigrationPackage['daily'][number]

async function withTempUserData(run: (userDataPath: string) => Promise<void>) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-memory-local-data-'))
  try {
    await run(userDataPath)
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true })
  }
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
      },
    },
    configurable: true,
    writable: true,
  })
}

function longTermFixture(id: string, content: string, createdAt = '2026-06-19T10:00:00.000Z'): LongTermPackageEntry {
  return {
    id,
    content,
    category: 'preference',
    source: 'chat',
    kind: 'preference',
    importance: 'high',
    enabled: true,
    createdAt,
  }
}

function dailyFixture(id: string, content: string, createdAt = '2026-06-19T10:30:00.000Z') {
  return {
    id,
    role: 'user' as const,
    content,
    source: 'chat' as const,
    createdAt,
  }
}

test('memory migration package builds from long-term, daily, and legacy localStorage shapes', () => {
  installStorage({
    [MEMORY_STORAGE_KEY]: JSON.stringify([longTermFixture('lt-1', 'private long term content')]),
    [LEGACY_MEMORY_STORAGE_KEY]: JSON.stringify([longTermFixture('legacy-1', 'private legacy content')]),
    [DAILY_MEMORY_STORAGE_KEY]: JSON.stringify({
      '2026-06-19': [dailyFixture('d-1', 'private daily content')],
    }),
  })
  try {
    const migrationPackage = buildMemoryLocalDataMigrationPackage(new Date('2026-06-19T11:00:00.000Z'))
    assert.equal(migrationPackage.schemaVersion, 1)
    assert.equal(migrationPackage.createdAt, '2026-06-19T11:00:00.000Z')
    assert.deepEqual(migrationPackage.source, {
      longTermKeyPresent: true,
      legacyLongTermKeyPresent: true,
      dailyKeyPresent: true,
      legacyLongTermUsed: false,
    })
    assert.equal(migrationPackage.longTerm.length, 1)
    assert.equal(migrationPackage.longTerm[0].id, 'lt-1')
    assert.equal(migrationPackage.longTerm[0].enabled, true)
    assert.equal(migrationPackage.daily.length, 1)
    assert.equal(migrationPackage.daily[0].id, 'd-1')
    assert.equal(migrationPackage.daily[0].day, '2026-06-19')
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})

test('memory migration package falls back to legacy long-term memory only when current key is absent', () => {
  installStorage({
    [LEGACY_MEMORY_STORAGE_KEY]: JSON.stringify([longTermFixture('legacy-1', 'private legacy content')]),
  })
  try {
    const migrationPackage = buildMemoryLocalDataMigrationPackage(new Date('2026-06-19T11:00:00.000Z'))
    assert.equal(migrationPackage.source.legacyLongTermUsed, true)
    assert.equal(migrationPackage.longTerm.length, 1)
    assert.equal(migrationPackage.longTerm[0].id, 'legacy-1')
    assert.equal(migrationPackage.daily.length, 0)
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})

test('memory migration package does not resurrect legacy memories when current key exists but empty', () => {
  // Key present but empty: the user explicitly deleted every memory. The
  // migration package must stay empty instead of pulling the untouched
  // legacy key back in (same rule as loadMemories in memory.ts).
  installStorage({
    [MEMORY_STORAGE_KEY]: JSON.stringify([]),
    [LEGACY_MEMORY_STORAGE_KEY]: JSON.stringify([longTermFixture('legacy-1', 'private legacy content')]),
  })
  try {
    const migrationPackage = buildMemoryLocalDataMigrationPackage(new Date('2026-06-19T11:00:00.000Z'))
    assert.equal(migrationPackage.source.legacyLongTermUsed, false)
    assert.deepEqual(migrationPackage.longTerm, [])
    assert.deepEqual(migrationPackage.daily, [])
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})

test('memory migration package is empty when no memory keys exist and rejects malformed JSON', () => {
  installStorage()
  try {
    const emptyPackage = buildMemoryLocalDataMigrationPackage(new Date('2026-06-19T11:00:00.000Z'))
    assert.deepEqual(emptyPackage.source, {
      longTermKeyPresent: false,
      legacyLongTermKeyPresent: false,
      dailyKeyPresent: false,
      legacyLongTermUsed: false,
    })
    assert.deepEqual(emptyPackage.longTerm, [])
    assert.deepEqual(emptyPackage.daily, [])

    installStorage({ [MEMORY_STORAGE_KEY]: '{not valid json' })
    assert.throws(
      () => buildMemoryLocalDataMigrationPackage(),
      /memory migration source JSON is invalid/u,
    )
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})

function buildPackageWithContent() {
  const migrationPackage = buildMemoryLocalDataMigrationPackage(new Date('2026-06-19T11:00:00.000Z'))
  migrationPackage.longTerm = [longTermFixture('memory-1', 'private memory content')]
  const dailyEntry: DailyPackageEntry = {
    ...dailyFixture('daily-1', 'private daily content'),
    day: '2026-06-19',
  }
  migrationPackage.daily = [dailyEntry]
  return migrationPackage
}

test('memory migration plan is content-free and rejects malformed packages', () => {
  installStorage()
  try {
    const migrationPackage = buildPackageWithContent()
    const plan = planMemoryLocalDataMigration(migrationPackage)
    assert.equal(plan.ok, true)
    assert.deepEqual(plan.targetDomainIds, ['memory-long-term', 'memory-daily'])
    assert.equal(plan.longTermRecordCount, 1)
    assert.equal(plan.dailyEntryCount, 1)
    assert.equal(plan.requiresConfirmation, true)
    assert.equal(plan.writesData, true)
    assert.equal(plan.errorKind, null)
    assert.equal(JSON.stringify(plan).includes('private memory content'), false)
    assert.equal(JSON.stringify(plan).includes('private daily content'), false)
    assert.equal(JSON.stringify(plan).includes('memory-1'), false)

    for (const invalid of [
      null,
      { schemaVersion: 99, longTerm: [], daily: [] },
      { schemaVersion: 1, createdAt: '2026-06-19T11:00:00.000Z', longTerm: [{ id: 'x' }], daily: [] },
      {
        schemaVersion: 1,
        createdAt: '2026-06-19T11:00:00.000Z',
        longTerm: [migrationPackage.longTerm[0], migrationPackage.longTerm[0]],
        daily: [],
      },
    ]) {
      const invalidPlan = planMemoryLocalDataMigration(invalid)
      assert.equal(invalidPlan.ok, false)
      assert.equal(invalidPlan.writesData, false)
      assert.equal(invalidPlan.longTermRecordCount, 0)
      assert.equal(invalidPlan.dailyEntryCount, 0)
      assert.equal(invalidPlan.errorKind, 'local-data-memory-migration-invalid')
    }
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})

test('memory migration apply requires confirmation and writes content-free audit records', async () => {
  installStorage()
  try {
    await withTempUserData(async (userDataPath) => {
      const migrationPackage = buildPackageWithContent()

      const unconfirmed = await applyMemoryLocalDataMigration({
        userDataPath,
        migrationPackage,
        confirmed: false,
      })
      assert.equal(unconfirmed.ok, false)
      assert.equal(unconfirmed.applied, false)
      assert.equal(unconfirmed.recordsWritten, 0)
      assert.equal(unconfirmed.errorKind, 'local-data-memory-migration-confirmation-required')
      assert.equal(await pathExists((await resolveLocalDataPaths({ userDataPath })).databasePath), false)

      const applied = await applyMemoryLocalDataMigration({
        userDataPath,
        now: new Date('2026-06-19T11:01:00.000Z'),
        migrationPackage,
        confirmed: true,
      })
      assert.equal(applied.ok, true)
      assert.equal(applied.applied, true)
      assert.equal(applied.recordsWritten, 2)
      assert.equal(applied.auditRecordId, 'memory-migration-2026-06-19T11-01-00-000Z')
      assert.equal(JSON.stringify(applied).includes('private memory content'), false)
      assert.equal(JSON.stringify(applied).includes('private daily content'), false)

      const longTermRecords = await readLocalDataDomainRecords('memory-long-term', { userDataPath })
      assert.equal(longTermRecords.length, 1)
      assert.equal(longTermRecords[0].recordId, 'memory-1')
      assert.equal(longTermRecords[0].payload.content, 'private memory content')
      assert.equal(longTermRecords[0].source, 'renderer-localStorage-memory-migration')
      const dailyRecords = await readLocalDataDomainRecords('memory-daily', { userDataPath })
      assert.equal(dailyRecords.length, 1)
      assert.equal(dailyRecords[0].payload.content, 'private daily content')

      const auditRecords = await readLocalDataDomainRecords('local-data-audit', { userDataPath })
      assert.equal(auditRecords.length, 1)
      assert.equal(auditRecords[0].payload.action, 'memory-migration-applied')
      assert.equal(auditRecords[0].payload.appliedAt, '2026-06-19T11:01:00.000Z')
      assert.equal(auditRecords[0].payload.longTermRecordCount, 1)
      assert.equal(auditRecords[0].payload.dailyEntryCount, 1)
      assert.equal(auditRecords[0].payload.confirmed, true)
      assert.equal(JSON.stringify(auditRecords).includes('private memory content'), false)
      assert.equal(JSON.stringify(auditRecords).includes('private daily content'), false)

      // Re-applying the same package replaces records idempotently instead of duplicating them.
      const reapplied = await applyMemoryLocalDataMigration({
        userDataPath,
        now: new Date('2026-06-19T11:02:00.000Z'),
        migrationPackage,
        confirmed: true,
      })
      assert.equal(reapplied.ok, true)
      assert.equal(reapplied.recordsWritten, 2)
      assert.equal((await readLocalDataDomainRecords('memory-long-term', { userDataPath })).length, 1)
      assert.equal((await readLocalDataDomainRecords('memory-daily', { userDataPath })).length, 1)
    })
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})

test('memory migration rollback deletes only memory domains and leaves other domains untouched', async () => {
  installStorage()
  try {
    await withTempUserData(async (userDataPath) => {
      await mirrorLocalDataOnboardingState({
        userDataPath,
        now: new Date('2026-06-19T08:10:00.000Z'),
        state: { completedAt: '2026-06-19T08:00:00.000Z' },
      })
      const chatPackage = buildChatStorageMigrationPackage({
        sessionsRaw: JSON.stringify([{
          id: 'session-1',
          startedAt: '2026-06-19T08:00:00.000Z',
          lastActiveAt: '2026-06-19T08:05:00.000Z',
          messages: [
            { id: 'm1', role: 'user', content: 'private chat content', createdAt: '2026-06-19T08:00:00.000Z' },
          ],
        }]),
      }, { now: '2026-06-19T08:06:00.000Z' })
      assert.equal(chatPackage.ok, true)
      if (!chatPackage.ok) throw new Error('expected chat migration package')
      await applyChatLocalDataMigration({
        userDataPath,
        now: new Date('2026-06-19T08:08:00.000Z'),
        migrationPackage: chatPackage.migrationPackage,
        confirmed: true,
      })

      const migrationPackage = buildPackageWithContent()
      await applyMemoryLocalDataMigration({
        userDataPath,
        now: new Date('2026-06-19T11:01:00.000Z'),
        migrationPackage,
        confirmed: true,
      })

      const unconfirmedRollback = await rollbackMemoryLocalDataMigration({
        userDataPath,
        confirmed: false,
      })
      assert.equal(unconfirmedRollback.ok, false)
      assert.equal(unconfirmedRollback.recordsDeleted, 0)
      assert.equal(unconfirmedRollback.errorKind, 'local-data-memory-migration-confirmation-required')
      assert.equal((await readLocalDataDomainRecords('memory-long-term', { userDataPath })).length, 1)

      const rolledBack = await rollbackMemoryLocalDataMigration({
        userDataPath,
        now: new Date('2026-06-19T11:03:00.000Z'),
        confirmed: true,
      })
      assert.equal(rolledBack.ok, true)
      assert.deepEqual(rolledBack.targetDomainIds, ['memory-long-term', 'memory-daily'])
      assert.equal(rolledBack.recordsDeleted, 2)

      assert.deepEqual(await readLocalDataDomainRecords('memory-long-term', { userDataPath }), [])
      assert.deepEqual(await readLocalDataDomainRecords('memory-daily', { userDataPath }), [])
      const onboardingRecords = await readLocalDataDomainRecords('onboarding', { userDataPath })
      assert.equal(onboardingRecords.length, 1)
      const chatRecords = await readLocalDataDomainRecords('chat-sessions', { userDataPath })
      assert.equal(chatRecords.length, 1)
      assert.equal(chatRecords[0].payload.messages[0].content, 'private chat content')

      const auditRecords = await readLocalDataDomainRecords('local-data-audit', { userDataPath })
      assert.equal(auditRecords.length, 3)
      const rollbackAudit = auditRecords.find((record) => record.payload.action === 'memory-migration-rolled-back')
      assert.equal(rollbackAudit?.payload.rolledBackAt, '2026-06-19T11:03:00.000Z')
      assert.equal(rollbackAudit?.payload.recordsDeleted, 2)
      assert.equal(JSON.stringify(auditRecords).includes('private memory content'), false)
      assert.equal(JSON.stringify(auditRecords).includes('private daily content'), false)
    })
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})

test('migration 0004 upgrades an existing schema version 3 profile and preserves the 0001-0003 ledger chain', async () => {
  await withTempUserData(async (userDataPath) => {
    const paths = await resolveLocalDataPaths({ userDataPath })
    await fs.mkdir(paths.root, { recursive: true })
    const legacyMigrations = [
      { id: '0001-create-local-data-manifest', fromVersion: 0, toVersion: 1, appliedAt: '2026-06-19T07:00:00.000Z' },
      { id: '0002-create-sqlite-local-data-foundation', fromVersion: 1, toVersion: 2, appliedAt: '2026-06-19T07:05:00.000Z' },
      { id: '0003-create-domain-records-and-onboarding-mirror', fromVersion: 2, toVersion: 3, appliedAt: '2026-06-19T07:10:00.000Z' },
    ]
    await fs.writeFile(paths.manifestPath, `${JSON.stringify({
      format: 'nexus-local-data-manifest',
      formatVersion: 1,
      backend: 'sqlite',
      schemaVersion: 3,
      createdAt: '2026-06-19T07:00:00.000Z',
      updatedAt: '2026-06-19T07:10:00.000Z',
      migrations: legacyMigrations.map((migration) => ({ ...migration, reversible: true })),
      domains: {
        onboarding: { authority: 'renderer-localStorage' },
      },
    }, null, 2)}\n`, 'utf8')

    const seed = openSqliteDatabase(paths.databasePath)
    try {
      ensureSqliteTables(seed)
      setMeta(seed, 'schemaVersion', 3)
      setMeta(seed, 'backend', 'sqlite')
      setMeta(seed, 'createdAt', '2026-06-19T07:00:00.000Z')
      setMeta(seed, 'updatedAt', '2026-06-19T07:10:00.000Z')
      for (const migration of legacyMigrations) {
        seed.prepare(`
          INSERT INTO schema_migrations (id, from_version, to_version, applied_at, reversible)
          VALUES (?, ?, ?, ?, 1)
        `).run(migration.id, migration.fromVersion, migration.toVersion, migration.appliedAt)
      }
      seed.prepare(`
        INSERT INTO domain_registry (id, metadata_json, created_at, updated_at)
        VALUES ('onboarding', '{"authority":"renderer-localStorage"}', '2026-06-19T07:10:00.000Z', '2026-06-19T07:10:00.000Z')
      `).run()
    } finally {
      seed.close()
    }

    const status = await initializeLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T09:00:00.000Z'),
    })
    assert.equal(status.healthy, true)
    assert.equal(status.schemaVersion, 4)
    assert.equal(status.migrationCount, 4)
    assert.equal(status.lastMigrationId, '0004-register-memory-domain')

    const sqliteState = await readLocalDataSqliteState({ userDataPath })
    assert.equal(sqliteState.schemaVersion, 4)
    assert.equal(sqliteState.migrations.length, 4)
    for (const [index, migration] of legacyMigrations.entries()) {
      assert.equal(sqliteState.migrations[index].id, migration.id)
      assert.equal(sqliteState.migrations[index].appliedAt, migration.appliedAt)
    }
    assert.equal(sqliteState.migrations[3].id, '0004-register-memory-domain')
    assert.equal(sqliteState.migrations[3].fromVersion, 3)
    assert.equal(sqliteState.migrations[3].toVersion, 4)
    assert.equal(sqliteState.migrations[3].appliedAt, '2026-06-19T09:00:00.000Z')
    const domainIds = sqliteState.domains.map((domain) => domain.id)
    assert.equal(domainIds.includes('memory-long-term'), true)
    assert.equal(domainIds.includes('memory-daily'), true)
    const longTermDomain = sqliteState.domains.find((domain) => domain.id === 'memory-long-term')
    assert.equal(longTermDomain?.metadata.authority, 'renderer-localStorage')
    assert.equal(longTermDomain?.metadata.containsUserContent, true)
    assert.equal(longTermDomain?.metadata.containsSecrets, false)

    const manifest = await readLocalDataManifest({ userDataPath })
    assert.equal(manifest.schemaVersion, 4)
    assert.equal(manifest.migrations.length, 4)
    assert.equal(manifest.createdAt, '2026-06-19T07:00:00.000Z')

    // Re-initialization is idempotent: the ledger and manifest stay byte-identical.
    const firstRaw = await fs.readFile(paths.manifestPath, 'utf8')
    const secondStatus = await initializeLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T10:00:00.000Z'),
    })
    assert.equal(secondStatus.healthy, true)
    assert.equal(secondStatus.migrationCount, 4)
    const secondRaw = await fs.readFile(paths.manifestPath, 'utf8')
    assert.equal(secondRaw, firstRaw)
  })
})

test('memory migration backup envelope carries full content with an explicit warning', () => {
  installStorage({
    [MEMORY_STORAGE_KEY]: JSON.stringify([longTermFixture('lt-1', 'private long term content')]),
    [DAILY_MEMORY_STORAGE_KEY]: JSON.stringify({
      '2026-06-19': [dailyFixture('d-1', 'private daily content')],
    }),
  })
  try {
    const migrationPackage = buildMemoryLocalDataMigrationPackage(new Date('2026-06-19T11:00:00.000Z'))
    const envelope = buildMemoryMigrationBackupEnvelope(migrationPackage, {
      now: '2026-06-19T12:34:56.789Z',
    })

    assert.equal(envelope.format, 'nexus-memory-migration-backup')
    assert.equal(envelope.schemaVersion, 1)
    assert.equal(envelope.includesMessageContent, true)
    assert.equal(envelope.warning, 'This backup contains full memory content.')
    assert.equal(envelope.exportedAt, '2026-06-19T12:34:56.789Z')
    assert.equal(envelope.totals.longTermMemoryCount, 1)
    assert.equal(envelope.totals.dailyEntryCount, 1)
    assert.equal(envelope.totals.payloadBytes > 0, true)
    assert.deepEqual(envelope.source, migrationPackage.source)
    assert.equal(envelope.migrationPackage.longTerm[0].content, 'private long term content')
    assert.equal(envelope.migrationPackage.daily[0].content, 'private daily content')

    const metadataOnly = JSON.stringify({
      format: envelope.format,
      totals: envelope.totals,
      source: envelope.source,
    })
    assert.equal(metadataOnly.includes('private long term content'), false)
    assert.equal(metadataOnly.includes('private daily content'), false)
    assert.equal(
      buildMemoryMigrationBackupFileName(envelope.exportedAt),
      'nexus-memory-migration-backup-2026-06-19T12-34-56-789Z.json',
    )
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})

test('memory migration backup export gating follows the ui flag, data presence, and blocked status', () => {
  const longTermReport = buildMemoryStorageMigrationDryRun({
    longTermRaw: JSON.stringify([longTermFixture('lt-1', 'content')]),
  })
  assert.equal(canExportMemoryMigrationBackup(longTermReport, true), true)
  assert.equal(canExportMemoryMigrationBackup(longTermReport, false), false)

  const dailyOnlyReport = buildMemoryStorageMigrationDryRun({
    dailyRaw: JSON.stringify({ '2026-06-19': [dailyFixture('d-1', 'daily')] }),
  })
  assert.equal(canExportMemoryMigrationBackup(dailyOnlyReport, true), true)

  const emptyReport = buildMemoryStorageMigrationDryRun({})
  assert.equal(emptyReport.status, 'empty')
  assert.equal(canExportMemoryMigrationBackup(emptyReport, true), false)

  const blockedReport = buildMemoryStorageMigrationDryRun({ longTermRaw: '{invalid json' })
  assert.equal(blockedReport.status, 'blocked')
  assert.equal(canExportMemoryMigrationBackup(blockedReport, true), false)
})

test('memory migration ui flag is default-on with an explicit opt-out', () => {
  // Default-on since v0.4.6: unset env shows the panel; '0' hides it;
  // '1' is accepted but redundant.
  assert.equal(isMemoryLocalDataMigrationUiEnabled({}), true)
  assert.equal(isMemoryLocalDataMigrationUiEnabled({ VITE_NEXUS_ENABLE_LOCAL_DATA_MEMORY_MIGRATION_UI: '1' }), true)
  assert.equal(isMemoryLocalDataMigrationUiEnabled({ VITE_NEXUS_ENABLE_LOCAL_DATA_MEMORY_MIGRATION_UI: 'true' }), true)
  assert.equal(isMemoryLocalDataMigrationUiEnabled({ VITE_NEXUS_ENABLE_LOCAL_DATA_MEMORY_MIGRATION_UI: '0' }), false)
})
