import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import {
  LOCAL_DATA_AUDIT_DOMAIN_ID,
  LOCAL_DATA_COMPANION_RELATIONSHIP_DOMAIN_ID,
  LOCAL_DATA_COMPANION_TASKS_DOMAIN_ID,
  initializeLocalDataStore,
  readLocalDataDomainRecords,
  readLocalDataSqliteState,
  resolveLocalDataPaths,
} from './localDataStore.js'

export const COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION = 1
const MAX_DATASET_BYTES = 2_000_000
const MAX_TOTAL_BYTES = 20_000_000
const MAX_ARRAY_ITEMS = 2_000
const MAX_OBJECT_KEYS = 128
const MAX_DEPTH = 8
const require = createRequire(import.meta.url)

const RELATIONSHIP_DATASETS = Object.freeze([
  ['relationship-state', 'nexus:autonomy:relationship'],
  ['relationship-history', 'nexus:autonomy:relationship-history'],
  ['emotion-state', 'nexus:autonomy:emotion'],
  ['emotion-history', 'nexus:autonomy:emotion-history'],
  ['rhythm-state', 'nexus:autonomy:rhythm'],
  ['user-affect-history', 'nexus:autonomy:user-affect-history'],
])

const TASK_DATASETS = Object.freeze([
  ['plans', 'nexus:plans'],
  ['open-goals', 'nexus:open-goals'],
  ['agent-traces', 'nexus:agent-traces'],
  ['background-tasks', 'nexus:background-tasks'],
  ['errands', 'nexus:agent:errands'],
  ['reminder-tasks', 'nexus:reminder-tasks'],
])

const DATASET_SPECS = new Map(
  [...RELATIONSHIP_DATASETS, ...TASK_DATASETS].map(([id, storageKey]) => [storageKey, { id, storageKey }]),
)

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function normalizeJsonValue(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('companion dataset nesting is too deep')
  if (value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('companion dataset contains a non-finite number')
    if (typeof value === 'string' && value.length > 4_000) throw new Error('companion dataset contains oversized text')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new Error('companion dataset contains too many items')
    return value.map((item) => normalizeJsonValue(item, depth + 1))
  }
  if (typeof value !== 'object') throw new Error('companion dataset contains a non-JSON value')
  const keys = Object.keys(value)
  if (keys.length > MAX_OBJECT_KEYS) throw new Error('companion dataset contains too many fields')
  return Object.fromEntries(keys.map((key) => {
    if (key.length > 120) throw new Error('companion dataset contains an oversized field name')
    return [key, normalizeJsonValue(value[key], depth + 1)]
  }))
}

export function normalizeCompanionDataset(dataset) {
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
    throw new Error('companion dataset must be an object')
  }
  const spec = DATASET_SPECS.get(String(dataset.storageKey ?? ''))
  if (!spec || (dataset.id != null && dataset.id !== spec.id)) throw new Error('companion dataset identity is invalid')
  const value = normalizeJsonValue(dataset.value ?? null)
  const payloadBytes = byteLength(value)
  if (payloadBytes > MAX_DATASET_BYTES) throw new Error('companion dataset exceeds its size limit')
  return {
    id: spec.id,
    storageKey: spec.storageKey,
    value,
    recordCount: Array.isArray(value) ? value.length : value == null ? 0 : 1,
    payloadBytes,
  }
}

export function normalizeCompanionMigrationPackage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('companion migration package must be an object')
  if (input.schemaVersion !== COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION) throw new Error('companion migration package schema is unsupported')
  if (typeof input.createdAt !== 'string' || !input.createdAt.trim()) throw new Error('companion migration package timestamp is invalid')
  const relationship = (Array.isArray(input.relationship) ? input.relationship : []).map(normalizeCompanionDataset)
  const tasks = (Array.isArray(input.tasks) ? input.tasks : []).map(normalizeCompanionDataset)
  const all = [...relationship, ...tasks]
  if (new Set(all.map((dataset) => dataset.storageKey)).size !== all.length) throw new Error('companion migration package contains duplicate datasets')
  if (byteLength(all.map((dataset) => dataset.value)) > MAX_TOTAL_BYTES) throw new Error('companion migration package exceeds its size limit')
  return {
    migrationPackage: {
      schemaVersion: COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION,
      createdAt: new Date(input.createdAt).toISOString(),
      source: input.source && typeof input.source === 'object' && !Array.isArray(input.source)
        ? { ...input.source }
        : {},
      relationship,
      tasks,
    },
    payloadBytes: all.reduce((total, dataset) => total + dataset.payloadBytes, 0),
  }
}

