import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const M4_SQLITE_FOUNDATION_GATE = 'nexus-v1-m4-sqlite-foundation'
export const M4_SQLITE_SCHEMA_VERSION = 3

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

const M4_SQLITE_STRUCTURED_COPY_TABLES = [
  'local_storage_copy_runs',
  'local_storage_copy_items',
  'memory_sources',
  'chat_sessions',
  'chat_messages',
  'memories',
  'daily_memory_entries',
]

export const M4_SQLITE_FOUNDATION_TABLES = [
  ...M4_SQLITE_FOUNDATION_V1_TABLES,
  ...M4_SQLITE_SNAPSHOT_TABLES,
  ...M4_SQLITE_STRUCTURED_COPY_TABLES,
]

export const M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND = 'renderer-local-storage-snapshot'
export const M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRIES = 12
export const M4_LOCAL_STORAGE_SNAPSHOT_MAX_ENTRY_BYTES = 2 * 1024 * 1024
export const M4_LOCAL_STORAGE_SNAPSHOT_MAX_TOTAL_BYTES = 8 * 1024 * 1024
export const M4_LOCAL_STORAGE_READ_THROUGH_DEFAULT_LIMIT = 100
export const M4_LOCAL_STORAGE_READ_THROUGH_MAX_LIMIT = 500

const M4_LOCAL_STORAGE_READ_THROUGH_DOMAINS = ['chat', 'memory']

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
const STRUCTURED_COPY_MIGRATION_ID = 'm4-chat-memory-structured-copy-v3'
const STRUCTURED_COPY_MIGRATION_CHECKSUM = crypto
  .createHash('sha256')
  .update(`${STRUCTURED_COPY_MIGRATION_ID}:3:${M4_SQLITE_STRUCTURED_COPY_TABLES.join(',')}`)
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

    CREATE TABLE IF NOT EXISTS local_storage_copy_runs (
      copy_id TEXT PRIMARY KEY,
      backup_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('copied', 'partial', 'failed')),
      item_count INTEGER NOT NULL CHECK (item_count >= 0),
      copied_item_count INTEGER NOT NULL CHECK (copied_item_count >= 0),
      skipped_item_count INTEGER NOT NULL CHECK (skipped_item_count >= 0),
      failed_item_count INTEGER NOT NULL CHECK (failed_item_count >= 0),
      chat_session_count INTEGER NOT NULL CHECK (chat_session_count >= 0),
      chat_message_count INTEGER NOT NULL CHECK (chat_message_count >= 0),
      memory_count INTEGER NOT NULL CHECK (memory_count >= 0),
      daily_memory_entry_count INTEGER NOT NULL CHECK (daily_memory_entry_count >= 0),
      runtime_migration_enabled INTEGER NOT NULL CHECK (runtime_migration_enabled IN (0, 1)),
      read_through_migration_enabled INTEGER NOT NULL CHECK (read_through_migration_enabled IN (0, 1)),
      source_local_storage_preserved INTEGER NOT NULL CHECK (source_local_storage_preserved IN (0, 1)),
      FOREIGN KEY (backup_id) REFERENCES local_storage_backup_runs(backup_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS local_storage_copy_items (
      copy_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('copied', 'skipped', 'failed')),
      inserted_rows INTEGER NOT NULL CHECK (inserted_rows >= 0),
      skipped_rows INTEGER NOT NULL CHECK (skipped_rows >= 0),
      error_message TEXT,
      PRIMARY KEY (copy_id, storage_key),
      FOREIGN KEY (copy_id) REFERENCES local_storage_copy_runs(copy_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_sources (
      source_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      backup_id TEXT NOT NULL,
      source_value_sha256 TEXT NOT NULL,
      copied_at TEXT NOT NULL,
      FOREIGN KEY (backup_id) REFERENCES local_storage_backup_runs(backup_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT,
      started_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      source_storage_key TEXT NOT NULL,
      copied_from_backup_id TEXT NOT NULL,
      copied_at TEXT NOT NULL,
      message_count INTEGER NOT NULL CHECK (message_count >= 0),
      source_value_sha256 TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      tone TEXT,
      reasoning_content TEXT,
      tool_result_json TEXT CHECK (tool_result_json IS NULL OR json_valid(tool_result_json)),
      source_storage_key TEXT NOT NULL,
      copied_from_backup_id TEXT NOT NULL,
      copied_at TEXT NOT NULL,
      source_value_sha256 TEXT NOT NULL,
      PRIMARY KEY (session_id, message_id),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      memory_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      source_ref TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      importance TEXT,
      importance_score REAL,
      recall_count INTEGER,
      last_recalled_at TEXT,
      emotional_valence TEXT,
      significance REAL,
      reflection_topic TEXT,
      reflection_confidence REAL,
      raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
      source_storage_key TEXT NOT NULL,
      copied_from_backup_id TEXT NOT NULL,
      copied_at TEXT NOT NULL,
      source_value_sha256 TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_memory_entries (
      day TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('chat', 'voice')),
      source_ref TEXT,
      created_at TEXT NOT NULL,
      raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
      source_storage_key TEXT NOT NULL,
      copied_from_backup_id TEXT NOT NULL,
      copied_at TEXT NOT NULL,
      source_value_sha256 TEXT NOT NULL,
      PRIMARY KEY (day, entry_id)
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
    .run(3, STRUCTURED_COPY_MIGRATION_ID, now, STRUCTURED_COPY_MIGRATION_CHECKSUM)

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
  const localStorageCopyRuns = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM local_storage_copy_runs').get(),
    0,
  ))
  const localStorageCopyItems = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM local_storage_copy_items').get(),
    0,
  ))
  const chatSessions = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM chat_sessions').get(),
    0,
  ))
  const chatMessages = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM chat_messages').get(),
    0,
  ))
  const memories = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM memories').get(),
    0,
  ))
  const dailyMemoryEntries = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM daily_memory_entries').get(),
    0,
  ))
  const memorySources = Number(getScalar(
    database.prepare('SELECT COUNT(*) AS count FROM memory_sources').get(),
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
    localStorageCopyRuns,
    localStorageCopyItems,
    chatSessions,
    chatMessages,
    memories,
    dailyMemoryEntries,
    memorySources,
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
        localStorageCopyRuns: summary.localStorageCopyRuns,
        localStorageCopyItems: summary.localStorageCopyItems,
        chatSessions: summary.chatSessions,
        chatMessages: summary.chatMessages,
        memories: summary.memories,
        dailyMemoryEntries: summary.dailyMemoryEntries,
        memorySources: summary.memorySources,
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

export function validateLocalStorageSnapshotCopyRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('local storage snapshot copy request must be a plain object')
  }
  const backupId = cleanString(request.backupId)
  if (!backupId || !/^[a-z0-9:_-]{1,160}$/i.test(backupId)) {
    throw new Error('backupId must be a short id')
  }
  const copyId = cleanString(request.copyId)
  if (copyId && !/^[a-z0-9:_-]{1,160}$/i.test(copyId)) {
    throw new Error('copyId must be a short id')
  }
  return { backupId, copyId }
}

export function validateLocalStorageSnapshotRestoreRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('local storage snapshot restore request must be a plain object')
  }
  const backupId = cleanString(request.backupId)
  if (!backupId || !/^[a-z0-9:_-]{1,160}$/i.test(backupId)) {
    throw new Error('backupId must be a short id')
  }
  const restoreId = cleanString(request.restoreId)
  if (restoreId && !/^[a-z0-9:_-]{1,160}$/i.test(restoreId)) {
    throw new Error('restoreId must be a short id')
  }

  const keys = Array.isArray(request.keys)
    ? request.keys.map(cleanString).filter(Boolean)
    : []
  const uniqueKeys = unique(keys)
  if (uniqueKeys.length !== keys.length) {
    throw new Error('restore keys must not include duplicates')
  }
  for (const key of uniqueKeys) {
    if (!snapshotMetadataForKey(key)) {
      throw new Error(`restore key is not allowed for M4 localStorage backup: ${key}`)
    }
  }

  return { backupId, restoreId, keys: uniqueKeys }
}

export function validateLocalStorageReadThroughQueryRequest(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('local storage read-through query request must be a plain object')
  }

  const backupId = cleanString(request.backupId)
  if (backupId && !/^[a-z0-9:_-]{1,160}$/i.test(backupId)) {
    throw new Error('backupId must be a short id')
  }
  const copyId = cleanString(request.copyId)
  if (copyId && !/^[a-z0-9:_-]{1,160}$/i.test(copyId)) {
    throw new Error('copyId must be a short id')
  }

  const rawDomains = Array.isArray(request.domains)
    ? request.domains.map(cleanString).filter(Boolean)
    : M4_LOCAL_STORAGE_READ_THROUGH_DOMAINS
  const domains = unique(rawDomains)
  if (domains.length < 1) throw new Error('domains must include at least one read-through domain')
  if (domains.length !== rawDomains.length) throw new Error('domains must not include duplicates')
  for (const domain of domains) {
    if (!M4_LOCAL_STORAGE_READ_THROUGH_DOMAINS.includes(domain)) {
      throw new Error(`read-through domain is not allowed for M4 localStorage preview: ${domain}`)
    }
  }

  const requestedLimit = request.limit == null
    ? M4_LOCAL_STORAGE_READ_THROUGH_DEFAULT_LIMIT
    : Number(request.limit)
  if (
    !Number.isInteger(requestedLimit)
    || requestedLimit < 1
    || requestedLimit > M4_LOCAL_STORAGE_READ_THROUGH_MAX_LIMIT
  ) {
    throw new Error(`limit must be an integer from 1 to ${M4_LOCAL_STORAGE_READ_THROUGH_MAX_LIMIT}`)
  }

  return {
    backupId,
    copyId,
    domains,
    limit: requestedLimit,
  }
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value, limit) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, limit).trim()
    : ''
}

function normalizeContentText(value, limit) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed
}

function normalizeIsoForCopy(value, fallbackIndex = 0) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value.trim())
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  return new Date(fallbackIndex).toISOString()
}

function normalizeOptionalIsoForCopy(value) {
  const text = cleanString(value)
  if (!text) return ''
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
}

function parseSnapshotJson(item) {
  try {
    return JSON.parse(item.source_value_text)
  } catch {
    throw new Error(`invalid JSON for ${item.storage_key}`)
  }
}

function readSnapshotBackupItems(database, backupId) {
  const backupRun = database
    .prepare('SELECT backup_id FROM local_storage_backup_runs WHERE backup_id = ?')
    .get(backupId)
  if (!backupRun) throw new Error(`local storage backup not found: ${backupId}`)

  return database
    .prepare(`
      SELECT
        storage_key,
        domain,
        source_value_text,
        source_value_sha256,
        source_value_bytes,
        source_updated_at
      FROM local_storage_backup_items
      WHERE backup_id = ?
      ORDER BY storage_key
    `)
    .all(backupId)
}

function readSelectedSnapshotBackupItems(database, backupId, keys) {
  const items = readSnapshotBackupItems(database, backupId)
  if (!keys.length) return items

  const allowed = new Set(keys)
  const selected = items.filter((item) => allowed.has(item.storage_key))
  const found = new Set(selected.map((item) => item.storage_key))
  const missing = keys.filter((key) => !found.has(key))
  if (missing.length > 0) {
    throw new Error(`restore keys are not present in backup: ${missing.join(', ')}`)
  }
  return selected
}

function validateSnapshotBackupItemIntegrity(item) {
  const value = String(item.source_value_text ?? '')
  const expectedSha256 = cleanString(item.source_value_sha256)
  const expectedBytes = Number(item.source_value_bytes)
  const actualSha256 = sha256(value)
  const actualBytes = byteLength(value)
  return {
    ok: actualSha256 === expectedSha256 && actualBytes === expectedBytes,
    storageKey: cleanString(item.storage_key),
    expectedSha256,
    actualSha256,
    expectedBytes,
    actualBytes,
  }
}

