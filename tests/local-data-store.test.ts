import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applyChatLocalDataMigration,
  buildLocalDataExportSnapshot,
  compareChatLocalDataSessions,
  getChatLocalDataMigrationStatus,
  importLocalDataSnapshot,
  initializeLocalDataStore,
  mirrorLocalDataOnboardingState,
  mirrorChatLocalDataSession,
  normalizeOnboardingMirrorState,
  planChatLocalDataMigration,
  planLocalDataImport,
  readChatLocalDataSessions,
  readLocalDataDomainRecords,
  readLocalDataManifest,
  readLocalDataSqliteState,
  resolveLocalDataPaths,
  rollbackChatLocalDataMigration,
  rollbackLocalDataStore,
} from '../electron/services/localDataStore.js'
import { buildChatStorageMigrationPackage } from '../src/lib/storage/chatMigrationDryRun.ts'

async function withTempUserData(run: (userDataPath: string) => Promise<void>) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-local-data-'))
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

function byteLength(value: unknown): number {
  return new TextEncoder().encode(String(value ?? '')).length
}

test('local data store initializes a versioned manifest and migration ledger', async () => {
  await withTempUserData(async (userDataPath) => {
    const status = await initializeLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T08:00:00.000Z'),
    })

    assert.deepEqual(status, {
      initialized: true,
      healthy: true,
      backend: 'sqlite',
      schemaVersion: 3,
      targetSchemaVersion: 3,
      migrationCount: 3,
      lastMigrationId: '0003-create-domain-records-and-onboarding-mirror',
      storageDirectoryName: 'local-data',
      errorKind: null,
      errorMessage: null,
    })
    assert.equal(JSON.stringify(status).includes(userDataPath), false)

    const manifest = await readLocalDataManifest({ userDataPath })
    assert.equal(manifest.format, 'nexus-local-data-manifest')
    assert.equal(manifest.backend, 'sqlite')
    assert.equal(manifest.schemaVersion, 3)
    assert.equal(manifest.createdAt, '2026-06-19T08:00:00.000Z')
    assert.equal(manifest.migrations.length, 3)
    assert.equal(manifest.migrations[0].id, '0001-create-local-data-manifest')
    assert.equal(manifest.migrations[1].id, '0002-create-sqlite-local-data-foundation')
    assert.equal(manifest.migrations[2].id, '0003-create-domain-records-and-onboarding-mirror')
    assert.equal(manifest.domains.onboarding.sourceStorageKey, 'nexus:onboarding')
    assert.equal(manifest.domains.onboarding.authority, 'renderer-localStorage')
    assert.equal(manifest.domains.onboarding.containsSecrets, false)
    assert.equal(manifest.domains['chat-sessions'].sourceStorageKey, 'nexus:chat:sessions')
    assert.equal(manifest.domains['chat-sessions'].containsUserContent, true)
    assert.equal(manifest.domains['local-data-audit'].authority, 'main-process')

    const paths = await resolveLocalDataPaths({ userDataPath })
    assert.equal(await pathExists(paths.databasePath), true)
    const sqliteState = await readLocalDataSqliteState({ userDataPath })
    assert.equal(sqliteState.schemaVersion, 3)
    assert.equal(sqliteState.migrations.length, 3)
    assert.deepEqual(sqliteState.domains.map((domain) => domain.id), [
      'chat-sessions',
      'local-data-audit',
      'onboarding',
    ])
  })
})

test('local data initialization is idempotent once migrations are applied', async () => {
  await withTempUserData(async (userDataPath) => {
    const paths = await resolveLocalDataPaths({ userDataPath })
    await initializeLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T08:00:00.000Z'),
    })
    const firstRaw = await fs.readFile(paths.manifestPath, 'utf8')

    const status = await initializeLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T09:00:00.000Z'),
    })
    const secondRaw = await fs.readFile(paths.manifestPath, 'utf8')

    assert.equal(status.healthy, true)
    assert.equal(status.migrationCount, 3)
    assert.equal(secondRaw, firstRaw)
  })
})

