import electron from 'electron'

import { requireTrustedSender } from './validate.js'
import {
  backupLocalStorageSnapshot,
  copyLocalStorageSnapshotToStructuredSqlite,
  initializeNexusStorageDatabase,
  M4_SQLITE_FOUNDATION_GATE,
  M4_SQLITE_FOUNDATION_TABLES,
  M4_SQLITE_SCHEMA_VERSION,
  queryLocalStorageReadThroughData,
  queryLocalStorageReadThroughPreview,
  setLocalStorageReadThroughMode,
  validateLocalStorageReadThroughDataRequest,
  validateLocalStorageReadThroughModeRequest,
  validateLocalStorageReadThroughQueryRequest,
  validateLocalStorageSnapshotCopyRequest,
  validateLocalStorageSnapshotRequest,
} from '../services/sqliteStorage.js'

export const STORAGE_STATUS_CHANNEL = 'storage:status'
export const STORAGE_BACKUP_LOCAL_SNAPSHOT_CHANNEL = 'storage:backup-local-snapshot'
export const STORAGE_COPY_LOCAL_SNAPSHOT_CHANNEL = 'storage:copy-local-snapshot'
export const STORAGE_READ_THROUGH_PREVIEW_CHANNEL = 'storage:read-through-preview'
export const STORAGE_SET_READ_THROUGH_MODE_CHANNEL = 'storage:set-read-through-mode'
export const STORAGE_READ_THROUGH_DATA_CHANNEL = 'storage:read-through-data'
export const STORAGE_BACKUP_LOCAL_SNAPSHOT_GATE = 'nexus-v1-m4-local-storage-snapshot-backup'
export const STORAGE_COPY_LOCAL_SNAPSHOT_GATE = 'nexus-v1-m4-local-storage-snapshot-copy'
export const STORAGE_READ_THROUGH_PREVIEW_GATE = 'nexus-v1-m4-local-storage-read-through-preview'
export const STORAGE_READ_THROUGH_MODE_GATE = 'nexus-v1-m4-local-storage-read-through-mode'
export const STORAGE_READ_THROUGH_DATA_GATE = 'nexus-v1-m4-local-storage-read-through-data'

const { app, ipcMain } = electron ?? {}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toFiniteNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : []
}

function databasePathKind(databasePath, appLike) {
  const target = cleanString(databasePath)
  if (!target) return 'unknown'

  try {
    const userDataPath = cleanString(appLike?.getPath?.('userData'))
    if (userDataPath && target.startsWith(userDataPath)) return 'userData'
  } catch {
    // Ignore app path lookup failures; this is a diagnostic label only.
  }

  return 'custom'
}

function databaseFileName(databasePath) {
  const normalized = cleanString(databasePath).replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) || 'nexus.sqlite3'
}

function expectedTableReadiness(tables) {
  const present = new Set(toStringArray(tables))
  return M4_SQLITE_FOUNDATION_TABLES.map((table) => ({
    table,
    ready: present.has(table),
  }))
}

function blockingIssuesForStatus(status, missingTables) {
  const issues = []
  if (status?.runtime?.available !== true) issues.push('node-sqlite-runtime-unavailable')
  if (status?.ok !== true) issues.push('sqlite-foundation-schema-not-ready')
  issues.push(...missingTables.map((table) => `missing-table:${table}`))
  return [...new Set(issues)]
}

export function buildStorageStatusResponse(status, options = {}) {
  const tables = toStringArray(status?.tables)
  const missingTables = M4_SQLITE_FOUNDATION_TABLES.filter((table) => !tables.includes(table))
  const counts = isObject(status?.counts) ? status.counts : {}
  const blockingIssueIds = blockingIssuesForStatus(status, missingTables)

  return validateStorageStatusResponse({
    gate: M4_SQLITE_FOUNDATION_GATE,
    ok: status?.ok === true,
    status: cleanString(status?.status) || 'unknown',
    schemaVersion: toFiniteNumber(status?.schemaVersion, 0),
    runtime: {
      engine: cleanString(status?.runtime?.engine) || 'node:sqlite',
      available: status?.runtime?.available === true,
      experimental: status?.runtime?.experimental !== false,
      externalDependencyAdded: status?.runtime?.externalDependencyAdded === true,
    },
    database: {
      pathKind: databasePathKind(status?.databasePath, options.appLike),
      fileName: databaseFileName(status?.databasePath),
      schemaVersion: toFiniteNumber(status?.schemaVersion, 0),
      journalMode: cleanString(status?.journalMode) || 'unknown',
      expectedTables: expectedTableReadiness(tables),
      missingTables,
      counts: {
        schemaMigrations: toFiniteNumber(counts.schemaMigrations, 0),
        backups: toFiniteNumber(counts.backups, 0),
        localStorageLedgerItems: toFiniteNumber(counts.localStorageLedgerItems, 0),
        migrationEvents: toFiniteNumber(counts.migrationEvents, 0),
        localStorageBackupRuns: toFiniteNumber(counts.localStorageBackupRuns, 0),
        localStorageBackupItems: toFiniteNumber(counts.localStorageBackupItems, 0),
        localStorageCopyRuns: toFiniteNumber(counts.localStorageCopyRuns, 0),
        localStorageCopyItems: toFiniteNumber(counts.localStorageCopyItems, 0),
        chatSessions: toFiniteNumber(counts.chatSessions, 0),
        chatMessages: toFiniteNumber(counts.chatMessages, 0),
        memories: toFiniteNumber(counts.memories, 0),
        dailyMemoryEntries: toFiniteNumber(counts.dailyMemoryEntries, 0),
        memorySources: toFiniteNumber(counts.memorySources, 0),
        readThroughEnabledCopyRuns: toFiniteNumber(counts.readThroughEnabledCopyRuns, 0),
        runtimeMigrationEnabledCopyRuns: toFiniteNumber(counts.runtimeMigrationEnabledCopyRuns, 0),
      },
    },
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: toFiniteNumber(counts.readThroughEnabledCopyRuns, 0) > 0,
      sourceLocalStoragePreservationRequired: true,
      backupBeforeMutationRequired: true,
      rollbackToolRequired: true,
      backupLedgerReady: tables.includes('storage_backups'),
      rollbackLedgerReady: tables.includes('storage_schema_migrations'),
      localStorageLedgerReady: tables.includes('local_storage_migration_ledger'),
      localStorageSnapshotBackupReady: tables.includes('local_storage_backup_runs')
        && tables.includes('local_storage_backup_items'),
      localStorageStructuredCopyReady: tables.includes('local_storage_copy_runs')
        && tables.includes('local_storage_copy_items')
        && tables.includes('chat_sessions')
        && tables.includes('chat_messages')
        && tables.includes('memories')
        && tables.includes('daily_memory_entries')
        && tables.includes('memory_sources'),
      crossPlatformCoverageRequired: ['macos', 'windows', 'linux'],
    },
    privacy: {
      userDataCopied: false,
      localStorageValuesRead: false,
      absoluteDatabasePathExposed: false,
    },
    blockingIssueIds,
    nextActions: blockingIssueIds.length > 0
      ? ['fix-node-sqlite-foundation-before-runtime-migration']
      : [
          'capture-local-storage-snapshot-backup-before-read-through-migration',
          'implement-read-through-chat-memory-migration-with-backup',
          'add-restore-and-downgrade-cli-fixtures',
          'capture-packaged-electron-sqlite-smoke-evidence',
        ],
  })
}

function requirePlainObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be a plain object`)
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
}

function requireFiniteNumber(value, label) {
  if (!Number.isFinite(Number(value))) throw new Error(`${label} must be a finite number`)
}

function requireStringValue(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
}

function requireString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
}

function requireTableReadiness(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  for (const [index, entry] of value.entries()) {
    requirePlainObject(entry, `${label}[${index}]`)
    requireStringValue(entry.table, `${label}[${index}].table`)
    requireBoolean(entry.ready, `${label}[${index}].ready`)
  }
}

export function validateStorageStatusResponse(response) {
  requirePlainObject(response, 'storage status response')
  requireStringValue(response.gate, 'gate')
  if (response.gate !== M4_SQLITE_FOUNDATION_GATE) {
    throw new Error('storage status response gate mismatch')
  }
  requireBoolean(response.ok, 'ok')
  requireStringValue(response.status, 'status')
  requireFiniteNumber(response.schemaVersion, 'schemaVersion')

  requirePlainObject(response.runtime, 'runtime')
  requireStringValue(response.runtime.engine, 'runtime.engine')
  requireBoolean(response.runtime.available, 'runtime.available')
  requireBoolean(response.runtime.experimental, 'runtime.experimental')
  requireBoolean(response.runtime.externalDependencyAdded, 'runtime.externalDependencyAdded')

  requirePlainObject(response.database, 'database')
  requireStringValue(response.database.pathKind, 'database.pathKind')
  if (!['userData', 'custom', 'unknown'].includes(response.database.pathKind)) {
    throw new Error('database.pathKind must be userData, custom, or unknown')
  }
  requireStringValue(response.database.fileName, 'database.fileName')
  if (response.database.fileName.includes('/') || response.database.fileName.includes('\\')) {
    throw new Error('database.fileName must not include path separators')
  }
  requireFiniteNumber(response.database.schemaVersion, 'database.schemaVersion')
  requireStringValue(response.database.journalMode, 'database.journalMode')
  requireTableReadiness(response.database.expectedTables, 'database.expectedTables')
  requireStringArray(response.database.missingTables, 'database.missingTables')
  requirePlainObject(response.database.counts, 'database.counts')
  requireFiniteNumber(response.database.counts.schemaMigrations, 'database.counts.schemaMigrations')
  requireFiniteNumber(response.database.counts.backups, 'database.counts.backups')
  requireFiniteNumber(response.database.counts.localStorageLedgerItems, 'database.counts.localStorageLedgerItems')
  requireFiniteNumber(response.database.counts.migrationEvents, 'database.counts.migrationEvents')
  requireFiniteNumber(response.database.counts.localStorageBackupRuns, 'database.counts.localStorageBackupRuns')
  requireFiniteNumber(response.database.counts.localStorageBackupItems, 'database.counts.localStorageBackupItems')
  requireFiniteNumber(response.database.counts.localStorageCopyRuns, 'database.counts.localStorageCopyRuns')
  requireFiniteNumber(response.database.counts.localStorageCopyItems, 'database.counts.localStorageCopyItems')
  requireFiniteNumber(response.database.counts.chatSessions, 'database.counts.chatSessions')
  requireFiniteNumber(response.database.counts.chatMessages, 'database.counts.chatMessages')
  requireFiniteNumber(response.database.counts.memories, 'database.counts.memories')
  requireFiniteNumber(response.database.counts.dailyMemoryEntries, 'database.counts.dailyMemoryEntries')
  requireFiniteNumber(response.database.counts.memorySources, 'database.counts.memorySources')
  requireFiniteNumber(response.database.counts.readThroughEnabledCopyRuns, 'database.counts.readThroughEnabledCopyRuns')
  requireFiniteNumber(response.database.counts.runtimeMigrationEnabledCopyRuns, 'database.counts.runtimeMigrationEnabledCopyRuns')

  requirePlainObject(response.migrationPlan, 'migrationPlan')
  requireBoolean(response.migrationPlan.runtimeMigrationEnabled, 'migrationPlan.runtimeMigrationEnabled')
  requireBoolean(response.migrationPlan.readThroughMigrationEnabled, 'migrationPlan.readThroughMigrationEnabled')
  requireBoolean(response.migrationPlan.sourceLocalStoragePreservationRequired, 'migrationPlan.sourceLocalStoragePreservationRequired')
  requireBoolean(response.migrationPlan.backupBeforeMutationRequired, 'migrationPlan.backupBeforeMutationRequired')
  requireBoolean(response.migrationPlan.rollbackToolRequired, 'migrationPlan.rollbackToolRequired')
  requireBoolean(response.migrationPlan.backupLedgerReady, 'migrationPlan.backupLedgerReady')
  requireBoolean(response.migrationPlan.rollbackLedgerReady, 'migrationPlan.rollbackLedgerReady')
  requireBoolean(response.migrationPlan.localStorageLedgerReady, 'migrationPlan.localStorageLedgerReady')
  requireBoolean(response.migrationPlan.localStorageSnapshotBackupReady, 'migrationPlan.localStorageSnapshotBackupReady')
  requireBoolean(response.migrationPlan.localStorageStructuredCopyReady, 'migrationPlan.localStorageStructuredCopyReady')
  requireStringArray(response.migrationPlan.crossPlatformCoverageRequired, 'migrationPlan.crossPlatformCoverageRequired')

  requirePlainObject(response.privacy, 'privacy')
  requireBoolean(response.privacy.userDataCopied, 'privacy.userDataCopied')
  requireBoolean(response.privacy.localStorageValuesRead, 'privacy.localStorageValuesRead')
  requireBoolean(response.privacy.absoluteDatabasePathExposed, 'privacy.absoluteDatabasePathExposed')
  requireStringArray(response.blockingIssueIds, 'blockingIssueIds')
  requireStringArray(response.nextActions, 'nextActions')

  if (response.schemaVersion > M4_SQLITE_SCHEMA_VERSION) {
    throw new Error('storage status response schemaVersion is newer than this runtime')
  }

  return response
}

function requireIsoString(value, label) {
  requireStringValue(value, label)
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`)
}

function requireOptionalIsoString(value, label) {
  requireString(value, label)
  if (value && !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`)
}

function requireSafeFileName(value, label) {
  requireStringValue(value, label)
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`${label} must not include path separators`)
  }
}

function requireSha256(value, label) {
  requireStringValue(value, label)
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a sha256 hex string`)
}

export function buildLocalStorageSnapshotBackupResponse(result, options = {}) {
  const keys = toStringArray(result?.keys)
  const domains = toStringArray(result?.domains)

  return validateLocalStorageSnapshotBackupResponse({
    gate: STORAGE_BACKUP_LOCAL_SNAPSHOT_GATE,
    ok: result?.ok === true,
    status: cleanString(result?.status) || 'unknown',
    backupId: cleanString(result?.backupId),
    createdAt: cleanString(result?.createdAt),
    reason: cleanString(result?.reason),
    entryCount: toFiniteNumber(result?.entryCount, 0),
    totalBytes: toFiniteNumber(result?.totalBytes, 0),
    keys,
    domains,
    backup: {
      pathKind: databasePathKind(result?.backupPath, options.appLike),
      fileName: databaseFileName(result?.backupPath || result?.backupFileName),
      sha256: cleanString(result?.sha256),
    },
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: false,
      sourceLocalStoragePreserved: result?.sourceLocalStoragePreserved === true,
      backupBeforeMutationCompleted: result?.ok === true,
      destructiveMigrationDetected: false,
    },
    privacy: {
      localStorageValuesReturned: false,
      absoluteBackupPathExposed: false,
      sourceLocalStorageMutated: false,
      valuesCopiedToResponse: result?.valuesCopiedToResponse === true,
    },
    nextActions: [
      'verify-snapshot-backup-before-read-through-migration',
      'implement-chat-memory-read-through-to-sqlite',
      'add-restore-and-downgrade-cli-fixtures',
    ],
  })
}

