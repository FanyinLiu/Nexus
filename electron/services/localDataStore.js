import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

export const LOCAL_DATA_BACKEND = 'sqlite'
export const LOCAL_DATA_SCHEMA_VERSION = 3
export const LOCAL_DATA_MANIFEST_FORMAT = 'nexus-local-data-manifest'
export const LOCAL_DATA_EXPORT_FORMAT = 'nexus-local-data-export'
export const LOCAL_DATA_ONBOARDING_DOMAIN_ID = 'onboarding'
export const LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID = 'chat-sessions'
export const LOCAL_DATA_AUDIT_DOMAIN_ID = 'local-data-audit'

const LEGACY_JSON_BACKEND = 'json-ledger'
const LOCAL_DATA_DIR_NAME = 'local-data'
const MANIFEST_FILE_NAME = 'manifest.json'
const DATABASE_FILE_NAME = 'nexus.sqlite'
const EXPORT_FORMAT_VERSION = 1
const CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION = 1
const ONBOARDING_RECORD_ID = 'state'
const ONBOARDING_STORAGE_KEY = 'nexus:onboarding'
const MAX_CHAT_MIGRATION_SESSIONS = 30
const MAX_CHAT_MIGRATION_MESSAGES_PER_SESSION = 500
const MAX_CHAT_MIGRATION_TEXT = 200_000
const MAX_CHAT_MIGRATION_PAYLOAD_BYTES = 20_000_000
const require = createRequire(import.meta.url)
let DatabaseSync = null

const BUILT_IN_DOMAINS = [
  {
    id: LOCAL_DATA_ONBOARDING_DOMAIN_ID,
    metadata: {
      label: 'Onboarding state mirror',
      sourceStorageKey: ONBOARDING_STORAGE_KEY,
      authority: 'renderer-localStorage',
      mirrorStrategy: 'best-effort-renderer-mirror',
      recordLimit: 1,
      containsUserContent: false,
      containsSecrets: false,
      userVisible: false,
    },
  },
  {
    id: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
    metadata: {
      label: 'Chat sessions',
      sourceStorageKey: 'nexus:chat:sessions',
      legacySourceStorageKey: 'nexus:chat',
      authority: 'renderer-localStorage',
      migrationStrategy: 'explicit-confirmation-required',
      containsUserContent: true,
      containsSecrets: false,
      userVisible: false,
    },
  },
  {
    id: LOCAL_DATA_AUDIT_DOMAIN_ID,
    metadata: {
      label: 'Local data audit events',
      authority: 'main-process',
      containsUserContent: false,
      containsSecrets: false,
      userVisible: false,
    },
  },
]

const MIGRATIONS = [
  {
    id: '0001-create-local-data-manifest',
    fromVersion: 0,
    toVersion: 1,
    description: 'Create the main-process local-data manifest and migration ledger before domain data moves out of renderer storage.',
    rollback: 'Rename the local-data directory out of the active userData path; renderer localStorage remains authoritative.',
    reversible: true,
  },
  {
    id: '0002-create-sqlite-local-data-foundation',
    fromVersion: 1,
    toVersion: 2,
    description: 'Create the SQLite local-data database, schema metadata, migration ledger, and empty domain registry.',
    rollback: 'Rename the local-data directory out of the active userData path; renderer localStorage remains authoritative.',
    reversible: true,
  },
  {
    id: '0003-create-domain-records-and-onboarding-mirror',
    fromVersion: 2,
    toVersion: 3,
    description: 'Create the generic domain record table and register a low-risk onboarding localStorage mirror domain.',
    rollback: 'Rename the local-data directory out of the active userData path; renderer localStorage remains authoritative.',
    reversible: true,
  },
]

let runtimeStatus = {
  initialized: false,
  healthy: false,
  backend: LOCAL_DATA_BACKEND,
  schemaVersion: 0,
  targetSchemaVersion: LOCAL_DATA_SCHEMA_VERSION,
  migrationCount: 0,
  lastMigrationId: null,
  storageDirectoryName: LOCAL_DATA_DIR_NAME,
  errorKind: null,
  errorMessage: null,
}

