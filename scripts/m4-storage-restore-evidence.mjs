#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  backupLocalStorageSnapshot,
  exportLocalStorageSnapshotRestoreBundle,
  initializeNexusStorageDatabase,
  summarizeNexusStorageDatabase,
} from '../electron/services/sqliteStorage.js'

export const M4_STORAGE_RESTORE_EVIDENCE_GATE = 'nexus-v1-m4-storage-restore-evidence'
export const DEFAULT_M4_STORAGE_RESTORE_EVIDENCE_FILE = 'artifacts/v1/m4-storage-restore-evidence.json'

const SAMPLE_SENTINEL = 'M4_RESTORE_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m4-storage-restore-evidence.mjs [options]',
    '',
    'Runs a private-safe M4 localStorage snapshot backup plus restore-bundle evidence check.',
    'The report records keys, counts, and readiness flags only; it does not copy chat text,',
    'memory bodies, relationship notes, local paths, or restore bundle contents.',
    '',
    'Input options:',
    '  --sample                         Use synthetic chat/memory localStorage data',
    '  --input <path>                   JSON payload exported from renderer localStorage, or - for stdin',
    '  --json <path>                    Alias for --input',
    '',
    'Other options:',
    '  --generated-at <iso>             Override report timestamp',
    `  --output <path>                  Write JSON report (default: ${DEFAULT_M4_STORAGE_RESTORE_EVIDENCE_FILE})`,
    '  --database <path>                Optional private SQLite database path',
    '  --backup-directory <path>        Optional private backup/restore directory',
    '  --backup-id <id>                 Optional deterministic backup id',
    '  --restore-id <id>                Optional deterministic restore id',
    '  --keep-private-artifacts         Keep temporary SQLite, backup, and restore files',
    '  --require-ready                  Exit non-zero unless restore evidence is ready',
    '  --help                           Show this help',
    '',
    'Examples:',
    '  npm run m4:storage:restore:evidence -- --sample --require-ready',
    '  npm run m4:storage:restore:evidence -- --input artifacts/m4-local-storage-export.json --require-ready',
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

