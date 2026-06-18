#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  backupLocalStorageSnapshot,
  copyLocalStorageSnapshotToStructuredSqlite,
  downgradeNexusStorageSchema,
  exportLocalStorageSnapshotRestoreBundle,
} from '../electron/services/sqliteStorage.js'

export const M4_STORAGE_DOWNGRADE_EVIDENCE_GATE = 'nexus-v1-m4-storage-downgrade-evidence'
export const DEFAULT_M4_STORAGE_DOWNGRADE_EVIDENCE_FILE = 'artifacts/v1/m4-storage-downgrade-evidence.json'

const SAMPLE_SENTINEL = 'M4_DOWNGRADE_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m4-storage-downgrade-evidence.mjs [options]',
    '',
    'Runs a private-safe M4 backup + copy + restore-bundle + schema downgrade evidence check.',
    'The report records only counts, keys, readiness flags, and hashes; it does not copy',
    'chat text, memory bodies, localStorage raw values, local paths, or backup contents.',
    '',
    'Input options:',
    '  --sample                         Use synthetic chat/memory localStorage data',
    '  --input <path>                   JSON payload exported from renderer localStorage, or - for stdin',
    '  --json <path>                    Alias for --input',
    '',
    'Other options:',
    '  --generated-at <iso>             Override report timestamp',
    `  --output <path>                  Write JSON report (default: ${DEFAULT_M4_STORAGE_DOWNGRADE_EVIDENCE_FILE})`,
    '  --database <path>                Optional private SQLite database path',
    '  --backup-directory <path>        Optional private backup/restore directory',
    '  --backup-id <id>                 Optional deterministic backup id',
    '  --copy-id <id>                   Optional deterministic copy id',
    '  --restore-id <id>                Optional deterministic restore id',
    '  --downgrade-id <id>              Optional deterministic downgrade id',
    '  --keep-private-artifacts         Keep temporary SQLite, backup, restore, and DB backup files',
    '  --require-ready                  Exit non-zero unless downgrade evidence is ready',
    '  --help                           Show this help',
    '',
    'Examples:',
    '  npm run m4:storage:downgrade:evidence -- --sample --require-ready',
    '  npm run m4:storage:downgrade:evidence -- --input artifacts/m4-local-storage-export.json --require-ready',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeIso(value = new Date()) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  const parsed = Date.parse(String(value ?? ''))
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

export function parseM4StorageDowngradeEvidenceArgs(argv) {
  const options = {
    backupDirectory: '',
    backupId: '',
    copyId: '',
    databasePath: '',
    downgradeId: '',
    generatedAt: '',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: false,
    outputPath: DEFAULT_M4_STORAGE_DOWNGRADE_EVIDENCE_FILE,
    requireReady: false,
    restoreId: '',
    sample: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--sample') {
      options.sample = true
      continue
    }
    if (arg === '--require-ready') {
      options.requireReady = true
      continue
    }
    if (arg === '--keep-private-artifacts') {
      options.keepPrivateArtifacts = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      if (name === '--generated-at') {
        options.generatedAt = parsed.value
      } else if (name === '--output' || name === '--output-file' || name === '--evidence-file') {
        options.outputPath = parsed.value
      } else if (name === '--input' || name === '--json') {
        options.inputPath = parsed.value
      } else if (name === '--database' || name === '--database-path') {
        options.databasePath = parsed.value
      } else if (name === '--backup-directory' || name === '--backup-dir') {
        options.backupDirectory = parsed.value
      } else if (name === '--backup-id') {
        options.backupId = parsed.value
      } else if (name === '--copy-id') {
        options.copyId = parsed.value
      } else if (name === '--restore-id') {
        options.restoreId = parsed.value
      } else if (name === '--downgrade-id') {
        options.downgradeId = parsed.value
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

function buildSamplePayload(generatedAt) {
  return {
    evidenceSource: 'sample-m4-storage-downgrade',
    entries: [
      {
        key: 'nexus:chat',
        value: JSON.stringify([
          {
            id: 'downgrade-sample-chat-user',
            role: 'user',
            content: `${SAMPLE_SENTINEL}: flat chat line one`,
            createdAt: generatedAt,
          },
          {
            id: 'downgrade-sample-chat-assistant',
            role: 'assistant',
            content: `${SAMPLE_SENTINEL}: flat chat line two`,
            createdAt: generatedAt,
          },
        ]),
      },
      {
        key: 'nexus:memory:long-term',
        value: JSON.stringify([
          {
            id: 'downgrade-sample-memory',
            content: `${SAMPLE_SENTINEL}: long term memory`,
            category: 'preference',
            source: 'chat',
            createdAt: generatedAt,
          },
        ]),
      },
      {
        key: 'nexus:memory:daily',
        value: JSON.stringify({
          [generatedAt.slice(0, 10)]: [
            {
              id: 'downgrade-sample-daily-memory',
              role: 'user',
              content: `${SAMPLE_SENTINEL}: daily memory`,
              source: 'chat',
              createdAt: generatedAt,
            },
          ],
        }),
      },
    ],
  }
}

async function readStdinText() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`entries[${index}] must be a plain object`)
  }
  const key = cleanString(entry.key || entry.storageKey)
  if (!key) throw new Error(`entries[${index}] is missing key`)
  if (typeof entry.value !== 'string') throw new Error(`entries[${index}].value must be a string`)
  return {
    key,
    value: entry.value,
    sourceUpdatedAt: entry.sourceUpdatedAt,
  }
}