function nowIso(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

async function resolveDefaultUserDataPath() {
  const electron = await import('electron')
  if (!electron.app?.getPath) {
    throw new Error('Electron app path API is unavailable')
  }
  return electron.app.getPath('userData')
}

async function resolveUserDataPath(options = {}) {
  if (typeof options.userDataPath === 'string' && options.userDataPath.trim()) {
    return options.userDataPath
  }
  return resolveDefaultUserDataPath()
}

export async function resolveLocalDataPaths(options = {}) {
  const userDataPath = await resolveUserDataPath(options)
  const root = path.join(userDataPath, LOCAL_DATA_DIR_NAME)
  return {
    root,
    manifestPath: path.join(root, MANIFEST_FILE_NAME),
    databasePath: path.join(root, DATABASE_FILE_NAME),
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(tempPath, filePath)
}

function normalizeMigrationEntry(entry) {
  if (!isPlainObject(entry)) throw new Error('migration entry must be an object')
  const id = typeof entry.id === 'string' ? entry.id : ''
  const fromVersion = Number.isInteger(entry.fromVersion) ? entry.fromVersion : -1
  const toVersion = Number.isInteger(entry.toVersion) ? entry.toVersion : -1
  const appliedAt = typeof entry.appliedAt === 'string' ? entry.appliedAt : ''
  const reversible = entry.reversible === true
  if (!id || fromVersion < 0 || toVersion < 0 || !appliedAt) {
    throw new Error('migration entry is malformed')
  }
  return {
    id,
    fromVersion,
    toVersion,
    appliedAt,
    reversible,
  }
}

function normalizeManifest(parsed) {
  if (!isPlainObject(parsed)) {
    throw new Error('local-data manifest must be a JSON object')
  }
  if (parsed.format !== LOCAL_DATA_MANIFEST_FORMAT) {
    throw new Error('local-data manifest format is unsupported')
  }
  if (![LOCAL_DATA_BACKEND, LEGACY_JSON_BACKEND].includes(parsed.backend)) {
    throw new Error('local-data backend is unsupported')
  }
  if (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 0) {
    throw new Error('local-data schemaVersion is invalid')
  }
  if (parsed.schemaVersion > LOCAL_DATA_SCHEMA_VERSION) {
    throw new Error('local-data schemaVersion is newer than this app supports')
  }
  if (!Array.isArray(parsed.migrations)) {
    throw new Error('local-data migrations ledger is missing')
  }
  if (!isPlainObject(parsed.domains)) {
    throw new Error('local-data domains registry is missing')
  }

  return {
    format: LOCAL_DATA_MANIFEST_FORMAT,
    formatVersion: Number.isInteger(parsed.formatVersion) ? parsed.formatVersion : 1,
    backend: parsed.backend,
    schemaVersion: parsed.schemaVersion,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : nowIso(),
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
    migrations: parsed.migrations.map(normalizeMigrationEntry),
    domains: { ...parsed.domains },
  }
}

function createEmptyManifest(appliedAt) {
  return {
    format: LOCAL_DATA_MANIFEST_FORMAT,
    formatVersion: 1,
    backend: LEGACY_JSON_BACKEND,
    schemaVersion: 0,
    createdAt: appliedAt,
    updatedAt: appliedAt,
    migrations: [],
    domains: {},
  }
}

function migrationById(id) {
  return MIGRATIONS.find((migration) => migration.id === id) ?? null
}

function legacyAppliedAt(manifest, migrationId, fallback) {
  return manifest.migrations.find((entry) => entry.id === migrationId)?.appliedAt ?? fallback
}

function openSqliteDatabase(databasePath) {
  if (!DatabaseSync) {
    DatabaseSync = require('node:sqlite').DatabaseSync
  }
  const db = new DatabaseSync(databasePath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)
  return db
}

function ensureSqliteTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_data_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      from_version INTEGER NOT NULL,
      to_version INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      reversible INTEGER NOT NULL DEFAULT 1
    );

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

function getMeta(db, key) {
  return db.prepare('SELECT value FROM local_data_meta WHERE key = ?').get(key)?.value ?? null
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO local_data_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value))
}

function getSqliteSchemaVersion(db) {
  const raw = getMeta(db, 'schemaVersion')
  if (raw == null || raw === '') return 0
  const version = Number(raw)
  if (!Number.isInteger(version) || version < 0) {
    throw new Error('local-data SQLite schemaVersion is invalid')
  }
  if (version > LOCAL_DATA_SCHEMA_VERSION) {
    throw new Error('local-data SQLite schemaVersion is newer than this app supports')
  }
  return version
}

function readSqliteMigrations(db) {
  return db.prepare(`
    SELECT id, from_version AS fromVersion, to_version AS toVersion, applied_at AS appliedAt, reversible
    FROM schema_migrations
    ORDER BY to_version ASC, applied_at ASC
  `).all().map((entry) => ({
    id: entry.id,
    fromVersion: entry.fromVersion,
    toVersion: entry.toVersion,
    appliedAt: entry.appliedAt,
    reversible: entry.reversible === 1,
  }))
}

function readSqliteDomains(db) {
  return db.prepare(`
    SELECT id, metadata_json AS metadataJson
    FROM domain_registry
    ORDER BY id ASC
  `).all().map((row) => {
    let metadata = {}
    try {
      const parsed = JSON.parse(row.metadataJson)
      if (isPlainObject(parsed)) metadata = parsed
    } catch {
      metadata = {}
    }
    return { id: row.id, metadata }
  })
}