function createSnapshotRestorePayload(restore) {
  return {
    schemaVersion: 1,
    restoreId: restore.restoreId,
    backupId: restore.backupId,
    createdAt: restore.createdAt,
    sourceKind: M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND,
    applyMode: 'manual-confirmed-localStorage-restore',
    sourceLocalStoragePreserved: true,
    entries: restore.items.map((item) => ({
      storageKey: item.storage_key,
      domain: item.domain,
      sourceUpdatedAt: item.source_updated_at || null,
      sourceValueText: item.source_value_text,
      sourceValueSha256: item.source_value_sha256,
      sourceValueBytes: item.source_value_bytes,
    })),
  }
}

function writeSnapshotRestoreBundleFile(restore, backupDirectory) {
  fs.mkdirSync(backupDirectory, { recursive: true })
  const payload = createSnapshotRestorePayload(restore)
  const text = `${JSON.stringify(payload, null, 2)}\n`
  const restoreFileName = `${restore.restoreId}.local-storage-restore.json`
  const restorePath = path.join(backupDirectory, restoreFileName)
  fs.writeFileSync(restorePath, text, { encoding: 'utf8', flag: 'wx' })
  return {
    restoreFileName,
    restorePath,
    sha256: sha256(text),
  }
}

function insertMemorySource(database, item, context) {
  database
    .prepare(`
      INSERT OR REPLACE INTO memory_sources (
        source_id,
        source_kind,
        storage_key,
        backup_id,
        source_value_sha256,
        copied_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      `${context.backupId}:${item.storage_key}`,
      M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND,
      item.storage_key,
      context.backupId,
      item.source_value_sha256,
      context.copiedAt,
    )
}

function normalizeChatMessageForSqlite(value, index) {
  if (!isPlainObject(value)) return null
  if (!['user', 'assistant', 'system'].includes(value.role)) return null
  const content = normalizeContentText(value.content, 50_000)
  if (!content) return null
  const createdAt = normalizeIsoForCopy(value.createdAt, index)
  const id = normalizeText(value.id, 160) || `chat-message-recovered-${index}-${Date.parse(createdAt)}`
  const tone = ['neutral', 'error'].includes(value.tone) ? value.tone : ''
  const reasoning = typeof value.reasoning_content === 'string' && value.reasoning_content
    ? value.reasoning_content.slice(0, 50_000)
    : ''
  const toolResultJson = isPlainObject(value.toolResult) ? JSON.stringify(value.toolResult) : ''
  return { id, role: value.role, content, createdAt, tone, reasoning, toolResultJson }
}

function inferSqliteSessionTitle(messages) {
  const firstUser = messages.find((message) => message.role === 'user' && message.content)
  if (!firstUser) return ''
  return firstUser.content.length > 80 ? firstUser.content.slice(0, 80).trim() : firstUser.content
}

function insertChatSession(database, session, item, context) {
  database
    .prepare(`
      INSERT OR REPLACE INTO chat_sessions (
        session_id,
        title,
        started_at,
        last_active_at,
        source_storage_key,
        copied_from_backup_id,
        copied_at,
        message_count,
        source_value_sha256
      )
      VALUES (?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      session.id,
      session.title,
      session.startedAt,
      session.lastActiveAt,
      item.storage_key,
      context.backupId,
      context.copiedAt,
      session.messages.length,
      item.source_value_sha256,
    )
}

function insertChatMessage(database, message, sessionId, item, context) {
  database
    .prepare(`
      INSERT OR REPLACE INTO chat_messages (
        session_id,
        message_id,
        role,
        content,
        created_at,
        tone,
        reasoning_content,
        tool_result_json,
        source_storage_key,
        copied_from_backup_id,
        copied_at,
        source_value_sha256
      )
      VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?)
    `)
    .run(
      sessionId,
      message.id,
      message.role,
      message.content,
      message.createdAt,
      message.tone,
      message.reasoning,
      message.toolResultJson,
      item.storage_key,
      context.backupId,
      context.copiedAt,
      item.source_value_sha256,
    )
}

function copyFlatChatMessages(database, item, context) {
  const parsed = parseSnapshotJson(item)
  if (!Array.isArray(parsed)) return { status: 'skipped', insertedRows: 0, skippedRows: 1 }
  const messages = parsed
    .map(normalizeChatMessageForSqlite)
    .filter(Boolean)
  if (!messages.length) return { status: 'skipped', insertedRows: 0, skippedRows: parsed.length }

  const startedAt = messages[0]?.createdAt || context.copiedAt
  const lastActiveAt = messages[messages.length - 1]?.createdAt || startedAt
  const session = {
    id: 'local-storage-flat-chat',
    title: inferSqliteSessionTitle(messages),
    startedAt,
    lastActiveAt,
    messages,
  }
  insertMemorySource(database, item, context)
  insertChatSession(database, session, item, context)
  for (const message of messages) insertChatMessage(database, message, session.id, item, context)
  return {
    status: 'copied',
    insertedRows: 1 + messages.length,
    skippedRows: Math.max(0, parsed.length - messages.length),
    chatSessions: 1,
    chatMessages: messages.length,
  }
}

function normalizeSessionTimestamp(value, fallbackIso) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return fallbackIso
}

