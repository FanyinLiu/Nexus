#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  backupLocalStorageSnapshot,
  copyLocalStorageSnapshotToStructuredSqlite,
  initializeNexusStorageDatabase,
  summarizeNexusStorageDatabase,
} from '../electron/services/sqliteStorage.js'

export const M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_GATE = 'nexus-v1-m4-storage-snapshot-copy-evidence'
export const DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE = 'artifacts/v1/m4-storage-snapshot-copy-evidence.json'

const SAMPLE_SENTINEL = 'M4_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m4-storage-snapshot-copy-evidence.mjs [options]',
    '',
    'Runs a private-safe M4 localStorage snapshot backup plus structured SQLite copy evidence check.',
    'The report records keys, counts, and readiness flags only; it does not copy chat text,',
    'memory bodies, relationship notes, local paths, or backup file contents.',
    '',
    'Input options:',
    '  --sample                         Use synthetic chat/memory localStorage data',
    '  --input <path>                   JSON payload exported from renderer localStorage, or - for stdin',
    '  --json <path>                    Alias for --input',
    '',
    'Other options:',
    '  --generated-at <iso>             Override report timestamp',
    `  --output <path>                  Write JSON report (default: ${DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE})`,
    '  --database <path>                Optional private SQLite database path',
    '  --backup-directory <path>        Optional private backup directory',
    '  --backup-id <id>                 Optional deterministic backup id',
    '  --copy-id <id>                   Optional deterministic copy id',
    '  --keep-private-artifacts         Keep temporary SQLite and backup files',
    '  --require-ready                  Exit non-zero unless backup and copy evidence are ready',
    '  --help                           Show this help',
    '',
    'Examples:',
    '  npm run m4:storage:snapshot-copy:evidence -- --sample --require-ready',
    '  npm run m4:storage:snapshot-copy:evidence -- --input artifacts/m4-local-storage-export.json --require-ready',
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