function registerDomain(db, domain, now) {
  const metadataJson = JSON.stringify(domain.metadata)
  const existing = db.prepare(`
    SELECT metadata_json AS metadataJson
    FROM domain_registry
    WHERE id = ?
  `).get(domain.id)

  if (!existing) {
    db.prepare(`
      INSERT INTO domain_registry (id, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(domain.id, metadataJson, now, now)
    return true
  }

  if (existing.metadataJson !== metadataJson) {
    db.prepare(`
      UPDATE domain_registry
      SET metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(metadataJson, now, domain.id)
    return true
  }

  return false
}

function ensureBuiltInDomains(db, now) {
  let changed = false
  for (const domain of BUILT_IN_DOMAINS) {
    changed = registerDomain(db, domain, now) || changed
  }
  if (changed) setMeta(db, 'updatedAt', now)
  return changed
}

function parseRecordPayload(row) {
  let payload = null
  try {
    payload = JSON.parse(row.payloadJson)
  } catch {
    payload = null
  }
  return {
    domainId: row.domainId,
    recordId: row.recordId,
    payload,
    source: row.source,
    mirroredAt: row.mirroredAt,
    updatedAt: row.updatedAt,
  }
}

function readSqliteRecords(db, domainId = null) {
  const sql = domainId
    ? `
      SELECT domain_id AS domainId, record_id AS recordId, payload_json AS payloadJson,
        source, mirrored_at AS mirroredAt, updated_at AS updatedAt
      FROM local_data_records
      WHERE domain_id = ?
      ORDER BY domain_id ASC, record_id ASC
    `
    : `
      SELECT domain_id AS domainId, record_id AS recordId, payload_json AS payloadJson,
        source, mirrored_at AS mirroredAt, updated_at AS updatedAt
      FROM local_data_records
      ORDER BY domain_id ASC, record_id ASC
    `
  const rows = domainId ? db.prepare(sql).all(domainId) : db.prepare(sql).all()
  return rows.map(parseRecordPayload)
}

function safeParseJsonObject(raw) {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function countChatMessagesFromPayloadJson(raw) {
  const payload = safeParseJsonObject(raw)
  return Array.isArray(payload?.messages) ? payload.messages.length : 0
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

function recordsByDomain(records) {
  const grouped = {}
  for (const record of records) {
    if (!grouped[record.domainId]) grouped[record.domainId] = []
    grouped[record.domainId].push({
      id: record.recordId,
      payload: record.payload,
      source: record.source,
      mirroredAt: record.mirroredAt,
      updatedAt: record.updatedAt,
    })
  }
  return grouped
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).length
}

function normalizeRequiredString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new Error(`${label} is too long`)
  }
  return normalized
}

function normalizeOptionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const normalized = value.trim()
  if (!normalized) return undefined
  if (normalized.length > maxLength) throw new Error(`${label} is too long`)
  return normalized
}

