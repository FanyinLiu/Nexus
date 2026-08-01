/**
 * Chat-domain local-data operations (migration, compare, runtime mirror).
 * Extracted from localDataStore so the SQLite foundation stays separate.
 */
import {
  CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION,
  byteLength,
  chatComparisonIssueCodes,
  compareChatSessionMetadata,
  countChatMessagesFromPayloadJson,
  normalizeChatComparisonSource,
  normalizeChatMigrationPackage,
  normalizeChatMigrationSession,
  safeParseJsonObject,
  summarizeChatComparisonSessions,
  summarizeChatMigrationPackage,
  summarizeSqliteChatComparisonSessions,
} from './localDataChatMigration.js'
import {
  LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
  LOCAL_DATA_AUDIT_DOMAIN_ID,
  initializeLocalDataStore,
  resolveLocalDataPaths,
  setLocalDataRuntimeStatus,
  getLocalDataRuntimeStatusRef,
  nowIso,
  openSqliteDatabase,
  ensureSqliteTables,
  ensureBuiltInDomains,
  auditRecordId,
  insertLocalDataAuditRecord,
  setMeta,
  readSqliteState,
  atomicWriteJson,
  manifestFromSqliteState,
  statusFromSqliteState,
  statusFromError,
  readSqliteRecords,
  getMeta,
  isPlainObject,
} from './localDataStoreCore.js'

export function planChatLocalDataMigration(migrationPackage) {
  try {
    const normalized = normalizeChatMigrationPackage(migrationPackage)
    return {
      ok: true,
      ...summarizeChatMigrationPackage(
        normalized.migrationPackage,
        normalized.payloadBytes,
        LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      ),
      errorKind: null,
      errorMessage: null,
    }
  } catch {
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION,
      sessionCount: 0,
      messageCount: 0,
      payloadBytes: 0,
      legacyFlatChatUsed: false,
      requiresConfirmation: true,
      writesData: false,
      errorKind: 'local-data-chat-migration-invalid',
      errorMessage: 'Chat migration package is invalid.',
    }
  }
}