export function validateLocalStorageSnapshotBackupResponse(response) {
  requirePlainObject(response, 'local storage snapshot backup response')
  requireStringValue(response.gate, 'gate')
  if (response.gate !== STORAGE_BACKUP_LOCAL_SNAPSHOT_GATE) {
    throw new Error('local storage snapshot backup response gate mismatch')
  }
  requireBoolean(response.ok, 'ok')
  requireStringValue(response.status, 'status')
  requireStringValue(response.backupId, 'backupId')
  requireIsoString(response.createdAt, 'createdAt')
  requireStringValue(response.reason, 'reason')
  requireFiniteNumber(response.entryCount, 'entryCount')
  requireFiniteNumber(response.totalBytes, 'totalBytes')
  requireStringArray(response.keys, 'keys')
  requireStringArray(response.domains, 'domains')

  requirePlainObject(response.backup, 'backup')
  requireStringValue(response.backup.pathKind, 'backup.pathKind')
  if (!['userData', 'custom', 'unknown'].includes(response.backup.pathKind)) {
    throw new Error('backup.pathKind must be userData, custom, or unknown')
  }
  requireSafeFileName(response.backup.fileName, 'backup.fileName')
  requireSha256(response.backup.sha256, 'backup.sha256')

  requirePlainObject(response.migrationPlan, 'migrationPlan')
  requireBoolean(response.migrationPlan.runtimeMigrationEnabled, 'migrationPlan.runtimeMigrationEnabled')
  requireBoolean(response.migrationPlan.readThroughMigrationEnabled, 'migrationPlan.readThroughMigrationEnabled')
  requireBoolean(response.migrationPlan.sourceLocalStoragePreserved, 'migrationPlan.sourceLocalStoragePreserved')
  requireBoolean(response.migrationPlan.backupBeforeMutationCompleted, 'migrationPlan.backupBeforeMutationCompleted')
  requireBoolean(response.migrationPlan.destructiveMigrationDetected, 'migrationPlan.destructiveMigrationDetected')

  requirePlainObject(response.privacy, 'privacy')
  requireBoolean(response.privacy.localStorageValuesReturned, 'privacy.localStorageValuesReturned')
  requireBoolean(response.privacy.absoluteBackupPathExposed, 'privacy.absoluteBackupPathExposed')
  requireBoolean(response.privacy.sourceLocalStorageMutated, 'privacy.sourceLocalStorageMutated')
  requireBoolean(response.privacy.valuesCopiedToResponse, 'privacy.valuesCopiedToResponse')
  requireStringArray(response.nextActions, 'nextActions')

  if (response.privacy.localStorageValuesReturned) {
    throw new Error('local storage snapshot backup response must not return values')
  }
  if (response.privacy.absoluteBackupPathExposed) {
    throw new Error('local storage snapshot backup response must not expose absolute paths')
  }
  if (response.privacy.sourceLocalStorageMutated) {
    throw new Error('local storage snapshot backup response must preserve source localStorage')
  }
  if (response.privacy.valuesCopiedToResponse) {
    throw new Error('local storage snapshot backup response must not copy values to response')
  }

  return response
}

export function buildLocalStorageSnapshotCopyResponse(result) {
  return validateLocalStorageSnapshotCopyResponse({
    gate: STORAGE_COPY_LOCAL_SNAPSHOT_GATE,
    ok: result?.ok === true,
    status: cleanString(result?.status) || 'unknown',
    copyId: cleanString(result?.copyId),
    backupId: cleanString(result?.backupId),
    copiedAt: cleanString(result?.copiedAt),
    itemCount: toFiniteNumber(result?.itemCount, 0),
    copiedItemCount: toFiniteNumber(result?.copiedItemCount, 0),
    skippedItemCount: toFiniteNumber(result?.skippedItemCount, 0),
    failedItemCount: toFiniteNumber(result?.failedItemCount, 0),
    chatSessionCount: toFiniteNumber(result?.chatSessionCount, 0),
    chatMessageCount: toFiniteNumber(result?.chatMessageCount, 0),
    memoryCount: toFiniteNumber(result?.memoryCount, 0),
    dailyMemoryEntryCount: toFiniteNumber(result?.dailyMemoryEntryCount, 0),
    keys: toStringArray(result?.keys),
    copiedKeys: toStringArray(result?.copiedKeys),
    skippedKeys: toStringArray(result?.skippedKeys),
    failedKeys: toStringArray(result?.failedKeys),
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: false,
      sourceLocalStoragePreserved: result?.sourceLocalStoragePreserved === true,
      structuredSqliteCopyCompleted: result?.copiedItemCount > 0,
      destructiveMigrationDetected: false,
    },
    privacy: {
      localStorageValuesReturned: false,
      absolutePathExposed: false,
      sourceLocalStorageMutated: false,
      valuesCopiedToResponse: result?.valuesCopiedToResponse === true,
    },
    nextActions: [
      'verify-structured-copy-before-read-through-migration',
      'implement-chat-memory-read-through-to-sqlite',
      'add-restore-and-downgrade-cli-fixtures',
    ],
  })
}

export function validateLocalStorageSnapshotCopyResponse(response) {
  requirePlainObject(response, 'local storage snapshot copy response')
  requireStringValue(response.gate, 'gate')
  if (response.gate !== STORAGE_COPY_LOCAL_SNAPSHOT_GATE) {
    throw new Error('local storage snapshot copy response gate mismatch')
  }
  requireBoolean(response.ok, 'ok')
  requireStringValue(response.status, 'status')
  requireStringValue(response.copyId, 'copyId')
  requireStringValue(response.backupId, 'backupId')
  requireIsoString(response.copiedAt, 'copiedAt')
  requireFiniteNumber(response.itemCount, 'itemCount')
  requireFiniteNumber(response.copiedItemCount, 'copiedItemCount')
  requireFiniteNumber(response.skippedItemCount, 'skippedItemCount')
  requireFiniteNumber(response.failedItemCount, 'failedItemCount')
  requireFiniteNumber(response.chatSessionCount, 'chatSessionCount')
  requireFiniteNumber(response.chatMessageCount, 'chatMessageCount')
  requireFiniteNumber(response.memoryCount, 'memoryCount')
  requireFiniteNumber(response.dailyMemoryEntryCount, 'dailyMemoryEntryCount')
  requireStringArray(response.keys, 'keys')
  requireStringArray(response.copiedKeys, 'copiedKeys')
  requireStringArray(response.skippedKeys, 'skippedKeys')
  requireStringArray(response.failedKeys, 'failedKeys')

  requirePlainObject(response.migrationPlan, 'migrationPlan')
  requireBoolean(response.migrationPlan.runtimeMigrationEnabled, 'migrationPlan.runtimeMigrationEnabled')
  requireBoolean(response.migrationPlan.readThroughMigrationEnabled, 'migrationPlan.readThroughMigrationEnabled')
  requireBoolean(response.migrationPlan.sourceLocalStoragePreserved, 'migrationPlan.sourceLocalStoragePreserved')
  requireBoolean(response.migrationPlan.structuredSqliteCopyCompleted, 'migrationPlan.structuredSqliteCopyCompleted')
  requireBoolean(response.migrationPlan.destructiveMigrationDetected, 'migrationPlan.destructiveMigrationDetected')

  requirePlainObject(response.privacy, 'privacy')
  requireBoolean(response.privacy.localStorageValuesReturned, 'privacy.localStorageValuesReturned')
  requireBoolean(response.privacy.absolutePathExposed, 'privacy.absolutePathExposed')
  requireBoolean(response.privacy.sourceLocalStorageMutated, 'privacy.sourceLocalStorageMutated')
  requireBoolean(response.privacy.valuesCopiedToResponse, 'privacy.valuesCopiedToResponse')
  requireStringArray(response.nextActions, 'nextActions')

  if (response.privacy.localStorageValuesReturned) {
    throw new Error('local storage snapshot copy response must not return values')
  }
  if (response.privacy.absolutePathExposed) {
    throw new Error('local storage snapshot copy response must not expose absolute paths')
  }
  if (response.privacy.sourceLocalStorageMutated) {
    throw new Error('local storage snapshot copy response must preserve source localStorage')
  }
  if (response.privacy.valuesCopiedToResponse) {
    throw new Error('local storage snapshot copy response must not copy values to response')
  }

  return response
}