test('local data initialization migrates an existing json-ledger manifest into SQLite', async () => {
  await withTempUserData(async (userDataPath) => {
    const paths = await resolveLocalDataPaths({ userDataPath })
    await fs.mkdir(paths.root, { recursive: true })
    await fs.writeFile(paths.manifestPath, `${JSON.stringify({
      format: 'nexus-local-data-manifest',
      formatVersion: 1,
      backend: 'json-ledger',
      schemaVersion: 1,
      createdAt: '2026-06-19T07:00:00.000Z',
      updatedAt: '2026-06-19T07:00:00.000Z',
      migrations: [{
        id: '0001-create-local-data-manifest',
        fromVersion: 0,
        toVersion: 1,
        appliedAt: '2026-06-19T07:00:00.000Z',
        reversible: true,
      }],
      domains: {},
    }, null, 2)}\n`, 'utf8')

    const status = await initializeLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T09:00:00.000Z'),
    })

    assert.equal(status.healthy, true)
    assert.equal(status.backend, 'sqlite')
    assert.equal(status.schemaVersion, 3)
    assert.equal(status.migrationCount, 3)

    const manifest = await readLocalDataManifest({ userDataPath })
    assert.equal(manifest.backend, 'sqlite')
    assert.equal(manifest.schemaVersion, 3)
    assert.equal(manifest.createdAt, '2026-06-19T07:00:00.000Z')
    assert.equal(manifest.migrations[0].appliedAt, '2026-06-19T07:00:00.000Z')
    assert.equal(manifest.migrations[1].appliedAt, '2026-06-19T09:00:00.000Z')
    assert.equal(manifest.migrations[2].appliedAt, '2026-06-19T09:00:00.000Z')

    const sqliteState = await readLocalDataSqliteState({ userDataPath })
    assert.equal(sqliteState.schemaVersion, 3)
    assert.equal(sqliteState.migrations[0].id, '0001-create-local-data-manifest')
    assert.equal(sqliteState.migrations[1].id, '0002-create-sqlite-local-data-foundation')
    assert.equal(sqliteState.migrations[2].id, '0003-create-domain-records-and-onboarding-mirror')
  })
})

test('local data initialization reports corrupt manifests without overwriting them', async () => {
  await withTempUserData(async (userDataPath) => {
    const paths = await resolveLocalDataPaths({ userDataPath })
    await fs.mkdir(paths.root, { recursive: true })
    await fs.writeFile(paths.manifestPath, '{not valid json', 'utf8')

    const status = await initializeLocalDataStore({ userDataPath })

    assert.equal(status.healthy, false)
    assert.equal(status.initialized, false)
    assert.equal(status.errorKind, 'local-data-manifest-invalid')
    assert.equal(status.errorMessage?.includes(userDataPath), false)
    assert.equal(await fs.readFile(paths.manifestPath, 'utf8'), '{not valid json')
  })
})

test('local data export and import scaffolding is metadata-only before migration', async () => {
  await withTempUserData(async (userDataPath) => {
    await initializeLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T08:00:00.000Z'),
    })

    const snapshot = await buildLocalDataExportSnapshot({
      userDataPath,
      now: new Date('2026-06-19T08:30:00.000Z'),
    })

    assert.equal(snapshot.format, 'nexus-local-data-export')
    assert.equal(snapshot.backend, 'sqlite')
    assert.equal(snapshot.schemaVersion, 3)
    assert.equal(snapshot.recordPayloadsIncluded, false)
    assert.equal(snapshot.records, undefined)
    assert.equal(snapshot.domains.length, 3)
    assert.deepEqual(snapshot.domains.map((domain) => domain.id), [
      'chat-sessions',
      'local-data-audit',
      'onboarding',
    ])
    assert.equal(snapshot.migrations.length, 3)
    assert.equal(JSON.stringify(snapshot).includes(userDataPath), false)

    assert.deepEqual(planLocalDataImport(snapshot), {
      ok: true,
      schemaVersion: 3,
      domainCount: 3,
      migrationCount: 3,
      recordPayloadsIncluded: false,
      writesData: false,
    })
    assert.deepEqual(await importLocalDataSnapshot({ userDataPath, snapshot }), {
      ok: true,
      schemaVersion: 3,
      domainCount: 3,
      migrationCount: 3,
      recordPayloadsIncluded: false,
      writesData: false,
      applied: false,
    })
    assert.equal(planLocalDataImport({ ...snapshot, schemaVersion: 99 }).ok, false)
  })
})

