import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import {
  LOCAL_DATA_AUDIT_DOMAIN_ID,
  LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID,
  LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID,
  initializeLocalDataStore,
  readLocalDataDomainRecords,
  readLocalDataSqliteState,
  resolveLocalDataPaths,
} from './localDataStore.js'
import {
  MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION,
  normalizeMemoryMigrationDailyEntry,
  normalizeMemoryMigrationItem,
  normalizeMemoryMigrationPackage,
  summarizeMemoryMigrationPackage,
} from './localDataMemoryMigration.js'

const require = createRequire(import.meta.url)

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}
function openDatabase(databasePath) {
  const db = new (require('node:sqlite').DatabaseSync)(databasePath)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  return db
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_data_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS domain_registry (
      id TEXT PRIMARY KEY,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_data_records (
      domain_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      source TEXT NOT NULL,
      mirrored_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (domain_id, record_id),
      FOREIGN KEY (domain_id) REFERENCES domain_registry(id) ON DELETE CASCADE
    );
  `)
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO local_data_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value))
}

function auditRecordId(prefix, timestamp) {
  return `${prefix}-${timestamp.replace(/[:.]/g, '-')}`
}

function insertRecord(db, domainId, recordId, payload, source, timestamp) {
  db.prepare(`
    INSERT INTO local_data_records (domain_id, record_id, payload_json, source, mirrored_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain_id, record_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      source = excluded.source,
      mirrored_at = excluded.mirrored_at,
      updated_at = excluded.updated_at
  `).run(domainId, recordId, JSON.stringify(payload), source, timestamp, timestamp)
}

function insertAuditRecord(db, recordId, payload, timestamp) {
  insertRecord(db, LOCAL_DATA_AUDIT_DOMAIN_ID, recordId, payload, 'main-process-local-data-service', timestamp)
}

async function refreshManifest(options, updatedAt) {
  const state = await readLocalDataSqliteState(options)
  const { manifestPath } = await resolveLocalDataPaths(options)
  const manifest = {
    format: 'nexus-local-data-manifest',
    formatVersion: 1,
    backend: state.backend,
    schemaVersion: state.schemaVersion,
    createdAt: state.createdAt,
    updatedAt,
    migrations: state.migrations,
    domains: Object.fromEntries(state.domains.map((domain) => [domain.id, domain.metadata])),
  }
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fs.rename(tempPath, manifestPath)
  return state
}

function targetDomainIds() {
  return [LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID, LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID]
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
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openDatabase(databasePath)
    ensureTables(db)
    const auditId = auditRecordId('memory-migration', appliedAt)
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM local_data_records WHERE domain_id IN (?, ?)').run(...targetDomainIds())
      for (const memory of normalized.migrationPackage.longTerm) {
        insertRecord(db, LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID, memory.id, memory, 'renderer-localStorage-memory-migration', appliedAt)
      }
      for (const entry of normalized.migrationPackage.daily) {
        insertRecord(db, LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID, entry.id, entry, 'renderer-localStorage-memory-migration', appliedAt)
      }
      insertAuditRecord(db, auditId, {
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
    const state = await refreshManifest(options, appliedAt)
    return { ...planned, ok: true, applied: true, recordsWritten: normalized.migrationPackage.longTerm.length + normalized.migrationPackage.daily.length, schemaVersion: state.schemaVersion, auditRecordId: auditId, errorKind: null, errorMessage: null }
  } catch {
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
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openDatabase(databasePath)
    ensureTables(db)
    const existing = db.prepare('SELECT COUNT(*) AS count FROM local_data_records WHERE domain_id IN (?, ?)').get(...domains)?.count ?? 0
    const auditId = auditRecordId('memory-migration-rollback', rolledBackAt)
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM local_data_records WHERE domain_id IN (?, ?)').run(...domains)
      insertAuditRecord(db, auditId, { action: 'memory-migration-rolled-back', rolledBackAt, recordsDeleted: existing }, rolledBackAt)
      setMeta(db, 'updatedAt', rolledBackAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }
    const state = await refreshManifest(options, rolledBackAt)
    return { ok: true, targetDomainIds: domains, recordsDeleted: existing, schemaVersion: state.schemaVersion, auditRecordId: auditId, errorKind: null, errorMessage: null }
  } catch {
    return { ok: false, targetDomainIds: domains, recordsDeleted: 0, auditRecordId: null, errorKind: 'local-data-memory-migration-failed', errorMessage: 'Memory migration rollback could not be completed.' }
  } finally {
    if (db) db.close()
  }
}

async function readMemoryAudit(options) {
  const records = await readLocalDataDomainRecords(LOCAL_DATA_AUDIT_DOMAIN_ID, options)
  return records
    .filter((record) => record.payload?.action === 'memory-migration-applied' || record.payload?.action === 'memory-migration-rolled-back')
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] ?? null
}

export async function getMemoryLocalDataMigrationStatus(options = {}) {
  const domains = targetDomainIds()
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, longTermRecordCount: 0, dailyEntryCount: 0, recordPayloadsIncluded: false, lastAuditRecordId: null, lastAuditAction: null, lastAuditAt: null, errorKind: status.errorKind, errorMessage: status.errorMessage }
  }
  try {
    const [longTerm, daily, audit] = await Promise.all([
      readLocalDataDomainRecords(LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID, options),
      readLocalDataDomainRecords(LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID, options),
      readMemoryAudit(options),
    ])
    return { ok: true, targetDomainIds: domains, schemaVersion: status.schemaVersion, longTermRecordCount: longTerm.length, dailyEntryCount: daily.length, recordPayloadsIncluded: false, lastAuditRecordId: audit?.recordId ?? null, lastAuditAction: audit?.payload?.action ?? null, lastAuditAt: audit?.payload?.appliedAt || audit?.payload?.rolledBackAt || audit?.updatedAt || null, errorKind: null, errorMessage: null }
  } catch {
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, longTermRecordCount: 0, dailyEntryCount: 0, recordPayloadsIncluded: false, lastAuditRecordId: null, lastAuditAction: null, lastAuditAt: null, errorKind: 'local-data-memory-migration-failed', errorMessage: 'Memory migration status is unavailable.' }
  }
}

export async function readMemoryLocalData(options = {}) {
  const domains = targetDomainIds()
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, recordPayloadsIncluded: true, longTermRecordCount: 0, dailyEntryCount: 0, malformedRecordCount: 0, memories: [], daily: [], errorKind: status.errorKind, errorMessage: status.errorMessage }
  }
  try {
    const [longTermRows, dailyRows] = await Promise.all([
      readLocalDataDomainRecords(LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID, options),
      readLocalDataDomainRecords(LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID, options),
    ])
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
  } catch {
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, recordPayloadsIncluded: true, longTermRecordCount: 0, dailyEntryCount: 0, malformedRecordCount: 0, memories: [], daily: [], errorKind: 'local-data-memory-migration-failed', errorMessage: 'Memory records are unavailable.' }
  }
}