function normalizeIsoTimestamp(value, label) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`)
  }
  return new Date(parsed).toISOString()
}

function cloneJsonValue(value, label, maxBytes = MAX_CHAT_MIGRATION_TEXT) {
  if (value === undefined) return undefined
  const json = JSON.stringify(value)
  if (!json) throw new Error(`${label} must be JSON serializable`)
  if (byteLength(json) > maxBytes) throw new Error(`${label} is too large`)
  return JSON.parse(json)
}

function normalizeChatMigrationMessage(value, index) {
  if (!isPlainObject(value)) throw new Error(`message ${index} must be an object`)
  if (!['user', 'assistant', 'system'].includes(value.role)) {
    throw new Error(`message ${index} role is unsupported`)
  }
  const content = normalizeRequiredString(value.content, `message ${index} content`, MAX_CHAT_MIGRATION_TEXT)
  const message = {
    id: normalizeRequiredString(value.id, `message ${index} id`, 256),
    role: value.role,
    content,
    createdAt: normalizeIsoTimestamp(value.createdAt, `message ${index} createdAt`),
  }

  const tone = normalizeOptionalString(value.tone, `message ${index} tone`, 32)
  if (tone === 'neutral' || tone === 'error') message.tone = tone

  const reasoning = normalizeOptionalString(
    value.reasoning_content,
    `message ${index} reasoning_content`,
    MAX_CHAT_MIGRATION_TEXT,
  )
  if (reasoning) message.reasoning_content = reasoning

  const toolResult = cloneJsonValue(value.toolResult, `message ${index} toolResult`)
  if (toolResult !== undefined) message.toolResult = toolResult

  return message
}

function normalizeChatMigrationSession(value, index) {
  if (!isPlainObject(value)) throw new Error(`session ${index} must be an object`)
  if (!Array.isArray(value.messages)) throw new Error(`session ${index} messages must be an array`)
  if (value.messages.length > MAX_CHAT_MIGRATION_MESSAGES_PER_SESSION) {
    throw new Error(`session ${index} has too many messages`)
  }

  const messages = value.messages.map((message, messageIndex) => normalizeChatMigrationMessage(message, messageIndex))
  const session = {
    id: normalizeRequiredString(value.id, `session ${index} id`, 256),
    startedAt: Date.parse(normalizeIsoTimestamp(value.startedAt, `session ${index} startedAt`)),
    lastActiveAt: Date.parse(normalizeIsoTimestamp(value.lastActiveAt, `session ${index} lastActiveAt`)),
    messages,
  }
  const title = normalizeOptionalString(value.title, `session ${index} title`, 80)
  if (title) session.title = title
  return session
}

function normalizeChatMigrationPackage(value) {
  if (!isPlainObject(value)) throw new Error('chat migration package must be an object')
  if (value.schemaVersion !== CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION) {
    throw new Error('chat migration package schemaVersion is unsupported')
  }
  if (!Array.isArray(value.sessions)) throw new Error('chat migration package sessions must be an array')
  if (value.sessions.length > MAX_CHAT_MIGRATION_SESSIONS) {
    throw new Error('chat migration package has too many sessions')
  }

  const migrationPackage = {
    schemaVersion: CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION,
    createdAt: normalizeIsoTimestamp(value.createdAt, 'chat migration package createdAt'),
    source: isPlainObject(value.source) ? {
      sessionsKeyPresent: value.source.sessionsKeyPresent === true,
      legacyFlatChatKeyPresent: value.source.legacyFlatChatKeyPresent === true,
      legacyFlatChatUsed: value.source.legacyFlatChatUsed === true,
    } : {
      sessionsKeyPresent: false,
      legacyFlatChatKeyPresent: false,
      legacyFlatChatUsed: false,
    },
    sessions: value.sessions.map(normalizeChatMigrationSession),
  }

  const payloadBytes = byteLength(JSON.stringify(migrationPackage.sessions))
  if (payloadBytes > MAX_CHAT_MIGRATION_PAYLOAD_BYTES) {
    throw new Error('chat migration package payload is too large')
  }

  return { migrationPackage, payloadBytes }
}

function summarizeChatMigrationPackage(migrationPackage, payloadBytes) {
  const messageCount = migrationPackage.sessions.reduce((sum, session) => sum + session.messages.length, 0)
  return {
    targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
    schemaVersion: migrationPackage.schemaVersion,
    sessionCount: migrationPackage.sessions.length,
    messageCount,
    payloadBytes,
    legacyFlatChatUsed: migrationPackage.source.legacyFlatChatUsed,
    requiresConfirmation: true,
    writesData: true,
  }
}

function normalizeNonNegativeInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function normalizeChatComparisonSourceSession(value, index) {
  if (!isPlainObject(value)) throw new Error(`comparison session ${index} must be an object`)
  return {
    id: normalizeRequiredString(value.id, `comparison session ${index} id`, 256),
    startedAt: parseDateInput(value.startedAt, `comparison session ${index} startedAt`),
    lastActiveAt: parseDateInput(value.lastActiveAt, `comparison session ${index} lastActiveAt`),
    messageCount: normalizeNonNegativeInteger(
      value.messageCount,
      `comparison session ${index} messageCount`,
      MAX_CHAT_MIGRATION_MESSAGES_PER_SESSION,
    ),
    payloadBytes: normalizeNonNegativeInteger(
      value.payloadBytes,
      `comparison session ${index} payloadBytes`,
      MAX_CHAT_MIGRATION_PAYLOAD_BYTES,
    ),
  }
}

function normalizeChatComparisonSource(value) {
  if (!isPlainObject(value)) throw new Error('chat comparison source must be an object')
  if (value.schemaVersion !== CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION) {
    throw new Error('chat comparison source schemaVersion is unsupported')
  }
  if (!Array.isArray(value.sessions)) throw new Error('chat comparison source sessions must be an array')
  if (value.sessions.length > MAX_CHAT_MIGRATION_SESSIONS) {
    throw new Error('chat comparison source has too many sessions')
  }
  return {
    schemaVersion: CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION,
    generatedAt: normalizeIsoTimestamp(value.generatedAt, 'chat comparison source generatedAt'),
    source: isPlainObject(value.source) ? {
      sessionsKeyPresent: value.source.sessionsKeyPresent === true,
      legacyFlatChatKeyPresent: value.source.legacyFlatChatKeyPresent === true,
      legacyFlatChatUsed: value.source.legacyFlatChatUsed === true,
    } : {
      sessionsKeyPresent: false,
      legacyFlatChatKeyPresent: false,
      legacyFlatChatUsed: false,
    },
    sessions: value.sessions.map(normalizeChatComparisonSourceSession),
  }
}

function summarizeChatComparisonSessions(sessions) {
  return sessions.reduce((summary, session) => {
    summary.sessionCount += 1
    summary.messageCount += session.messageCount
    summary.payloadBytes += session.payloadBytes
    return summary
  }, {
    sessionCount: 0,
    messageCount: 0,
    payloadBytes: 0,
  })
}

function summarizeSqliteChatComparisonSessions(sessions) {
  return summarizeChatComparisonSessions(sessions.map((session) => ({
    id: session.id,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    messageCount: session.messages.length,
    payloadBytes: byteLength(JSON.stringify(session)),
  })))
}

function compareChatSessionMetadata(sourceSessions, sqliteSessions) {
  const sourceMap = new Map(sourceSessions.map((session) => [session.id, session]))
  const sqliteMetadata = sqliteSessions.map((session) => ({
    id: session.id,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    messageCount: session.messages.length,
    payloadBytes: byteLength(JSON.stringify(session)),
  }))
  const sqliteMap = new Map(sqliteMetadata.map((session) => [session.id, session]))

  let matchedRecordCount = 0
  let metadataAlignedRecordCount = 0
  let metadataMismatchCount = 0
  let missingSqliteRecordCount = 0

  for (const sourceSession of sourceSessions) {
    const sqliteSession = sqliteMap.get(sourceSession.id)
    if (!sqliteSession) {
      missingSqliteRecordCount += 1
      continue
    }
    matchedRecordCount += 1
    const aligned = sourceSession.startedAt === sqliteSession.startedAt
      && sourceSession.lastActiveAt === sqliteSession.lastActiveAt
      && sourceSession.messageCount === sqliteSession.messageCount
      && sourceSession.payloadBytes === sqliteSession.payloadBytes
    if (aligned) {
      metadataAlignedRecordCount += 1
    } else {
      metadataMismatchCount += 1
    }
  }

  let extraSqliteRecordCount = 0
  for (const sqliteSession of sqliteMetadata) {
    if (!sourceMap.has(sqliteSession.id)) extraSqliteRecordCount += 1
  }

  return {
    matchedRecordCount,
    metadataAlignedRecordCount,
    metadataMismatchCount,
    missingSqliteRecordCount,
    extraSqliteRecordCount,
  }
}

function chatComparisonIssueCodes({
  sourceSummary,
  sqliteSummary,
  malformedRecordCount,
  metadata,
  messageCountDelta,
}) {
  const issues = []
  if (sourceSummary.sessionCount === 0 && sourceSummary.messageCount === 0) issues.push('no-source-chat-data')
  if (sqliteSummary.sessionCount === 0 && sqliteSummary.messageCount === 0) issues.push('no-sqlite-chat-records')
  if (malformedRecordCount > 0) issues.push('sqlite-malformed-records')
  if (metadata.missingSqliteRecordCount > 0) issues.push('sqlite-missing-records')
  if (metadata.extraSqliteRecordCount > 0) issues.push('sqlite-extra-records')
  if (metadata.metadataMismatchCount > 0) issues.push('sqlite-metadata-mismatch')
  if (messageCountDelta !== 0) issues.push('sqlite-message-count-delta')
  if (issues.length === 0) issues.push('comparison-aligned')
  return issues
}

function auditRecordId(prefix, now) {
  return `${prefix}-${nowIso(now).replace(/[:.]/g, '-')}`
}

function insertLocalDataAuditRecord(db, recordId, payload, now) {
  db.prepare(`
    INSERT INTO local_data_records (domain_id, record_id, payload_json, source, mirrored_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain_id, record_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      source = excluded.source,
      mirrored_at = excluded.mirrored_at,
      updated_at = excluded.updated_at
  `).run(
    LOCAL_DATA_AUDIT_DOMAIN_ID,
    recordId,
    JSON.stringify(payload),
    'main-process-local-data-service',
    now,
    now,
  )
}

function parseDateInput(value, label) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`)
  }
  return parsed
}