export async function applyChatLocalDataMigration(options = {}) {
  const planned = planChatLocalDataMigration(options.migrationPackage)
  if (!planned.ok) return { ...planned, applied: false, recordsWritten: 0, auditRecordId: null }
  if (options.confirmed !== true) {
    return {
      ...planned,
      ok: false,
      applied: false,
      recordsWritten: 0,
      auditRecordId: null,
      errorKind: 'local-data-chat-migration-confirmation-required',
      errorMessage: 'Chat migration requires explicit confirmation.',
    }
  }

  const normalized = normalizeChatMigrationPackage(options.migrationPackage)
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return {
      ...planned,
      ok: false,
      applied: false,
      recordsWritten: 0,
      auditRecordId: null,
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    }
  }

  let db = null
  try {
    const appliedAt = nowIso(options.now)
    const { manifestPath, databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const auditId = auditRecordId('chat-migration', appliedAt)
    db.exec('BEGIN')
    try {
      ensureBuiltInDomains(db, appliedAt)
      db.prepare('DELETE FROM local_data_records WHERE domain_id = ?').run(LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID)

      for (const session of normalized.migrationPackage.sessions) {
        db.prepare(`
          INSERT INTO local_data_records (domain_id, record_id, payload_json, source, mirrored_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(domain_id, record_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            source = excluded.source,
            mirrored_at = excluded.mirrored_at,
            updated_at = excluded.updated_at
        `).run(
          LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
          session.id,
          JSON.stringify(session),
          'renderer-localStorage-chat-migration',
          appliedAt,
          appliedAt,
        )
      }

      insertLocalDataAuditRecord(db, auditId, {
        action: 'chat-sessions-migration-applied',
        appliedAt,
        sessionCount: planned.sessionCount,
        messageCount: planned.messageCount,
        payloadBytes: planned.payloadBytes,
        legacyFlatChatUsed: planned.legacyFlatChatUsed,
        confirmed: true,
      }, appliedAt)
      setMeta(db, 'updatedAt', appliedAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }

    const state = readSqliteState(db)
    await atomicWriteJson(manifestPath, manifestFromSqliteState(state))
    setLocalDataRuntimeStatus(statusFromSqliteState(state))

    return {
      ...planned,
      ok: true,
      applied: true,
      recordsWritten: normalized.migrationPackage.sessions.length,
      auditRecordId: auditId,
      errorKind: null,
      errorMessage: null,
    }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return {
      ...planned,
      ok: false,
      applied: false,
      recordsWritten: 0,
      auditRecordId: null,
      errorKind: getLocalDataRuntimeStatusRef().errorKind,
      errorMessage: getLocalDataRuntimeStatusRef().errorMessage,
    }
  } finally {
    if (db) db.close()
  }
}

export async function rollbackChatLocalDataMigration(options = {}) {
  if (options.confirmed !== true) {
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      recordsDeleted: 0,
      auditRecordId: null,
      errorKind: 'local-data-chat-migration-confirmation-required',
      errorMessage: 'Chat migration rollback requires explicit confirmation.',
    }
  }

  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      recordsDeleted: 0,
      auditRecordId: null,
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    }
  }

  let db = null
  try {
    const rolledBackAt = nowIso(options.now)
    const { manifestPath, databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const existing = db.prepare(`
      SELECT COUNT(*) AS count
      FROM local_data_records
      WHERE domain_id = ?
    `).get(LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID)?.count ?? 0
    const auditId = auditRecordId('chat-migration-rollback', rolledBackAt)

    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM local_data_records WHERE domain_id = ?').run(LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID)
      insertLocalDataAuditRecord(db, auditId, {
        action: 'chat-sessions-migration-rolled-back',
        rolledBackAt,
        recordsDeleted: existing,
      }, rolledBackAt)
      setMeta(db, 'updatedAt', rolledBackAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }

    const state = readSqliteState(db)
    await atomicWriteJson(manifestPath, manifestFromSqliteState(state))
    setLocalDataRuntimeStatus(statusFromSqliteState(state))
    return {
      ok: true,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      recordsDeleted: existing,
      auditRecordId: auditId,
      errorKind: null,
      errorMessage: null,
    }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      recordsDeleted: 0,
      auditRecordId: null,
      errorKind: getLocalDataRuntimeStatusRef().errorKind,
      errorMessage: getLocalDataRuntimeStatusRef().errorMessage,
    }
  } finally {
    if (db) db.close()
  }
}

function readLastChatMigrationAudit(db) {
  const rows = db.prepare(`
    SELECT record_id AS recordId, payload_json AS payloadJson, updated_at AS updatedAt
    FROM local_data_records
    WHERE domain_id = ?
    ORDER BY updated_at DESC, record_id DESC
    LIMIT 20
  `).all(LOCAL_DATA_AUDIT_DOMAIN_ID)

  for (const row of rows) {
    const payload = safeParseJsonObject(row.payloadJson)
    if (payload?.action === 'chat-sessions-migration-applied') {
      return {
        recordId: row.recordId,
        action: payload.action,
        at: typeof payload.appliedAt === 'string' ? payload.appliedAt : row.updatedAt,
      }
    }
    if (payload?.action === 'chat-sessions-migration-rolled-back') {
      return {
        recordId: row.recordId,
        action: payload.action,
        at: typeof payload.rolledBackAt === 'string' ? payload.rolledBackAt : row.updatedAt,
      }
    }
  }

  return null
}