test('local data chat migration requires confirmation, writes records, and rolls back by domain', async () => {
  await withTempUserData(async (userDataPath) => {
    const packageResult = buildChatStorageMigrationPackage({
      sessionsRaw: JSON.stringify([{
        id: 'session-1',
        startedAt: '2026-06-19T08:00:00.000Z',
        lastActiveAt: '2026-06-19T08:05:00.000Z',
        title: 'private title',
        messages: [
          { id: 'm1', role: 'user', content: 'private chat content', createdAt: '2026-06-19T08:00:00.000Z' },
          { id: 'm2', role: 'assistant', content: 'private assistant answer', createdAt: '2026-06-19T08:05:00.000Z' },
        ],
      }]),
    }, {
      now: '2026-06-19T08:06:00.000Z',
    })
    assert.equal(packageResult.ok, true)
    if (!packageResult.ok) throw new Error('expected chat migration package')

    const plan = planChatLocalDataMigration(packageResult.migrationPackage)
    assert.equal(plan.ok, true)
    assert.equal(plan.sessionCount, 1)
    assert.equal(plan.messageCount, 2)
    assert.equal(plan.writesData, true)
    assert.equal(JSON.stringify(plan).includes('private chat content'), false)

    const unconfirmed = await applyChatLocalDataMigration({
      userDataPath,
      now: new Date('2026-06-19T08:07:00.000Z'),
      migrationPackage: packageResult.migrationPackage,
      confirmed: false,
    })
    assert.equal(unconfirmed.ok, false)
    assert.equal(unconfirmed.applied, false)
    assert.equal(unconfirmed.errorKind, 'local-data-chat-migration-confirmation-required')
    assert.equal(await pathExists((await resolveLocalDataPaths({ userDataPath })).databasePath), false)

    const applied = await applyChatLocalDataMigration({
      userDataPath,
      now: new Date('2026-06-19T08:08:00.000Z'),
      migrationPackage: packageResult.migrationPackage,
      confirmed: true,
    })
    assert.equal(applied.ok, true)
    assert.equal(applied.applied, true)
    assert.equal(applied.recordsWritten, 1)
    assert.equal(applied.auditRecordId, 'chat-migration-2026-06-19T08-08-00-000Z')
    assert.equal(JSON.stringify(applied).includes('private chat content'), false)

    const statusAfterApply = await getChatLocalDataMigrationStatus({ userDataPath })
    assert.equal(statusAfterApply.ok, true)
    assert.equal(statusAfterApply.targetDomainId, 'chat-sessions')
    assert.equal(statusAfterApply.schemaVersion, 3)
    assert.equal(statusAfterApply.recordCount, 1)
    assert.equal(statusAfterApply.messageCount, 2)
    assert.equal(statusAfterApply.recordPayloadsIncluded, false)
    assert.equal(statusAfterApply.lastAuditRecordId, 'chat-migration-2026-06-19T08-08-00-000Z')
    assert.equal(statusAfterApply.lastAuditAction, 'chat-sessions-migration-applied')
    assert.equal(statusAfterApply.lastAuditAt, '2026-06-19T08:08:00.000Z')
    assert.equal(statusAfterApply.errorKind, null)
    assert.equal(JSON.stringify(statusAfterApply).includes('private chat content'), false)
    assert.equal(JSON.stringify(statusAfterApply).includes('private title'), false)
    assert.equal(JSON.stringify(statusAfterApply).includes('session-1'), false)

    const readBack = await readChatLocalDataSessions({ userDataPath })
    assert.equal(readBack.ok, true)
    assert.equal(readBack.targetDomainId, 'chat-sessions')
    assert.equal(readBack.schemaVersion, 3)
    assert.equal(readBack.recordPayloadsIncluded, true)
    assert.equal(readBack.recordCount, 1)
    assert.equal(readBack.validSessionCount, 1)
    assert.equal(readBack.messageCount, 2)
    assert.equal(readBack.malformedRecordCount, 0)
    assert.equal(readBack.sessions[0].id, 'session-1')
    assert.equal(readBack.sessions[0].title, 'private title')
    assert.equal(readBack.sessions[0].messages[0].content, 'private chat content')
    assert.equal(JSON.stringify(readBack).includes(userDataPath), false)

    const chatRecords = await readLocalDataDomainRecords('chat-sessions', { userDataPath })
    assert.equal(chatRecords.length, 1)
    assert.equal(chatRecords[0].recordId, 'session-1')
    assert.equal(chatRecords[0].payload.messages.length, 2)
    assert.equal(chatRecords[0].payload.messages[0].content, 'private chat content')

    const auditRecords = await readLocalDataDomainRecords('local-data-audit', { userDataPath })
    assert.equal(auditRecords.length, 1)
    assert.equal(auditRecords[0].payload.action, 'chat-sessions-migration-applied')
    assert.equal(auditRecords[0].payload.messageCount, 2)
    assert.equal(JSON.stringify(auditRecords).includes('private chat content'), false)

    const rolledBack = await rollbackChatLocalDataMigration({
      userDataPath,
      now: new Date('2026-06-19T08:09:00.000Z'),
      confirmed: true,
    })
    assert.equal(rolledBack.ok, true)
    assert.equal(rolledBack.recordsDeleted, 1)
    assert.deepEqual(await readLocalDataDomainRecords('chat-sessions', { userDataPath }), [])
    assert.equal((await readLocalDataDomainRecords('local-data-audit', { userDataPath })).length, 2)

    const statusAfterRollback = await getChatLocalDataMigrationStatus({ userDataPath })
    assert.equal(statusAfterRollback.ok, true)
    assert.equal(statusAfterRollback.recordCount, 0)
    assert.equal(statusAfterRollback.messageCount, 0)
    assert.equal(statusAfterRollback.recordPayloadsIncluded, false)
    assert.equal(statusAfterRollback.lastAuditRecordId, 'chat-migration-rollback-2026-06-19T08-09-00-000Z')
    assert.equal(statusAfterRollback.lastAuditAction, 'chat-sessions-migration-rolled-back')
    assert.equal(statusAfterRollback.lastAuditAt, '2026-06-19T08:09:00.000Z')
    assert.equal(JSON.stringify(statusAfterRollback).includes('private chat content'), false)
    assert.equal(JSON.stringify(statusAfterRollback).includes('session-1'), false)

    const readBackAfterRollback = await readChatLocalDataSessions({ userDataPath })
    assert.equal(readBackAfterRollback.ok, true)
    assert.equal(readBackAfterRollback.recordPayloadsIncluded, true)
    assert.equal(readBackAfterRollback.recordCount, 0)
    assert.equal(readBackAfterRollback.validSessionCount, 0)
    assert.equal(readBackAfterRollback.messageCount, 0)
    assert.deepEqual(readBackAfterRollback.sessions, [])

    const unconfirmedRollback = await rollbackChatLocalDataMigration({
      userDataPath,
      now: new Date('2026-06-19T08:10:00.000Z'),
      confirmed: false,
    })
    assert.equal(unconfirmedRollback.ok, false)
    assert.equal(unconfirmedRollback.recordsDeleted, 0)
    assert.equal(unconfirmedRollback.errorKind, 'local-data-chat-migration-confirmation-required')
  })
})