export function normalizeOnboardingMirrorState(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('onboarding mirror state must be an object')
  }

  const completedAtMs = parseDateInput(raw.completedAt, 'completedAt')
  const normalized = {
    completedAt: new Date(completedAtMs).toISOString(),
  }

  if (raw.firstConversationAt !== undefined && raw.firstConversationAt !== null) {
    const firstConversationMs = parseDateInput(raw.firstConversationAt, 'firstConversationAt')
    if (firstConversationMs >= completedAtMs) {
      normalized.firstConversationAt = new Date(firstConversationMs).toISOString()
      normalized.firstConversationElapsedMs = Math.max(0, Math.round(firstConversationMs - completedAtMs))
    }
  }

  return normalized
}

function insertMigration(db, migration, appliedAt) {
  db.prepare(`
    INSERT INTO schema_migrations (id, from_version, to_version, applied_at, reversible)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(
    migration.id,
    migration.fromVersion,
    migration.toVersion,
    appliedAt,
    migration.reversible ? 1 : 0,
  )
  setMeta(db, 'schemaVersion', migration.toVersion)
}

function applySqliteMigrations(db, manifest, appliedAt) {
  const applied = []
  db.exec('BEGIN')
  try {
    let currentVersion = getSqliteSchemaVersion(db)

    for (const migration of MIGRATIONS) {
      if (currentVersion >= migration.toVersion) continue
      if (currentVersion !== migration.fromVersion) {
        throw new Error(`Cannot apply ${migration.id}: expected schemaVersion ${migration.fromVersion}, found ${currentVersion}`)
      }
      const migrationAppliedAt = migration.id === '0001-create-local-data-manifest'
        ? legacyAppliedAt(manifest, migration.id, appliedAt)
        : appliedAt
      insertMigration(db, migration, migrationAppliedAt)
      currentVersion = migration.toVersion
      applied.push(migration.id)
    }

    setMeta(db, 'backend', LOCAL_DATA_BACKEND)
    if (!getMeta(db, 'createdAt')) setMeta(db, 'createdAt', manifest.createdAt || appliedAt)
    if (applied.length > 0 || !getMeta(db, 'updatedAt')) {
      setMeta(db, 'updatedAt', appliedAt)
    }
    ensureBuiltInDomains(db, appliedAt)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
  return applied
}

function readSqliteState(db) {
  const schemaVersion = getSqliteSchemaVersion(db)
  const migrations = readSqliteMigrations(db)
  const domains = readSqliteDomains(db)
  return {
    backend: LOCAL_DATA_BACKEND,
    schemaVersion,
    createdAt: getMeta(db, 'createdAt') ?? nowIso(),
    updatedAt: getMeta(db, 'updatedAt') ?? nowIso(),
    migrations,
    domains,
  }
}

function manifestFromSqliteState(state) {
  return {
    format: LOCAL_DATA_MANIFEST_FORMAT,
    formatVersion: 1,
    backend: LOCAL_DATA_BACKEND,
    schemaVersion: state.schemaVersion,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    migrations: state.migrations.map((entry) => ({ ...entry })),
    domains: Object.fromEntries(state.domains.map((domain) => [domain.id, { ...domain.metadata }])),
  }
}

function statusFromSqliteState(state, initialized = true) {
  const lastMigration = state.migrations.at(-1)
  return {
    initialized,
    healthy: true,
    backend: LOCAL_DATA_BACKEND,
    schemaVersion: state.schemaVersion,
    targetSchemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    migrationCount: state.migrations.length,
    lastMigrationId: lastMigration?.id ?? null,
    storageDirectoryName: LOCAL_DATA_DIR_NAME,
    errorKind: null,
    errorMessage: null,
  }
}

function statusFromError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const manifestInvalid = /(?:manifest|schemaVersion|backend|format|migration|JSON)/iu.test(message)
  const sqliteInvalid = /(?:SQLite|sqlite|database|SQLITE_)/u.test(message)
  return {
    initialized: false,
    healthy: false,
    backend: LOCAL_DATA_BACKEND,
    schemaVersion: 0,
    targetSchemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    migrationCount: 0,
    lastMigrationId: null,
    storageDirectoryName: LOCAL_DATA_DIR_NAME,
    errorKind: manifestInvalid
      ? 'local-data-manifest-invalid'
      : sqliteInvalid
        ? 'local-data-sqlite-unavailable'
        : 'local-data-unavailable',
    errorMessage: manifestInvalid
      ? 'Local data manifest is invalid; existing renderer storage remains authoritative.'
      : sqliteInvalid
        ? 'Local data SQLite database is unavailable; existing renderer storage remains authoritative.'
        : 'Local data adapter is unavailable; existing renderer storage remains authoritative.',
  }
}

export function getLocalDataStatus() {
  return { ...runtimeStatus }
}

export async function initializeLocalDataStore(options = {}) {
  let db = null
  try {
    const appliedAt = nowIso(options.now)
    const { root, manifestPath, databasePath } = await resolveLocalDataPaths(options)
    await fs.mkdir(root, { recursive: true })

    const manifestExists = await pathExists(manifestPath)
    const manifest = manifestExists
      ? normalizeManifest(await readJsonFile(manifestPath))
      : createEmptyManifest(appliedAt)

    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)
    applySqliteMigrations(db, manifest, appliedAt)

    const state = readSqliteState(db)
    await atomicWriteJson(manifestPath, manifestFromSqliteState(state))

    runtimeStatus = statusFromSqliteState(state)
    return getLocalDataStatus()
  } catch (error) {
    runtimeStatus = statusFromError(error)
    return getLocalDataStatus()
  } finally {
    if (db) db.close()
  }
}

export async function readLocalDataManifest(options = {}) {
  const { manifestPath } = await resolveLocalDataPaths(options)
  return normalizeManifest(await readJsonFile(manifestPath))
}

export async function readLocalDataSqliteState(options = {}) {
  const { databasePath } = await resolveLocalDataPaths(options)
  const db = openSqliteDatabase(databasePath)
  try {
    ensureSqliteTables(db)
    return readSqliteState(db)
  } finally {
    db.close()
  }
}

export async function readLocalDataDomainRecords(domainId, options = {}) {
  const { databasePath } = await resolveLocalDataPaths(options)
  const db = openSqliteDatabase(databasePath)
  try {
    ensureSqliteTables(db)
    return readSqliteRecords(db, domainId)
  } finally {
    db.close()
  }
}

export async function buildLocalDataExportSnapshot(options = {}) {
  const includeRecords = options.includeRecords === true
  const { databasePath } = await resolveLocalDataPaths(options)
  const db = openSqliteDatabase(databasePath)
  try {
    ensureSqliteTables(db)
    const state = readSqliteState(db)
    return {
      format: LOCAL_DATA_EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: nowIso(options.now),
      backend: state.backend,
      schemaVersion: state.schemaVersion,
      recordPayloadsIncluded: includeRecords,
      domains: state.domains.map((domain) => ({
        id: domain.id,
        metadata: { ...domain.metadata },
      })),
      migrations: state.migrations.map((entry) => ({ ...entry })),
      records: includeRecords ? recordsByDomain(readSqliteRecords(db)) : undefined,
    }
  } finally {
    db.close()
  }
}

export async function mirrorLocalDataOnboardingState(options = {}) {
  let normalizedState = null
  try {
    if (options.state !== null && options.state !== undefined) {
      normalizedState = normalizeOnboardingMirrorState(options.state)
    }
  } catch {
    return {
      ok: false,
      domainId: LOCAL_DATA_ONBOARDING_DOMAIN_ID,
      recordId: ONBOARDING_RECORD_ID,
      mirrored: false,
      deleted: false,
      errorKind: 'local-data-onboarding-invalid',
      errorMessage: 'Onboarding mirror payload is invalid.',
    }
  }

  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return {
      ok: false,
      domainId: LOCAL_DATA_ONBOARDING_DOMAIN_ID,
      recordId: ONBOARDING_RECORD_ID,
      mirrored: false,
      deleted: false,
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    }
  }

  let db = null
  try {
    const mirroredAt = nowIso(options.now)
    const { manifestPath, databasePath } = await resolveLocalDataPaths(options)
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    db.exec('BEGIN')
    try {
      ensureBuiltInDomains(db, mirroredAt)
      if (normalizedState) {
        db.prepare(`
          INSERT INTO local_data_records (domain_id, record_id, payload_json, source, mirrored_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(domain_id, record_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            source = excluded.source,
            mirrored_at = excluded.mirrored_at,
            updated_at = excluded.updated_at
        `).run(
          LOCAL_DATA_ONBOARDING_DOMAIN_ID,
          ONBOARDING_RECORD_ID,
          JSON.stringify(normalizedState),
          'renderer-localStorage',
          mirroredAt,
          mirroredAt,
        )
      } else {
        db.prepare(`
          DELETE FROM local_data_records
          WHERE domain_id = ? AND record_id = ?
        `).run(LOCAL_DATA_ONBOARDING_DOMAIN_ID, ONBOARDING_RECORD_ID)
      }
      setMeta(db, 'updatedAt', mirroredAt)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }

    const state = readSqliteState(db)
    await atomicWriteJson(manifestPath, manifestFromSqliteState(state))
    runtimeStatus = statusFromSqliteState(state)

    return {
      ok: true,
      domainId: LOCAL_DATA_ONBOARDING_DOMAIN_ID,
      recordId: ONBOARDING_RECORD_ID,
      mirrored: Boolean(normalizedState),
      deleted: !normalizedState,
      schemaVersion: state.schemaVersion,
      errorKind: null,
      errorMessage: null,
    }
  } catch (error) {
    runtimeStatus = statusFromError(error)
    return {
      ok: false,
      domainId: LOCAL_DATA_ONBOARDING_DOMAIN_ID,
      recordId: ONBOARDING_RECORD_ID,
      mirrored: false,
      deleted: false,
      errorKind: runtimeStatus.errorKind,
      errorMessage: runtimeStatus.errorMessage,
    }
  } finally {
    if (db) db.close()
  }
}

export function planChatLocalDataMigration(migrationPackage) {
  try {
    const normalized = normalizeChatMigrationPackage(migrationPackage)
    return {
      ok: true,
      ...summarizeChatMigrationPackage(normalized.migrationPackage, normalized.payloadBytes),
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
    runtimeStatus = statusFromSqliteState(state)

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
    runtimeStatus = statusFromError(error)
    return {
      ...planned,
      ok: false,
      applied: false,
      recordsWritten: 0,
      auditRecordId: null,
      errorKind: runtimeStatus.errorKind,
      errorMessage: runtimeStatus.errorMessage,
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
    runtimeStatus = statusFromSqliteState(state)
    return {
      ok: true,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      recordsDeleted: existing,
      auditRecordId: auditId,
      errorKind: null,
      errorMessage: null,
    }
  } catch (error) {
    runtimeStatus = statusFromError(error)
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      recordsDeleted: 0,
      auditRecordId: null,
      errorKind: runtimeStatus.errorKind,
      errorMessage: runtimeStatus.errorMessage,
    }
  } finally {
    if (db) db.close()
  }
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
    runtimeStatus = statusFromError(error)
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: runtimeStatus.schemaVersion,
      recordCount: 0,
      messageCount: 0,
      recordPayloadsIncluded: false,
      lastAuditRecordId: null,
      lastAuditAction: null,
      lastAuditAt: null,
      errorKind: runtimeStatus.errorKind,
      errorMessage: runtimeStatus.errorMessage,
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
    runtimeStatus = statusFromError(error)
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: runtimeStatus.schemaVersion,
      recordPayloadsIncluded: true,
      recordCount: 0,
      validSessionCount: 0,
      messageCount: 0,
      malformedRecordCount: 0,
      sessions: [],
      errorKind: runtimeStatus.errorKind,
      errorMessage: runtimeStatus.errorMessage,
    }
  } finally {
    if (db) db.close()
  }
}

export async function compareChatLocalDataSessions(options = {}) {
  if (options.confirmed !== true) {
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
      errorKind: 'local-data-chat-comparison-confirmation-required',
      errorMessage: 'Chat local-data comparison requires explicit confirmation.',
    }
  }

  let source
  try {
    source = normalizeChatComparisonSource(options.source)
  } catch {
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
      errorKind: 'local-data-chat-comparison-invalid',
      errorMessage: 'Chat local-data comparison source is invalid.',
    }
  }

  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: status.schemaVersion,
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
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    }
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
    runtimeStatus = statusFromSqliteState(state)

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
    runtimeStatus = statusFromError(error)
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: runtimeStatus.schemaVersion,
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
      errorKind: runtimeStatus.errorKind,
      errorMessage: runtimeStatus.errorMessage,
    }
  } finally {
    if (db) db.close()
  }
}

export async function mirrorChatLocalDataSession(options = {}) {
  if (options.confirmed !== true) {
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
      errorKind: 'local-data-chat-runtime-mirror-confirmation-required',
      errorMessage: 'Chat runtime mirror requires explicit confirmation.',
    }
  }

  let normalizedSession
  try {
    normalizedSession = normalizeChatMigrationSession(options.session, 0)
  } catch {
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
      errorKind: 'local-data-chat-runtime-mirror-invalid',
      errorMessage: 'Chat runtime mirror session is invalid.',
    }
  }

  const status = await initializeLocalDataStore(options)
  if (!status.healthy) {
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: status.schemaVersion,
      mirrored: false,
      deleted: false,
      recordsWritten: 0,
      recordsDeleted: 0,
      messageCount: 0,
      auditRecordId: null,
      errorKind: status.errorKind,
      errorMessage: status.errorMessage,
    }
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
    runtimeStatus = statusFromSqliteState(state)
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
    runtimeStatus = statusFromError(error)
    return {
      ok: false,
      targetDomainId: LOCAL_DATA_CHAT_SESSIONS_DOMAIN_ID,
      schemaVersion: runtimeStatus.schemaVersion,
      mirrored: false,
      deleted: false,
      recordsWritten: 0,
      recordsDeleted: 0,
      messageCount: 0,
      auditRecordId: null,
      errorKind: runtimeStatus.errorKind,
      errorMessage: runtimeStatus.errorMessage,
    }
  } finally {
    if (db) db.close()
  }
}

export function planLocalDataImport(snapshot) {
  if (!isPlainObject(snapshot)) {
    return { ok: false, reason: 'snapshot must be a JSON object' }
  }
  if (snapshot.format !== LOCAL_DATA_EXPORT_FORMAT) {
    return { ok: false, reason: 'unsupported snapshot format' }
  }
  if (snapshot.formatVersion !== EXPORT_FORMAT_VERSION) {
    return { ok: false, reason: 'unsupported snapshot format version' }
  }
  if (snapshot.backend !== LOCAL_DATA_BACKEND) {
    return { ok: false, reason: 'unsupported snapshot backend' }
  }
  if (!Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 0 || snapshot.schemaVersion > LOCAL_DATA_SCHEMA_VERSION) {
    return { ok: false, reason: 'unsupported snapshot schema version' }
  }
  const domains = Array.isArray(snapshot.domains) ? snapshot.domains : []
  const migrations = Array.isArray(snapshot.migrations) ? snapshot.migrations : []
  return {
    ok: true,
    schemaVersion: snapshot.schemaVersion,
    domainCount: domains.length,
    migrationCount: migrations.length,
    recordPayloadsIncluded: snapshot.recordPayloadsIncluded === true,
    writesData: false,
  }
}

export async function importLocalDataSnapshot(options = {}) {
  const plan = planLocalDataImport(options.snapshot)
  if (!plan.ok || options.dryRun !== false) return { ...plan, applied: false }
  await initializeLocalDataStore(options)
  return { ...plan, applied: true }
}

function rollbackDirectoryName(now = new Date()) {
  return `${LOCAL_DATA_DIR_NAME}.disabled-${nowIso(now).replace(/[:.]/g, '-')}`
}

export async function rollbackLocalDataStore(options = {}) {
  try {
    const { root } = await resolveLocalDataPaths(options)
    if (!(await pathExists(root))) {
      runtimeStatus = {
        ...runtimeStatus,
        initialized: false,
        healthy: true,
        schemaVersion: 0,
        migrationCount: 0,
        lastMigrationId: null,
      }
      return { ok: true, action: 'noop', disabledDirectoryName: null }
    }

    const userDataPath = path.dirname(root)
    const baseName = rollbackDirectoryName(options.now)
    let target = path.join(userDataPath, baseName)
    let suffix = 1
    while (await pathExists(target)) {
      target = path.join(userDataPath, `${baseName}-${suffix}`)
      suffix += 1
    }
    await fs.rename(root, target)
    runtimeStatus = {
      initialized: false,
      healthy: true,
      backend: LOCAL_DATA_BACKEND,
      schemaVersion: 0,
      targetSchemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      migrationCount: 0,
      lastMigrationId: null,
      storageDirectoryName: LOCAL_DATA_DIR_NAME,
      errorKind: null,
      errorMessage: null,
    }
    return { ok: true, action: 'renamed', disabledDirectoryName: path.basename(target) }
  } catch (error) {
    runtimeStatus = statusFromError(error)
    return { ok: false, action: 'error', disabledDirectoryName: null, errorMessage: runtimeStatus.errorMessage }
  }
}

export function getLocalDataMigrationPlan() {
  return MIGRATIONS.map((migration) => ({
    ...migration,
    known: migrationById(migration.id) != null,
  }))
}
