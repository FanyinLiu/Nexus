import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const M4_SQLITE_FOUNDATION_GATE = 'nexus-v1-m4-sqlite-foundation'
export const M4_SQLITE_SCHEMA_VERSION = 2

const M4_SQLITE_FOUNDATION_V1_TABLES = [
  'storage_schema_migrations',
  'storage_backups',
  'local_storage_migration_ledger',
  'storage_migration_events',
]

const M4_SQLITE_SNAPSHOT_TABLES = [
  'local_storage_backup_runs',
  'local_storage_backup_items',
]

export const M4_SQLITE_FOUNDATION_TABLES = [
  ...M4_SQLITE_FOUNDATION_V1_TABLES,
  ...M4_SQLITE_SNAPSHOT_TABLES,
]

export const M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND = 'renderer-local-storage-snapshot'
export const M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRIES = 12
export const M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRY_BYTES = 2 * 1024 * 1024
export const M4_LOCAL_STORAGE_SNAPSHOT_MAX_TOTAL_BYTES = 8 * 1024 * 1024

export const M4_LOCAL_STORAGE_SNAPSHOT_KEY_METADATA = [
  {
    storageKey: 'nexus:chat',
    domain: 'chat',
    migrationPriority: 'p0',
    firstSeenFile: 'src/lib/storage/core.ts',
    firstSeenLine: 9,
  },
  {
    storageKey: 'nexus:chat:sessions',
    domain: 'chat',
    migrationPriority: 'p0',
    firstSeenFile: 'src/lib/storage/core.ts',
    firstSeenLine: 10,
  },
  {
    storageKey: 'nexus:memory',
    domain: 'memory',
    migrationPriority: 'p0',
    firstSeenFile: 'src/lib/storage/core.ts',
    firstSeenLine: 12,
  },
  {
    storageKey: 'nexus:memory:long-term',
    domain: 'memory',
    migrationPriority: 'p0',
    firstSeenFile: 'src/lib/storage/core.ts',
    firstSeenLine: 13,
  },
  {
    storageKey: 'nexus:memory:daily',
    domain: 'memory',
    migrationPriority: 'p0',
    firstSeenFile: 'src/lib/storage/core.ts',
    firstSeenLine: 14,
  },
  {
    storageKey: 'nexus:autonomy:relationship',
    domain: 'memory',
    migrationPriority: 'p0',
    firstSeenFile: 'src/lib/storage/core.ts',
    firstSeenLine: 32,
  },
  {
    storageKey: 'nexus:autonomy:relationship-history',
    domain: 'memory',
    migrationPriority: 'p1',
    firstSeenFile: 'src/lib/storage/core.ts',
    firstSeenLine: 36,
  },
]

const FOUNDATION_MIGRATION_ID = 'm4-sqlite-foundation-v1'
const FOUNDATION_MIGRATION_CHECKSUM = crypto
  .createHash('sha256')
  .update(`${FOUNDATION_MIGRATION_ID}:1:${M4_SQLITE_FOUNDATION_V1_TABLES.join(',')}`)
  .digest('hex')