export async function getChatLocalDataMigrationStatus(options = {}) {
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: status.schemaVersion,
      recordCount: 0,
      messageCount: 0,
      recordPayloadsIncluded: false,
      lastAuditRecordId: null,
      lastAuditAction: null,
      lastAuditAt: null,
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    }
  }

  let db = null
  try {
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const state = readSqliteState(db)
    const rows = db.prepare(`
      SELECT payload_json AS payloadJson
      FROM local_data_records
      WHERE domain_id = ?
      ORDER BY updated_at ASC
    `).all(LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID)
    const lastAudit = readLastChatMigrationAudit(db)

    return {
      ok: true,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: state.schemaVersion,
      recordCount: rows.length,
      messageCount: rows.reduce((sum, row) => sum + countChatMessagesFromPayloadJson(row.payloadJson), 0),
      recordPayloadsIncluded: false,
      lastAuditRecordId: lastAudit?.recordId ?? null,
      lastAuditAction: lastAudit?.action ?? null,
      lastAuditAt: lastAudit?.at ?? null,
      errorKind: null,
      errorMessage: null,
    }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: getLocalDataRuntimeStatusRef().schemaVersion,
      recordCount: 0,
      messageCount: 0,
      recordPayloadsIncluded: false,
      lastAuditRecordId: null,
      lastAuditAction: null,
      lastAuditAt: null,
      errorKind: getLocalDataRuntimeStatusRef().errorKind,
      errorMessage: getLocalDataRuntimeStatusRef().errorMessage,
    }
  } finally {
    if (db) db.close()
  }
}

export async function readChatLocalDataSessions(options = {}) {
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: status.schemaVersion,
      recordPayloadsIncluded: true,
      recordCount: 0,
      validSessionCount: 0,
      messageCount: 0,
      malformedRecordCount: 0,
      sessions: [],
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    }
  }

  let db = null
  try {
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const state = readSqliteState(db)
    const rows = db.prepare(`
      SELECT payload_json AS payloadJson
      FROM local_data_records
      WHERE domain_id = ?
      ORDER BY updated_at DESC, rowid DESC
    `).all(LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID)
    const sessions = []
    let malformedRecordCount = 0

    rows.forEach((row, index) => {
      const payload = safeParseJsonObject(row.payloadJson)
      if (!payload) {
        malformedRecordCount += 1
        return
      }
      try {
        sessions.push(normalizeChatMigrationSession(payload, index))
      } catch {
        malformedRecordCount += 1
      }
    })
    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)

    return {
      ok: true,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: state.schemaVersion,
      recordPayloadsIncluded: true,
      recordCount: rows.length,
      validSessionCount: sessions.length,
      messageCount: sessions.reduce((sum, session) => sum + session.messages.length, 0),
      malformedRecordCount,
      sessions,
      errorKind: null,
      errorMessage: null,
    }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: getLocalDataRuntimeStatusRef().schemaVersion,
      recordPayloadsIncluded: true,
      recordCount: 0,
      validSessionCount: 0,
      messageCount: 0,
      malformedRecordCount: 0,
      sessions: [],
      errorKind: getLocalDataRuntimeStatusRef().errorKind,
      errorMessage: getLocalDataRuntimeStatusRef().errorMessage,
    }
  } finally {
    if (db) db.close()
  }
}

function createChatComparisonBlockedResult(overrides = {}) {
  return {
    ok: false,
    targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
    schemaVersion: CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION,
    compared: false,
    recordPayloadsIncluded: false,
    status: 'blocked',
    sourceSessionCount: 0,
    sqliteSessionCount: 0,
    matchedRecordCount: 0,
    metadataAlignedRecordCount: 0,
    metadataMismatchCount: 0,
    missingSqliteRecordCount: 0,
    extraSqliteRecordCount: 0,
    malformedSqliteRecordCount: 0,
    sourceMessageCount: 0,
    sqliteMessageCount: 0,
    messageCountDelta: 0,
    sourcePayloadBytes: 0,
    sqlitePayloadBytes: 0,
    issueCodes: [],
    auditRecordId: null,
    errorKind: null,
    errorMessage: null,
    ...overrides,
  }
}

function createChatRuntimeMirrorResult(overrides = {}) {
  return {
    ok: false,
    targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
    schemaVersion: CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION,
    mirrored: false,
    deleted: false,
    recordsWritten: 0,
    recordsDeleted: 0,
    messageCount: 0,
    auditRecordId: null,
    errorKind: null,
    errorMessage: null,
    ...overrides,
  }
}