test('local data chat runtime mirror requires confirmation, mirrors, and deletes one session', async () => {
  await withTempUserData(async (userDataPath) => {
    const session = {
      id: 'runtime-session-1',
      startedAt: Date.parse('2026-06-19T09:00:00.000Z'),
      lastActiveAt: Date.parse('2026-06-19T09:01:00.000Z'),
      title: 'private runtime title',
      messages: [
        { id: 'runtime-m1', role: 'user', content: 'private runtime content', createdAt: '2026-06-19T09:00:00.000Z' },
      ],
    }

    const unconfirmed = await mirrorChatLocalDataSession({
      userDataPath,
      now: new Date('2026-06-19T09:02:00.000Z'),
      session,
      confirmed: false,
    })
    assert.equal(unconfirmed.ok, false)
    assert.equal(unconfirmed.errorKind, 'local-data-chat-runtime-mirror-confirmation-required')
    assert.equal(await pathExists((await resolveLocalDataPaths({ userDataPath })).databasePath), false)

    const mirrored = await mirrorChatLocalDataSession({
      userDataPath,
      now: new Date('2026-06-19T09:03:00.000Z'),
      session,
      confirmed: true,
    })
    assert.equal(mirrored.ok, true)
    assert.equal(mirrored.mirrored, true)
    assert.equal(mirrored.deleted, false)
    assert.equal(mirrored.recordsWritten, 1)
    assert.equal(mirrored.recordsDeleted, 0)
    assert.equal(mirrored.messageCount, 1)
    assert.equal(mirrored.auditRecordId, 'chat-runtime-mirror-2026-06-19T09-03-00-000Z')
    assert.equal(JSON.stringify(mirrored).includes('private runtime content'), false)
    assert.equal(JSON.stringify(mirrored).includes('runtime-session-1'), false)

    const readBack = await readChatLocalDataSessions({ userDataPath })
    assert.equal(readBack.ok, true)
    assert.equal(readBack.validSessionCount, 1)
    assert.equal(readBack.sessions[0].id, 'runtime-session-1')
    assert.equal(readBack.sessions[0].messages[0].content, 'private runtime content')

    const auditRecords = await readLocalDataDomainRecords('local-data-audit', { userDataPath })
    assert.equal(auditRecords.length, 1)
    assert.equal(auditRecords[0].payload.action, 'chat-session-runtime-mirrored')
    assert.equal(auditRecords[0].payload.messageCount, 1)
    assert.equal(JSON.stringify(auditRecords).includes('private runtime content'), false)
    assert.equal(JSON.stringify(auditRecords).includes('runtime-session-1'), false)

    const deleted = await mirrorChatLocalDataSession({
      userDataPath,
      now: new Date('2026-06-19T09:04:00.000Z'),
      session: {
        ...session,
        lastActiveAt: Date.parse('2026-06-19T09:04:00.000Z'),
        messages: [],
      },
      confirmed: true,
    })
    assert.equal(deleted.ok, true)
    assert.equal(deleted.mirrored, false)
    assert.equal(deleted.deleted, true)
    assert.equal(deleted.recordsWritten, 0)
    assert.equal(deleted.recordsDeleted, 1)
    assert.equal(deleted.messageCount, 0)
    assert.equal(deleted.auditRecordId, 'chat-runtime-mirror-2026-06-19T09-04-00-000Z')
    assert.deepEqual(await readLocalDataDomainRecords('chat-sessions', { userDataPath }), [])

    const auditAfterDelete = await readLocalDataDomainRecords('local-data-audit', { userDataPath })
    assert.equal(auditAfterDelete.length, 2)
    assert.equal(auditAfterDelete[1].payload.action, 'chat-session-runtime-mirror-deleted')
    assert.equal(auditAfterDelete[1].payload.recordsDeleted, 1)
  })
})