function copyChatSessions(database, item, context) {
  const parsed = parseSnapshotJson(item)
  if (!Array.isArray(parsed)) return { status: 'skipped', insertedRows: 0, skippedRows: 1 }

  let insertedRows = 0
  let skippedRows = 0
  let chatSessions = 0
  let chatMessages = 0

  insertMemorySource(database, item, context)
  for (let index = 0; index < parsed.length; index += 1) {
    const rawSession = parsed[index]
    if (!isPlainObject(rawSession)) {
      skippedRows += 1
      continue
    }
    const rawMessages = Array.isArray(rawSession.messages) ? rawSession.messages : []
    const messages = rawMessages
      .map(normalizeChatMessageForSqlite)
      .filter(Boolean)
    const latestMessageAt = messages[messages.length - 1]?.createdAt || context.copiedAt
    const firstMessageAt = messages[0]?.createdAt || latestMessageAt
    const sessionId = normalizeText(rawSession.id, 160) || `chat-session-recovered-${index}-${Date.parse(firstMessageAt)}`
    const session = {
      id: sessionId,
      title: normalizeText(rawSession.title, 120) || inferSqliteSessionTitle(messages),
      startedAt: normalizeSessionTimestamp(rawSession.startedAt, firstMessageAt),
      lastActiveAt: normalizeSessionTimestamp(rawSession.lastActiveAt, latestMessageAt),
      messages,
    }
    insertChatSession(database, session, item, context)
    for (const message of messages) insertChatMessage(database, message, session.id, item, context)
    insertedRows += 1 + messages.length
    skippedRows += Math.max(0, rawMessages.length - messages.length)
    chatSessions += 1
    chatMessages += messages.length
  }

  return {
    status: chatSessions > 0 ? 'copied' : 'skipped',
    insertedRows,
    skippedRows,
    chatSessions,
    chatMessages,
  }
}

const VALID_MEMORY_CATEGORIES = new Set(['profile', 'preference', 'goal', 'habit', 'manual', 'feedback', 'project', 'reference'])
const VALID_MEMORY_KINDS = new Set(['preference', 'fact', 'relationship', 'knowledge'])
const VALID_MEMORY_IMPORTANCE = new Set(['low', 'normal', 'high', 'pinned', 'reflection'])
const VALID_MEMORY_VALENCES = new Set(['positive', 'negative', 'neutral', 'mixed'])

function normalizeFiniteScore(value, max) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(max, value))
    : null
}

function normalizeMemoryItemForSqlite(value, index) {
  if (!isPlainObject(value)) return null
  const content = normalizeContentText(value.content, 2_000)
  if (!content) return null
  const createdAt = normalizeIsoForCopy(value.createdAt, index)
  const id = normalizeText(value.id, 160) || `memory-recovered-${index}-${Date.parse(createdAt)}`
  const category = VALID_MEMORY_CATEGORIES.has(value.category) ? value.category : 'manual'
  const source = normalizeText(value.source, 160) || 'storage'
  const kind = VALID_MEMORY_KINDS.has(value.kind) ? value.kind : ''
  const importance = VALID_MEMORY_IMPORTANCE.has(value.importance) ? value.importance : ''
  const emotionalValence = VALID_MEMORY_VALENCES.has(value.emotionalValence) ? value.emotionalValence : ''
  const recallCount = typeof value.recallCount === 'number' && Number.isFinite(value.recallCount)
    ? Math.max(0, Math.round(value.recallCount))
    : null
  return {
    id,
    content,
    category,
    source,
    kind,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    sourceRef: normalizeText(value.sourceRef, 260),
    createdAt,
    lastUsedAt: normalizeOptionalIsoForCopy(value.lastUsedAt),
    importance,
    importanceScore: normalizeFiniteScore(value.importanceScore, 2),
    recallCount,
    lastRecalledAt: normalizeOptionalIsoForCopy(value.lastRecalledAt),
    emotionalValence,
    significance: normalizeFiniteScore(value.significance, 1),
    reflectionTopic: normalizeText(value.reflectionTopic, 160),
    reflectionConfidence: normalizeFiniteScore(value.reflectionConfidence, 1),
    rawJson: JSON.stringify(value),
  }
}

function insertMemory(database, memory, item, context) {
  database
    .prepare(`
      INSERT OR REPLACE INTO memories (
        memory_id,
        content,
        category,
        source,
        kind,
        enabled,
        source_ref,
        created_at,
        last_used_at,
        importance,
        importance_score,
        recall_count,
        last_recalled_at,
        emotional_valence,
        significance,
        reflection_topic,
        reflection_confidence,
        raw_json,
        source_storage_key,
        copied_from_backup_id,
        copied_at,
        source_value_sha256
      )
      VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?)
    `)
    .run(
      memory.id,
      memory.content,
      memory.category,
      memory.source,
      memory.kind,
      memory.enabled ? 1 : 0,
      memory.sourceRef,
      memory.createdAt,
      memory.lastUsedAt,
      memory.importance,
      memory.importanceScore,
      memory.recallCount,
      memory.lastRecalledAt,
      memory.emotionalValence,
      memory.significance,
      memory.reflectionTopic,
      memory.reflectionConfidence,
      memory.rawJson,
      item.storage_key,
      context.backupId,
      context.copiedAt,
      item.source_value_sha256,
    )
}

function copyLongTermMemories(database, item, context) {
  const parsed = parseSnapshotJson(item)
  if (!Array.isArray(parsed)) return { status: 'skipped', insertedRows: 0, skippedRows: 1 }
  const memories = parsed
    .map(normalizeMemoryItemForSqlite)
    .filter(Boolean)
  if (!memories.length) return { status: 'skipped', insertedRows: 0, skippedRows: parsed.length }
  insertMemorySource(database, item, context)
  for (const memory of memories) insertMemory(database, memory, item, context)
  return {
    status: 'copied',
    insertedRows: memories.length,
    skippedRows: Math.max(0, parsed.length - memories.length),
    memories: memories.length,
  }
}

function isValidDayKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
}

function normalizeDailyMemoryEntryForSqlite(value, index, dayHint) {
  if (!isPlainObject(value)) return null
  if (!['user', 'assistant'].includes(value.role)) return null
  const content = normalizeContentText(value.content, 200)
  if (!content) return null
  const createdAt = normalizeIsoForCopy(value.createdAt, index)
  const day = isValidDayKey(dayHint) ? dayHint : createdAt.slice(0, 10)
  const id = normalizeText(value.id, 160) || `daily-memory-recovered-${index}-${Date.parse(createdAt)}`
  return {
    id,
    day,
    role: value.role,
    content,
    source: value.source === 'voice' ? 'voice' : 'chat',
    sourceRef: normalizeText(value.sourceRef, 260),
    createdAt,
    rawJson: JSON.stringify(value),
  }
}