const SNAPSHOT_MIGRATION_ID = 'm4-local-storage-snapshot-backup-v2'
const SNAPSHOT_MIGRATION_CHECKSUM = crypto
  .createHash('sha256')
  .update(`${SNAPSHOT_MIGRATION_ID}:2:${M4_SQLITE_SNAPSHOT_TABLES.join(',')}`)
  .digest('hex')

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function normalizeOptionalIso(value, label) {
  const text = cleanString(value)
  if (!text) return ''
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`)
  return new Date(parsed).toISOString()
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8')
}

function normalizeDatabasePath(databasePath) {
  const value = cleanString(databasePath)
  return value ? path.resolve(value) : ''
}

export function resolveNexusStorageDatabasePath(options = {}) {
  const explicitPath = normalizeDatabasePath(options.databasePath)
  if (explicitPath) return explicitPath

  const appLike = options.appLike
  if (appLike && typeof appLike.getPath === 'function') {
    return path.join(appLike.getPath('userData'), 'storage', 'nexus.sqlite3')
  }

  throw new Error('resolveNexusStorageDatabasePath requires databasePath or appLike.getPath("userData").')
}

export function resolveNexusStorageBackupDirectory(options = {}) {
  const explicitPath = normalizeDatabasePath(options.backupDirectory || options.backupDir)
  if (explicitPath) return explicitPath

  const appLike = options.appLike
  if (appLike && typeof appLike.getPath === 'function') {
    return path.join(appLike.getPath('userData'), 'storage', 'backups')
  }

  const databasePath = normalizeDatabasePath(options.databasePath)
  if (databasePath) return path.join(path.dirname(databasePath), 'backups')

  throw new Error('resolveNexusStorageBackupDirectory requires backupDirectory, databasePath, or appLike.getPath("userData").')
}

async function loadNodeSqlite(options = {}) {
  if (options.sqliteModule) return options.sqliteModule
  return import('node:sqlite')
}

function getScalar(row, fallback = null) {
  if (!row || typeof row !== 'object') return fallback
  const values = Object.values(row)
  return values.length > 0 ? values[0] : fallback
}

function sqliteStatusFromError(error) {
  return {
    ok: false,
    available: false,
    engine: 'node:sqlite',
    errorName: error instanceof Error && error.name ? error.name : typeof error,
    errorCode: cleanString(error?.code),
  }
}

export async function probeNexusSqliteRuntime(options = {}) {
  try {
    const sqlite = await loadNodeSqlite(options)
    return {
      ok: typeof sqlite?.DatabaseSync === 'function',
      available: typeof sqlite?.DatabaseSync === 'function',
      engine: 'node:sqlite',
      externalDependencyAdded: false,
      experimental: true,
    }
  } catch (error) {
    return sqliteStatusFromError(error)
  }
}

function createSchema(database, now) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS storage_schema_migrations (
      version INTEGER PRIMARY KEY,
      migration_id TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
      checksum TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storage_backups (
      backup_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      database_path TEXT NOT NULL,
      backup_path TEXT NOT NULL,
      sha256 TEXT,
      schema_version INTEGER NOT NULL,
      restored_at TEXT
    );

    CREATE TABLE IF NOT EXISTS local_storage_migration_ledger (
      storage_key TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      migration_priority TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      first_seen_file TEXT NOT NULL,
      first_seen_line INTEGER NOT NULL CHECK (first_seen_line >= 0),
      status TEXT NOT NULL CHECK (
        status IN (
          'planned',
          'backed-up',
          'copied',
          'verified',
          'renderer-read-through',
          'retired',
          'skipped',
          'failed'
        )
      ),
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storage_migration_events (
      event_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
      storage_key TEXT,
      details_json TEXT NOT NULL CHECK (json_valid(details_json))
    );

    CREATE TABLE IF NOT EXISTS local_storage_backup_runs (
      backup_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
      total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0),
      backup_file_name TEXT NOT NULL,
      backup_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      source_local_storage_preserved INTEGER NOT NULL CHECK (source_local_storage_preserved IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS local_storage_backup_items (
      backup_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      source_value_text TEXT NOT NULL,
      source_value_sha256 TEXT NOT NULL,
      source_value_bytes INTEGER NOT NULL CHECK (source_value_bytes >= 0),
      source_updated_at TEXT,
      verified_at TEXT NOT NULL,
      PRIMARY KEY (backup_id, storage_key),
      FOREIGN KEY (backup_id) REFERENCES local_storage_backup_runs(backup_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_local_storage_backup_items_storage_key
      ON local_storage_backup_items(storage_key);
  `)

  database
    .prepare(`
      INSERT INTO storage_schema_migrations (
        version,
        migration_id,
        applied_at,
        direction,
        checksum
      )
      VALUES (?, ?, ?, 'up', ?)
      ON CONFLICT(version) DO NOTHING
    `)
    .run(1, FOUNDATION_MIGRATION_ID, now, FOUNDATION_MIGRATION_CHECKSUM)

  database
    .prepare(`
      INSERT INTO storage_schema_migrations (
        version,
        migration_id,
        applied_at,
        direction,
        checksum
      )
      VALUES (?, ?, ?, 'up', ?)
      ON CONFLICT(version) DO NOTHING
    `)
    .run(2, SNAPSHOT_MIGRATION_ID, now, SNAPSHOT_MIGRATION_CHECKSUM)

  database.exec(`PRAGMA user_version = ${M4_SQLITE_SCHEMA_VERSION};`)
}