function normalizeInputPayload(payload) {
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entries)
      ? payload.entries
      : Array.isArray(payload?.localStorageEntries)
        ? payload.localStorageEntries
        : Array.isArray(payload?.snapshot?.entries)
          ? payload.snapshot.entries
          : null
  if (!entries) throw new Error('input JSON must be an array or contain entries/localStorageEntries/snapshot.entries')

  return {
    evidenceSource: cleanString(payload?.evidenceSource) || 'private-renderer-local-storage-export',
    entries: entries.map(normalizeEntry),
  }
}

async function loadInputPayload(options, generatedAt) {
  if (options.sample && options.inputPath) throw new Error('Use either --sample or --input, not both')
  if (options.sample) return buildSamplePayload(generatedAt)
  if (!options.inputPath) throw new Error('Missing input: use --sample or --input <path>')

  const text = options.inputPath === '-'
    ? await readStdinText()
    : await fs.readFile(options.inputPath, 'utf8')
  return normalizeInputPayload(JSON.parse(text))
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8')
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function collectValueNeedles(entries) {
  return entries
    .map((entry) => entry.value)
    .filter((value) => typeof value === 'string' && value.trim().length >= 16)
    .flatMap((value) => {
      const trimmed = value.trim()
      const needles = [trimmed]
      const sentinelMatch = trimmed.match(/M4_[A-Z_]+DO_NOT_COPY/g)
      if (sentinelMatch) needles.push(...sentinelMatch)
      return needles
    })
}

function reportContainsInputValues(report, entries) {
  const json = JSON.stringify(report)
  return collectValueNeedles(entries).some((needle) => json.includes(needle))
}

export async function buildM4StorageDowngradeEvidenceReport(options = {}, context = {}) {
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const payload = context.inputPayload
    ? normalizeInputPayload(context.inputPayload)
    : await loadInputPayload(options, generatedAt)
  const entries = payload.entries

  const explicitDatabasePath = cleanString(options.databasePath)
  const explicitBackupDirectory = cleanString(options.backupDirectory)
  const tempDir = explicitDatabasePath && explicitBackupDirectory
    ? ''
    : await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-downgrade-'))
  const databasePath = explicitDatabasePath || path.join(tempDir, 'nexus-m4-storage-downgrade.sqlite3')
  const backupDirectory = explicitBackupDirectory || path.join(tempDir, 'backups')

  try {
    const backup = await backupLocalStorageSnapshot({
      reason: 'm4-downgrade-evidence',
      entries,
    }, {
      databasePath,
      backupDirectory,
      generatedAt,
      backupId: cleanString(options.backupId) || 'm4-downgrade-evidence-backup',
    })
    const copy = await copyLocalStorageSnapshotToStructuredSqlite({
      backupId: backup.backupId,
      copyId: cleanString(options.copyId) || 'm4-downgrade-evidence-copy',
    }, {
      databasePath,
      generatedAt,
    })
    const restore = await exportLocalStorageSnapshotRestoreBundle({
      backupId: backup.backupId,
      restoreId: cleanString(options.restoreId) || 'm4-downgrade-evidence-restore',
    }, {
      databasePath,
      backupDirectory,
      generatedAt,
    })
    const downgrade = await downgradeNexusStorageSchema({
      targetVersion: 2,
      reason: 'm4-downgrade-evidence',
      downgradeId: cleanString(options.downgradeId) || 'm4-downgrade-evidence-schema-downgrade',
      backupId: backup.backupId,
      restoreBundleSha256: restore.sha256,
    }, {
      databasePath,
      backupDirectory,
      generatedAt,
    })

    const reportBase = {
      schemaVersion: 1,
      gate: M4_STORAGE_DOWNGRADE_EVIDENCE_GATE,
      generatedAt,
      targetMilestone: 'M4',
      evidenceSource: payload.evidenceSource,
      input: {
        sample: options.sample === true,
        entryCount: entries.length,
        keyCount: unique(entries.map((entry) => entry.key)).length,
        keys: unique(entries.map((entry) => entry.key)).sort(),
        totalBytes: entries.reduce((total, entry) => total + byteLength(entry.value), 0),
        valuesCopiedToReport: false,
      },
      backup: {
        ok: backup.ok === true,
        status: cleanString(backup.status),
        entryCount: backup.entryCount,
        keyCount: backup.keys.length,
        keys: backup.keys.slice().sort(),
        backupFileNamePresent: Boolean(backup.backupFileName),
        backupSha256Present: Boolean(backup.sha256),
        sourceLocalStoragePreserved: backup.sourceLocalStoragePreserved === true,
        runtimeMigrationEnabled: backup.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: backup.readThroughMigrationEnabled === true,
        valuesCopiedToResponse: backup.valuesCopiedToResponse === true,
      },
      copy: {
        ok: copy.ok === true,
        status: cleanString(copy.status),
        copiedItemCount: copy.copiedItemCount,
        skippedItemCount: copy.skippedItemCount,
        failedItemCount: copy.failedItemCount,
        chatSessionCount: copy.chatSessionCount,
        chatMessageCount: copy.chatMessageCount,
        memoryCount: copy.memoryCount,
        dailyMemoryEntryCount: copy.dailyMemoryEntryCount,
        copiedKeys: copy.copiedKeys.slice().sort(),
        skippedKeys: copy.skippedKeys.slice().sort(),
        runtimeMigrationEnabled: copy.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: copy.readThroughMigrationEnabled === true,
        sourceLocalStoragePreserved: copy.sourceLocalStoragePreserved === true,
        valuesCopiedToResponse: copy.valuesCopiedToResponse === true,
      },
      restore: {
        ok: restore.ok === true,
        status: cleanString(restore.status),
        entryCount: restore.entryCount,
        keyCount: restore.keys.length,
        keys: restore.keys.slice().sort(),
        restoreFileNamePresent: Boolean(restore.restoreFileName),
        restoreSha256Present: Boolean(restore.sha256),
        hashesVerified: restore.hashesVerified === true,
        restoreBundleContainsValues: restore.restoreBundleContainsValues === true,
        sourceLocalStorageMutated: restore.sourceLocalStorageMutated === true,
        runtimeMigrationEnabled: restore.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: restore.readThroughMigrationEnabled === true,
        valuesCopiedToResponse: restore.valuesCopiedToResponse === true,
      },
      downgrade: {
        ok: downgrade.ok === true,
        status: cleanString(downgrade.status),
        fromSchemaVersion: downgrade.fromSchemaVersion,
        targetSchemaVersion: downgrade.targetSchemaVersion,
        droppedTableCount: downgrade.droppedTables.length,
        droppedTables: downgrade.droppedTables.slice().sort(),
        remainingStructuredTableCount: downgrade.remainingStructuredTables.length,
        databaseBackupFileNamePresent: Boolean(downgrade.databaseBackupFileName),
        databaseBackupSha256Present: Boolean(downgrade.databaseBackupSha256),
        restoreBundleSha256Present: downgrade.restoreBundleSha256Present === true,
        v2TablesReady: downgrade.after?.v2TablesReady === true,
        runtimeMigrationEnabled: downgrade.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: downgrade.readThroughMigrationEnabled === true,
        sourceLocalStoragePreserved: downgrade.sourceLocalStoragePreserved === true,
        valuesCopiedToResponse: downgrade.valuesCopiedToResponse === true,
      },
      migrationPlan: {
        schemaDowngradeEvidenceReady: downgrade.ok === true,
        targetSchemaVersion: 2,
        structuredCopyTablesRemoved: downgrade.remainingStructuredTables.length === 0,
        restoreBundleReady: restore.ok === true && restore.hashesVerified === true,
        databaseBackupBeforeDowngradeCompleted: Boolean(downgrade.databaseBackupSha256),
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        sourceLocalStoragePreserved: true,
        backupBeforeMutationRequired: true,
        rollbackToolRequired: true,
      },
      privateArtifacts: {
        persisted: Boolean(options.keepPrivateArtifacts || explicitDatabasePath || explicitBackupDirectory),
        databasePathExposed: false,
        backupDirectoryExposed: false,
        restoreBundlePathExposed: false,
        downgradeDatabaseBackupPathExposed: false,
      },
    }

    const leaked = reportContainsInputValues(reportBase, entries)
    const blockingIssueIds = [
      ...(reportBase.backup.ok ? [] : ['snapshot-backup-not-ready']),
      ...(reportBase.copy.ok ? [] : ['structured-copy-not-ready']),
      ...(reportBase.copy.failedItemCount === 0 ? [] : ['structured-copy-failed-items']),
      ...(reportBase.restore.ok ? [] : ['restore-bundle-not-ready']),
      ...(reportBase.restore.hashesVerified ? [] : ['restore-hashes-not-verified']),
      ...(reportBase.downgrade.ok ? [] : ['schema-downgrade-not-ready']),
      ...(reportBase.downgrade.targetSchemaVersion === 2 ? [] : ['schema-downgrade-target-not-v2']),
      ...(reportBase.downgrade.remainingStructuredTableCount === 0 ? [] : ['structured-copy-tables-still-present']),
      ...(reportBase.backup.runtimeMigrationEnabled || reportBase.copy.runtimeMigrationEnabled || reportBase.restore.runtimeMigrationEnabled || reportBase.downgrade.runtimeMigrationEnabled ? ['runtime-migration-enabled'] : []),
      ...(reportBase.backup.readThroughMigrationEnabled || reportBase.copy.readThroughMigrationEnabled || reportBase.restore.readThroughMigrationEnabled || reportBase.downgrade.readThroughMigrationEnabled ? ['read-through-migration-enabled'] : []),
      ...(reportBase.restore.sourceLocalStorageMutated ? ['source-local-storage-mutated'] : []),
      ...(reportBase.backup.valuesCopiedToResponse || reportBase.copy.valuesCopiedToResponse || reportBase.restore.valuesCopiedToResponse || reportBase.downgrade.valuesCopiedToResponse ? ['values-copied-to-response'] : []),
      ...(leaked ? ['input-values-leaked-to-report'] : []),
    ]
    const ok = blockingIssueIds.length === 0

    return {
      ...reportBase,
      ok,
      overallStatus: ok ? 'schema-downgrade-evidence-ready' : 'schema-downgrade-evidence-not-ready',
      privacy: {
        artifactContentsCopied: false,
        localStorageValuesCopiedToReport: false,
        localStorageValuesReturned: false,
        restoreBundleContainsValues: true,
        absolutePathsExposed: false,
        sourceLocalStorageMutated: false,
        privateFieldsOmitted: [
          'chat messages and transcripts',
          'chat session titles',
          'memory bodies and source refs',
          'relationship notes and state values',
          'localStorage raw values',
          'private SQLite database path',
          'private backup directory path',
          'private restore bundle path',
          'private downgrade database backup path',
          'backup and restore file contents',
        ],
      },
      blockingIssueIds,
      nextActions: ok
        ? ['wire-runtime-read-through-behind-user-confirmed-feature-flag']
        : [
            'fix-schema-downgrade-evidence',
            'rerun-m4-storage-downgrade-evidence',
          ],
    }
  } finally {
    if (tempDir && !options.keepPrivateArtifacts) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }
}

export async function runM4StorageDowngradeEvidenceCli(argv = process.argv.slice(2)) {
  const options = parseM4StorageDowngradeEvidenceArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = await buildM4StorageDowngradeEvidenceReport(options)
  if (options.outputPath) {
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true })
    await fs.writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.requireReady && !report.ok) return 1
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runM4StorageDowngradeEvidenceCli()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
