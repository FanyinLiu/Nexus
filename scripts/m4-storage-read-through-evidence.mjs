#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  backupLocalStorageSnapshot,
  copyLocalStorageSnapshotToStructuredSqlite,
  queryLocalStorageReadThroughPreview,
} from '../electron/services/sqliteStorage.js'

export const M4_STORAGE_READ_THROUGH_EVIDENCE_GATE = 'nexus-v1-m4-storage-read-through-evidence'
export const DEFAULT_M4_STORAGE_READ_THROUGH_EVIDENCE_FILE = 'artifacts/v1/m4-storage-read-through-evidence.json'

const SAMPLE_SENTINEL = 'M4_READ_THROUGH_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m4-storage-read-through-evidence.mjs [options]',
    '',
    'Runs a private-safe M4 localStorage snapshot backup, structured SQLite copy,',
    'and main-process read-through preview query evidence check.',
    'The report records keys, counts, and readiness flags only; it does not copy',
    'chat text, memory bodies, relationship notes, local paths, or backup files.',
    '',
    'Input options:',
    '  --sample                         Use synthetic chat/memory localStorage data',
    '  --input <path>                   JSON payload exported from renderer localStorage, or - for stdin',
    '  --json <path>                    Alias for --input',
    '',
    'Other options:',
    '  --generated-at <iso>             Override report timestamp',
    `  --output <path>                  Write JSON report (default: ${DEFAULT_M4_STORAGE_READ_THROUGH_EVIDENCE_FILE})`,
    '  --database <path>                Optional private SQLite database path',
    '  --backup-directory <path>        Optional private backup directory',
    '  --backup-id <id>                 Optional deterministic backup id',
    '  --copy-id <id>                   Optional deterministic copy id',
    '  --limit <number>                 Bounded preview row limit (default: 100)',
    '  --keep-private-artifacts         Keep temporary SQLite and backup files',
    '  --require-ready                  Exit non-zero unless read-through evidence is ready',
    '  --help                           Show this help',
    '',
    'Examples:',
    '  npm run m4:storage:read-through:evidence -- --sample --require-ready',
    '  npm run m4:storage:read-through:evidence -- --input artifacts/m4-local-storage-export.json --require-ready',
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

