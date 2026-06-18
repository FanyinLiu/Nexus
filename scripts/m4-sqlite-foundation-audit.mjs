#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  initializeNexusStorageDatabase,
  M4_SQLITE_FOUNDATION_GATE,
  M4_SQLITE_FOUNDATION_TABLES,
  M4_SQLITE_SCHEMA_VERSION,
  probeNexusSqliteRuntime,
} from '../electron/services/sqliteStorage.js'

export const DEFAULT_M4_SQLITE_FOUNDATION_FILE = 'artifacts/v1/m4-sqlite-foundation.json'
export const DEFAULT_M4_SQLITE_FOUNDATION_DATABASE = 'artifacts/v1/m4-sqlite-foundation.sqlite3'

const PRELOAD_PATH = 'electron/preload.js'
const IPC_REGISTRY_PATH = 'electron/ipcRegistry.js'
const STORAGE_IPC_PATH = 'electron/ipc/storageIpc.js'
const VITE_ENV_PATH = 'src/vite-env.d.ts'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m4-sqlite-foundation-audit.mjs [options]',
    '',
    'Initializes and audits the private-safe M4 main-process SQLite foundation.',
    '',
    'Options:',
    '  --generated-at <iso>          Override report timestamp',
    `  --database <path>             SQLite DB path (default: ${DEFAULT_M4_SQLITE_FOUNDATION_DATABASE})`,
    `  --output <path>               Write JSON report (default: ${DEFAULT_M4_SQLITE_FOUNDATION_FILE})`,
    '  --require-ready               Exit non-zero unless the SQLite foundation is ready',
    '  --help                        Show this help',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function splitOption(arg) {
  const eq = arg.indexOf('=')
  if (eq < 0) return [arg, null]
  return [arg.slice(0, eq), arg.slice(eq + 1)]
}

function readRequiredOptionValue(argv, index, inlineValue, optionName) {
  if (inlineValue !== null) return { value: inlineValue, nextIndex: index }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return { value, nextIndex: index + 1 }
}

export function parseM4SqliteFoundationArgs(argv) {
  const options = {
    databasePath: DEFAULT_M4_SQLITE_FOUNDATION_DATABASE,
    generatedAt: '',
    help: false,
    outputPath: DEFAULT_M4_SQLITE_FOUNDATION_FILE,
    requireReady: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--require-ready') {
      options.requireReady = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      if (name === '--generated-at') {
        options.generatedAt = parsed.value
      } else if (name === '--database' || name === '--database-path') {
        options.databasePath = parsed.value
      } else if (name === '--output' || name === '--output-file') {
        options.outputPath = parsed.value
      } else {
        throw new Error(`Unknown option: ${name}`)
      }
      index = parsed.nextIndex
      continue
    }
    throw new Error(`Unexpected argument: ${arg}`)
  }

  return options
}

function safeRelativePath(rootDir, targetPath) {
  const relative = path.relative(rootDir, path.resolve(rootDir, targetPath))
  return relative && !relative.startsWith('..') ? relative : '[outside-workspace]'
}

async function readText(rootDir, relativePath) {
  const target = cleanString(relativePath)
  try {
    return {
      exists: true,
      path: target,
      text: await fs.readFile(path.resolve(rootDir, target), 'utf8'),
      error: null,
    }
  } catch (error) {
    return {
      exists: false,
      path: target,
      text: '',
      error: error?.code === 'ENOENT' ? 'missing' : 'read-failed',
    }
  }
}

