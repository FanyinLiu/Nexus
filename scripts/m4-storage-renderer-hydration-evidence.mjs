#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildLocalStorageReadThroughDataResponse } from '../electron/ipc/storageIpc.js'
import {
  backupLocalStorageSnapshot,
  copyLocalStorageSnapshotToStructuredSqlite,
  queryLocalStorageReadThroughData,
  setLocalStorageReadThroughMode,
} from '../electron/services/sqliteStorage.js'
import { loadChatMemoryReadThroughSnapshot } from '../src/lib/storage/readThroughHydration.ts'

export const M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_GATE = 'nexus-v1-m4-storage-renderer-hydration-evidence'
export const DEFAULT_M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_FILE = 'artifacts/v1/m4-storage-renderer-hydration-evidence.json'

const SAMPLE_SENTINEL = 'M4_RENDERER_HYDRATION_SAMPLE_PRIVATE_SENTINEL_DO_NOT_COPY'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/m4-storage-renderer-hydration-evidence.mjs [options]',
    '',
    'Runs private-safe M4 renderer read-through hydration evidence.',
    'The report proves that a user-confirmed SQLite read-through data response',
    'is accepted by the renderer adapter without writing fallback localStorage.',
    'It records counts and safety flags only; it does not copy chat text, memory',
    'bodies, localStorage values, local paths, or backup contents.',
    '',
    'Input options:',
    '  --sample                         Use synthetic chat/memory localStorage data',
    '  --input <path>                   JSON payload exported from renderer localStorage, or - for stdin',
    '  --json <path>                    Alias for --input',
    '',
    'Other options:',
    '  --generated-at <iso>             Override report timestamp',
    `  --output <path>                  Write JSON report (default: ${DEFAULT_M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_FILE})`,
    '  --database <path>                Optional private SQLite database path',
    '  --backup-directory <path>        Optional private backup directory',
    '  --backup-id <id>                 Optional deterministic backup id',
    '  --copy-id <id>                   Optional deterministic copy id',
    '  --limit <number>                 Bounded data row limit (default: 500)',
    '  --keep-private-artifacts         Keep temporary SQLite and backup files',
    '  --require-ready                  Exit non-zero unless renderer hydration evidence is ready',
    '  --help                           Show this help',
    '',
    'Examples:',
    '  npm run m4:storage:renderer-hydration:evidence -- --sample --require-ready',
    '  npm run m4:storage:renderer-hydration:evidence -- --input artifacts/m4-local-storage-export.json --require-ready',
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

export function parseM4StorageRendererHydrationEvidenceArgs(argv) {
  const options = {
    backupDirectory: '',
    backupId: '',
    copyId: '',
    databasePath: '',
    generatedAt: '',
    help: false,
    inputPath: '',
    keepPrivateArtifacts: false,
    limit: 500,
    outputPath: DEFAULT_M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_FILE,
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
    evidenceSource: 'sample-m4-storage-renderer-hydration',
    entries: [
      {
        key: 'nexus:chat',
        value: JSON.stringify([
          {
            id: 'renderer-hydration-sample-chat-user',
            role: 'user',
            content: ` ${SAMPLE_SENTINEL}: chat line one `,
            createdAt: generatedAt,
          },
          {
            id: 'renderer-hydration-sample-chat-assistant',
            role: 'assistant',
            content: ` ${SAMPLE_SENTINEL}: assistant reply `,
            createdAt: normalizeIso(Date.parse(generatedAt) + 1000),
          },
        ]),
      },
      {
        key: 'nexus:memory:long-term',
        value: JSON.stringify([
          {
            id: 'renderer-hydration-sample-memory',
            content: ` ${SAMPLE_SENTINEL}: long term memory `,
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
              id: 'renderer-hydration-sample-daily-memory',
              role: 'user',
              content: ` ${SAMPLE_SENTINEL}: daily memory `,
              source: 'chat',
              createdAt: normalizeIso(Date.parse(generatedAt) + 3000),
            },
          ],
        }),
      },
      {
        key: 'nexus:autonomy:relationship',
        value: JSON.stringify({
          note: `${SAMPLE_SENTINEL}: relationship state remains outside renderer hydration evidence`,
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

function countDailyMemoryEntries(dailyMemories) {
  if (!dailyMemories || typeof dailyMemories !== 'object' || Array.isArray(dailyMemories)) return 0
  return Object.values(dailyMemories)
    .reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0)
}

function installRendererBridge(response) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const localStorageAccess = {
    getCount: 0,
    setCount: 0,
    removeCount: 0,
    clearCount: 0,
  }
  let requestPayload = null

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem() {
          localStorageAccess.getCount += 1
          return null
        },
        setItem() {
          localStorageAccess.setCount += 1
        },
        removeItem() {
          localStorageAccess.removeCount += 1
        },
        clear() {
          localStorageAccess.clearCount += 1
        },
      },
      desktopPet: {
        readLocalStorageReadThroughData: async (payload) => {
          requestPayload = payload
          return response
        },
      },
    },
    configurable: true,
    writable: true,
  })

  return {
    localStorageAccess,
    getRequestPayload: () => requestPayload,
    restore() {
      if (previousDescriptor) {
        Object.defineProperty(globalThis, 'window', previousDescriptor)
      } else {
        delete globalThis.window
      }
    },
  }
}