export function summarizeCompanionMigrationPackage(migrationPackage, payloadBytes) {
  const relationshipRecordCount = migrationPackage.relationship.reduce((total, dataset) => total + dataset.recordCount, 0)
  const taskRecordCount = migrationPackage.tasks.reduce((total, dataset) => total + dataset.recordCount, 0)
  return {
    targetDomainIds: [LOCAL_DATA_COMPANION_RELATIONSHIP_DOMAIN_ID, LOCAL_DATA_COMPANION_TASKS_DOMAIN_ID],
    schemaVersion: COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION,
    relationshipDatasetCount: migrationPackage.relationship.length,
    taskDatasetCount: migrationPackage.tasks.length,
    relationshipRecordCount,
    taskRecordCount,
    totalRecordCount: relationshipRecordCount + taskRecordCount,
    payloadBytes,
    requiresConfirmation: true,
    writesData: migrationPackage.relationship.length > 0 || migrationPackage.tasks.length > 0,
  }
}

function normalizeCompanionComparisonSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('companion comparison source must be an object')
  if (input.schemaVersion !== COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION) throw new Error('companion comparison schema is unsupported')
  const normalizeDataset = (dataset) => {
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) throw new Error('companion comparison dataset is invalid')
    const spec = DATASET_SPECS.get(String(dataset.storageKey ?? ''))
    if (!spec || dataset.id !== spec.id) throw new Error('companion comparison dataset identity is invalid')
    if (!Number.isInteger(dataset.recordCount) || dataset.recordCount < 0 || dataset.recordCount > MAX_ARRAY_ITEMS) throw new Error('companion comparison record count is invalid')
    if (!Number.isInteger(dataset.payloadBytes) || dataset.payloadBytes < 0 || dataset.payloadBytes > MAX_DATASET_BYTES) throw new Error('companion comparison payload size is invalid')
    return { id: spec.id, storageKey: spec.storageKey, recordCount: dataset.recordCount, payloadBytes: dataset.payloadBytes }
  }
  const relationship = (Array.isArray(input.relationship) ? input.relationship : []).map(normalizeDataset)
  const tasks = (Array.isArray(input.tasks) ? input.tasks : []).map(normalizeDataset)
  const all = [...relationship, ...tasks]
  if (new Set(all.map((dataset) => dataset.storageKey)).size !== all.length) throw new Error('companion comparison contains duplicate datasets')
  return { schemaVersion: COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION, relationship, tasks }
}

function emptyCompanionComparison(errorKind = null, errorMessage = null) {
  return {
    ok: errorKind == null,
    targetDomainIds: targetDomainIds(),
    schemaVersion: COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION,
    compared: false,
    recordPayloadsIncluded: false,
    status: 'blocked',
    sourceDatasetCount: 0,
    sqliteDatasetCount: 0,
    matchedDatasetCount: 0,
    metadataMismatchCount: 0,
    missingSqliteDatasetCount: 0,
    extraSqliteDatasetCount: 0,
    malformedSqliteRecordCount: 0,
    sourceRecordCount: 0,
    sqliteRecordCount: 0,
    sourcePayloadBytes: 0,
    sqlitePayloadBytes: 0,
    issueCodes: [],
    auditRecordId: null,
    errorKind,
    errorMessage,
  }
}