test('local data chat comparison preview audits metadata without returning chat content', async () => {
  await withTempUserData(async (userDataPath) => {
    const session = {
      id: 'comparison-session-1',
      startedAt: Date.parse('2026-06-19T10:00:00.000Z'),
      lastActiveAt: Date.parse('2026-06-19T10:01:00.000Z'),
      title: 'private comparison title',
      messages: [
        { id: 'comparison-m1', role: 'user', content: 'private comparison content', createdAt: '2026-06-19T10:00:00.000Z' },
      ],
    }
    const source = {
      schemaVersion: 1,
      generatedAt: '2026-06-19T10:02:00.000Z',
      source: {
        sessionsKeyPresent: true,
        legacyFlatChatKeyPresent: false,
        legacyFlatChatUsed: false,
      },
      sessions: [{
        id: session.id,
        startedAt: session.startedAt,
        lastActiveAt: session.lastActiveAt,
        messageCount: session.messages.length,
        payloadBytes: byteLength(JSON.stringify(session)),
      }],
    }

    const unconfirmed = await compareChatLocalDataSessions({
      userDataPath,
      now: new Date('2026-06-19T10:02:30.000Z'),
      source,
      confirmed: false,
    })
    assert.equal(unconfirmed.ok, false)
    assert.equal(unconfirmed.errorKind, 'local-data-chat-comparison-confirmation-required')
    assert.equal(await pathExists((await resolveLocalDataPaths({ userDataPath })).databasePath), false)

    await mirrorChatLocalDataSession({
      userDataPath,
      now: new Date('2026-06-19T10:03:00.000Z'),
      session,
      confirmed: true,
    })

    const aligned = await compareChatLocalDataSessions({
      userDataPath,
      now: new Date('2026-06-19T10:04:00.000Z'),
      source,
      confirmed: true,
    })
    assert.equal(aligned.ok, true)
    assert.equal(aligned.compared, true)
    assert.equal(aligned.recordPayloadsIncluded, false)
    assert.equal(aligned.status, 'aligned')
    assert.equal(aligned.sourceSessionCount, 1)
    assert.equal(aligned.sqliteSessionCount, 1)
    assert.equal(aligned.matchedRecordCount, 1)
    assert.equal(aligned.metadataAlignedRecordCount, 1)
    assert.equal(aligned.metadataMismatchCount, 0)
    assert.equal(aligned.messageCountDelta, 0)
    assert.deepEqual(aligned.issueCodes, ['comparison-aligned'])
    assert.equal(aligned.auditRecordId, 'chat-comparison-2026-06-19T10-04-00-000Z')
    assert.equal(JSON.stringify(aligned).includes('private comparison content'), false)
    assert.equal(JSON.stringify(aligned).includes('comparison-session-1'), false)

    const auditRecords = await readLocalDataDomainRecords('local-data-audit', { userDataPath })
    const comparisonAudit = auditRecords.find((record) => record.payload.action === 'chat-sessions-comparison-previewed')
    assert.equal(comparisonAudit?.payload.sourceSessionCount, 1)
    assert.equal(comparisonAudit?.payload.sqliteSessionCount, 1)
    assert.equal(JSON.stringify(auditRecords).includes('private comparison content'), false)
    assert.equal(JSON.stringify(auditRecords).includes('comparison-session-1'), false)

    const mismatched = await compareChatLocalDataSessions({
      userDataPath,
      now: new Date('2026-06-19T10:05:00.000Z'),
      source: {
        ...source,
        sessions: [{
          ...source.sessions[0],
          messageCount: 2,
          payloadBytes: source.sessions[0].payloadBytes + 1,
        }],
      },
      confirmed: true,
    })
    assert.equal(mismatched.ok, true)
    assert.equal(mismatched.status, 'differences')
    assert.equal(mismatched.metadataMismatchCount, 1)
    assert.equal(mismatched.messageCountDelta, -1)
    assert.ok(mismatched.issueCodes.includes('sqlite-metadata-mismatch'))
    assert.ok(mismatched.issueCodes.includes('sqlite-message-count-delta'))
  })
})