export function parseM4StorageReadThroughEvidenceArgs(argv) {
  const options = {
    backupDirectory: '',
    backupId: '',
    copyId: '',
    databasePath: '',
    generatedAt: '',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: false,
    limit: 100,
    outputPath: DEFAULT_M4_STORAGE_READ_THROUGH_EVIDENCE_FILE,
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
      } else if (name === '--limit') {
        options.limit = Number(parsed.value)
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
    evidenceSource: 'sample-m4-storage-read-through',
    entries: [
      {
        key: 'nexus:chat',
        value: JSON.stringify([
          {
            id: 'read-through-sample-chat-user',
            role: 'user',
            content: `${SAMPLE_SENTINEL}: flat chat line one`,
            createdAt: generatedAt,
          },
          {
            id: 'read-through-sample-chat-assistant',
            role: 'assistant',
            content: `${SAMPLE_SENTINEL}: assistant reply`,
            createdAt: normalizeIso(Date.parse(generatedAt) + 1000),
          },
        ]),
      },
      {
        key: 'nexus:memory:long-term',
        value: JSON.stringify([
          {
            id: 'read-through-sample-memory',
            content: `${SAMPLE_SENTINEL}: long term memory`,
            category: 'preference',
            source: 'chat',
            createdAt: normalizeIso(Date.parse(generatedAt) + 2000),
            importance: 'high',
          },
        ]),
      },
      {
        key: 'nexus:memory:daily',
        value: JSON.stringify({
          [generatedAt.slice(0, 10)]: [
            {
              id: 'read-through-sample-daily-memory',
              role: 'user',
              content: `${SAMPLE_SENTINEL}: daily memory`,
              source: 'chat',
              createdAt: normalizeIso(Date.parse(generatedAt) + 3000),
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

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8')
}

function idSuffix(generatedAt) {
  const parsed = Date.parse(generatedAt)
  return Number.isFinite(parsed) ? String(parsed) : String(Date.now())
}

function resolveOptionalPath(rootDir, maybePath) {
  const target = cleanString(maybePath)
  return target ? path.resolve(rootDir, target) : ''
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

export async function buildM4StorageReadThroughEvidenceReport(options = {}, context = {}) {
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
  const tempRoot = context.tempRoot || await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-read-through-'))
  const ownsTempRoot = !context.tempRoot
  const databasePath = resolveOptionalPath(rootDir, options.databasePath) || path.join(tempRoot, 'storage.sqlite3')
  const backupDirectory = resolveOptionalPath(rootDir, options.backupDirectory) || path.join(tempRoot, 'backups')
  const keepPrivateArtifacts = Boolean(options.keepPrivateArtifacts || options.databasePath || options.backupDirectory)
  const backupId = cleanString(options.backupId) || `m4-storage-read-through-backup-${idSuffix(generatedAt)}`
  const copyId = cleanString(options.copyId) || `m4-storage-read-through-copy-${idSuffix(generatedAt)}`
  const previewLimit = options.limit == null ? 100 : Number(options.limit)

  try {
    const backup = await backupLocalStorageSnapshot({
      reason: 'm4-read-through-evidence',
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

    const preview = await queryLocalStorageReadThroughPreview({
      backupId,
      copyId,
      domains: ['chat', 'memory'],
      limit: previewLimit,
    }, {
      databasePath,
      generatedAt: normalizeIso(Date.parse(generatedAt) + 2000),
    })

    const reportBase = {
      schemaVersion: 1,
      gate: M4_STORAGE_READ_THROUGH_EVIDENCE_GATE,
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
        runtimeMigrationEnabled: copy.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: copy.readThroughMigrationEnabled === true,
        sourceLocalStoragePreserved: copy.sourceLocalStoragePreserved === true,
        valuesCopiedToResponse: copy.valuesCopiedToResponse === true,
      },
      readThrough: {
        ok: preview.ok === true,
        status: cleanString(preview.status),
        previewQueryEnabled: preview.previewQueryEnabled === true,
        copyStatus: cleanString(preview.copyStatus),
        domains: Array.isArray(preview.domains) ? [...preview.domains].sort() : [],
        limit: Number(preview.limit || 0),
        sourceStorageKeyCount: Number(preview.source?.sourceStorageKeyCount || 0),
        sourceStorageKeys: Array.isArray(preview.source?.sourceStorageKeys)
          ? [...preview.source.sourceStorageKeys].sort()
          : [],
        copyItemCount: Number(preview.source?.copyItemCount || 0),
        chatReadable: preview.chat?.hasReadableRows === true,
        chatSessionCount: Number(preview.chat?.sessionCount || 0),
        chatMessageCount: Number(preview.chat?.messageCount || 0),
        sampledChatMessageCount: Number(preview.chat?.sampledMessageCount || 0),
        latestChatMessageAtPresent: Boolean(cleanString(preview.chat?.latestMessageAt)),
        memoryReadable: preview.memory?.hasReadableRows === true,
        memoryCount: Number(preview.memory?.memoryCount || 0),
        dailyMemoryEntryCount: Number(preview.memory?.dailyMemoryEntryCount || 0),
        sampledMemoryCount: Number(preview.memory?.sampledMemoryCount || 0),
        sampledDailyMemoryEntryCount: Number(preview.memory?.sampledDailyMemoryEntryCount || 0),
        latestMemoryCreatedAtPresent: Boolean(cleanString(preview.memory?.latestMemoryCreatedAt)),
        latestDailyMemoryEntryAtPresent: Boolean(cleanString(preview.memory?.latestDailyMemoryEntryAt)),
        readableRowCount: Number(preview.totals?.readableRowCount || 0),
        runtimeMigrationEnabled: preview.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: preview.readThroughMigrationEnabled === true,
        sourceLocalStoragePreserved: preview.sourceLocalStoragePreserved === true,
        valuesCopiedToResponse: preview.valuesCopiedToResponse === true,
      },
      migrationPlan: {
        snapshotBackupEvidenceReady: backup.ok === true,
        structuredCopyEvidenceReady: copy.ok === true && Number(copy.copiedItemCount || 0) > 0,
        readThroughPreviewEvidenceReady: preview.ok === true
          && preview.previewQueryEnabled === true
          && preview.chat?.hasReadableRows === true
          && preview.memory?.hasReadableRows === true,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: false,
        previewQueryEnabled: true,
        sourceLocalStoragePreserved: backup.sourceLocalStoragePreserved === true
          && copy.sourceLocalStoragePreserved === true
          && preview.sourceLocalStoragePreserved === true,
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
      ...(reportBase.readThrough.ok ? [] : ['read-through-preview-query-failed']),
      ...(reportBase.readThrough.previewQueryEnabled ? [] : ['read-through-preview-not-enabled']),
      ...(reportBase.readThrough.chatReadable ? [] : ['chat-read-through-preview-empty']),
      ...(reportBase.readThrough.memoryReadable ? [] : ['memory-read-through-preview-empty']),
      ...(reportBase.migrationPlan.sourceLocalStoragePreserved ? [] : ['source-localstorage-not-preserved']),
      ...(reportBase.backup.runtimeMigrationEnabled || reportBase.copy.runtimeMigrationEnabled || reportBase.readThrough.runtimeMigrationEnabled ? ['runtime-migration-enabled'] : []),
      ...(reportBase.backup.readThroughMigrationEnabled || reportBase.copy.readThroughMigrationEnabled || reportBase.readThrough.readThroughMigrationEnabled ? ['read-through-migration-enabled'] : []),
      ...(reportBase.backup.valuesCopiedToResponse || reportBase.copy.valuesCopiedToResponse || reportBase.readThrough.valuesCopiedToResponse ? ['values-copied-to-response'] : []),
      ...(valuesCopiedToReport ? ['input-values-copied-to-report'] : []),
    ]
    const ok = blockingIssueIds.length === 0

    return {
      ...reportBase,
      ok,
      overallStatus: ok ? 'read-through-evidence-ready' : 'read-through-evidence-not-ready',
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
          'chat session titles',
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
            'wire-runtime-read-through-behind-user-confirmed-feature-flag',
            'add-schema-downgrade-cli-fixtures',
          ]
        : [
            'fix-main-process-read-through-preview-evidence',
            'rerun-m4-storage-read-through-evidence',
          ],
    }
  } finally {
    if (ownsTempRoot && !keepPrivateArtifacts) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  }
}

export async function runM4StorageReadThroughEvidenceCli(argv = process.argv.slice(2), context = {}) {
  const options = parseM4StorageReadThroughEvidenceArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  if (!options.sample && !options.inputPath && !options.entries) {
    throw new Error('--sample or --input is required')
  }
  const report = await buildM4StorageReadThroughEvidenceReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM4StorageReadThroughEvidenceCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