async function writeCompanionComparisonAudit(options, result, comparedAt) {
  let db = null
  try {
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openDatabase(databasePath)
    ensureTables(db)
    const auditId = auditRecordId('companion-comparison', comparedAt)
    db.exec('BEGIN')
    try {
      insertAuditRecord(db, auditId, {
        action: 'companion-migration-compared',
        comparedAt,
        status: result.status,
        sourceDatasetCount: result.sourceDatasetCount,
        sqliteDatasetCount: result.sqliteDatasetCount,
        matchedDatasetCount: result.matchedDatasetCount,
        metadataMismatchCount: result.metadataMismatchCount,
        missingSqliteDatasetCount: result.missingSqliteDatasetCount,
        extraSqliteDatasetCount: result.extraSqliteDatasetCount,
        malformedSqliteRecordCount: result.malformedSqliteRecordCount,
        sourceRecordCount: result.sourceRecordCount,
        sqliteRecordCount: result.sqliteRecordCount,
        sourcePayloadBytes: result.sourcePayloadBytes,
        sqlitePayloadBytes: result.sqlitePayloadBytes,
        issueCodeCount: result.issueCodes.length,
        confirmed: true,
      }, comparedAt)
      setMeta(db, 'updatedAt', comparedAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }
    await refreshManifest(options, comparedAt)
    return auditId
  } catch {
    return null
  } finally {
    if (db) db.close()
  }
}

function openDatabase(databasePath) {
  const db = new (require('node:sqlite').DatabaseSync)(databasePath)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  return db
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_data_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS domain_registry (id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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
  db.prepare('INSERT INTO local_data_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value))
}

function insertRecord(db, domainId, recordId, payload, source, timestamp) {
  db.prepare(`
    INSERT INTO local_data_records (domain_id, record_id, payload_json, source, mirrored_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain_id, record_id) DO UPDATE SET payload_json = excluded.payload_json, source = excluded.source, mirrored_at = excluded.mirrored_at, updated_at = excluded.updated_at
  `).run(domainId, recordId, JSON.stringify(payload), source, timestamp, timestamp)
}

function auditRecordId(prefix, timestamp) {
  return `${prefix}-${timestamp.replace(/[:.]/g, '-')}`
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

function domainForDataset(dataset) {
  return RELATIONSHIP_DATASETS.some(([id]) => id === dataset.id)
    ? LOCAL_DATA_COMPANION_RELATIONSHIP_DOMAIN_ID
    : LOCAL_DATA_COMPANION_TASKS_DOMAIN_ID
}

function targetDomainIds() {
  return [LOCAL_DATA_COMPANION_RELATIONSHIP_DOMAIN_ID, LOCAL_DATA_COMPANION_TASKS_DOMAIN_ID]
}

function planInvalid(errorKind, errorMessage) {
  return {
    ok: false,
    ...summarizeCompanionMigrationPackage({ relationship: [], tasks: [] }, 0),
    errorKind,
    errorMessage,
  }
}

export function planCompanionLocalDataMigration(migrationPackage) {
  try {
    const normalized = normalizeCompanionMigrationPackage(migrationPackage)
    return { ok: true, ...summarizeCompanionMigrationPackage(normalized.migrationPackage, normalized.payloadBytes), errorKind: null, errorMessage: null }
  } catch {
    return planInvalid('local-data-companion-migration-invalid', 'Companion migration package is invalid.')
  }
}

export async function applyCompanionLocalDataMigration(options = {}) {
  const planned = planCompanionLocalDataMigration(options.migrationPackage)
  if (!planned.ok) return { ...planned, applied: false, recordsWritten: 0, auditRecordId: null }
  if (options.confirmed !== true) return { ...planned, ok: false, applied: false, recordsWritten: 0, auditRecordId: null, errorKind: 'local-data-companion-migration-confirmation-required', errorMessage: 'Companion migration requires explicit confirmation.' }
  const normalized = normalizeCompanionMigrationPackage(options.migrationPackage)
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) return { ...planned, ok: false, applied: false, recordsWritten: 0, auditRecordId: null, errorKind: status.errorKind, errorMessage: status.errorMessage }
  let db = null
  try {
    const appliedAt = nowIso(options.now)
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openDatabase(databasePath)
    ensureTables(db)
    const auditId = auditRecordId('companion-migration', appliedAt)
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM local_data_records WHERE domain_id IN (?, ?)').run(...targetDomainIds())
      for (const dataset of [...normalized.migrationPackage.relationship, ...normalized.migrationPackage.tasks]) {
        insertRecord(db, domainForDataset(dataset), dataset.id, { storageKey: dataset.storageKey, value: dataset.value }, 'renderer-localStorage-companion-migration', appliedAt)
      }
      insertAuditRecord(db, auditId, { action: 'companion-migration-applied', appliedAt, relationshipDatasetCount: planned.relationshipDatasetCount, taskDatasetCount: planned.taskDatasetCount, totalRecordCount: planned.totalRecordCount, payloadBytes: planned.payloadBytes, confirmed: true }, appliedAt)
      setMeta(db, 'updatedAt', appliedAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }
    const state = await refreshManifest(options, appliedAt)
    return { ...planned, ok: true, applied: true, recordsWritten: normalized.migrationPackage.relationship.length + normalized.migrationPackage.tasks.length, schemaVersion: state.schemaVersion, auditRecordId: auditId, errorKind: null, errorMessage: null }
  } catch {
    return { ...planned, ok: false, applied: false, recordsWritten: 0, auditRecordId: null, errorKind: 'local-data-companion-migration-failed', errorMessage: 'Companion migration could not be completed.' }
  } finally {
    if (db) db.close()
  }
}

export async function compareCompanionLocalData(options = {}) {
  if (options.confirmed !== true) {
    return { ...emptyCompanionComparison(), ok: false, errorKind: 'local-data-companion-migration-confirmation-required', errorMessage: 'Companion comparison requires explicit confirmation.' }
  }

  let source
  try {
    source = normalizeCompanionComparisonSource(options.source)
  } catch {
    return { ...emptyCompanionComparison('local-data-companion-comparison-invalid', 'Companion comparison source is invalid.') }
  }

  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return { ...emptyCompanionComparison(status.errorKind, status.errorMessage), schemaVersion: status.schemaVersion }
  }

  try {
    const read = await readCompanionLocalData(options)
    if (!read.ok) return { ...emptyCompanionComparison(read.errorKind, read.errorMessage), schemaVersion: read.schemaVersion }

    const sourceDatasets = [...source.relationship, ...source.tasks]
    const sqliteDatasets = [...read.relationship, ...read.tasks]
    const sourceByKey = new Map(sourceDatasets.map((dataset) => [dataset.storageKey, dataset]))
    const sqliteByKey = new Map(sqliteDatasets.map((dataset) => [dataset.storageKey, dataset]))
    const issueCodes = []
    let matchedDatasetCount = 0
    let metadataMismatchCount = 0
    let missingSqliteDatasetCount = 0
    let extraSqliteDatasetCount = 0
    for (const [storageKey, dataset] of sourceByKey) {
      const sqlite = sqliteByKey.get(storageKey)
      if (!sqlite) {
        missingSqliteDatasetCount += 1
        issueCodes.push(`missing:${storageKey}`)
        continue
      }
      if (dataset.recordCount === sqlite.recordCount && dataset.payloadBytes === sqlite.payloadBytes) matchedDatasetCount += 1
      else {
        metadataMismatchCount += 1
        issueCodes.push(`mismatch:${storageKey}`)
      }
    }
    for (const storageKey of sqliteByKey.keys()) {
      if (!sourceByKey.has(storageKey)) {
        extraSqliteDatasetCount += 1
        issueCodes.push(`extra:${storageKey}`)
      }
    }
    const sourceRecordCount = sourceDatasets.reduce((sum, dataset) => sum + dataset.recordCount, 0)
    const sqliteRecordCount = sqliteDatasets.reduce((sum, dataset) => sum + dataset.recordCount, 0)
    const sourcePayloadBytes = sourceDatasets.reduce((sum, dataset) => sum + dataset.payloadBytes, 0)
    const sqlitePayloadBytes = sqliteDatasets.reduce((sum, dataset) => sum + (dataset.payloadBytes ?? 0), 0)
    const result = {
      ...emptyCompanionComparison(),
      ok: true,
      schemaVersion: status.schemaVersion,
      compared: true,
      status: sourceDatasets.length === 0 && sqliteDatasets.length === 0
        ? 'empty'
        : issueCodes.length === 0 ? 'aligned' : 'differences',
      sourceDatasetCount: sourceDatasets.length,
      sqliteDatasetCount: sqliteDatasets.length,
      matchedDatasetCount,
      metadataMismatchCount,
      missingSqliteDatasetCount,
      extraSqliteDatasetCount,
      malformedSqliteRecordCount: read.malformedRecordCount,
      sourceRecordCount,
      sqliteRecordCount,
      sourcePayloadBytes,
      sqlitePayloadBytes,
      issueCodes,
      errorKind: null,
      errorMessage: null,
    }
    const auditId = await writeCompanionComparisonAudit(options, result, nowIso(options.now))
    return { ...result, auditRecordId: auditId }
  } catch {
    return { ...emptyCompanionComparison('local-data-companion-migration-failed', 'Companion comparison is unavailable.') }
  }
}

export async function mirrorCompanionLocalDataDataset(options = {}) {
  if (options.confirmed !== true) return { ok: false, mirrored: false, errorKind: 'local-data-companion-migration-confirmation-required', errorMessage: 'Companion dataset mirroring requires explicit confirmation.' }
  let dataset
  try { dataset = normalizeCompanionDataset(options) } catch { return { ok: false, mirrored: false, errorKind: 'local-data-companion-dataset-invalid', errorMessage: 'Companion dataset is invalid.' } }
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) return { ok: false, mirrored: false, errorKind: status.errorKind, errorMessage: status.errorMessage }
  let db = null
  try {
    const mirroredAt = nowIso(options.now)
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openDatabase(databasePath)
    ensureTables(db)
    db.exec('BEGIN')
    try {
      insertRecord(db, domainForDataset(dataset), dataset.id, { storageKey: dataset.storageKey, value: dataset.value }, 'renderer-localStorage-companion-authority', mirroredAt)
      setMeta(db, 'updatedAt', mirroredAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }
    const state = await refreshManifest(options, mirroredAt)
    return { ok: true, mirrored: true, datasetId: dataset.id, schemaVersion: state.schemaVersion, errorKind: null, errorMessage: null }
  } catch {
    return { ok: false, mirrored: false, errorKind: 'local-data-companion-migration-failed', errorMessage: 'Companion dataset could not be mirrored.' }
  } finally {
    if (db) db.close()
  }
}

export async function rollbackCompanionLocalDataMigration(options = {}) {
  const domains = targetDomainIds()
  if (options.confirmed !== true) return { ok: false, targetDomainIds: domains, recordsDeleted: 0, auditRecordId: null, errorKind: 'local-data-companion-migration-confirmation-required', errorMessage: 'Companion migration rollback requires explicit confirmation.' }
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) return { ok: false, targetDomainIds: domains, recordsDeleted: 0, auditRecordId: null, errorKind: status.errorKind, errorMessage: status.errorMessage }
  let db = null
  try {
    const rolledBackAt = nowIso(options.now)
    const { databasePath } = await resolveLocalDataPaths(options)
    db = openDatabase(databasePath)
    ensureTables(db)
    const existing = db.prepare('SELECT COUNT(*) AS count FROM local_data_records WHERE domain_id IN (?, ?)').get(...domains)?.count ?? 0
    const auditId = auditRecordId('companion-migration-rollback', rolledBackAt)
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM local_data_records WHERE domain_id IN (?, ?)').run(...domains)
      insertAuditRecord(db, auditId, { action: 'companion-migration-rolled-back', rolledBackAt, recordsDeleted: existing }, rolledBackAt)
      setMeta(db, 'updatedAt', rolledBackAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }
    const state = await refreshManifest(options, rolledBackAt)
    return { ok: true, targetDomainIds: domains, recordsDeleted: existing, schemaVersion: state.schemaVersion, auditRecordId: auditId, errorKind: null, errorMessage: null }
  } catch {
    return { ok: false, targetDomainIds: domains, recordsDeleted: 0, auditRecordId: null, errorKind: 'local-data-companion-migration-failed', errorMessage: 'Companion migration rollback could not be completed.' }
  } finally {
    if (db) db.close()
  }
}

async function readCompanionAudit(options) {
  const records = await readLocalDataDomainRecords(LOCAL_DATA_AUDIT_DOMAIN_ID, options)
  return records
    .filter((record) => record.payload?.action === 'companion-migration-applied' || record.payload?.action === 'companion-migration-rolled-back' || record.payload?.action === 'companion-migration-compared')
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] ?? null
}