export async function compareChatLocalDataSessions(options = {}) {
  if (options.confirmed !== true) {
    return createChatComparisonBlockedResult({
      errorKind: 'local-data-chat-comparison-confirmation-required',
      errorMessage: 'Chat local-data comparison requires explicit confirmation.',
    })
  }

  let source
  try {
    source = normalizeChatComparisonSource(options.source)
  } catch {
    return createChatComparisonBlockedResult({
      errorKind: 'local-data-chat-comparison-invalid',
      errorMessage: 'Chat local-data comparison source is invalid.',
    })
  }

  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return createChatComparisonBlockedResult({
      schemaVersion: status.schemaVersion,
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    })
  }

  let db = null
  try {
    const comparedAt = nowIso(options.now)
    const { manifestPath, databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const records = readSqliteRecords(db, LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID)
    const sqliteSessions = []
    let malformedSqliteRecordCount = 0
    records.forEach((record, index) => {
      try {
        sqliteSessions.push(normalizeChatMigrationSession(record.payload, index))
      } catch {
        malformedSqliteRecordCount += 1
      }
    })

    const sourceSummary = summarizeChatComparisonSessions(source.sessions)
    const sqliteSummary = summarizeSqliteChatComparisonSessions(sqliteSessions)
    const metadata = compareChatSessionMetadata(source.sessions, sqliteSessions)
    const messageCountDelta = sqliteSummary.messageCount - sourceSummary.messageCount
    const issueCodes = chatComparisonIssueCodes({
      sourceSummary,
      sqliteSummary,
      malformedRecordCount: malformedSqliteRecordCount,
      metadata,
      messageCountDelta,
    })
    const comparisonStatus = issueCodes.length === 1 && issueCodes[0] === 'comparison-aligned'
      ? 'aligned'
      : sourceSummary.sessionCount === 0 && sqliteSummary.sessionCount === 0
        ? 'empty'
        : 'differences'
    const auditId = auditRecordId('chat-comparison', comparedAt)

    db.exec('BEGIN')
    try {
      insertLocalDataAuditRecord(db, auditId, {
        action: 'chat-sessions-comparison-previewed',
        comparedAt,
        sourceSessionCount: sourceSummary.sessionCount,
        sqliteSessionCount: sqliteSummary.sessionCount,
        matchedRecordCount: metadata.matchedRecordCount,
        metadataAlignedRecordCount: metadata.metadataAlignedRecordCount,
        metadataMismatchCount: metadata.metadataMismatchCount,
        missingSqliteRecordCount: metadata.missingSqliteRecordCount,
        extraSqliteRecordCount: metadata.extraSqliteRecordCount,
        malformedSqliteRecordCount,
        sourceMessageCount: sourceSummary.messageCount,
        sqliteMessageCount: sqliteSummary.messageCount,
        messageCountDelta,
        issueCodes,
        confirmed: true,
      }, comparedAt)
      setMeta(db, 'updatedAt', comparedAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }

    const state = readSqliteState(db)
    await atomicWriteJson(manifestPath, manifestFromSqliteState(state))
    setLocalDataRuntimeStatus(statusFromSqliteState(state))

    return {
      ok: true,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: state.schemaVersion,
      compared: true,
      recordPayloadsIncluded: false,
      status: comparisonStatus,
      sourceSessionCount: sourceSummary.sessionCount,
      sqliteSessionCount: sqliteSummary.sessionCount,
      matchedRecordCount: metadata.matchedRecordCount,
      metadataAlignedRecordCount: metadata.metadataAlignedRecordCount,
      metadataMismatchCount: metadata.metadataMismatchCount,
      missingSqliteRecordCount: metadata.missingSqliteRecordCount,
      extraSqliteRecordCount: metadata.extraSqliteRecordCount,
      malformedSqliteRecordCount,
      sourceMessageCount: sourceSummary.messageCount,
      sqliteMessageCount: sqliteSummary.messageCount,
      messageCountDelta,
      sourcePayloadBytes: sourceSummary.payloadBytes,
      sqlitePayloadBytes: sqliteSummary.payloadBytes,
      issueCodes,
      auditRecordId: auditId,
      errorKind: null,
      errorMessage: null,
    }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return createChatComparisonBlockedResult({
      schemaVersion: getLocalDataRuntimeStatusRef().schemaVersion,
      errorKind: getLocalDataRuntimeStatusRef().errorKind,
      errorMessage: getLocalDataRuntimeStatusRef().errorMessage,
    })
  } finally {
    if (db) db.close()
  }
}

export async function mirrorChatLocalDataSession(options = {}) {
  if (options.confirmed !== true) {
    return createChatRuntimeMirrorResult({
      errorKind: 'local-data-chat-runtime-mirror-confirmation-required',
      errorMessage: 'Chat runtime mirror requires explicit confirmation.',
    })
  }

  let normalizedSession
  try {
    normalizedSession = normalizeChatMigrationSession(options.session, 0)
  } catch {
    return createChatRuntimeMirrorResult({
      errorKind: 'local-data-chat-runtime-mirror-invalid',
      errorMessage: 'Chat runtime mirror session is invalid.',
    })
  }

  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return createChatRuntimeMirrorResult({
      schemaVersion: status.schemaVersion,
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    })
  }

  let db = null
  try {
    const mirroredAt = nowIso(options.now)
    const { manifestPath, databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)
    const auditId = auditRecordId('chat-runtime-mirror', mirroredAt)
    const shouldDelete = normalizedSession.messages.length === 0
    const existing = shouldDelete
      ? db.prepare(`
        SELECT COUNT(*) AS count
        FROM local_data_records
        WHERE domain_id = ? AND record_id = ?
      `).get(LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID, normalizedSession.id)?.count ?? 0
      : 0

    db.exec('BEGIN')
    try {
      ensureBuiltInDomains(db, mirroredAt)
      if (shouldDelete) {
        db.prepare(`
          DELETE FROM local_data_records
          WHERE domain_id = ? AND record_id = ?
        `).run(LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID, normalizedSession.id)
      } else {
        db.prepare(`
          INSERT INTO local_data_records (domain_id, record_id, payload_json, source, mirrored_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(domain_id, record_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            source = excluded.source,
            mirrored_at = excluded.mirrored_at,
            updated_at = excluded.updated_at
        `).run(
          LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
          normalizedSession.id,
          JSON.stringify(normalizedSession),
          'renderer-live-chat-runtime-mirror',
          mirroredAt,
          mirroredAt,
        )
      }

      insertLocalDataAuditRecord(db, auditId, {
        action: shouldDelete ? 'chat-session-runtime-mirror-deleted' : 'chat-session-runtime-mirrored',
        mirroredAt,
        messageCount: normalizedSession.messages.length,
        recordsWritten: shouldDelete ? 0 : 1,
        recordsDeleted: shouldDelete ? existing : 0,
        confirmed: true,
      }, mirroredAt)
      setMeta(db, 'updatedAt', mirroredAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }

    const state = readSqliteState(db)
    await atomicWriteJson(manifestPath, manifestFromSqliteState(state))
    setLocalDataRuntimeStatus(statusFromSqliteState(state))
    return {
      ok: true,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: state.schemaVersion,
      mirrored: !shouldDelete,
      deleted: shouldDelete,
      recordsWritten: shouldDelete ? 0 : 1,
      recordsDeleted: shouldDelete ? existing : 0,
      messageCount: normalizedSession.messages.length,
      auditRecordId: auditId,
      errorKind: null,
      errorMessage: null,
    }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return createChatRuntimeMirrorResult({
      schemaVersion: getLocalDataRuntimeStatusRef().schemaVersion,
      errorKind: getLocalDataRuntimeStatusRef().errorKind,
      errorMessage: getLocalDataRuntimeStatusRef().errorMessage,
    })
  } finally {
    if (db) db.close()
  }
}