function insertDailyMemoryEntry(database, entry, item, context) {
  database
    .prepare(`
      INSERT OR REPLACE INTO daily_memory_entries (
        day,
        entry_id,
        role,
        content,
        source,
        source_ref,
        created_at,
        raw_json,
        source_storage_key,
        copied_from_backup_id,
        copied_at,
        source_value_sha256
      )
      VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?)
    `)
    .run(
      entry.day,
      entry.id,
      entry.role,
      entry.content,
      entry.source,
      entry.sourceRef,
      entry.createdAt,
      entry.rawJson,
      item.storage_key,
      context.backupId,
      context.copiedAt,
      item.source_value_sha256,
    )
}

function copyDailyMemories(database, item, context) {
  const parsed = parseSnapshotJson(item)
  if (!isPlainObject(parsed)) return { status: 'skipped', insertedRows: 0, skippedRows: 1 }
  let insertedRows = 0
  let skippedRows = 0
  insertMemorySource(database, item, context)
  for (const [dayHint, rawEntries] of Object.entries(parsed)) {
    if (!Array.isArray(rawEntries)) {
      skippedRows += 1
      continue
    }
    const entries = rawEntries
      .map((entry, index) => normalizeDailyMemoryEntryForSqlite(entry, index, dayHint))
      .filter(Boolean)
    for (const entry of entries) insertDailyMemoryEntry(database, entry, item, context)
    insertedRows += entries.length
    skippedRows += Math.max(0, rawEntries.length - entries.length)
  }
  return {
    status: insertedRows > 0 ? 'copied' : 'skipped',
    insertedRows,
    skippedRows,
    dailyMemoryEntries: insertedRows,
  }
}

function copySnapshotItemToStructuredTables(database, item, context) {
  switch (item.storage_key) {
    case 'nexus:chat':
      return copyFlatChatMessages(database, item, context)
    case 'nexus:chat:sessions':
      return copyChatSessions(database, item, context)
    case 'nexus:memory':
    case 'nexus:memory:long-term':
      return copyLongTermMemories(database, item, context)
    case 'nexus:memory:daily':
      return copyDailyMemories(database, item, context)
    default:
      return { status: 'skipped', insertedRows: 0, skippedRows: 1 }
  }
}

function insertCopyItem(database, copyId, item, result) {
  database
    .prepare(`
      INSERT OR REPLACE INTO local_storage_copy_items (
        copy_id,
        storage_key,
        domain,
        status,
        inserted_rows,
        skipped_rows,
        error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''))
    `)
    .run(
      copyId,
      item.storage_key,
      item.domain,
      result.status,
      result.insertedRows || 0,
      result.skippedRows || 0,
      cleanString(result.errorMessage).slice(0, 240),
    )
}

function insertCopyRun(database, run) {
  database
    .prepare(`
      INSERT INTO local_storage_copy_runs (
        copy_id,
        backup_id,
        created_at,
        source_kind,
        status,
        item_count,
        copied_item_count,
        skipped_item_count,
        failed_item_count,
        chat_session_count,
        chat_message_count,
        memory_count,
        daily_memory_entry_count,
        runtime_migration_enabled,
        read_through_migration_enabled,
        source_local_storage_preserved
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
      ON CONFLICT(copy_id) DO UPDATE SET
        backup_id = excluded.backup_id,
        created_at = excluded.created_at,
        source_kind = excluded.source_kind,
        status = excluded.status,
        item_count = excluded.item_count,
        copied_item_count = excluded.copied_item_count,
        skipped_item_count = excluded.skipped_item_count,
        failed_item_count = excluded.failed_item_count,
        chat_session_count = excluded.chat_session_count,
        chat_message_count = excluded.chat_message_count,
        memory_count = excluded.memory_count,
        daily_memory_entry_count = excluded.daily_memory_entry_count,
        runtime_migration_enabled = excluded.runtime_migration_enabled,
        read_through_migration_enabled = excluded.read_through_migration_enabled,
        source_local_storage_preserved = excluded.source_local_storage_preserved
    `)
    .run(
      run.copyId,
      run.backupId,
      run.copiedAt,
      M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND,
      run.status,
      run.itemCount,
      run.copiedItemCount,
      run.skippedItemCount,
      run.failedItemCount,
      run.chatSessionCount,
      run.chatMessageCount,
      run.memoryCount,
      run.dailyMemoryEntryCount,
    )
}

function copyStatusFromCounts(copiedItemCount, skippedItemCount, failedItemCount) {
  if (failedItemCount > 0) return copiedItemCount > 0 || skippedItemCount > 0 ? 'partial' : 'failed'
  if (copiedItemCount > 0) return skippedItemCount > 0 ? 'partial' : 'copied'
  return skippedItemCount > 0 ? 'partial' : 'failed'
}