function toSafeCountMap(value) {
  if (!isObject(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .map(([key, count]) => [cleanString(key) || 'unknown', toFiniteNumber(count, 0)])
    .filter(([key]) => Boolean(key)))
}

function requireCountMap(value, label) {
  requirePlainObject(value, label)
  for (const [key, count] of Object.entries(value)) {
    requireStringValue(key, `${label} key`)
    requireFiniteNumber(count, `${label}.${key}`)
  }
}

function requireCopyItemSummary(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  for (const [index, item] of value.entries()) {
    requirePlainObject(item, `${label}[${index}]`)
    requireStringValue(item.storageKey, `${label}[${index}].storageKey`)
    requireStringValue(item.domain, `${label}[${index}].domain`)
    requireStringValue(item.status, `${label}[${index}].status`)
    requireFiniteNumber(item.insertedRows, `${label}[${index}].insertedRows`)
    requireFiniteNumber(item.skippedRows, `${label}[${index}].skippedRows`)
  }
}

function buildReadThroughChatSummary(chat) {
  return {
    selected: chat?.selected === true,
    hasReadableRows: chat?.hasReadableRows === true,
    sessionCount: toFiniteNumber(chat?.sessionCount, 0),
    messageCount: toFiniteNumber(chat?.messageCount, 0),
    sampledMessageCount: toFiniteNumber(chat?.sampledMessageCount, 0),
    latestMessageAtPresent: Boolean(cleanString(chat?.latestMessageAt)),
    roleCounts: toSafeCountMap(chat?.roleCounts),
  }
}

function buildReadThroughMemorySummary(memory) {
  return {
    selected: memory?.selected === true,
    hasReadableRows: memory?.hasReadableRows === true,
    memoryCount: toFiniteNumber(memory?.memoryCount, 0),
    dailyMemoryEntryCount: toFiniteNumber(memory?.dailyMemoryEntryCount, 0),
    sampledMemoryCount: toFiniteNumber(memory?.sampledMemoryCount, 0),
    sampledDailyMemoryEntryCount: toFiniteNumber(memory?.sampledDailyMemoryEntryCount, 0),
    latestMemoryCreatedAtPresent: Boolean(cleanString(memory?.latestMemoryCreatedAt)),
    latestDailyMemoryEntryAtPresent: Boolean(cleanString(memory?.latestDailyMemoryEntryAt)),
    categoryCounts: toSafeCountMap(memory?.categoryCounts),
    dailyRoleCounts: toSafeCountMap(memory?.dailyRoleCounts),
  }
}

function buildReadThroughSourceSummary(source) {
  const sourceStorageKeys = toStringArray(source?.sourceStorageKeys)
  const copyItems = Array.isArray(source?.copyItems)
    ? source.copyItems.map((item) => ({
        storageKey: cleanString(item?.storageKey),
        domain: cleanString(item?.domain),
        status: cleanString(item?.status),
        insertedRows: toFiniteNumber(item?.insertedRows, 0),
        skippedRows: toFiniteNumber(item?.skippedRows, 0),
      })).filter((item) => item.storageKey && item.domain && item.status)
    : []
  return {
    sourceStorageKeyCount: toFiniteNumber(source?.sourceStorageKeyCount, sourceStorageKeys.length),
    sourceStorageKeys,
    copyItemCount: toFiniteNumber(source?.copyItemCount, copyItems.length),
    copyItems,
  }
}

export function buildLocalStorageReadThroughPreviewResponse(result) {
  const chat = buildReadThroughChatSummary(result?.chat)
  const memory = buildReadThroughMemorySummary(result?.memory)
  const source = buildReadThroughSourceSummary(result?.source)
  const readableRowCount = toFiniteNumber(
    result?.totals?.readableRowCount,
    chat.sessionCount + chat.messageCount + memory.memoryCount + memory.dailyMemoryEntryCount,
  )

  return validateLocalStorageReadThroughPreviewResponse({
    gate: STORAGE_READ_THROUGH_PREVIEW_GATE,
    ok: result?.ok === true,
    status: cleanString(result?.status) || 'unknown',
    generatedAt: cleanString(result?.generatedAt),
    backupId: cleanString(result?.backupId || result?.requestedBackupId),
    copyId: cleanString(result?.copyId || result?.requestedCopyId),
    copiedAt: cleanString(result?.copiedAt),
    copyStatus: cleanString(result?.copyStatus),
    domains: toStringArray(result?.domains),
    limit: toFiniteNumber(result?.limit, 0),
    chat,
    memory,
    source,
    totals: {
      readableRowCount,
      sourceStorageKeyCount: toFiniteNumber(result?.totals?.sourceStorageKeyCount, source.sourceStorageKeyCount),
      copyItemCount: toFiniteNumber(result?.totals?.copyItemCount, source.copyItemCount),
    },
    migrationPlan: {
      previewQueryEnabled: result?.previewQueryEnabled === true,
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: false,
      sourceLocalStoragePreserved: result?.sourceLocalStoragePreserved === true,
      destructiveMigrationDetected: false,
    },
    privacy: {
      localStorageValuesReturned: false,
      absolutePathExposed: false,
      sourceLocalStorageMutated: false,
      valuesCopiedToResponse: result?.valuesCopiedToResponse === true,
    },
    nextActions: [
      'wire-runtime-read-through-behind-user-confirmed-feature-flag',
      'add-schema-downgrade-cli-fixtures',
    ],
  })
}

export function validateLocalStorageReadThroughPreviewResponse(response) {
  requirePlainObject(response, 'local storage read-through preview response')
  requireStringValue(response.gate, 'gate')
  if (response.gate !== STORAGE_READ_THROUGH_PREVIEW_GATE) {
    throw new Error('local storage read-through preview response gate mismatch')
  }
  requireBoolean(response.ok, 'ok')
  requireStringValue(response.status, 'status')
  requireIsoString(response.generatedAt, 'generatedAt')
  requireString(response.backupId, 'backupId')
  requireString(response.copyId, 'copyId')
  requireOptionalIsoString(response.copiedAt, 'copiedAt')
  requireString(response.copyStatus, 'copyStatus')
  requireStringArray(response.domains, 'domains')
  requireFiniteNumber(response.limit, 'limit')

  requirePlainObject(response.chat, 'chat')
  requireBoolean(response.chat.selected, 'chat.selected')
  requireBoolean(response.chat.hasReadableRows, 'chat.hasReadableRows')
  requireFiniteNumber(response.chat.sessionCount, 'chat.sessionCount')
  requireFiniteNumber(response.chat.messageCount, 'chat.messageCount')
  requireFiniteNumber(response.chat.sampledMessageCount, 'chat.sampledMessageCount')
  requireBoolean(response.chat.latestMessageAtPresent, 'chat.latestMessageAtPresent')
  requireCountMap(response.chat.roleCounts, 'chat.roleCounts')

  requirePlainObject(response.memory, 'memory')
  requireBoolean(response.memory.selected, 'memory.selected')
  requireBoolean(response.memory.hasReadableRows, 'memory.hasReadableRows')
  requireFiniteNumber(response.memory.memoryCount, 'memory.memoryCount')
  requireFiniteNumber(response.memory.dailyMemoryEntryCount, 'memory.dailyMemoryEntryCount')
  requireFiniteNumber(response.memory.sampledMemoryCount, 'memory.sampledMemoryCount')
  requireFiniteNumber(response.memory.sampledDailyMemoryEntryCount, 'memory.sampledDailyMemoryEntryCount')
  requireBoolean(response.memory.latestMemoryCreatedAtPresent, 'memory.latestMemoryCreatedAtPresent')
  requireBoolean(response.memory.latestDailyMemoryEntryAtPresent, 'memory.latestDailyMemoryEntryAtPresent')
  requireCountMap(response.memory.categoryCounts, 'memory.categoryCounts')
  requireCountMap(response.memory.dailyRoleCounts, 'memory.dailyRoleCounts')

  requirePlainObject(response.source, 'source')
  requireFiniteNumber(response.source.sourceStorageKeyCount, 'source.sourceStorageKeyCount')
  requireStringArray(response.source.sourceStorageKeys, 'source.sourceStorageKeys')
  requireFiniteNumber(response.source.copyItemCount, 'source.copyItemCount')
  requireCopyItemSummary(response.source.copyItems, 'source.copyItems')

  requirePlainObject(response.totals, 'totals')
  requireFiniteNumber(response.totals.readableRowCount, 'totals.readableRowCount')
  requireFiniteNumber(response.totals.sourceStorageKeyCount, 'totals.sourceStorageKeyCount')
  requireFiniteNumber(response.totals.copyItemCount, 'totals.copyItemCount')

  requirePlainObject(response.migrationPlan, 'migrationPlan')
  requireBoolean(response.migrationPlan.previewQueryEnabled, 'migrationPlan.previewQueryEnabled')
  requireBoolean(response.migrationPlan.runtimeMigrationEnabled, 'migrationPlan.runtimeMigrationEnabled')
  requireBoolean(response.migrationPlan.readThroughMigrationEnabled, 'migrationPlan.readThroughMigrationEnabled')
  requireBoolean(response.migrationPlan.sourceLocalStoragePreserved, 'migrationPlan.sourceLocalStoragePreserved')
  requireBoolean(response.migrationPlan.destructiveMigrationDetected, 'migrationPlan.destructiveMigrationDetected')

  requirePlainObject(response.privacy, 'privacy')
  requireBoolean(response.privacy.localStorageValuesReturned, 'privacy.localStorageValuesReturned')
  requireBoolean(response.privacy.absolutePathExposed, 'privacy.absolutePathExposed')
  requireBoolean(response.privacy.sourceLocalStorageMutated, 'privacy.sourceLocalStorageMutated')
  requireBoolean(response.privacy.valuesCopiedToResponse, 'privacy.valuesCopiedToResponse')
  requireStringArray(response.nextActions, 'nextActions')

  if (response.migrationPlan.runtimeMigrationEnabled) {
    throw new Error('local storage read-through preview response must keep runtime migration disabled')
  }
  if (response.migrationPlan.readThroughMigrationEnabled) {
    throw new Error('local storage read-through preview response must keep read-through migration disabled')
  }
  if (response.migrationPlan.destructiveMigrationDetected) {
    throw new Error('local storage read-through preview response must not include destructive migration')
  }
  if (response.privacy.localStorageValuesReturned) {
    throw new Error('local storage read-through preview response must not return values')
  }
  if (response.privacy.absolutePathExposed) {
    throw new Error('local storage read-through preview response must not expose absolute paths')
  }
  if (response.privacy.sourceLocalStorageMutated) {
    throw new Error('local storage read-through preview response must preserve source localStorage')
  }
  if (response.privacy.valuesCopiedToResponse) {
    throw new Error('local storage read-through preview response must not copy values to response')
  }

  return response
}

export function buildLocalStorageReadThroughModeResponse(result) {
  const enabled = result?.enabled === true
  const requestedEnabled = result?.requestedEnabled === true
  return validateLocalStorageReadThroughModeResponse({
    gate: STORAGE_READ_THROUGH_MODE_GATE,
    ok: result?.ok === true,
    status: cleanString(result?.status) || 'unknown',
    generatedAt: cleanString(result?.generatedAt),
    requestedEnabled,
    enabled,
    backupId: cleanString(result?.backupId),
    copyId: cleanString(result?.copyId),
    domains: toStringArray(result?.domains),
    reason: cleanString(result?.reason),
    userConfirmed: result?.userConfirmed === true,
    readiness: {
      chatReadable: result?.chatReadable === true,
      memoryReadable: result?.memoryReadable === true,
      readableRowCount: toFiniteNumber(result?.readableRowCount, 0),
      sourceStorageKeyCount: toFiniteNumber(result?.sourceStorageKeyCount, 0),
      copyItemCount: toFiniteNumber(result?.copyItemCount, 0),
    },
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: enabled,
      sourceLocalStoragePreserved: result?.sourceLocalStoragePreserved === true,
      userConfirmedFeatureFlag: result?.userConfirmed === true,
      destructiveMigrationDetected: false,
      rollbackByDisablingReadThrough: true,
    },
    privacy: {
      localStorageValuesReturned: false,
      absolutePathExposed: false,
      sourceLocalStorageMutated: result?.sourceLocalStorageMutated === true,
      valuesCopiedToResponse: result?.valuesCopiedToResponse === true,
    },
    nextActions: enabled
      ? ['wire-renderer-chat-memory-reads-to-main-process-with-localstorage-fallback']
      : ['keep-localstorage-fallback-until-read-through-enabled'],
  })
}