async function loadSnapshotWithBridge(response) {
  const bridge = installRendererBridge(response)
  try {
    const snapshot = await loadChatMemoryReadThroughSnapshot()
    return {
      snapshot,
      requestPayload: bridge.getRequestPayload(),
      localStorageAccess: { ...bridge.localStorageAccess },
    }
  } finally {
    bridge.restore()
  }
}

function summarizeRendererSnapshot(snapshot, safeRun, unsafeRun) {
  const requestDomains = Array.isArray(safeRun.requestPayload?.domains)
    ? [...safeRun.requestPayload.domains].map(cleanString).filter(Boolean).sort()
    : []
  const requestLimit = Number(safeRun.requestPayload?.limit || 0)
  const chatMessages = Array.isArray(snapshot?.chat?.messages) ? snapshot.chat.messages : []
  const chatSessions = Array.isArray(snapshot?.chat?.sessions) ? snapshot.chat.sessions : []
  const memories = Array.isArray(snapshot?.memory?.memories) ? snapshot.memory.memories : []
  const dailyMemories = snapshot?.memory?.dailyMemories || {}
  const dailyMemoryEntryCount = countDailyMemoryEntries(dailyMemories)
  const localStorageWriteCount = safeRun.localStorageAccess.setCount
    + safeRun.localStorageAccess.removeCount
    + safeRun.localStorageAccess.clearCount
    + unsafeRun.localStorageAccess.setCount
    + unsafeRun.localStorageAccess.removeCount
    + unsafeRun.localStorageAccess.clearCount

  return {
    ok: Boolean(snapshot)
      && requestDomains.includes('chat')
      && requestDomains.includes('memory')
      && requestLimit === 500
      && chatMessages.length > 0
      && memories.length > 0
      && dailyMemoryEntryCount > 0
      && localStorageWriteCount === 0
      && unsafeRun.snapshot === null,
    hydrationAttempted: true,
    snapshotReturned: Boolean(snapshot),
    adapterAcceptedConfirmedResponse: Boolean(snapshot),
    unsafePrivacyResponseRejected: unsafeRun.snapshot === null,
    requestDomains,
    requestLimit,
    chatMessageCount: chatMessages.length,
    chatSessionCount: chatSessions.length,
    memoryCount: memories.length,
    dailyMemoryDayCount: Object.keys(dailyMemories).length,
    dailyMemoryEntryCount,
    readableRowCount: Number(snapshot?.metadata?.readableRowCount || 0),
    returnedRowCount: Number(snapshot?.metadata?.returnedRowCount || 0),
    contentNormalized: chatMessages.every((message) => message.content === message.content.trim())
      && memories.every((memory) => memory.content === memory.content.trim())
      && Object.values(dailyMemories).every((entries) => (
        Array.isArray(entries) && entries.every((entry) => entry.content === entry.content.trim())
      )),
    fallbackLocalStorageGetCount: safeRun.localStorageAccess.getCount + unsafeRun.localStorageAccess.getCount,
    fallbackLocalStorageSetCount: safeRun.localStorageAccess.setCount + unsafeRun.localStorageAccess.setCount,
    fallbackLocalStorageRemoveCount: safeRun.localStorageAccess.removeCount + unsafeRun.localStorageAccess.removeCount,
    fallbackLocalStorageClearCount: safeRun.localStorageAccess.clearCount + unsafeRun.localStorageAccess.clearCount,
    fallbackLocalStorageWritten: localStorageWriteCount > 0,
    fallbackLocalStorageMutated: localStorageWriteCount > 0,
  }
}