export async function copyLocalStorageSnapshotToStructuredSqlite(request, options = {}) {
  const normalizedRequest = validateLocalStorageSnapshotCopyRequest(request)
  const copiedAt = normalizeIso(options.generatedAt || options.now || new Date())
  const copyId = normalizedRequest.copyId || cleanString(options.copyId) || createId('local-storage-copy')
  const initializeFn = options.initializeStorageDatabase || initializeNexusStorageDatabase
  const status = options.storageStatus || await initializeFn({
    ...options,
    generatedAt: copiedAt,
  })
  const shouldClose = !options.storageStatus

  try {
    if (!status?.ok || !status.database) {
      throw new Error('sqlite storage foundation must be ready before local storage snapshot copy')
    }

    const items = readSnapshotBackupItems(status.database, normalizedRequest.backupId)
    const context = { backupId: normalizedRequest.backupId, copyId, copiedAt }
    const itemResults = []
    const totals = {
      copiedItemCount: 0,
      skippedItemCount: 0,
      failedItemCount: 0,
      chatSessionCount: 0,
      chatMessageCount: 0,
      memoryCount: 0,
      dailyMemoryEntryCount: 0,
    }

    let committed = false
    try {
      status.database.exec('BEGIN IMMEDIATE')
      insertCopyRun(status.database, {
        copyId,
        backupId: normalizedRequest.backupId,
        copiedAt,
        status: 'partial',
        itemCount: items.length,
        copiedItemCount: 0,
        skippedItemCount: 0,
        failedItemCount: 0,
        chatSessionCount: 0,
        chatMessageCount: 0,
        memoryCount: 0,
        dailyMemoryEntryCount: 0,
      })
      for (const item of items) {
        let result
        try {
          result = copySnapshotItemToStructuredTables(status.database, item, context)
        } catch (error) {
          result = {
            status: 'failed',
            insertedRows: 0,
            skippedRows: 0,
            errorMessage: error instanceof Error ? error.message : String(error),
          }
        }

        insertCopyItem(status.database, copyId, item, result)
        itemResults.push({
          storageKey: item.storage_key,
          domain: item.domain,
          status: result.status,
          insertedRows: result.insertedRows || 0,
          skippedRows: result.skippedRows || 0,
          errorMessage: cleanString(result.errorMessage),
        })

        if (result.status === 'copied') {
          totals.copiedItemCount += 1
          const metadata = snapshotMetadataForKey(item.storage_key)
          upsertLocalStorageMigrationLedgerItem(status.database, {
            storageKey: item.storage_key,
            domain: item.domain,
            migrationPriority: metadata?.migrationPriority || 'p0',
            sourceKind: M4_LOCAL_STORAGE_SNAPSHOT_SOURCE_KIND,
            firstSeenFile: metadata?.firstSeenFile || 'src/lib/storage/core.ts',
            firstSeenLine: metadata?.firstSeenLine || 0,
            status: 'copied',
          }, { now: copiedAt })
        } else if (result.status === 'skipped') {
          totals.skippedItemCount += 1
        } else {
          totals.failedItemCount += 1
        }
        totals.chatSessionCount += result.chatSessions || 0
        totals.chatMessageCount += result.chatMessages || 0
        totals.memoryCount += result.memories || 0
        totals.dailyMemoryEntryCount += result.dailyMemoryEntries || 0
      }

      const runStatus = copyStatusFromCounts(
        totals.copiedItemCount,
        totals.skippedItemCount,
        totals.failedItemCount,
      )
      insertCopyRun(status.database, {
        copyId,
        backupId: normalizedRequest.backupId,
        copiedAt,
        status: runStatus,
        itemCount: items.length,
        ...totals,
      })
      recordStorageMigrationEvent(status.database, {
        eventType: 'local-storage-snapshot-copied',
        level: totals.failedItemCount > 0 ? 'warn' : 'info',
        details: {
          copyId,
          backupId: normalizedRequest.backupId,
          itemCount: items.length,
          copiedItemCount: totals.copiedItemCount,
          skippedItemCount: totals.skippedItemCount,
          failedItemCount: totals.failedItemCount,
          chatSessionCount: totals.chatSessionCount,
          chatMessageCount: totals.chatMessageCount,
          memoryCount: totals.memoryCount,
          dailyMemoryEntryCount: totals.dailyMemoryEntryCount,
          runtimeMigrationEnabled: false,
          readThroughMigrationEnabled: false,
          valuesCopiedToResponse: false,
          sourceLocalStoragePreserved: true,
        },
      }, { now: copiedAt })

      status.database.exec('COMMIT')
      committed = true

      return {
        ok: totals.failedItemCount === 0 && totals.copiedItemCount > 0,
        status: runStatus === 'copied' ? 'snapshot-copied' : `snapshot-copy-${runStatus}`,
        copyId,
        backupId: normalizedRequest.backupId,
        copiedAt,
        itemCount: items.length,
        copiedItemCount: totals.copiedItemCount,
        skippedItemCount: totals.skippedItemCount,
        failedItemCount: totals.failedItemCount,
        chatSessionCount: totals.chatSessionCount,
        chatMessageCount: totals.chatMessageCount,
        memoryCount: totals.memoryCount,
        dailyMemoryEntryCount: totals.dailyMemoryEntryCount,
        keys: itemResults.map((item) => item.storageKey),
        copiedKeys: itemResults.filter((item) => item.status === 'copied').map((item) => item.storageKey),
        skippedKeys: itemResults.filter((item) => item.status === 'skipped').map((item) => item.storageKey),
        failedKeys: itemResults.filter((item) => item.status === 'failed').map((item) => item.storageKey),
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        sourceLocalStoragePreserved: true,
        valuesCopiedToResponse: false,
      }
    } finally {
      if (!committed) {
        try { status.database.exec('ROLLBACK') } catch {}
      }
    }
  } finally {
    if (shouldClose) status?.close?.()
  }
}