function listTables(database) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => cleanString(row.name))
    .filter(Boolean)
}

function getDatabaseSummary(database) {
  const userVersion = Number(getScalar(database.prepare('PRAGMA user_version').get(), 0))
  const journalMode = cleanString(getScalar(database.prepare('PRAGMA journal_mode').get(), 'unknown'))
  const tables = listTables(database)
  const missingTables = M4_SQLITE_FOUNDATION_TABLES.filter((table) => !tables.includes(table))
  const migrationRows = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM storage_schema_migrations').get(),
    0,
  ))
  const backupRows = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM storage_backups').get(),
    0,
  ))
  const ledgerRows = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM local_storage_migration_ledger').get(),
    0,
  ))
  const eventRows = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM storage_migration_events').get(),
    0,
  ))
  const localStorageBackupRuns = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM local_storage_backup_runs').get(),
    0,
  ))
  const localStorageBackupItems = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM local_storage_backup_items').get(),
    0,
  ))

  return {
    schemaVersion: userVersion,
    journalMode,
    tables,
    missingTables,
    migrationRows,
    backupRows,
    ledgerRows,
    eventRows,
    localStorageBackupRuns,
    localStorageBackupItems,
  }
}

export async function initializeNexusStorageDatabase(options = {}) {
  const generatedAt = normalizeIso(options.generatedAt || options.now || new Date())
  const runtime = await probeNexusSqliteRuntime(options)
  const databasePath = resolveNexusStorageDatabasePath(options)

  if (!runtime.available) {
    return {
      gate: M4_SQLITE_FOUNDATION_GATE,
      ok: false,
      status: 'sqlite-runtime-unavailable',
      generatedAt,
      runtime,
      databasePath,
      schemaVersion: 0,
      tables: [],
      missingTables: M4_SQLITE_FOUNDATION_TABLES,
    }
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const sqlite = await loadNodeSqlite(options)
  const database = new sqlite.DatabaseSync(databasePath)
  let closed = false
  const close = () => {
    if (closed) return
    database.close()
    closed = true
  }

  try {
    database.prepare('PRAGMA journal_mode = WAL').get()
    createSchema(database, generatedAt)
    const summary = getDatabaseSummary(database)

    return {
      gate: M4_SQLITE_FOUNDATION_GATE,
      ok: summary.missingTables.length === 0 && summary.schemaVersion >= M4_SQLITE_SCHEMA_VERSION,
      status: summary.missingTables.length === 0 ? 'foundation-ready' : 'schema-incomplete',
      generatedAt,
      runtime,
      databasePath,
      schemaVersion: summary.schemaVersion,
      journalMode: summary.journalMode,
      tables: summary.tables,
      missingTables: summary.missingTables,
      counts: {
        schemaMigrations: summary.migrationRows,
        backups: summary.backupRows,
        localStorageLedgerItems: summary.ledgerRows,
        migrationEvents: summary.eventRows,
        localStorageBackupRuns: summary.localStorageBackupRuns,
        localStorageBackupItems: summary.localStorageBackupItems,
      },
      database,
      close,
    }
  } catch (error) {
    close()
    return {
      gate: M4_SQLITE_FOUNDATION_GATE,
      ok: false,
      status: 'schema-initialization-failed',
      generatedAt,
      runtime,
      databasePath,
      schemaVersion: 0,
      tables: [],
      missingTables: M4_SQLITE_FOUNDATION_TABLES,
      errorName: error instanceof Error && error.name ? error.name : typeof error,
      errorMessage: cleanString(error?.message),
    }
  }
}

export function upsertLocalStorageMigrationLedgerItem(database, item, options = {}) {
  const storageKey = cleanString(item?.storageKey)
  if (!storageKey) throw new Error('storageKey is required')

  const now = normalizeIso(options.now || new Date())
  const domain = cleanString(item?.domain) || 'other'
  const migrationPriority = cleanString(item?.migrationPriority) || 'p3'
  const sourceKind = cleanString(item?.sourceKind) || 'unknown'
  const firstSeenFile = cleanString(item?.firstSeenFile) || 'unknown'
  const firstSeenLine = Math.max(0, Number.isFinite(Number(item?.firstSeenLine)) ? Number(item.firstSeenLine) : 0)
  const status = cleanString(item?.status) || 'planned'
  const lastError = cleanString(item?.lastError)

  database
    .prepare(`
      INSERT INTO local_storage_migration_ledger (
        storage_key,
        domain,
        migration_priority,
        source_kind,
        first_seen_file,
        first_seen_line,
        status,
        last_error,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)
      ON CONFLICT(storage_key) DO UPDATE SET
        domain = excluded.domain,
        migration_priority = excluded.migration_priority,
        source_kind = excluded.source_kind,
        first_seen_file = excluded.first_seen_file,
        first_seen_line = excluded.first_seen_line,
        status = excluded.status,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `)
    .run(
      storageKey,
      domain,
      migrationPriority,
      sourceKind,
      firstSeenFile,
      firstSeenLine,
      status,
      lastError,
      now,
    )

  return { storageKey, updatedAt: now }
}

export function recordStorageMigrationEvent(database, event, options = {}) {
  const eventType = cleanString(event?.eventType)
  if (!eventType) throw new Error('eventType is required')

  const now = normalizeIso(options.now || new Date())
  const eventId = cleanString(event?.eventId) || createId('storage-event')
  const level = cleanString(event?.level) || 'info'
  const storageKey = cleanString(event?.storageKey)
  const detailsJson = JSON.stringify(event?.details && typeof event.details === 'object' ? event.details : {})

  database
    .prepare(`
      INSERT INTO storage_migration_events (
        event_id,
        created_at,
        event_type,
        level,
        storage_key,
        details_json
      )
      VALUES (?, ?, ?, ?, NULLIF(?, ''), ?)
    `)
    .run(eventId, now, eventType, level, storageKey, detailsJson)

  return { eventId, createdAt: now }
}

function snapshotMetadataForKey(storageKey) {
  return M4_LOCAL_STORAGE_SNAPSHOT_KEY_METADATA.find((entry) => entry.storageKey === storageKey) || null
}

export function validateLocalStorageSnapshotRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('local storage snapshot request must be a plain object')
  }

  const reason = cleanString(request.reason) || 'manual'
  if (!/^[a-z0-9:-]{1,64}$/i.test(reason)) {
    throw new Error('reason must be a short id')
  }

  if (!Array.isArray(request.entries)) {
    throw new Error('entries must be an array')
  }
  if (request.entries.length < 1) {
    throw new Error('entries must include at least one item')
  }
  if (request.entries.length > M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRIES) {
    throw new Error(`entries must include at most ${M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRIES} items`)
  }

  const seen = new Set()
  let totalBytes = 0
  const entries = request.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`entries[${index}] must be a plain object`)
    }

    const storageKey = cleanString(entry.key || entry.storageKey)
    const metadata = snapshotMetadataForKey(storageKey)
    if (!metadata) throw new Error(`storage key is not allowed for M4 snapshot backup: ${storageKey || '[empty]'}`)
    if (seen.has(storageKey)) throw new Error(`duplicate storage key in snapshot request: ${storageKey}`)
    seen.add(storageKey)

    if (typeof entry.value !== 'string') {
      throw new Error(`entries[${index}].value must be a string`)
    }
    const valueBytes = byteLength(entry.value)
    if (valueBytes > M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRY_BYTES) {
      throw new Error(`local storage snapshot value exceeds per-entry byte limit for ${storageKey}`)
    }
    totalBytes += valueBytes
    if (totalBytes > M4_LOCAL_STORAGE_SNAPSHOT_MAX_TOTAL_BYTES) {
      throw new Error('local storage snapshot exceeds total byte limit')
    }

    const normalizedSourceUpdatedAt = normalizeOptionalIso(entry.sourceUpdatedAt, `entries[${index}].sourceUpdatedAt`)

    return {
      storageKey,
      domain: metadata.domain,
      migrationPriority: metadata.migrationPriority,
      firstSeenFile: metadata.firstSeenFile,
      firstSeenLine: metadata.firstSeenLine,
      value: entry.value,
      valueBytes,
      valueSha256: sha256(entry.value),
      sourceUpdatedAt: normalizedSourceUpdatedAt,
    }
  })

  return {
    reason,
    entries,
    entryCount: entries.length,
    totalBytes,
  }
}