export async function buildM4StorageRendererHydrationEvidenceReport(options = {}, context = {}) {
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
  const tempRoot = context.tempRoot || await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-m4-storage-renderer-hydration-'))
  const ownsTempRoot = !context.tempRoot
  const databasePath = resolveOptionalPath(rootDir, options.databasePath) || path.join(tempRoot, 'storage.sqlite3')
  const backupDirectory = resolveOptionalPath(rootDir, options.backupDirectory) || path.join(tempRoot, 'backups')
  const keepPrivateArtifacts = Boolean(options.keepPrivateArtifacts || options.databasePath || options.backupDirectory)
  const backupId = cleanString(options.backupId) || `m4-storage-renderer-hydration-backup-${idSuffix(generatedAt)}`
  const copyId = cleanString(options.copyId) || `m4-storage-renderer-hydration-copy-${idSuffix(generatedAt)}`
  const dataLimit = options.limit == null ? 500 : Number(options.limit)

  try {
    const backup = await backupLocalStorageSnapshot({
      reason: 'm4-renderer-hydration-evidence',
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

    const mode = await setLocalStorageReadThroughMode({
      enabled: true,
      userConfirmed: true,
      backupId,
      copyId,
      domains: ['chat', 'memory'],
      reason: 'm4-renderer-hydration-evidence',
      confirmedAt: normalizeIso(Date.parse(generatedAt) + 2000),
    }, {
      databasePath,
      generatedAt: normalizeIso(Date.parse(generatedAt) + 2000),
    })

    const data = await queryLocalStorageReadThroughData({
      domains: ['chat', 'memory'],
      limit: dataLimit,
    }, {
      databasePath,
      generatedAt: normalizeIso(Date.parse(generatedAt) + 3000),
    })
    const ipcResponse = buildLocalStorageReadThroughDataResponse(data)
    const safeRun = await loadSnapshotWithBridge(ipcResponse)
    const unsafeResponse = {
      ...ipcResponse,
      privacy: {
        ...ipcResponse.privacy,
        valuesCopiedToAuditLog: true,
      },
    }
    const unsafeRun = await loadSnapshotWithBridge(unsafeResponse)
    const renderer = summarizeRendererSnapshot(safeRun.snapshot, safeRun, unsafeRun)

    const reportBase = {
      schemaVersion: 1,
      gate: M4_STORAGE_RENDERER_HYDRATION_EVIDENCE_GATE,
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
        chatMessageCount: Number(copy.chatMessageCount || 0),
        memoryCount: Number(copy.memoryCount || 0),
        dailyMemoryEntryCount: Number(copy.dailyMemoryEntryCount || 0),
        runtimeMigrationEnabled: copy.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: copy.readThroughMigrationEnabled === true,
        sourceLocalStoragePreserved: copy.sourceLocalStoragePreserved === true,
        valuesCopiedToResponse: copy.valuesCopiedToResponse === true,
      },
      mode: {
        ok: mode.ok === true,
        status: cleanString(mode.status),
        enabled: mode.enabled === true,
        userConfirmed: mode.userConfirmed === true,
        chatReadable: mode.chatReadable === true,
        memoryReadable: mode.memoryReadable === true,
        readableRowCount: Number(mode.readableRowCount || 0),
        runtimeMigrationEnabled: mode.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: mode.readThroughMigrationEnabled === true,
        sourceLocalStoragePreserved: mode.sourceLocalStoragePreserved === true,
        sourceLocalStorageMutated: mode.sourceLocalStorageMutated === true,
        valuesCopiedToResponse: mode.valuesCopiedToResponse === true,
      },
      data: {
        ok: ipcResponse.ok === true,
        status: cleanString(ipcResponse.status),
        domains: Array.isArray(ipcResponse.domains) ? [...ipcResponse.domains].sort() : [],
        limit: Number(ipcResponse.limit || 0),
        chatMessageCount: Number(ipcResponse.chat?.messageCount || 0),
        returnedChatMessageCount: Number(ipcResponse.chat?.returnedMessageCount || 0),
        memoryCount: Number(ipcResponse.memory?.memoryCount || 0),
        returnedMemoryCount: Number(ipcResponse.memory?.returnedMemoryCount || 0),
        dailyMemoryEntryCount: Number(ipcResponse.memory?.dailyMemoryEntryCount || 0),
        returnedDailyMemoryEntryCount: Number(ipcResponse.memory?.returnedDailyMemoryEntryCount || 0),
        readableRowCount: Number(ipcResponse.totals?.readableRowCount || 0),
        returnedRowCount: Number(ipcResponse.totals?.returnedRowCount || 0),
        runtimeMigrationEnabled: ipcResponse.migrationPlan?.runtimeMigrationEnabled === true,
        readThroughMigrationEnabled: ipcResponse.migrationPlan?.readThroughMigrationEnabled === true,
        userConfirmedReadThroughMode: ipcResponse.migrationPlan?.userConfirmedReadThroughMode === true,
        sourceLocalStoragePreserved: ipcResponse.migrationPlan?.sourceLocalStoragePreserved === true,
        destructiveMigrationDetected: ipcResponse.migrationPlan?.destructiveMigrationDetected === true,
        fallbackLocalStorageSupported: ipcResponse.migrationPlan?.fallbackLocalStorageSupported === true,
        containsUserData: ipcResponse.privacy?.containsUserData === true,
        sqliteValuesReturned: ipcResponse.privacy?.sqliteValuesReturned === true,
        localStorageRawValuesReturned: ipcResponse.privacy?.localStorageRawValuesReturned === true,
        absolutePathExposed: ipcResponse.privacy?.absolutePathExposed === true,
        sourceLocalStorageMutated: ipcResponse.privacy?.sourceLocalStorageMutated === true,
        valuesCopiedToAuditLog: ipcResponse.privacy?.valuesCopiedToAuditLog === true,
      },
      renderer,
      migrationPlan: {
        snapshotBackupEvidenceReady: backup.ok === true,
        structuredCopyEvidenceReady: copy.ok === true && Number(copy.copiedItemCount || 0) > 0,
        readThroughModeEnabled: mode.ok === true && mode.enabled === true && mode.userConfirmed === true,
        readThroughDataIpcResponseReady: ipcResponse.ok === true
          && ipcResponse.migrationPlan?.readThroughMigrationEnabled === true
          && ipcResponse.migrationPlan?.userConfirmedReadThroughMode === true
          && ipcResponse.privacy?.containsUserData === true
          && ipcResponse.privacy?.sqliteValuesReturned === true,
        rendererReadThroughHydrationEvidenceReady: renderer.ok === true,
        runtimeMigrationEnabled: false,
        readThroughMigrationEnabled: true,
        userConfirmedReadThroughMode: true,
        sourceLocalStoragePreserved: backup.sourceLocalStoragePreserved === true
          && copy.sourceLocalStoragePreserved === true
          && mode.sourceLocalStoragePreserved === true
          && ipcResponse.migrationPlan?.sourceLocalStoragePreserved === true,
        destructiveMigrationDetected: false,
        fallbackLocalStorageSupported: ipcResponse.migrationPlan?.fallbackLocalStorageSupported === true,
        rendererFallbackLocalStorageWritebackBlocked: renderer.fallbackLocalStorageWritten === false,
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
      ...(reportBase.mode.ok && reportBase.mode.enabled ? [] : ['read-through-mode-not-enabled']),
      ...(reportBase.mode.userConfirmed ? [] : ['read-through-mode-not-user-confirmed']),
      ...(reportBase.data.ok ? [] : ['read-through-data-response-failed']),
      ...(reportBase.data.containsUserData && reportBase.data.sqliteValuesReturned ? [] : ['read-through-data-user-data-not-disclosed']),
      ...(reportBase.data.localStorageRawValuesReturned ? ['raw-localstorage-values-returned'] : []),
      ...(reportBase.data.absolutePathExposed ? ['absolute-path-exposed'] : []),
      ...(reportBase.data.valuesCopiedToAuditLog ? ['values-copied-to-audit-log'] : []),
      ...(reportBase.renderer.snapshotReturned ? [] : ['renderer-hydration-empty']),
      ...(reportBase.renderer.chatMessageCount > 0 ? [] : ['renderer-chat-not-hydrated']),
      ...(reportBase.renderer.memoryCount > 0 ? [] : ['renderer-memory-not-hydrated']),
      ...(reportBase.renderer.dailyMemoryEntryCount > 0 ? [] : ['renderer-daily-memory-not-hydrated']),
      ...(reportBase.renderer.unsafePrivacyResponseRejected ? [] : ['renderer-unsafe-response-not-rejected']),
      ...(reportBase.renderer.fallbackLocalStorageWritten ? ['renderer-localstorage-writeback-detected'] : []),
      ...(reportBase.migrationPlan.sourceLocalStoragePreserved ? [] : ['source-localstorage-not-preserved']),
      ...(reportBase.backup.runtimeMigrationEnabled || reportBase.copy.runtimeMigrationEnabled || reportBase.mode.runtimeMigrationEnabled || reportBase.data.runtimeMigrationEnabled ? ['runtime-migration-enabled'] : []),
      ...(reportBase.data.destructiveMigrationDetected ? ['destructive-migration-detected'] : []),
      ...(valuesCopiedToReport ? ['input-values-copied-to-report'] : []),
    ]
    const ok = blockingIssueIds.length === 0

    return {
      ...reportBase,
      ok,
      overallStatus: ok ? 'renderer-hydration-evidence-ready' : 'renderer-hydration-evidence-not-ready',
      input: {
        ...reportBase.input,
        valuesCopiedToReport,
      },
      privacy: {
        artifactContentsCopied: false,
        localStorageValuesCopiedToReport: valuesCopiedToReport,
        rendererHydratedContentCopiedToReport: valuesCopiedToReport,
        sqliteValuesReturnedToRenderer: reportBase.data.sqliteValuesReturned,
        containsUserDataInRendererResponse: reportBase.data.containsUserData,
        localStorageRawValuesReturned: reportBase.data.localStorageRawValuesReturned,
        absolutePathsExposed: false,
        sourceLocalStorageMutated: false,
        rendererFallbackLocalStorageWritten: reportBase.renderer.fallbackLocalStorageWritten,
        valuesCopiedToAuditLog: reportBase.data.valuesCopiedToAuditLog,
        privateFieldsOmitted: [
          'chat messages and transcripts',
          'chat session titles',
          'memory bodies and source refs',
          'relationship notes and state values',
          'localStorage raw values',
          'private SQLite database path',
          'private backup directory path',
          'backup file contents',
          'renderer hydrated content',
        ],
      },
      blockingIssueIds,
      nextActions: ok
        ? [
            ...(options.sample ? ['run-renderer-hydration-evidence-against-real-renderer-export'] : []),
            'wire-chat-memory-writes-to-main-process-store-with-localstorage-fallback',
          ]
        : [
            'fix-renderer-read-through-hydration-evidence',
            'rerun-m4-storage-renderer-hydration-evidence',
          ],
    }
  } finally {
    if (ownsTempRoot && !keepPrivateArtifacts) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  }
}

export async function runM4StorageRendererHydrationEvidenceCli(argv = process.argv.slice(2), context = {}) {
  const options = parseM4StorageRendererHydrationEvidenceArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  if (!options.sample && !options.inputPath && !options.entries) {
    throw new Error('--sample or --input is required')
  }
  const report = await buildM4StorageRendererHydrationEvidenceReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM4StorageRendererHydrationEvidenceCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