export async function exportLocalStorageSnapshotRestoreBundle(request, options = {}) {
  const normalizedRequest = validateLocalStorageSnapshotRestoreRequest(request)
  const createdAt = normalizeIso(options.generatedAt || options.now || new Date())
  const restoreId = normalizedRequest.restoreId || cleanString(options.restoreId) || createId('local-storage-restore')
  const initializeFn = options.initializeStorageDatabase || initializeNexusStorageDatabase
  const status = options.storageStatus || await initializeFn({
    ...options,
    generatedAt: createdAt,
  })
  const shouldClose = !options.storageStatus

  try {
    if (!status?.ok || !status.database) {
      throw new Error('sqlite storage foundation must be ready before local storage restore export')
    }

    const items = readSelectedSnapshotBackupItems(
      status.database,
      normalizedRequest.backupId,
      normalizedRequest.keys,
    )
    if (items.length < 1) {
      throw new Error('local storage restore export requires at least one backup item')
    }

    const integrity = items.map(validateSnapshotBackupItemIntegrity)
    const failedIntegrity = integrity.filter((entry) => !entry.ok)
    if (failedIntegrity.length > 0) {
      throw new Error(`local storage backup item checksum mismatch: ${failedIntegrity.map((entry) => entry.storageKey).join(', ')}`)
    }

    const backupDirectory = resolveNexusStorageBackupDirectory({
      ...options,
      databasePath: status.databasePath,
    })
    const restoreBase = {
      restoreId,
      backupId: normalizedRequest.backupId,
      createdAt,
      items,
    }
    const fileResult = writeSnapshotRestoreBundleFile(restoreBase, backupDirectory)

    let committed = false
    try {
      status.database.exec('BEGIN IMMEDIATE')
      recordStorageMigrationEvent(status.database, {
        eventType: 'local-storage-snapshot-restore-bundle-exported',
        level: 'info',
        details: {
          restoreId,
          backupId: normalizedRequest.backupId,
          entryCount: items.length,
          totalBytes: items.reduce((total, item) => total + Number(item.source_value_bytes || 0), 0),
          keys: items.map((item) => item.storage_key),
          valuesCopiedToResponse: false,
          restoreBundleContainsValues: true,
          sourceLocalStorageMutated: false,
          runtimeMigrationEnabled: false,
          readThroughMigrationEnabled: false,
        },
      }, { now: createdAt })
      status.database.exec('COMMIT')
      committed = true
    } finally {
      if (!committed) {
        try { status.database.exec('ROLLBACK') } catch {}
        try { fs.rmSync(fileResult.restorePath, { force: true }) } catch {}
      }
    }

    const totalBytes = items.reduce((total, item) => total + Number(item.source_value_bytes || 0), 0)
    return {
      ok: true,
      status: 'restore-bundle-exported',
      restoreId,
      backupId: normalizedRequest.backupId,
      createdAt,
      entryCount: items.length,
      totalBytes,
      keys: items.map((item) => item.storage_key),
      domains: unique(items.map((item) => item.domain)),
      restoreFileName: fileResult.restoreFileName,
      restorePath: fileResult.restorePath,
      sha256: fileResult.sha256,
      hashesVerified: true,
      sourceLocalStoragePreserved: true,
      sourceLocalStorageMutated: false,
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: false,
      valuesCopiedToResponse: false,
      restoreBundleContainsValues: true,
    }
  } finally {
    if (shouldClose) status?.close?.()
  }
}

function findReadThroughCopyRun(database, request) {
  const where = []
  const params = []
  if (request.copyId) {
    where.push('copy_id = ?')
    params.push(request.copyId)
  }
  if (request.backupId) {
    where.push('backup_id = ?')
    params.push(request.backupId)
  }
  const query = `
    SELECT
      copy_id,
      backup_id,
      created_at,
      status,
      item_count,
      copied_item_count,
      skipped_item_count,
      failed_item_count,
      chat_session_count,
      chat_message_count,
      memory_count,
      daily_memory_entry_count,
      runtime_migration_enabled,
      read_through_migration_enabled,
      source_local_storage_preserved
    FROM local_storage_copy_runs
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, copy_id DESC
    LIMIT 1
  `
  return database.prepare(query).get(...params) || null
}

function queryNumber(database, sql, params = []) {
  return Number(getScalar(database.prepare(sql).get(...params), 0) || 0)
}

function queryText(database, sql, params = []) {
  return cleanString(getScalar(database.prepare(sql).get(...params), ''))
}

function queryGroupedCounts(database, sql, params = []) {
  const rows = database.prepare(sql).all(...params)
  return Object.fromEntries(rows.map((row) => [
    cleanString(row.name) || 'unknown',
    Number(row.count || 0),
  ]))
}

function queryStorageKeys(database, backupId, domains) {
  const keys = []
  if (domains.includes('chat')) {
    keys.push(
      ...database
        .prepare('SELECT DISTINCT source_storage_key AS key FROM chat_sessions WHERE copied_from_backup_id = ?')
        .all(backupId)
        .map((row) => cleanString(row.key)),
      ...database
        .prepare('SELECT DISTINCT source_storage_key AS key FROM chat_messages WHERE copied_from_backup_id = ?')
        .all(backupId)
        .map((row) => cleanString(row.key)),
    )
  }
  if (domains.includes('memory')) {
    keys.push(
      ...database
        .prepare('SELECT DISTINCT source_storage_key AS key FROM memories WHERE copied_from_backup_id = ?')
        .all(backupId)
        .map((row) => cleanString(row.key)),
      ...database
        .prepare('SELECT DISTINCT source_storage_key AS key FROM daily_memory_entries WHERE copied_from_backup_id = ?')
        .all(backupId)
        .map((row) => cleanString(row.key)),
      ...database
        .prepare('SELECT DISTINCT storage_key AS key FROM memory_sources WHERE backup_id = ?')
        .all(backupId)
        .map((row) => cleanString(row.key)),
    )
  }
  return unique(keys).sort()
}

function queryCopyItems(database, copyId, domains) {
  const placeholders = domains.map(() => '?').join(', ')
  return database
    .prepare(`
      SELECT
        storage_key,
        domain,
        status,
        inserted_rows,
        skipped_rows
      FROM local_storage_copy_items
      WHERE copy_id = ?
        AND domain IN (${placeholders})
      ORDER BY domain, storage_key
    `)
    .all(copyId, ...domains)
    .map((row) => ({
      storageKey: cleanString(row.storage_key),
      domain: cleanString(row.domain),
      status: cleanString(row.status),
      insertedRows: Number(row.inserted_rows || 0),
      skippedRows: Number(row.skipped_rows || 0),
    }))
}

function buildChatReadThroughPreview(database, backupId, limit) {
  const sessionCount = queryNumber(
    database,
    'SELECT COUNT(*) FROM chat_sessions WHERE copied_from_backup_id = ?',
    [backupId],
  )
  const messageCount = queryNumber(
    database,
    'SELECT COUNT(*) FROM chat_messages WHERE copied_from_backup_id = ?',
    [backupId],
  )
  const sampledMessageCount = queryNumber(
    database,
    `
      SELECT COUNT(*) FROM (
        SELECT 1 FROM chat_messages
        WHERE copied_from_backup_id = ?
        ORDER BY created_at DESC, message_id DESC
        LIMIT ?
      )
    `,
    [backupId, limit],
  )
  return {
    selected: true,
    hasReadableRows: sessionCount > 0 || messageCount > 0,
    sessionCount,
    messageCount,
    sampledMessageCount,
    latestMessageAt: queryText(
      database,
      'SELECT MAX(created_at) FROM chat_messages WHERE copied_from_backup_id = ?',
      [backupId],
    ),
    roleCounts: queryGroupedCounts(
      database,
      `
        SELECT role AS name, COUNT(*) AS count
        FROM chat_messages
        WHERE copied_from_backup_id = ?
        GROUP BY role
        ORDER BY role
      `,
      [backupId],
    ),
    valuesCopiedToResponse: false,
  }
}