export function parseM4StorageRestoreEvidenceArgs(argv) {
  const options = {
    backupDirectory: '',
    backupId: '',
    databasePath: '',
    generatedAt: '',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: false,
    outputPath: DEFAULT_M4_STORAGE_RESTORE_EVIDENCE_FILE,
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
      } else if (name === '--restore-id') {
        options.restoreId = parsed.value
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
    evidenceSource: 'sample-m4-storage-restore',
    entries: [
      {
        key: 'nexus:chat',
        value: JSON.stringify([
          {
            id: 'restore-sample-chat-user',
            role: 'user',
            content: `${SAMPLE_SENTINEL}: flat chat line one`,
            createdAt: generatedAt,
          },
        ]),
      },
      {
        key: 'nexus:memory:long-term',
        value: JSON.stringify([
          {
            id: 'restore-sample-memory',
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
              id: 'restore-sample-daily-memory',
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

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export async function buildM4StorageRestoreEvidenceReport(options = {}, context = {}) {
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const payload = context.inputPayload
    ? normalizeInputPayload(context.inputPayload)
    : await loadInputPayload(options, generatedAt)
  const entries = payload.entries

  const explicitDatabasePath = cleanString(options.databasePath)
  const explicitBackupDirectory = cleanString(options.backupDirectory)
  const tempDir = explicitDatabasePath && explicitBackupDirectory
    ? ''
    : await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-restore-'))
  const databasePath = explicitDatabasePath || path.join(tempDir, 'nexus-m4-storage-restore.sqlite3')
  const backupDirectory = explicitBackupDirectory || path.join(tempDir, 'backups')

  try {
    const backup = await backupLocalStorageSnapshot({
      reason: 'm4-restore-evidence',
      entries,
    }, {
      databasePath,
      backupDirectory,
      generatedAt,
      backupId: cleanString(options.backupId) || 'm4-restore-evidence-backup',
    })

    const restore = await exportLocalStorageSnapshotRestoreBundle({
      backupId: backup.backupId,
      restoreId: cleanString(options.restoreId) || 'm4-restore-evidence-restore',
    }, {
      databasePath,
      backupDirectory,
      generatedAt,
    })

    const status = await initializeNexusStorageDatabase({
      databasePath,
      generatedAt,
    })
    let databaseSummary
    try {
      databaseSummary = summarizeNexusStorageDatabase(status.database)
    } finally {
      status.close?.()
    }

    const reportBase = {
      schemaVersion: 1,
      gate: M4_STORAGE_RESTORE_EVIDENCE_GATE,
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
        sourceLocalStoragePreserved: restore.sourceLocalStoragePreserved === true,
        sourceLocalStorageMutated: restore.sourceLocalStorageMutated === true,
        runtimeMigrationEnabled: restore.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: restore.readThroughMigrationEnabled === true,
        valuesCopiedToResponse: restore.valuesCopiedToResponse === true,
        valuesCopiedToReport: false,
      },
      database: {
        schemaVersion: databaseSummary.schemaVersion,
        counts: databaseSummary.counts,
      },
      migrationPlan: {
        restoreEvidenceReady: restore.ok === true && restore.hashesVerified === true,
        rollbackFixtureReady: restore.ok === true && restore.restoreBundleContainsValues === true,
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
      },
    }

    const leaked = reportContainsInputValues(reportBase, entries)
    const blockingIssueIds = [
      ...(reportBase.backup.ok ? [] : ['snapshot-backup-not-ready']),
      ...(reportBase.restore.ok ? [] : ['restore-bundle-not-ready']),
      ...(reportBase.restore.hashesVerified ? [] : ['restore-hashes-not-verified']),
      ...(reportBase.restore.entryCount > 0 ? [] : ['restore-entry-count-empty']),
      ...(reportBase.backup.runtimeMigrationEnabled || reportBase.restore.runtimeMigrationEnabled ? ['runtime-migration-enabled'] : []),
      ...(reportBase.backup.readThroughMigrationEnabled || reportBase.restore.readThroughMigrationEnabled ? ['read-through-migration-enabled'] : []),
      ...(reportBase.restore.sourceLocalStorageMutated ? ['source-local-storage-mutated'] : []),
      ...(reportBase.backup.valuesCopiedToResponse || reportBase.restore.valuesCopiedToResponse ? ['values-copied-to-response'] : []),
      ...(leaked ? ['input-values-leaked-to-report'] : []),
    ]
    const ok = blockingIssueIds.length === 0

    return {
      ...reportBase,
      ok,
      overallStatus: ok ? 'restore-evidence-ready' : 'restore-evidence-not-ready',
      privacy: {
        artifactContentsCopied: false,
        localStorageValuesCopiedToReport: false,
        localStorageValuesReturned: false,
        restoreBundleContainsValues: true,
        absolutePathsExposed: false,
        sourceLocalStorageMutated: false,
        privateFieldsOmitted: [
          'chat messages and transcripts',
          'memory bodies and source refs',
          'relationship notes and state values',
          'localStorage raw values',
          'private SQLite database path',
          'private backup directory path',
          'private restore bundle path',
          'restore bundle contents',
        ],
      },
      blockingIssueIds,
      nextActions: ok
        ? [
            'implement-read-through-migration-with-localstorage-preservation',
            'add-schema-downgrade-cli-fixtures',
          ]
        : [
            'fix-local-storage-restore-evidence',
            'rerun-m4-storage-restore-evidence',
          ],
    }
  } finally {
    if (tempDir && !options.keepPrivateArtifacts) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }
}

export async function runM4StorageRestoreEvidenceCli(argv = process.argv.slice(2)) {
  const options = parseM4StorageRestoreEvidenceArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = await buildM4StorageRestoreEvidenceReport(options)
  if (options.outputPath) {
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true })
    await fs.writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.requireReady && !report.ok) return 1
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runM4StorageRestoreEvidenceCli()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
