import electron from 'electron'

import { requireTrustedSender } from './validate.js'
import {
  initializeNexusStorageDatabase,
  M4_SQLITE_FOUNDATION_GATE,
  M4_SQLITE_FOUNDATION_TABLES,
  M4_SQLITE_SCHEMA_VERSION,
} from '../services/sqliteStorage.js'

export const STORAGE_STATUS_CHANNEL = 'storage:status'

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
      },
    },
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: false,
      sourceLocalStoragePreservationRequired: true,
      backupBeforeMutationRequired: true,
      rollbackToolRequired: true,
      backupLedgerReady: tables.includes('storage_backups'),
      rollbackLedgerReady: tables.includes('storage_schema_migrations'),
      localStorageLedgerReady: tables.includes('local_storage_migration_ledger'),
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

  requirePlainObject(response.migrationPlan, 'migrationPlan')
  requireBoolean(response.migrationPlan.runtimeMigrationEnabled, 'migrationPlan.runtimeMigrationEnabled')
  requireBoolean(response.migrationPlan.readThroughMigrationEnabled, 'migrationPlan.readThroughMigrationEnabled')
  requireBoolean(response.migrationPlan.sourceLocalStoragePreservationRequired, 'migrationPlan.sourceLocalStoragePreservationRequired')
  requireBoolean(response.migrationPlan.backupBeforeMutationRequired, 'migrationPlan.backupBeforeMutationRequired')
  requireBoolean(response.migrationPlan.rollbackToolRequired, 'migrationPlan.rollbackToolRequired')
  requireBoolean(response.migrationPlan.backupLedgerReady, 'migrationPlan.backupLedgerReady')
  requireBoolean(response.migrationPlan.rollbackLedgerReady, 'migrationPlan.rollbackLedgerReady')
  requireBoolean(response.migrationPlan.localStorageLedgerReady, 'migrationPlan.localStorageLedgerReady')
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
}