async function summarizeStorageStatusIpc(rootDir) {
  const [preload, ipcRegistry, storageIpc, viteEnv] = await Promise.all([
    readText(rootDir, PRELOAD_PATH),
    readText(rootDir, IPC_REGISTRY_PATH),
    readText(rootDir, STORAGE_IPC_PATH),
    readText(rootDir, VITE_ENV_PATH),
  ])
  const preloadExposed = /storageStatus\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]storage:status['"]\)/.test(preload.text)
  const handlerRegistered = /(?:ipcMain|ipcMainLike)\.handle\(\s*(?:STORAGE_STATUS_CHANNEL|['"]storage:status['"])/.test(storageIpc.text)
  const registryRegistered = /storageIpc\.register\s*\(/.test(ipcRegistry.text)
  const trustedSenderCheck = /trustedSenderCheck\s*\(\s*event\s*\)/.test(storageIpc.text)
    && /requireTrustedSender/.test(storageIpc.text)
  const responseValidationReady = /validateStorageStatusResponse/.test(storageIpc.text)
    && /return validateStorageStatusResponse\(/.test(storageIpc.text)
  const rendererTypeDeclared = /storageStatus:\s*\(\)\s*=>\s*Promise<StorageStatus>/.test(viteEnv.text)
  const absolutePathRedactionReady = /absoluteDatabasePathExposed:\s*false/.test(storageIpc.text)
    && !/databasePath\s*:/.test(storageIpc.text)
  const snapshotBackup = {
    channel: 'storage:backup-local-snapshot',
    preloadExposed: /backupLocalStorageSnapshot\s*:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(['"]storage:backup-local-snapshot['"],\s*payload\)/.test(preload.text),
    handlerRegistered: /(?:ipcMain|ipcMainLike)\.handle\(\s*(?:STORAGE_BACKUP_LOCAL_SNAPSHOT_CHANNEL|['"]storage:backup-local-snapshot['"])/.test(storageIpc.text),
    trustedSenderCheck,
    responseValidationReady: /validateLocalStorageSnapshotBackupResponse/.test(storageIpc.text)
      && /return validateLocalStorageSnapshotBackupResponse\(/.test(storageIpc.text),
    rendererTypeDeclared: /backupLocalStorageSnapshot:\s*\([\s\S]*?LocalStorageSnapshotBackupRequest[\s\S]*?\)\s*=>\s*Promise<LocalStorageSnapshotBackupResponse>/.test(viteEnv.text),
    absolutePathRedactionReady: /absoluteBackupPathExposed:\s*false/.test(storageIpc.text),
    valuesRedactionReady: /localStorageValuesReturned:\s*false/.test(storageIpc.text)
      && /valuesCopiedToResponse:\s*result\?\.valuesCopiedToResponse\s*===\s*true/.test(storageIpc.text),
    sourcePreservationReady: /sourceLocalStorageMutated:\s*false/.test(storageIpc.text),
  }
  snapshotBackup.ready = snapshotBackup.preloadExposed
    && snapshotBackup.handlerRegistered
    && snapshotBackup.trustedSenderCheck
    && snapshotBackup.responseValidationReady
    && snapshotBackup.rendererTypeDeclared
    && snapshotBackup.absolutePathRedactionReady
    && snapshotBackup.valuesRedactionReady
    && snapshotBackup.sourcePreservationReady
  const structuredCopy = {
    channel: 'storage:copy-local-snapshot',
    preloadExposed: /copyLocalStorageSnapshot\s*:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(['"]storage:copy-local-snapshot['"],\s*payload\)/.test(preload.text),
    handlerRegistered: /(?:ipcMain|ipcMainLike)\.handle\(\s*(?:STORAGE_COPY_LOCAL_SNAPSHOT_CHANNEL|['"]storage:copy-local-snapshot['"])/.test(storageIpc.text),
    trustedSenderCheck,
    requestValidationReady: /validateLocalStorageSnapshotCopyRequest/.test(storageIpc.text),
    responseValidationReady: /validateLocalStorageSnapshotCopyResponse/.test(storageIpc.text)
      && /return validateLocalStorageSnapshotCopyResponse\(/.test(storageIpc.text),
    rendererTypeDeclared: /copyLocalStorageSnapshot:\s*\([\s\S]*?LocalStorageSnapshotCopyRequest[\s\S]*?\)\s*=>\s*Promise<LocalStorageSnapshotCopyResponse>/.test(viteEnv.text),
    valuesRedactionReady: /localStorageValuesReturned:\s*false/.test(storageIpc.text)
      && /valuesCopiedToResponse:\s*result\?\.valuesCopiedToResponse\s*===\s*true/.test(storageIpc.text),
    sourcePreservationReady: /sourceLocalStorageMutated:\s*false/.test(storageIpc.text),
    runtimeMigrationDisabled: /runtimeMigrationEnabled:\s*false/.test(storageIpc.text)
      && /readThroughMigrationEnabled:\s*false/.test(storageIpc.text),
  }
  structuredCopy.ready = structuredCopy.preloadExposed
    && structuredCopy.handlerRegistered
    && structuredCopy.trustedSenderCheck
    && structuredCopy.requestValidationReady
    && structuredCopy.responseValidationReady
    && structuredCopy.rendererTypeDeclared
    && structuredCopy.valuesRedactionReady
    && structuredCopy.sourcePreservationReady
    && structuredCopy.runtimeMigrationDisabled
  const readThroughPreview = {
    channel: 'storage:read-through-preview',
    preloadExposed: /queryLocalStorageReadThroughPreview\s*:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(['"]storage:read-through-preview['"],\s*payload\)/.test(preload.text),
    handlerRegistered: /(?:ipcMain|ipcMainLike)\.handle\(\s*(?:STORAGE_READ_THROUGH_PREVIEW_CHANNEL|['"]storage:read-through-preview['"])/.test(storageIpc.text),
    trustedSenderCheck,
    requestValidationReady: /validateLocalStorageReadThroughQueryRequest/.test(storageIpc.text),
    responseValidationReady: /validateLocalStorageReadThroughPreviewResponse/.test(storageIpc.text)
      && /return validateLocalStorageReadThroughPreviewResponse\(/.test(storageIpc.text),
    rendererTypeDeclared: /queryLocalStorageReadThroughPreview:\s*\([\s\S]*?LocalStorageReadThroughPreviewRequest[\s\S]*?\)\s*=>\s*Promise<LocalStorageReadThroughPreviewResponse>/.test(viteEnv.text),
    valuesRedactionReady: /localStorageValuesReturned:\s*false/.test(storageIpc.text)
      && /valuesCopiedToResponse:\s*result\?\.valuesCopiedToResponse\s*===\s*true/.test(storageIpc.text),
    sourcePreservationReady: /sourceLocalStorageMutated:\s*false/.test(storageIpc.text),
    runtimeMigrationDisabled: /runtimeMigrationEnabled:\s*false/.test(storageIpc.text)
      && /readThroughMigrationEnabled:\s*false/.test(storageIpc.text),
  }
  readThroughPreview.ready = readThroughPreview.preloadExposed
    && readThroughPreview.handlerRegistered
    && readThroughPreview.trustedSenderCheck
    && readThroughPreview.requestValidationReady
    && readThroughPreview.responseValidationReady
    && readThroughPreview.rendererTypeDeclared
    && readThroughPreview.valuesRedactionReady
    && readThroughPreview.sourcePreservationReady
    && readThroughPreview.runtimeMigrationDisabled
  const missingSourceIds = [preload, ipcRegistry, storageIpc, viteEnv]
    .filter((source) => !source.exists || source.error)
    .map((source) => source.path)
  const ready = missingSourceIds.length === 0
    && preloadExposed
    && handlerRegistered
    && registryRegistered
    && trustedSenderCheck
    && responseValidationReady
    && rendererTypeDeclared
    && absolutePathRedactionReady
    && snapshotBackup.ready
    && structuredCopy.ready
    && readThroughPreview.ready

  return {
    ready,
    channel: 'storage:status',
    preloadExposed,
    handlerRegistered,
    registryRegistered,
    trustedSenderCheck,
    responseValidationReady,
    rendererTypeDeclared,
    absolutePathRedactionReady,
    snapshotBackup,
    structuredCopy,
    readThroughPreview,
    missingSourceIds,
  }
}

export async function buildM4SqliteFoundationReport(options = {}, context = {}) {
  const rootDir = context.rootDir || process.cwd()
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const databasePath = path.resolve(rootDir, cleanString(options.databasePath) || DEFAULT_M4_SQLITE_FOUNDATION_DATABASE)
  const runtime = await probeNexusSqliteRuntime(context)
  const ipcStatus = await summarizeStorageStatusIpc(rootDir)
  const status = await initializeNexusStorageDatabase({
    ...context,
    databasePath,
    generatedAt,
  })
  status.close?.()

  const missingTables = M4_SQLITE_FOUNDATION_TABLES.filter((table) => !status.tables?.includes(table))
  const ok = runtime.available === true
    && status.ok === true
    && status.schemaVersion >= M4_SQLITE_SCHEMA_VERSION
    && missingTables.length === 0
    && ipcStatus.ready === true
  const blockingIssueIds = [
    ...(runtime.available ? [] : ['node-sqlite-runtime-unavailable']),
    ...(status.ok ? [] : ['sqlite-foundation-schema-not-ready']),
    ...missingTables.map((table) => `missing-table:${table}`),
    ...(!ipcStatus.ready ? ['storage-status-ipc-not-ready'] : []),
    ...(!ipcStatus.snapshotBackup?.ready ? ['local-storage-snapshot-backup-ipc-not-ready'] : []),
    ...(!ipcStatus.structuredCopy?.ready ? ['local-storage-structured-copy-ipc-not-ready'] : []),
    ...(!ipcStatus.readThroughPreview?.ready ? ['local-storage-read-through-preview-ipc-not-ready'] : []),
  ]

  return {
    schemaVersion: 1,
    gate: M4_SQLITE_FOUNDATION_GATE,
    generatedAt,
    ok,
    status: ok ? 'foundation-ready' : 'foundation-not-ready',
    targetMilestone: 'M4',
    sqlite: {
      engine: 'node:sqlite',
      available: runtime.available === true,
      experimental: true,
      externalDependencyAdded: false,
      dependencyReview: {
        decision: 'use-built-in-node-sqlite-first',
        reason: 'Avoids adding a packaged native SQLite dependency while Electron 41/Node 24 can provide node:sqlite.',
        fallbackRequired: true,
      },
    },
    database: {
      path: safeRelativePath(rootDir, databasePath),
      schemaVersion: status.schemaVersion || 0,
      journalMode: cleanString(status.journalMode) || 'unknown',
      tables: status.tables || [],
      missingTables,
      counts: status.counts || {
        schemaMigrations: 0,
        backups: 0,
        localStorageLedgerItems: 0,
        migrationEvents: 0,
      },
    },
    migrationPlan: {
      runtimeMigrationEnabled: false,
      readThroughMigrationEnabled: false,
      backupLedgerReady: status.tables?.includes('storage_backups') === true,
      rollbackLedgerReady: status.tables?.includes('storage_schema_migrations') === true,
      localStorageLedgerReady: status.tables?.includes('local_storage_migration_ledger') === true,
      localStorageSnapshotBackupReady: status.tables?.includes('local_storage_backup_runs') === true
        && status.tables?.includes('local_storage_backup_items') === true
        && ipcStatus.snapshotBackup?.ready === true,
      localStorageStructuredCopyReady: status.tables?.includes('local_storage_copy_runs') === true
        && status.tables?.includes('local_storage_copy_items') === true
        && status.tables?.includes('chat_sessions') === true
        && status.tables?.includes('chat_messages') === true
        && status.tables?.includes('memories') === true
        && status.tables?.includes('daily_memory_entries') === true
        && status.tables?.includes('memory_sources') === true
        && ipcStatus.structuredCopy?.ready === true,
      localStorageReadThroughPreviewIpcReady: status.tables?.includes('local_storage_copy_runs') === true
        && status.tables?.includes('local_storage_copy_items') === true
        && status.tables?.includes('chat_sessions') === true
        && status.tables?.includes('chat_messages') === true
        && status.tables?.includes('memories') === true
        && status.tables?.includes('daily_memory_entries') === true
        && status.tables?.includes('memory_sources') === true
        && ipcStatus.readThroughPreview?.ready === true,
      sourceLocalStoragePreservationRequired: true,
      backupBeforeMutationRequired: true,
      rollbackToolRequired: true,
      crossPlatformCoverageRequired: ['macos', 'windows', 'linux'],
    },
    ipcStatus,
    privacy: {
      userDataCopied: false,
      localStorageValuesRead: false,
      privateFieldsOmitted: [
        'chat messages and transcripts',
        'memory bodies and source ids',
        'API keys and provider secrets',
        'audit log contents',
        'local file contents',
      ],
    },
    blockingIssueIds,
    nextActions: ok
      ? [
          'capture-chat-memory-local-storage-snapshot-backup',
          'copy-chat-memory-snapshot-into-structured-sqlite',
          'capture-main-process-read-through-preview-evidence',
          'implement-read-through-chat-memory-migration-with-backup',
          'add-restore-and-downgrade-cli-fixtures',
          'capture-packaged-electron-sqlite-smoke-evidence',
        ]
      : ['fix-node-sqlite-foundation-before-runtime-migration'],
  }
}

async function writeReportFile(report, outputPath) {
  const target = cleanString(outputPath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runM4SqliteFoundationCli(argv = process.argv.slice(2), context = {}) {
  const options = parseM4SqliteFoundationArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = await buildM4SqliteFoundationReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM4SqliteFoundationCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