test('local data onboarding mirror writes and deletes a low-risk domain record', async () => {
  await withTempUserData(async (userDataPath) => {
    const mirrored = await mirrorLocalDataOnboardingState({
      userDataPath,
      now: new Date('2026-06-19T08:10:00.000Z'),
      state: {
        completedAt: '2026-06-19T08:00:00.000Z',
        firstConversationAt: '2026-06-19T08:04:59.000Z',
        firstConversationElapsedMs: 1,
      },
    })

    assert.deepEqual(mirrored, {
      ok: true,
      domainId: 'onboarding',
      recordId: 'state',
      mirrored: true,
      deleted: false,
      schemaVersion: 3,
      errorKind: null,
      errorMessage: null,
    })

    const records = await readLocalDataDomainRecords('onboarding', { userDataPath })
    assert.equal(records.length, 1)
    assert.equal(records[0].recordId, 'state')
    assert.deepEqual(records[0].payload, {
      completedAt: '2026-06-19T08:00:00.000Z',
      firstConversationAt: '2026-06-19T08:04:59.000Z',
      firstConversationElapsedMs: 299000,
    })
    assert.equal(records[0].source, 'renderer-localStorage')
    assert.equal(JSON.stringify(records).includes(userDataPath), false)

    const snapshot = await buildLocalDataExportSnapshot({
      userDataPath,
      now: new Date('2026-06-19T08:11:00.000Z'),
      includeRecords: true,
    })
    assert.equal(snapshot.recordPayloadsIncluded, true)
    assert.equal(snapshot.records.onboarding.length, 1)
    assert.deepEqual(snapshot.records.onboarding[0].payload, records[0].payload)
    assert.deepEqual(planLocalDataImport(snapshot), {
      ok: true,
      schemaVersion: 3,
      domainCount: 3,
      migrationCount: 3,
      recordPayloadsIncluded: true,
      writesData: false,
    })

    const deleted = await mirrorLocalDataOnboardingState({
      userDataPath,
      now: new Date('2026-06-19T08:12:00.000Z'),
      state: null,
    })
    assert.equal(deleted.ok, true)
    assert.equal(deleted.deleted, true)
    assert.deepEqual(await readLocalDataDomainRecords('onboarding', { userDataPath }), [])
  })
})