function insertStorageBackup(database, backup, options = {}) {
  database
    .prepare(`
      INSERT INTO storage_backups (
        backup_id,
        created_at,
        reason,
        database_path,
        backup_path,
        sha256,
        schema_version,
        restored_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(backup_id) DO NOTHING
    `)
    .run(
      backup.backupId,
      backup.createdAt,
      backup.reason,
      options.databasePath,
      backup.backupPath,
      backup.sha256,
      M4_SQLITE_SCHEMA_VERSION,
    )
}

function insertLocalStorageBackupRun(database, backup) {
  database
    .prepare(`
      INSERT INTO local_storage_backup_runs (
        backup_id,
        created_at,
        reason,
        source_kind,
        entry_count,
        total_bytes,
        backup_file_name,
        backup_path,
        sha256,
        schema_version,
        source_local_storage_preserved
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(backup_id) DO NOTHING
    `)
    .run(
      backup.backupId,
      backup.createdAt,
      backup.reason,
      M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND,
      backup.entryCount,
      backup.totalBytes,
      backup.backupFileName,
      backup.backupPath,
      backup.sha256,
      M4_SQLITE_SCHEMA_VERSION,
    )
}

function insertLocalStorageBackupItems(database, backup) {
  const statement = database.prepare(`
    INSERT INTO local_storage_backup_items (
      backup_id,
      storage_key,
      domain,
      source_value_text,
      source_value_sha256,
      source_value_bytes,
      source_updated_at,
      verified_at
    )
    VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)
    ON CONFLICT(backup_id, storage_key) DO NOTHING
  `)

  for (const entry of backup.entries) {
    statement.run(
      backup.backupId,
      entry.storageKey,
      entry.domain,
      entry.value,
      entry.valueSha256,
      entry.valueBytes,
      entry.sourceUpdatedAt,
      backup.createdAt,
    )
  }
}