function buildMemoryReadThroughPreview(database, backupId, limit) {
  const memoryCount = queryNumber(
    database,
    'SELECT COUNT(*) FROM memories WHERE copied_from_backup_id = ?',
    [backupId],
  )
  const dailyMemoryEntryCount = queryNumber(
    database,
    'SELECT COUNT(*) FROM daily_memory_entries WHERE copied_from_backup_id = ?',
    [backupId],
  )
  const sampledMemoryCount = queryNumber(
    database,
    `
      SELECT COUNT(*) FROM (
        SELECT 1 FROM memories
        WHERE copied_from_backup_id = ?
        ORDER BY created_at DESC, memory_id DESC
        LIMIT ?
      )
    `,
    [backupId, limit],
  )
  const sampledDailyMemoryEntryCount = queryNumber(
    database,
    `
      SELECT COUNT(*) FROM (
        SELECT 1 FROM daily_memory_entries
        WHERE copied_from_backup_id = ?
        ORDER BY created_at DESC, entry_id DESC
        LIMIT ?
      )
    `,
    [backupId, limit],
  )
  return {
    selected: true,
    hasReadableRows: memoryCount > 0 || dailyMemoryEntryCount > 0,
    memoryCount,
    dailyMemoryEntryCount,
    sampledMemoryCount,
    sampledDailyMemoryEntryCount,
    latestMemoryCreatedAt: queryText(
      database,
      'SELECT MAX(created_at) FROM memories WHERE copied_from_backup_id = ?',
      [backupId],
    ),
    latestDailyMemoryEntryAt: queryText(
      database,
      'SELECT MAX(created_at) FROM daily_memory_entries WHERE copied_from_backup_id = ?',
      [backupId],
    ),
    categoryCounts: queryGroupedCounts(
      database,
      `
        SELECT category AS name, COUNT(*) AS count
        FROM memories
        WHERE copied_from_backup_id = ?
        GROUP BY category
        ORDER BY category
      `,
      [backupId],
    ),
    dailyRoleCounts: queryGroupedCounts(
      database,
      `
        SELECT role AS name, COUNT(*) AS count
        FROM daily_memory_entries
        WHERE copied_from_backup_id = ?
        GROUP BY role
        ORDER BY role
      `,
      [backupId],
    ),
    valuesCopiedToResponse: false,
  }
}

export async function queryLocalStorageReadThroughPreview(request = {}, options = {}) {
  const normalizedRequest = validateLocalStorageReadThroughQueryRequest(request)
  const generatedAt = normalizeIso(options.generatedAt || options.now || new Date())
  const initializeFn = options.initializeStorageDatabase || initializeNexusStorageDatabase
  const status = options.storageStatus || await initializeFn({
    ...options,
    generatedAt,
  })
  const shouldClose = !options.storageStatus

  try {
    if (!status?.ok || !status.database) {
      throw new Error('sqlite storage foundation must be ready before local storage read-through preview')
    }

    const copyRun = findReadThroughCopyRun(status.database, normalizedRequest)
    if (!copyRun) {
      return {
        ok: false,
        status: 'read-through-copy-run-missing',
        generatedAt,
        requestedBackupId: normalizedRequest.backupId,
        requestedCopyId: normalizedRequest.copyId,
        domains: normalizedRequest.domains,
        limit: normalizedRequest.limit,
        previewQueryEnabled: true,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        sourceLocalStoragePreserved: true,
        valuesCopiedToResponse: false,
      }
    }

    const domains = normalizedRequest.domains
    const backupId = cleanString(copyRun.backup_id)
    const chat = domains.includes('chat')
      ? buildChatReadThroughPreview(status.database, backupId, normalizedRequest.limit)
      : { selected: false, hasReadableRows: false, valuesCopiedToResponse: false }
    const memory = domains.includes('memory')
      ? buildMemoryReadThroughPreview(status.database, backupId, normalizedRequest.limit)
      : { selected: false, hasReadableRows: false, valuesCopiedToResponse: false }
    const sourceStorageKeys = queryStorageKeys(status.database, backupId, domains)
    const copyItems = queryCopyItems(status.database, cleanString(copyRun.copy_id), domains)
    const readableRowCount = Number(chat.messageCount || 0)
      + Number(chat.sessionCount || 0)
      + Number(memory.memoryCount || 0)
      + Number(memory.dailyMemoryEntryCount || 0)

    return {
      ok: true,
      status: 'read-through-preview-ready',
      generatedAt,
      backupId,
      copyId: cleanString(copyRun.copy_id),
      copiedAt: cleanString(copyRun.created_at),
      copyStatus: cleanString(copyRun.status),
      domains,
      limit: normalizedRequest.limit,
      chat,
      memory,
      source: {
        sourceStorageKeyCount: sourceStorageKeys.length,
        sourceStorageKeys,
        copyItemCount: copyItems.length,
        copyItems,
      },
      totals: {
        readableRowCount,
        sourceStorageKeyCount: sourceStorageKeys.length,
        copyItemCount: copyItems.length,
      },
      previewQueryEnabled: true,
      runtimeMigrationEnabled: Number(copyRun.runtime_migration_enabled || 0) === 1,
      readThroughMigrationEnabled: Number(copyRun.read_through_migration_enabled || 0) === 1,
      sourceLocalStoragePreserved: Number(copyRun.source_local_storage_preserved || 0) === 1,
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
      localStorageCopyRuns: summary.localStorageCopyRuns,
      localStorageCopyItems: summary.localStorageCopyItems,
      chatSessions: summary.chatSessions,
      chatMessages: summary.chatMessages,
      memories: summary.memories,
      dailyMemoryEntries: summary.dailyMemoryEntries,
      memorySources: summary.memorySources,
    },
  }
}
