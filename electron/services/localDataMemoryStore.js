/**
 * Memory-domain local-data operations (migration plan/apply/rollback, status, readback).
 * Mirrors the chat-domain module structure so the SQLite foundation stays in core.
 */
import {
  LOCAL_DATA_AUDIT_DOMAIN_ID,
  LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID,
  LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID,
  initializeLocalDataStore,
  resolveLocalDataPaths,
  setLocalDataRuntimeStatus,
  nowIso,
  openSqliteDatabase,
  ensureSqliteTables,
  ensureBuiltInDomains,
  auditRecordId,
  insertLocalDataAuditRecord,
  setMeta,
  readSqliteState,
  readSqliteRecords,
  atomicWriteJson,
  manifestFromSqliteState,
  statusFromSqliteState,
  statusFromError,
} from './localDataStoreCore.js'
import {
  MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION,
  normalizeMemoryMigrationDailyEntry,
  normalizeMemoryMigrationItem,
  normalizeMemoryMigrationPackage,
  summarizeMemoryMigrationPackage,
} from './localDataMemoryMigration.js'

function targetDomainIds() {
  return [LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID, LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID]
}

function insertMemoryRecord(db, domainId, recordId, payload, timestamp) {
  db.prepare(`
    INSERT INTO local_data_records (domain_id, record_id, payload_json, source, mirrored_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain_id, record_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      source = excluded.source,
      mirrored_at = excluded.mirrored_at,
      updated_at = excluded.updated_at
  `).run(domainId, recordId, JSON.stringify(payload), 'renderer-localStorage-memory-migration', timestamp, timestamp)
}

export function planMemoryLocalDataMigration(migrationPackage) {
  try {
    const normalized = normalizeMemoryMigrationPackage(migrationPackage)
    return {
      ok: true,
      ...summarizeMemoryMigrationPackage(normalized.migrationPackage, normalized.payloadBytes),
      errorKind: null,
      errorMessage: null,
    }
  } catch {
    return {
      ok: false,
      targetDomainIds: targetDomainIds(),
      schemaVersion: MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION,
      longTermRecordCount: 0,
      dailyEntryCount: 0,
      payloadBytes: 0,
      legacyLongTermUsed: false,
      requiresConfirmation: true,
      writesData: false,
      errorKind: 'local-data-memory-migration-invalid',
      errorMessage: 'Memory migration package is invalid.',
    }
  }
}

