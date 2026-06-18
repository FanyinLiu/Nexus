import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const M4_SQLITE_FOUNDATION_GATE = 'nexus-v1-m4-sqlite-foundation'
export const M4_SQLITE_SCHEMA_VERSION = 1

export const M4_SQLITE_FOUNDATION_TABLES = [
  'storage_schema_migrations',
  'storage_backups',
  'local_storage_migration_ledger',
  'storage_migration_events',
]

const FOUNDATION_MIGRATION_ID = 'm4-sqlite-foundation-v1'
const FOUNDATION_MIGRATION_CHECKSUM = crypto
  .createHash('sha256')
  .update(`${FOUNDATION_MIGRATION_ID}:${M4_SQLITE_SCHEMA_VERSION}:${M4_SQLITE_FOUNDATION_TABLES.join(',')}`)
  .digest('hex')

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
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
    .run(M4_SQLITE_SCHEMA_VERSION, FOUNDATION_MIGRATION_ID, now, FOUNDATION_MIGRATION_CHECKSUM)

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

  return {
    schemaVersion: userVersion,
    journalMode,
    tables,
    missingTables,
    migrationRows,
    backupRows,
    ledgerRows,
    eventRows,
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
    },
  }
}