export function parseM4StorageSnapshotCopyEvidenceArgs(argv) {
  const options = {
    backupDirectory: '',
    backupId: '',
    copyId: '',
    databasePath: '',
    generatedAt: '',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: false,
    outputPath: DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE,
    requireReady: false,
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
    evidenceSource: 'sample-m4-storage-snapshot-copy',
    entries: [
      {
        key: 'nexus:chat',
        value: JSON.stringify([
          {
            id: 'sample-chat-user',
            role: 'user',
            content: `${SAMPLE_SENTINEL}: flat chat line one\nflat chat line two`,
            createdAt: generatedAt,
          },
          {
            id: 'sample-chat-assistant',
            role: 'assistant',
            content: `${SAMPLE_SENTINEL}: assistant reply`,
            createdAt: generatedAt,
          },
        ]),
      },
      {
        key: 'nexus:chat:sessions',
        value: JSON.stringify([
          {
            id: 'sample-session',
            title: 'Sample session',
            startedAt: Date.parse(generatedAt),
            lastActiveAt: Date.parse(generatedAt),
            messages: [
              {
                id: 'sample-session-message',
                role: 'user',
                content: `${SAMPLE_SENTINEL}: session chat`,
                createdAt: generatedAt,
              },
            ],
          },
        ]),
      },
      {
        key: 'nexus:memory:long-term',
        value: JSON.stringify([
          {
            id: 'sample-memory',
            content: `${SAMPLE_SENTINEL}: long term memory`,
            category: 'preference',
            source: 'chat',
            createdAt: generatedAt,
            importance: 'high',
          },
        ]),
      },
      {
        key: 'nexus:memory:daily',
        value: JSON.stringify({
          [generatedAt.slice(0, 10)]: [
            {
              id: 'sample-daily-memory',
              role: 'user',
              content: `${SAMPLE_SENTINEL}: daily memory`,
              source: 'chat',
              createdAt: generatedAt,
            },
          ],
        }),
      },
      {
        key: 'nexus:autonomy:relationship',
        value: JSON.stringify({
          warmth: 0.8,
          note: `${SAMPLE_SENTINEL}: relationship state stays backed-up-only`,
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

async function readJsonInput(inputPath) {
  const target = cleanString(inputPath)
  if (!target) throw new Error('--input is required unless --sample is used')
  const text = target === '-'
    ? await readStdinText()
    : await fs.readFile(path.resolve(process.cwd(), target), 'utf8')
  return JSON.parse(text)
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8')
}

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`entries[${index}] must be a plain object`)
  }
  const key = cleanString(entry.key || entry.storageKey)
  if (typeof entry.value !== 'string') throw new Error(`entries[${index}].value must be a string`)
  return {
    key,
    value: entry.value,
    sourceUpdatedAt: cleanString(entry.sourceUpdatedAt) || undefined,
  }
}

function normalizeInputPayload(raw) {
  const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rawEntries = Array.isArray(raw)
    ? raw
    : Array.isArray(payload.entries)
      ? payload.entries
      : Array.isArray(payload.localStorageEntries)
        ? payload.localStorageEntries
        : Array.isArray(payload.snapshot?.entries)
          ? payload.snapshot.entries
          : null
  if (!rawEntries) throw new Error('input JSON must be an array or include entries')
  const entries = rawEntries.map(normalizeEntry)
  return {
    evidenceSource: cleanString(payload.evidenceSource) || cleanString(payload.source) || 'renderer-local-storage-export',
    entries,
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function idSuffix(generatedAt) {
  const parsed = Date.parse(generatedAt)
  return Number.isFinite(parsed) ? String(parsed) : String(Date.now())
}

function resolveOptionalPath(rootDir, maybePath) {
  const target = cleanString(maybePath)
  return target ? path.resolve(rootDir, target) : ''
}

function summarizeCounts(summary) {
  const counts = summary?.counts || {}
  return {
    schemaMigrations: Number(counts.schemaMigrations || 0),
    localStorageBackupRuns: Number(counts.localStorageBackupRuns || 0),
    localStorageBackupItems: Number(counts.localStorageBackupItems || 0),
    localStorageCopyRuns: Number(counts.localStorageCopyRuns || 0),
    localStorageCopyItems: Number(counts.localStorageCopyItems || 0),
    chatSessions: Number(counts.chatSessions || 0),
    chatMessages: Number(counts.chatMessages || 0),
    memories: Number(counts.memories || 0),
    dailyMemoryEntries: Number(counts.dailyMemoryEntries || 0),
    memorySources: Number(counts.memorySources || 0),
    migrationEvents: Number(counts.migrationEvents || 0),
  }
}

function collectValueNeedles(entries) {
  return entries
    .flatMap((entry) => {
      const value = String(entry.value || '')
      const needles = []
      if (value.length >= 24) needles.push(value.slice(0, Math.min(value.length, 120)))
      const sentinelMatch = value.match(/[A-Z0-9_]{12,}/)
      if (sentinelMatch) needles.push(sentinelMatch[0])
      return needles
    })
    .filter((needle) => needle.length >= 12)
}

function reportContainsInputValues(report, entries) {
  const text = JSON.stringify(report)
  return collectValueNeedles(entries).some((needle) => text.includes(needle))
}

async function writeReportFile(report, outputPath) {
  const target = cleanString(outputPath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function buildM4StorageSnapshotCopyEvidenceReport(options = {}, context = {}) {
  const rootDir = context.rootDir || process.cwd()
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const inputPayload = options.entries
    ? { evidenceSource: cleanString(options.evidenceSource) || 'programmatic-input', entries: options.entries }
    : options.sample
      ? buildSamplePayload(generatedAt)
      : await readJsonInput(options.inputPath)
  const normalizedInput = normalizeInputPayload(inputPayload)
  const entryKeys = normalizedInput.entries.map((entry) => entry.key)
  const totalBytes = normalizedInput.entries.reduce((sum, entry) => sum + byteLength(entry.value), 0)
  const tempRoot = context.tempRoot || await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-copy-evidence-'))
  const ownsTempRoot = !context.tempRoot
  const databasePath = resolveOptionalPath(rootDir, options.databasePath) || path.join(tempRoot, 'storage.sqlite3')
  const backupDirectory = resolveOptionalPath(rootDir, options.backupDirectory) || path.join(tempRoot, 'backups')
  const keepPrivateArtifacts = Boolean(options.keepPrivateArtifacts || options.databasePath || options.backupDirectory)
  const backupId = cleanString(options.backupId) || `m4-storage-snapshot-evidence-${idSuffix(generatedAt)}`
  const copyId = cleanString(options.copyId) || `m4-storage-copy-evidence-${idSuffix(generatedAt)}`

  let status
  try {
    const backup = await backupLocalStorageSnapshot({
      reason: 'm4-evidence',
      entries: normalizedInput.entries,
    }, {
      databasePath,
      backupDirectory,
      generatedAt,
      backupId,
    })

    const copiedAt = normalizeIso(Date.parse(generatedAt) + 1000)
    const copy = await copyLocalStorageSnapshotToStructuredSqlite({
      backupId,
      copyId,
    }, {
      databasePath,
      generatedAt: copiedAt,
    })

    status = await initializeNexusStorageDatabase({
      databasePath,
      generatedAt: normalizeIso(Date.parse(generatedAt) + 2000),
    })
    const summary = summarizeNexusStorageDatabase(status.database)
    const counts = summarizeCounts(summary)
    const reportBase = {
      schemaVersion: 1,
      gate: M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_GATE,
      generatedAt,
      targetMilestone: 'M4',
      evidenceSource: normalizedInput.evidenceSource,
      input: {
        sample: options.sample === true,
        entryCount: normalizedInput.entries.length,
        keyCount: unique(entryKeys).length,
        keys: unique(entryKeys).sort(),
        totalBytes,
        valuesCopiedToReport: false,
      },
      backup: {
        ok: backup.ok === true,
        status: cleanString(backup.status),
        entryCount: Number(backup.entryCount || 0),
        keyCount: Array.isArray(backup.keys) ? backup.keys.length : 0,
        keys: Array.isArray(backup.keys) ? [...backup.keys].sort() : [],
        domains: Array.isArray(backup.domains) ? [...backup.domains].sort() : [],
        backupFileNamePresent: Boolean(cleanString(backup.backupFileName)),
        backupSha256Present: Boolean(cleanString(backup.sha256)),
        sourceLocalStoragePreserved: backup.sourceLocalStoragePreserved === true,
        runtimeMigrationEnabled: backup.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: backup.readThroughMigrationEnabled === true,
        valuesCopiedToResponse: backup.valuesCopiedToResponse === true,
      },
      copy: {
        ok: copy.ok === true,
        status: cleanString(copy.status),
        itemCount: Number(copy.itemCount || 0),
        copiedItemCount: Number(copy.copiedItemCount || 0),
        skippedItemCount: Number(copy.skippedItemCount || 0),
        failedItemCount: Number(copy.failedItemCount || 0),
        chatSessionCount: Number(copy.chatSessionCount || 0),
        chatMessageCount: Number(copy.chatMessageCount || 0),
        memoryCount: Number(copy.memoryCount || 0),
        dailyMemoryEntryCount: Number(copy.dailyMemoryEntryCount || 0),
        keys: Array.isArray(copy.keys) ? [...copy.keys].sort() : [],
        copiedKeys: Array.isArray(copy.copiedKeys) ? [...copy.copiedKeys].sort() : [],
        skippedKeys: Array.isArray(copy.skippedKeys) ? [...copy.skippedKeys].sort() : [],
        failedKeys: Array.isArray(copy.failedKeys) ? [...copy.failedKeys].sort() : [],
        runtimeMigrationEnabled: copy.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: copy.readThroughMigrationEnabled === true,
        sourceLocalStoragePreserved: copy.sourceLocalStoragePreserved === true,
        valuesCopiedToResponse: copy.valuesCopiedToResponse === true,
      },
      database: {
        schemaVersion: summary.schemaVersion,
        counts,
      },
      migrationPlan: {
        snapshotBackupEvidenceReady: backup.ok === true,
        structuredCopyEvidenceReady: copy.ok === true && Number(copy.copiedItemCount || 0) > 0,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        sourceLocalStoragePreserved: backup.sourceLocalStoragePreserved === true
          && copy.sourceLocalStoragePreserved === true,
        backupBeforeMutationRequired: true,
        rollbackToolRequired: true,
      },
      privateArtifacts: {
        persisted: keepPrivateArtifacts,
        databasePathExposed: false,
        backupDirectoryExposed: false,
      },
    }
    const valuesCopiedToReport = reportContainsInputValues(reportBase, normalizedInput.entries)
    const blockingIssueIds = [
      ...(reportBase.backup.ok ? [] : ['snapshot-backup-failed']),
      ...(reportBase.copy.ok ? [] : ['structured-copy-failed']),
      ...(reportBase.copy.failedItemCount === 0 ? [] : ['structured-copy-item-failed']),
      ...(reportBase.copy.copiedItemCount > 0 ? [] : ['structured-copy-empty']),
      ...(reportBase.migrationPlan.sourceLocalStoragePreserved ? [] : ['source-localstorage-not-preserved']),
      ...(reportBase.backup.runtimeMigrationEnabled || reportBase.copy.runtimeMigrationEnabled ? ['runtime-migration-enabled'] : []),
      ...(reportBase.backup.readThroughMigrationEnabled || reportBase.copy.readThroughMigrationEnabled ? ['read-through-migration-enabled'] : []),
      ...(valuesCopiedToReport ? ['input-values-copied-to-report'] : []),
    ]
    const ok = blockingIssueIds.length === 0

    return {
      ...reportBase,
      ok,
      overallStatus: ok ? 'snapshot-copy-evidence-ready' : 'snapshot-copy-evidence-not-ready',
      input: {
        ...reportBase.input,
        valuesCopiedToReport,
      },
      privacy: {
        artifactContentsCopied: false,
        localStorageValuesCopiedToReport: valuesCopiedToReport,
        localStorageValuesReturned: false,
        absolutePathsExposed: false,
        sourceLocalStorageMutated: false,
        privateFieldsOmitted: [
          'chat messages and transcripts',
          'memory bodies and source refs',
          'relationship notes and state values',
          'localStorage raw values',
          'private SQLite database path',
          'private backup directory path',
          'backup file contents',
        ],
      },
      blockingIssueIds,
      nextActions: ok
        ? [
            'implement-read-through-migration-with-localstorage-preservation',
            'add-backup-restore-and-rollback-fixtures',
          ]
        : [
            'fix-snapshot-backup-or-structured-copy-evidence',
            'rerun-m4-storage-snapshot-copy-evidence',
          ],
    }
  } finally {
    status?.close?.()
    if (ownsTempRoot && !keepPrivateArtifacts) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  }
}

export async function runM4StorageSnapshotCopyEvidenceCli(argv = process.argv.slice(2), context = {}) {
  const options = parseM4StorageSnapshotCopyEvidenceArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  if (!options.sample && !options.inputPath && !options.entries) {
    throw new Error('--sample or --input is required')
  }
  const report = await buildM4StorageSnapshotCopyEvidenceReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM4StorageSnapshotCopyEvidenceCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