export function validateLocalStorageReadThroughModeResponse(response) {
  requirePlainObject(response, 'local storage read-through mode response')
  requireStringValue(response.gate, 'gate')
  if (response.gate !== STORAGE_READ_THROUGH_MODE_GATE) {
    throw new Error('local storage read-through mode response gate mismatch')
  }
  requireBoolean(response.ok, 'ok')
  requireStringValue(response.status, 'status')
  requireIsoString(response.generatedAt, 'generatedAt')
  requireBoolean(response.requestedEnabled, 'requestedEnabled')
  requireBoolean(response.enabled, 'enabled')
  requireString(response.backupId, 'backupId')
  requireString(response.copyId, 'copyId')
  requireStringArray(response.domains, 'domains')
  requireStringValue(response.reason, 'reason')
  requireBoolean(response.userConfirmed, 'userConfirmed')

  requirePlainObject(response.readiness, 'readiness')
  requireBoolean(response.readiness.chatReadable, 'readiness.chatReadable')
  requireBoolean(response.readiness.memoryReadable, 'readiness.memoryReadable')
  requireFiniteNumber(response.readiness.readableRowCount, 'readiness.readableRowCount')
  requireFiniteNumber(response.readiness.sourceStorageKeyCount, 'readiness.sourceStorageKeyCount')
  requireFiniteNumber(response.readiness.copyItemCount, 'readiness.copyItemCount')

  requirePlainObject(response.migrationPlan, 'migrationPlan')
  requireBoolean(response.migrationPlan.runtimeMigrationEnabled, 'migrationPlan.runtimeMigrationEnabled')
  requireBoolean(response.migrationPlan.readThroughMigrationEnabled, 'migrationPlan.readThroughMigrationEnabled')
  requireBoolean(response.migrationPlan.sourceLocalStoragePreserved, 'migrationPlan.sourceLocalStoragePreserved')
  requireBoolean(response.migrationPlan.userConfirmedFeatureFlag, 'migrationPlan.userConfirmedFeatureFlag')
  requireBoolean(response.migrationPlan.destructiveMigrationDetected, 'migrationPlan.destructiveMigrationDetected')
  requireBoolean(response.migrationPlan.rollbackByDisablingReadThrough, 'migrationPlan.rollbackByDisablingReadThrough')

  requirePlainObject(response.privacy, 'privacy')
  requireBoolean(response.privacy.localStorageValuesReturned, 'privacy.localStorageValuesReturned')
  requireBoolean(response.privacy.absolutePathExposed, 'privacy.absolutePathExposed')
  requireBoolean(response.privacy.sourceLocalStorageMutated, 'privacy.sourceLocalStorageMutated')
  requireBoolean(response.privacy.valuesCopiedToResponse, 'privacy.valuesCopiedToResponse')
  requireStringArray(response.nextActions, 'nextActions')

  if (response.migrationPlan.runtimeMigrationEnabled) {
    throw new Error('local storage read-through mode response must keep destructive runtime migration disabled')
  }
  if (response.migrationPlan.readThroughMigrationEnabled !== response.enabled) {
    throw new Error('local storage read-through mode response flag mismatch')
  }
  if (response.enabled && !response.userConfirmed) {
    throw new Error('local storage read-through mode response must be user confirmed before enabling')
  }
  if (response.migrationPlan.destructiveMigrationDetected) {
    throw new Error('local storage read-through mode response must not include destructive migration')
  }
  if (!response.migrationPlan.rollbackByDisablingReadThrough) {
    throw new Error('local storage read-through mode response must be reversible by disabling read-through')
  }
  if (response.privacy.localStorageValuesReturned) {
    throw new Error('local storage read-through mode response must not return values')
  }
  if (response.privacy.absolutePathExposed) {
    throw new Error('local storage read-through mode response must not expose absolute paths')
  }
  if (response.privacy.sourceLocalStorageMutated) {
    throw new Error('local storage read-through mode response must preserve source localStorage')
  }
  if (response.privacy.valuesCopiedToResponse) {
    throw new Error('local storage read-through mode response must not copy values to response')
  }

  return response
}