export async function getCompanionLocalDataMigrationStatus(options = {}) {
  const domains = targetDomainIds()
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, relationshipDatasetCount: 0, taskDatasetCount: 0, totalRecordCount: 0, payloadBytes: 0, recordPayloadsIncluded: false, lastAuditRecordId: null, lastAuditAction: null, lastAuditAt: null, errorKind: status.errorKind, errorMessage: status.errorMessage }
  try {
    const [relationship, tasks, audit] = await Promise.all([
      readLocalDataDomainRecords(LOCAL_DATA_COMPANION_RELATIONSHIP_DOMAIN_ID, options),
      readLocalDataDomainRecords(LOCAL_DATA_COMPANION_TASKS_DOMAIN_ID, options),
      readCompanionAudit(options),
    ])
    const rows = [...relationship, ...tasks]
    return { ok: true, targetDomainIds: domains, schemaVersion: status.schemaVersion, relationshipDatasetCount: relationship.length, taskDatasetCount: tasks.length, totalRecordCount: rows.length, payloadBytes: rows.reduce((sum, row) => sum + byteLength(row.payload?.value ?? null), 0), recordPayloadsIncluded: false, lastAuditRecordId: audit?.recordId ?? null, lastAuditAction: audit?.payload?.action ?? null, lastAuditAt: audit?.payload?.appliedAt || audit?.payload?.rolledBackAt || audit?.updatedAt || null, errorKind: null, errorMessage: null }
  } catch {
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, relationshipDatasetCount: 0, taskDatasetCount: 0, totalRecordCount: 0, payloadBytes: 0, recordPayloadsIncluded: false, lastAuditRecordId: null, lastAuditAction: null, lastAuditAt: null, errorKind: 'local-data-companion-migration-failed', errorMessage: 'Companion migration status is unavailable.' }
  }
}