test('local data onboarding mirror rejects invalid state before writing records', async () => {
  await withTempUserData(async (userDataPath) => {
    assert.throws(
      () => normalizeOnboardingMirrorState({ completedAt: 'not a date' }),
      /completedAt must be a valid timestamp/u,
    )

    const result = await mirrorLocalDataOnboardingState({
      userDataPath,
      state: { completedAt: 'not a date' },
    })

    assert.equal(result.ok, false)
    assert.equal(result.errorKind, 'local-data-onboarding-invalid')
    const paths = await resolveLocalDataPaths({ userDataPath })
    assert.equal(await pathExists(paths.databasePath), false)
  })
})

test('local data rollback preserves the active directory by renaming it aside', async () => {
  await withTempUserData(async (userDataPath) => {
    const paths = await resolveLocalDataPaths({ userDataPath })
    await initializeLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T08:00:00.000Z'),
    })

    const rollback = await rollbackLocalDataStore({
      userDataPath,
      now: new Date('2026-06-19T10:00:00.000Z'),
    })

    assert.equal(rollback.ok, true)
    assert.equal(rollback.action, 'renamed')
    assert.equal(rollback.disabledDirectoryName?.startsWith('local-data.disabled-'), true)
    assert.equal(rollback.disabledDirectoryName?.includes(userDataPath), false)
    assert.equal(await pathExists(paths.root), false)

    const disabledManifest = path.join(userDataPath, rollback.disabledDirectoryName!, 'manifest.json')
    assert.equal(await pathExists(disabledManifest), true)
    const disabledDatabase = path.join(userDataPath, rollback.disabledDirectoryName!, 'nexus.sqlite')
    assert.equal(await pathExists(disabledDatabase), true)

    const status = await initializeLocalDataStore({ userDataPath })
    assert.equal(status.healthy, true)
    assert.equal(await pathExists(paths.manifestPath), true)
  })
})