export async function applyMemoryLocalDataMigration(options = {}) {
  const planned = planMemoryLocalDataMigration(options.migrationPackage)
  if (!planned.ok) return { ...planned, applied: false, recordsWritten: 0, auditRecordId: null }
  if (options.confirmed !== true) {
    return {
      ...planned,
      ok: false,
      applied: false,
      recordsWritten: 0,
      auditRecordId: null,
      errorKind: 'local-data-memory-migration-confirmation-required',
      errorMessage: 'Memory migration requires explicit confirmation.',
    }
  }

  const normalized = normalizeMemoryMigrationPackage(options.migrationPackage)
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return { ...planned, ok: false, applied: false, recordsWritten: 0, auditRecordId: null, errorKind: status.errorKind, errorMessage: status.errorMessage }
  }

  let db = null
  try {
    const appliedAt = nowIso(options.now)
    const { manifestPath, databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const auditId = auditRecordId('memory-migration', appliedAt)
    db.exec('BEGIN')
    try {
      ensureBuiltInDomains(db, appliedAt)
      db.prepare('DELETE FROM local_data_records WHERE domain_id IN (?, ?)').run(...targetDomainIds())
      for (const memory of normalized.migrationPackage.longTerm) {
        insertMemoryRecord(db, LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID, memory.id, memory, appliedAt)
      }
      for (const entry of normalized.migrationPackage.daily) {
        insertMemoryRecord(db, LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID, entry.id, entry, appliedAt)
      }
      insertLocalDataAuditRecord(db, auditId, {
        action: 'memory-migration-applied',
        appliedAt,
        longTermRecordCount: planned.longTermRecordCount,
        dailyEntryCount: planned.dailyEntryCount,
        payloadBytes: planned.payloadBytes,
        legacyLongTermUsed: planned.legacyLongTermUsed,
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

    return { ...planned, ok: true, applied: true, recordsWritten: normalized.migrationPackage.longTerm.length + normalized.migrationPackage.daily.length, schemaVersion: state.schemaVersion, auditRecordId: auditId, errorKind: null, errorMessage: null }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return { ...planned, ok: false, applied: false, recordsWritten: 0, auditRecordId: null, errorKind: 'local-data-memory-migration-failed', errorMessage: 'Memory migration could not be completed.' }
  } finally {
    if (db) db.close()
  }
}

export async function rollbackMemoryLocalDataMigration(options = {}) {
  const domains = targetDomainIds()
  if (options.confirmed !== true) {
    return { ok: false, targetDomainIds: domains, recordsDeleted: 0, auditRecordId: null, errorKind: 'local-data-memory-migration-confirmation-required', errorMessage: 'Memory migration rollback requires explicit confirmation.' }
  }
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return { ok: false, targetDomainIds: domains, recordsDeleted: 0, auditRecordId: null, errorKind: status.errorKind, errorMessage: status.errorMessage }
  }

  let db = null
  try {
    const rolledBackAt = nowIso(options.now)
    const { manifestPath, databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const existing = db.prepare('SELECT COUNT(*) AS count FROM local_data_records WHERE domain_id IN (?, ?)').get(...domains)?.count ?? 0
    const auditId = auditRecordId('memory-migration-rollback', rolledBackAt)

    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM local_data_records WHERE domain_id IN (?, ?)').run(...domains)
      insertLocalDataAuditRecord(db, auditId, { action: 'memory-migration-rolled-back', rolledBackAt, recordsDeleted: existing }, rolledBackAt)
      setMeta(db, 'updatedAt', rolledBackAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }

    const state = readSqliteState(db)
    await atomicWriteJson(manifestPath, manifestFromSqliteState(state))
    setLocalDataRuntimeStatus(statusFromSqliteState(state))

    return { ok: true, targetDomainIds: domains, recordsDeleted: existing, schemaVersion: state.schemaVersion, auditRecordId: auditId, errorKind: null, errorMessage: null }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return { ok: false, targetDomainIds: domains, recordsDeleted: 0, auditRecordId: null, errorKind: 'local-data-memory-migration-failed', errorMessage: 'Memory migration rollback could not be completed.' }
  } finally {
    if (db) db.close()
  }
}

function readMemoryAudit(db) {
  return readSqliteRecords(db, LOCAL_DATA_AUDIT_DOMAIN_ID)
    .filter((record) => record.payload?.action === 'memory-migration-applied' || record.payload?.action === 'memory-migration-rolled-back')
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] ?? null
}

export async function getMemoryLocalDataMigrationStatus(options = {}) {
  const domains = targetDomainIds()
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, longTermRecordCount: 0, dailyEntryCount: 0, recordPayloadsIncluded: false, lastAuditRecordId: null, lastAuditAction: null, lastAuditAt: null, errorKind: status.errorKind, errorMessage: status.errorMessage }
  }

  let db = null
  try {
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const longTerm = readSqliteRecords(db, LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID)
    const daily = readSqliteRecords(db, LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID)
    const audit = readMemoryAudit(db)

    return { ok: true, targetDomainIds: domains, schemaVersion: status.schemaVersion, longTermRecordCount: longTerm.length, dailyEntryCount: daily.length, recordPayloadsIncluded: false, lastAuditRecordId: audit?.recordId ?? null, lastAuditAction: audit?.payload?.action ?? null, lastAuditAt: audit?.payload?.appliedAt || audit?.payload?.rolledBackAt || audit?.updatedAt || null, errorKind: null, errorMessage: null }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, longTermRecordCount: 0, dailyEntryCount: 0, recordPayloadsIncluded: false, lastAuditRecordId: null, lastAuditAction: null, lastAuditAt: null, errorKind: 'local-data-memory-migration-failed', errorMessage: 'Memory migration status is unavailable.' }
  } finally {
    if (db) db.close()
  }
}

export async function readMemoryLocalData(options = {}) {
  const domains = targetDomainIds()
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, recordPayloadsIncluded: true, longTermRecordCount: 0, dailyEntryCount: 0, malformedRecordCount: 0, memories: [], daily: [], errorKind: status.errorKind, errorMessage: status.errorMessage }
  }

  let db = null
  try {
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const longTermRows = readSqliteRecords(db, LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID)
    const dailyRows = readSqliteRecords(db, LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID)
    const memories = []
    const daily = []
    let malformedRecordCount = 0
    longTermRows.forEach((record, index) => {
      try { memories.push(normalizeMemoryMigrationItem(record.payload, index)) } catch { malformedRecordCount += 1 }
    })
    dailyRows.forEach((record, index) => {
      try { daily.push(normalizeMemoryMigrationDailyEntry(record.payload, index)) } catch { malformedRecordCount += 1 }
    })
    memories.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    daily.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    return { ok: true, targetDomainIds: domains, schemaVersion: status.schemaVersion, recordPayloadsIncluded: true, longTermRecordCount: longTermRows.length, dailyEntryCount: dailyRows.length, malformedRecordCount, memories, daily, errorKind: null, errorMessage: null }
  } catch (error) {
    setLocalDataRuntimeStatus(statusFromError(error))
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, recordPayloadsIncluded: true, longTermRecordCount: 0, dailyEntryCount: 0, malformedRecordCount: 0, memories: [], daily: [], errorKind: 'local-data-memory-migration-failed', errorMessage: 'Memory records are unavailable.' }
  } finally {
    if (db) db.close()
  }
}