function createSnapshotBackupPayload(backup) {
  return {
    schemaVersion: 1,
    backupId: backup.backupId,
    createdAt: backup.createdAt,
    reason: backup.reason,
    sourceKind: M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND,
    sourceLocalStoragePreserved: true,
    entries: backup.entries.map((entry) => ({
      storageKey: entry.storageKey,
      domain: entry.domain,
      sourceUpdatedAt: entry.sourceUpdatedAt || null,
      sourceValueText: entry.value,
      sourceValueSha256: entry.valueSha256,
      sourceValueBytes: entry.valueBytes,
    })),
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function writeSnapshotBackupFile(backup, backupDirectory) {
  fs.mkdirSync(backupDirectory, { recursive: true })
  const payload = createSnapshotBackupPayload(backup)
  const text = `${JSON.stringify(payload, null, 2)}\n`
  const backupFileName = `${backup.backupId}.local-storage-snapshot.json`
  const backupPath = path.join(backupDirectory, backupFileName)
  fs.writeFileSync(backupPath, text, { encoding: 'utf8', flag: 'wx' })
  return {
    backupFileName,
    backupPath,
    sha256: sha256(text),
  }
}

export async function backupLocalStorageSnapshot(request, options = {}) {
  const normalized = validateLocalStorageSnapshotRequest(request)
  const generatedAt = normalizeIso(options.generatedAt || options.now || new Date())
  const backupId = cleanString(options.backupId) || createId('local-storage-backup')
  const initializeFn = options.initializeStorageDatabase || initializeNexusStorageDatabase
  const status = options.storageStatus || await initializeFn({
    ...options,
    generatedAt,
  })
  const shouldClose = !options.storageStatus

  try {
    if (!status?.ok || !status.database) {
      throw new Error('sqlite storage foundation must be ready before local storage snapshot backup')
    }

    const backupDirectory = resolveNexusStorageBackupDirectory({
      ...options,
      databasePath: status.databasePath,
    })
    const backupBase = {
      backupId,
      createdAt: generatedAt,
      reason: normalized.reason,
      entryCount: normalized.entryCount,
      totalBytes: normalized.totalBytes,
      entries: normalized.entries,
    }
    const fileResult = writeSnapshotBackupFile(backupBase, backupDirectory)
    const backup = {
      ...backupBase,
      ...fileResult,
    }

    let committed = false
    try {
      status.database.exec('BEGIN IMMEDIATE')
      insertStorageBackup(status.database, backup, {
        databasePath: status.databasePath,
      })
      insertLocalStorageBackupRun(status.database, backup)
      insertLocalStorageBackupItems(status.database, backup)

      for (const entry of normalized.entries) {
        upsertLocalStorageMigrationLedgerItem(status.database, {
          storageKey: entry.storageKey,
          domain: entry.domain,
          migrationPriority: entry.migrationPriority,
          sourceKind: M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND,
          firstSeenFile: entry.firstSeenFile,
          firstSeenLine: entry.firstSeenLine,
          status: 'backed-up',
        }, { now: generatedAt })
      }

      recordStorageMigrationEvent(status.database, {
        eventType: 'local-storage-snapshot-backed-up',
        level: 'info',
        details: {
          backupId,
          reason: normalized.reason,
          entryCount: normalized.entryCount,
          totalBytes: normalized.totalBytes,
          keys: normalized.entries.map((entry) => entry.storageKey),
          valuesCopiedToResponse: false,
          sourceLocalStoragePreserved: true,
        },
      }, { now: generatedAt })
      status.database.exec('COMMIT')
      committed = true
    } finally {
      if (!committed) {
        try { status.database.exec('ROLLBACK') } catch {}
        try { fs.rmSync(backup.backupPath, { force: true }) } catch {}
      }
    }

    return {
      ok: true,
      status: 'snapshot-backed-up',
      backupId,
      createdAt: generatedAt,
      reason: normalized.reason,
      entryCount: normalized.entryCount,
      totalBytes: normalized.totalBytes,
      keys: normalized.entries.map((entry) => entry.storageKey),
      domains: unique(normalized.entries.map((entry) => entry.domain)),
      backupFileName: backup.backupFileName,
      backupPath: backup.backupPath,
      sha256: backup.sha256,
      sourceLocalStoragePreserved: true,
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: false,
      valuesCopiedToResponse: false,
    }
  } finally {
    if (shouldClose) status?.close?.()
  }
}

export function summarizeNexusStorageDatabase(database) {
  const summary = getDatabaseSummary(database)
  return {
    ok: summary.missingTables.length === 0 && summary.schemaVersion >= M4_SQLITE_SCHEMA_VERSION,
    schemaVersion: summary.schemaVersion,
    journalMode: summary.journalMode,
    tables: summary.tables,
    missingTables: summary.missingTables,
    counts: {
      schemaMigrations: summary.migrationRows,
      backups: summary.backupRows,
      localStorageLedgerItems: summary.ledgerRows,
      migrationEvents: summary.eventRows,
      localStorageBackupRuns: summary.localStorageBackupRuns,
      localStorageBackupItems: summary.localStorageBackupItems,
    },
  }
}