function toContentString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toOptionalPlainObject(value) {
  return isObject(value) ? value : undefined
}

function toReadThroughChatMessages(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((message) => {
      if (!isObject(message)) return null
      const id = cleanString(message.id)
      const role = cleanString(message.role)
      const content = toContentString(message.content)
      const createdAt = cleanString(message.createdAt)
      if (!id || !['user', 'assistant', 'system'].includes(role) || !content || !createdAt) return null
      const tone = cleanString(message.tone)
      const toolResult = toOptionalPlainObject(message.toolResult)
      const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : ''
      return {
        id,
        role,
        content,
        createdAt,
        ...(tone ? { tone } : {}),
        ...(toolResult ? { toolResult } : {}),
        ...(reasoning ? { reasoning_content: reasoning } : {}),
      }
    })
    .filter(Boolean)
}

function toReadThroughChatSessions(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((session) => {
      if (!isObject(session)) return null
      const id = cleanString(session.id)
      const startedAt = toFiniteNumber(session.startedAt, 0)
      const lastActiveAt = toFiniteNumber(session.lastActiveAt, 0)
      const title = cleanString(session.title)
      if (!id) return null
      return {
        id,
        startedAt,
        lastActiveAt,
        ...(title ? { title } : {}),
        messages: toReadThroughChatMessages(session.messages),
      }
    })
    .filter(Boolean)
}

function toReadThroughMemoryItems(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((memory) => {
      if (!isObject(memory)) return null
      const id = cleanString(memory.id)
      const content = toContentString(memory.content)
      const category = cleanString(memory.category) || 'manual'
      const source = cleanString(memory.source) || 'storage'
      const kind = cleanString(memory.kind)
      const sourceRef = cleanString(memory.sourceRef)
      const createdAt = cleanString(memory.createdAt)
      const lastUsedAt = cleanString(memory.lastUsedAt)
      const importance = cleanString(memory.importance)
      const importanceScore = Number(memory.importanceScore)
      const recallCount = Number(memory.recallCount)
      const lastRecalledAt = cleanString(memory.lastRecalledAt)
      const emotionalValence = cleanString(memory.emotionalValence)
      const significance = Number(memory.significance)
      const reflectionTopic = cleanString(memory.reflectionTopic)
      const reflectionConfidence = Number(memory.reflectionConfidence)
      if (!id || !content || !createdAt) return null
      return {
        id,
        content,
        category,
        source,
        ...(kind ? { kind } : {}),
        enabled: memory.enabled !== false,
        ...(sourceRef ? { sourceRef } : {}),
        createdAt,
        ...(lastUsedAt ? { lastUsedAt } : {}),
        ...(importance ? { importance } : {}),
        ...(Number.isFinite(importanceScore) ? { importanceScore } : {}),
        ...(Number.isFinite(recallCount) ? { recallCount: Math.max(0, Math.round(recallCount)) } : {}),
        ...(lastRecalledAt ? { lastRecalledAt } : {}),
        ...(emotionalValence ? { emotionalValence } : {}),
        ...(Number.isFinite(significance) ? { significance } : {}),
        ...(reflectionTopic ? { reflectionTopic } : {}),
        ...(Number.isFinite(reflectionConfidence) ? { reflectionConfidence } : {}),
      }
    })
    .filter(Boolean)
}