export async function readCompanionLocalData(options = {}) {
  const domains = targetDomainIds()
  const status = await initializeLocalDataStore(options)
  if (!status.healthy) return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, recordPayloadsIncluded: true, relationship: [], tasks: [], malformedRecordCount: 0, errorKind: status.errorKind, errorMessage: status.errorMessage }
  try {
    const [relationshipRows, taskRows] = await Promise.all([
      readLocalDataDomainRecords(LOCAL_DATA_COMPANION_RELATIONSHIP_DOMAIN_ID, options),
      readLocalDataDomainRecords(LOCAL_DATA_COMPANION_TASKS_DOMAIN_ID, options),
    ])
    const malformed = { count: 0 }
    const read = (rows) => rows.flatMap((record) => {
      try {
        const value = record.payload
        return [normalizeCompanionDataset({ id: record.recordId, storageKey: value?.storageKey, value: value?.value })]
      } catch {
        malformed.count += 1
        return []
      }
    })
    return { ok: true, targetDomainIds: domains, schemaVersion: status.schemaVersion, recordPayloadsIncluded: true, relationship: read(relationshipRows), tasks: read(taskRows), malformedRecordCount: malformed.count, errorKind: null, errorMessage: null }
  } catch {
    return { ok: false, targetDomainIds: domains, schemaVersion: status.schemaVersion, recordPayloadsIncluded: true, relationship: [], tasks: [], malformedRecordCount: 0, errorKind: 'local-data-companion-migration-failed', errorMessage: 'Companion records are unavailable.' }
  }
}