function toReadThroughDailyMemoryStore(value) {
  if (!isObject(value)) return {}
  const result = {}
  for (const [day, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue
    const normalizedEntries = entries
      .map((entry) => {
        if (!isObject(entry)) return null
        const id = cleanString(entry.id)
        const role = cleanString(entry.role)
        const content = toContentString(entry.content)
        const source = cleanString(entry.source) === 'voice' ? 'voice' : 'chat'
        const sourceRef = cleanString(entry.sourceRef)
        const createdAt = cleanString(entry.createdAt)
        if (!id || !['user', 'assistant'].includes(role) || !content || !createdAt) return null
        return {
          id,
          day: cleanString(entry.day) || day,
          role,
          content,
          source,
          ...(sourceRef ? { sourceRef } : {}),
          createdAt,
        }
      })
      .filter(Boolean)
    if (normalizedEntries.length) result[day] = normalizedEntries
  }
  return result
}

function buildReadThroughChatData(chat) {
  const messages = toReadThroughChatMessages(chat?.messages)
  const sessions = toReadThroughChatSessions(chat?.sessions)
  return {
    selected: chat?.selected === true,
    messages,
    sessions,
    sessionCount: toFiniteNumber(chat?.sessionCount, sessions.length),
    messageCount: toFiniteNumber(chat?.messageCount, messages.length),
    returnedMessageCount: toFiniteNumber(chat?.returnedMessageCount, messages.length),
    returnedSessionCount: toFiniteNumber(chat?.returnedSessionCount, sessions.length),
  }
}

function buildReadThroughMemoryData(memory) {
  const memories = toReadThroughMemoryItems(memory?.memories)
  const dailyMemories = toReadThroughDailyMemoryStore(memory?.dailyMemories)
  const returnedDailyMemoryEntryCount = Object.values(dailyMemories)
    .reduce((total, entries) => total + entries.length, 0)
  return {
    selected: memory?.selected === true,
    memories,
    dailyMemories,
    memoryCount: toFiniteNumber(memory?.memoryCount, memories.length),
    dailyMemoryEntryCount: toFiniteNumber(memory?.dailyMemoryEntryCount, returnedDailyMemoryEntryCount),
    returnedMemoryCount: toFiniteNumber(memory?.returnedMemoryCount, memories.length),
    returnedDailyMemoryEntryCount: toFiniteNumber(memory?.returnedDailyMemoryEntryCount, returnedDailyMemoryEntryCount),
    dayCount: toFiniteNumber(memory?.dayCount, Object.keys(dailyMemories).length),
  }
}

function requireReadThroughChatData(value, label) {
  requirePlainObject(value, label)
  requireBoolean(value.selected, `${label}.selected`)
  requireFiniteNumber(value.sessionCount, `${label}.sessionCount`)
  requireFiniteNumber(value.messageCount, `${label}.messageCount`)
  requireFiniteNumber(value.returnedMessageCount, `${label}.returnedMessageCount`)
  requireFiniteNumber(value.returnedSessionCount, `${label}.returnedSessionCount`)
  if (!Array.isArray(value.messages)) throw new Error(`${label}.messages must be an array`)
  for (const [index, message] of value.messages.entries()) {
    requirePlainObject(message, `${label}.messages[${index}]`)
    requireStringValue(message.id, `${label}.messages[${index}].id`)
    requireStringValue(message.role, `${label}.messages[${index}].role`)
    if (!['user', 'assistant', 'system'].includes(message.role)) {
      throw new Error(`${label}.messages[${index}].role must be a chat role`)
    }
    requireStringValue(message.content, `${label}.messages[${index}].content`)
    requireIsoString(message.createdAt, `${label}.messages[${index}].createdAt`)
  }
  if (!Array.isArray(value.sessions)) throw new Error(`${label}.sessions must be an array`)
  for (const [index, session] of value.sessions.entries()) {
    requirePlainObject(session, `${label}.sessions[${index}]`)
    requireStringValue(session.id, `${label}.sessions[${index}].id`)
    requireFiniteNumber(session.startedAt, `${label}.sessions[${index}].startedAt`)
    requireFiniteNumber(session.lastActiveAt, `${label}.sessions[${index}].lastActiveAt`)
    requireReadThroughChatData({
      selected: true,
      messages: session.messages,
      sessions: [],
      sessionCount: 0,
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      returnedMessageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      returnedSessionCount: 0,
    }, `${label}.sessions[${index}]`)
  }
}

function requireReadThroughMemoryData(value, label) {
  requirePlainObject(value, label)
  requireBoolean(value.selected, `${label}.selected`)
  requireFiniteNumber(value.memoryCount, `${label}.memoryCount`)
  requireFiniteNumber(value.dailyMemoryEntryCount, `${label}.dailyMemoryEntryCount`)
  requireFiniteNumber(value.returnedMemoryCount, `${label}.returnedMemoryCount`)
  requireFiniteNumber(value.returnedDailyMemoryEntryCount, `${label}.returnedDailyMemoryEntryCount`)
  requireFiniteNumber(value.dayCount, `${label}.dayCount`)
  if (!Array.isArray(value.memories)) throw new Error(`${label}.memories must be an array`)
  for (const [index, memory] of value.memories.entries()) {
    requirePlainObject(memory, `${label}.memories[${index}]`)
    requireStringValue(memory.id, `${label}.memories[${index}].id`)
    requireStringValue(memory.content, `${label}.memories[${index}].content`)
    requireStringValue(memory.category, `${label}.memories[${index}].category`)
    requireStringValue(memory.source, `${label}.memories[${index}].source`)
    requireIsoString(memory.createdAt, `${label}.memories[${index}].createdAt`)
    requireBoolean(memory.enabled, `${label}.memories[${index}].enabled`)
  }
  requirePlainObject(value.dailyMemories, `${label}.dailyMemories`)
  for (const [day, entries] of Object.entries(value.dailyMemories)) {
    if (!Array.isArray(entries)) throw new Error(`${label}.dailyMemories.${day} must be an array`)
    for (const [index, entry] of entries.entries()) {
      requirePlainObject(entry, `${label}.dailyMemories.${day}[${index}]`)
      requireStringValue(entry.id, `${label}.dailyMemories.${day}[${index}].id`)
      requireStringValue(entry.day, `${label}.dailyMemories.${day}[${index}].day`)
      requireStringValue(entry.role, `${label}.dailyMemories.${day}[${index}].role`)
      if (!['user', 'assistant'].includes(entry.role)) {
        throw new Error(`${label}.dailyMemories.${day}[${index}].role must be user or assistant`)
      }
      requireStringValue(entry.content, `${label}.dailyMemories.${day}[${index}].content`)
      requireStringValue(entry.source, `${label}.dailyMemories.${day}[${index}].source`)
      requireIsoString(entry.createdAt, `${label}.dailyMemories.${day}[${index}].createdAt`)
    }
  }
}

export function buildLocalStorageReadThroughDataResponse(result) {
  const ok = result?.ok === true
  const chat = buildReadThroughChatData(result?.chat)
  const memory = buildReadThroughMemoryData(result?.memory)
  const returnedRowCount = toFiniteNumber(
    result?.totals?.returnedRowCount,
    chat.returnedMessageCount + chat.returnedSessionCount + memory.returnedMemoryCount + memory.returnedDailyMemoryEntryCount,
  )
  const readableRowCount = toFiniteNumber(
    result?.totals?.readableRowCount,
    chat.sessionCount + chat.messageCount + memory.memoryCount + memory.dailyMemoryEntryCount,
  )

  return validateLocalStorageReadThroughDataResponse({
    gate: STORAGE_READ_THROUGH_DATA_GATE,
    ok,
    status: cleanString(result?.status) || 'unknown',
    generatedAt: cleanString(result?.generatedAt),
    backupId: cleanString(result?.backupId || result?.requestedBackupId),
    copyId: cleanString(result?.copyId || result?.requestedCopyId),
    copiedAt: cleanString(result?.copiedAt),
    copyStatus: cleanString(result?.copyStatus),
    domains: toStringArray(result?.domains),
    limit: toFiniteNumber(result?.limit, 0),
    chat: ok ? chat : buildReadThroughChatData(null),
    memory: ok ? memory : buildReadThroughMemoryData(null),
    totals: {
      readableRowCount: ok ? readableRowCount : 0,
      returnedRowCount: ok ? returnedRowCount : 0,
    },
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: result?.readThroughMigrationEnabled === true,
      userConfirmedReadThroughMode: result?.userConfirmedReadThroughMode === true,
      sourceLocalStoragePreserved: result?.sourceLocalStoragePreserved === true,
      destructiveMigrationDetected: false,
      fallbackLocalStorageSupported: true,
    },
    privacy: {
      containsUserData: ok && result?.containsUserData === true,
      sqliteValuesReturned: ok && result?.valuesReturned === true,
      localStorageRawValuesReturned: false,
      absolutePathExposed: false,
      sourceLocalStorageMutated: result?.sourceLocalStorageMutated === true,
      valuesCopiedToAuditLog: false,
    },
    nextActions: ok
      ? ['hydrate-renderer-chat-memory-state-without-localstorage-writeback']
      : ['keep-localstorage-fallback-until-read-through-enabled'],
  })
}

export function validateLocalStorageReadThroughDataResponse(response) {
  requirePlainObject(response, 'local storage read-through data response')
  requireStringValue(response.gate, 'gate')
  if (response.gate !== STORAGE_READ_THROUGH_DATA_GATE) {
    throw new Error('local storage read-through data response gate mismatch')
  }
  requireBoolean(response.ok, 'ok')
  requireStringValue(response.status, 'status')
  requireIsoString(response.generatedAt, 'generatedAt')
  requireString(response.backupId, 'backupId')
  requireString(response.copyId, 'copyId')
  requireOptionalIsoString(response.copiedAt, 'copiedAt')
  requireString(response.copyStatus, 'copyStatus')
  requireStringArray(response.domains, 'domains')
  requireFiniteNumber(response.limit, 'limit')
  requireReadThroughChatData(response.chat, 'chat')
  requireReadThroughMemoryData(response.memory, 'memory')

  requirePlainObject(response.totals, 'totals')
  requireFiniteNumber(response.totals.readableRowCount, 'totals.readableRowCount')
  requireFiniteNumber(response.totals.returnedRowCount, 'totals.returnedRowCount')

  requirePlainObject(response.migrationPlan, 'migrationPlan')
  requireBoolean(response.migrationPlan.runtimeMigrationEnabled, 'migrationPlan.runtimeMigrationEnabled')
  requireBoolean(response.migrationPlan.readThroughMigrationEnabled, 'migrationPlan.readThroughMigrationEnabled')
  requireBoolean(response.migrationPlan.userConfirmedReadThroughMode, 'migrationPlan.userConfirmedReadThroughMode')
  requireBoolean(response.migrationPlan.sourceLocalStoragePreserved, 'migrationPlan.sourceLocalStoragePreserved')
  requireBoolean(response.migrationPlan.destructiveMigrationDetected, 'migrationPlan.destructiveMigrationDetected')
  requireBoolean(response.migrationPlan.fallbackLocalStorageSupported, 'migrationPlan.fallbackLocalStorageSupported')

  requirePlainObject(response.privacy, 'privacy')
  requireBoolean(response.privacy.containsUserData, 'privacy.containsUserData')
  requireBoolean(response.privacy.sqliteValuesReturned, 'privacy.sqliteValuesReturned')
  requireBoolean(response.privacy.localStorageRawValuesReturned, 'privacy.localStorageRawValuesReturned')
  requireBoolean(response.privacy.absolutePathExposed, 'privacy.absolutePathExposed')
  requireBoolean(response.privacy.sourceLocalStorageMutated, 'privacy.sourceLocalStorageMutated')
  requireBoolean(response.privacy.valuesCopiedToAuditLog, 'privacy.valuesCopiedToAuditLog')
  requireStringArray(response.nextActions, 'nextActions')

  if (response.migrationPlan.runtimeMigrationEnabled) {
    throw new Error('local storage read-through data response must keep destructive runtime migration disabled')
  }
  if (response.migrationPlan.destructiveMigrationDetected) {
    throw new Error('local storage read-through data response must not include destructive migration')
  }
  if (!response.migrationPlan.fallbackLocalStorageSupported) {
    throw new Error('local storage read-through data response must keep localStorage fallback available')
  }
  if (response.privacy.localStorageRawValuesReturned) {
    throw new Error('local storage read-through data response must not return raw localStorage values')
  }
  if (response.privacy.absolutePathExposed) {
    throw new Error('local storage read-through data response must not expose absolute paths')
  }
  if (response.privacy.sourceLocalStorageMutated) {
    throw new Error('local storage read-through data response must preserve source localStorage')
  }
  if (response.privacy.valuesCopiedToAuditLog) {
    throw new Error('local storage read-through data response must not copy values to audit log')
  }
  if (response.ok) {
    if (!response.migrationPlan.readThroughMigrationEnabled) {
      throw new Error('local storage read-through data response requires read-through mode')
    }
    if (!response.migrationPlan.userConfirmedReadThroughMode) {
      throw new Error('local storage read-through data response requires confirmed read-through mode')
    }
    if (!response.migrationPlan.sourceLocalStoragePreserved) {
      throw new Error('local storage read-through data response requires preserved source localStorage')
    }
    if (!response.privacy.containsUserData || !response.privacy.sqliteValuesReturned) {
      throw new Error('local storage read-through data response must disclose returned user data')
    }
  } else if (response.privacy.containsUserData || response.privacy.sqliteValuesReturned) {
    throw new Error('local storage read-through data response must not return user data when disabled')
  }

  return response
}

export async function getStorageStatus(options = {}) {
  const initializeFn = options.initializeStorageDatabase || initializeNexusStorageDatabase
  const appLike = options.appLike || app
  const status = await initializeFn({
    ...options,
    appLike,
  })
  try {
    return buildStorageStatusResponse(status, { appLike })
  } finally {
    status?.close?.()
  }
}

export async function backupRendererLocalStorageSnapshot(payload, options = {}) {
  const appLike = options.appLike || app
  const result = await backupLocalStorageSnapshot(payload, {
    ...options,
    appLike,
  })
  return buildLocalStorageSnapshotBackupResponse(result, { appLike })
}

export async function copyRendererLocalStorageSnapshot(payload, options = {}) {
  const appLike = options.appLike || app
  const result = await copyLocalStorageSnapshotToStructuredSqlite(payload, {
    ...options,
    appLike,
  })
  return buildLocalStorageSnapshotCopyResponse(result)
}

export async function queryRendererLocalStorageReadThroughPreview(payload, options = {}) {
  const queryFn = options.queryLocalStorageReadThroughPreview || queryLocalStorageReadThroughPreview
  const appLike = options.appLike || app
  const result = await queryFn(payload, {
    ...options,
    appLike,
  })
  return buildLocalStorageReadThroughPreviewResponse(result)
}

export async function setRendererLocalStorageReadThroughMode(payload, options = {}) {
  const setModeFn = options.setLocalStorageReadThroughMode || setLocalStorageReadThroughMode
  const appLike = options.appLike || app
  const result = await setModeFn(payload, {
    ...options,
    appLike,
  })
  return buildLocalStorageReadThroughModeResponse(result)
}

export async function queryRendererLocalStorageReadThroughData(payload, options = {}) {
  const queryFn = options.queryLocalStorageReadThroughData || queryLocalStorageReadThroughData
  const appLike = options.appLike || app
  const result = await queryFn(payload, {
    ...options,
    appLike,
  })
  return buildLocalStorageReadThroughDataResponse(result)
}

export function register(options = {}) {
  const ipcMainLike = options.ipcMainLike || ipcMain
  if (!ipcMainLike || typeof ipcMainLike.handle !== 'function') {
    throw new Error('storageIpc.register requires an ipcMain-like object with handle(channel, listener).')
  }

  const trustedSenderCheck = options.trustedSenderCheck || requireTrustedSender
  ipcMainLike.handle('storage:status', async (event) => {
    trustedSenderCheck(event)
    return getStorageStatus(options)
  })
  ipcMainLike.handle('storage:backup-local-snapshot', async (event, payload) => {
    trustedSenderCheck(event)
    validateLocalStorageSnapshotRequest(payload)
    return backupRendererLocalStorageSnapshot(payload, options)
  })
  ipcMainLike.handle('storage:copy-local-snapshot', async (event, payload) => {
    trustedSenderCheck(event)
    validateLocalStorageSnapshotCopyRequest(payload)
    return copyRendererLocalStorageSnapshot(payload, options)
  })
  ipcMainLike.handle('storage:read-through-preview', async (event, payload) => {
    trustedSenderCheck(event)
    validateLocalStorageReadThroughQueryRequest(payload)
    return queryRendererLocalStorageReadThroughPreview(payload, options)
  })
  ipcMainLike.handle('storage:set-read-through-mode', async (event, payload) => {
    trustedSenderCheck(event)
    validateLocalStorageReadThroughModeRequest(payload)
    return setRendererLocalStorageReadThroughMode(payload, options)
  })
  ipcMainLike.handle('storage:read-through-data', async (event, payload) => {
    trustedSenderCheck(event)
    validateLocalStorageReadThroughDataRequest(payload)
    return queryRendererLocalStorageReadThroughData(payload, options)
  })
}
