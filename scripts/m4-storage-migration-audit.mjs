#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const M4_STORAGE_MIGRATION_GATE = 'nexus-v1-m4-storage-migration-inventory'
export const DEFAULT_M4_STORAGE_MIGRATION_FILE = 'artifacts/v1/m4-storage-migration.json'
export const M4_SQLITE_FOUNDATION_GATE = 'nexus-v1-m4-sqlite-foundation'
export const DEFAULT_M4_SQLITE_FOUNDATION_FILE = 'artifacts/v1/m4-sqlite-foundation.json'
export const M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_GATE = 'nexus-v1-m4-storage-snapshot-copy-evidence'
export const DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE = 'artifacts/v1/m4-storage-snapshot-copy-evidence.json'

const SOURCE_DIRS = ['src', 'electron']
const PACKAGE_JSON_PATH = 'package.json'
const STORAGE_CORE_PATH = 'src/lib/storage/core.ts'

const REQUIRED_MIGRATION_DOMAINS = [
  'chat',
  'memory',
  'permissions-settings',
  'audit-logs',
]

const SQLITE_DEPENDENCY_NAMES = [
  'better-sqlite3',
  'sqlite',
  'sqlite3',
  '@sqlite.org/sqlite-wasm',
]

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m4-storage-migration-audit.mjs [options]',
    '',
    'Builds a private-safe M4 localStorage-to-SQLite migration inventory.',
    '',
    'Options:',
    '  --generated-at <iso>          Override report timestamp',
    `  --output <path>               Write JSON report (default: ${DEFAULT_M4_STORAGE_MIGRATION_FILE})`,
    `  --sqlite-foundation-file <path>`,
    `                                Optional SQLite foundation report (default: ${DEFAULT_M4_SQLITE_FOUNDATION_FILE})`,
    `  --snapshot-copy-evidence-file <path>`,
    `                                Optional backup+structured-copy evidence report (default: ${DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE})`,
    '  --require-inventory-ready     Exit non-zero unless the storage inventory is ready',
    '  --require-migration-ready     Also require a real SQLite migration/rollback implementation',
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

export function parseM4StorageMigrationArgs(argv) {
  const options = {
    generatedAt: '',
    help: false,
    outputPath: DEFAULT_M4_STORAGE_MIGRATION_FILE,
    requireInventoryReady: false,
    requireMigrationReady: false,
    snapshotCopyEvidenceFile: DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE,
    sqliteFoundationFile: DEFAULT_M4_SQLITE_FOUNDATION_FILE,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--require-inventory-ready' || arg === '--require-ready') {
      options.requireInventoryReady = true
      continue
    }
    if (arg === '--require-migration-ready') {
      options.requireMigrationReady = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      if (name === '--generated-at') {
        options.generatedAt = parsed.value
      } else if (name === '--output' || name === '--output-file') {
        options.outputPath = parsed.value
      } else if (name === '--sqlite-foundation-file' || name === '--m4-sqlite-foundation-file') {
        options.sqliteFoundationFile = parsed.value
      } else if (name === '--snapshot-copy-evidence-file' || name === '--m4-storage-snapshot-copy-evidence-file') {
        options.snapshotCopyEvidenceFile = parsed.value
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

async function readJsonStatus(rootDir, relativePath) {
  const target = cleanString(relativePath)
  try {
    const text = await fs.readFile(path.resolve(rootDir, target), 'utf8')
    return {
      exists: true,
      path: target,
      value: JSON.parse(text),
      error: null,
    }
  } catch (error) {
    return {
      exists: false,
      path: target,
      value: null,
      error: error?.code === 'ENOENT' ? 'missing' : 'read-failed',
    }
  }
}

async function listSourceFiles(rootDir, relativeDir) {
  const dir = path.resolve(rootDir, relativeDir)
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'release') continue
    const relativePath = path.posix.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(rootDir, relativePath))
    } else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

function lineForIndex(source, index) {
  return source.slice(0, index).split('\n').length
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function classifyStorageKey(key) {
  if (/chat|lorebook|pending-greeting/.test(key)) return 'chat'
  if (/memory|letters|arc:open-threads|capsule/.test(key)) return 'memory'
  if (/settings|auth|consent|safety|onboarding|vts-auth-token|provider-failover/.test(key)) {
    return 'permissions-settings'
  }
  if (/debug|trace|event|proactive|agent|task|goal|emotion|relationship|guidance|presence-history|cost|budget|voice-trace/.test(key)) {
    return 'audit-logs'
  }
  if (/runtime|presence|voice-pipeline|pet-window|metering|modelSetup|useTtsPipeline/.test(key)) {
    return 'runtime-cache'
  }
  return 'other'
}

function migrationPriorityForDomain(domain) {
  switch (domain) {
    case 'chat':
    case 'memory':
      return 'p0'
    case 'permissions-settings':
    case 'audit-logs':
      return 'p1'
    case 'runtime-cache':
      return 'p2'
    default:
      return 'p3'
  }
}

function extractStorageKeys(source, relativePath) {
  const entries = []
  const constantRegex = /\b(?:export\s+)?const\s+([A-Z0-9_]*STORAGE_KEY[A-Z0-9_]*|STORAGE_KEY)\s*=\s*(['"`])(nexus[^'"`]+)\2/g
  for (const match of source.matchAll(constantRegex)) {
    const key = cleanString(match[3])
    const domain = classifyStorageKey(key)
    entries.push({
      key,
      constantName: cleanString(match[1]),
      file: relativePath,
      line: lineForIndex(source, match.index ?? 0),
      domain,
      migrationPriority: migrationPriorityForDomain(domain),
      source: relativePath === STORAGE_CORE_PATH ? 'storage-core' : 'feature-local',
    })
  }

  const literalRegex = /(?:localStorage|window\.localStorage|sessionStorage|window\.sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*(['"`])(nexus[^'"`]+)\1/g
  for (const match of source.matchAll(literalRegex)) {
    const key = cleanString(match[2])
    if (entries.some((entry) => entry.key === key && entry.file === relativePath)) continue
    const domain = classifyStorageKey(key)
    entries.push({
      key,
      constantName: '',
      file: relativePath,
      line: lineForIndex(source, match.index ?? 0),
      domain,
      migrationPriority: migrationPriorityForDomain(domain),
      source: 'literal-storage-use',
    })
  }

  return entries
}

function extractDirectStorageAccesses(source, relativePath) {
  const directRegex = /\b(?:window\.)?(localStorage|sessionStorage)\.(getItem|setItem|removeItem|clear)\s*\(/g
  return [...source.matchAll(directRegex)].map((match) => ({
    file: relativePath,
    line: lineForIndex(source, match.index ?? 0),
    storageKind: match[1],
    operation: match[2],
    insideStorageCore: relativePath === STORAGE_CORE_PATH,
  }))
}

function summarizeDomainCoverage(storageKeys) {
  return REQUIRED_MIGRATION_DOMAINS.map((domain) => {
    const keys = storageKeys.filter((entry) => entry.domain === domain)
    return {
      domain,
      keyCount: unique(keys.map((entry) => entry.key)).length,
      sourceFileCount: unique(keys.map((entry) => entry.file)).length,
      covered: keys.length > 0,
      migrationPriority: migrationPriorityForDomain(domain),
    }
  })
}

function isSqliteFoundationReady(sqliteFoundationSource) {
  const raw = sqliteFoundationSource?.value
  const missingTables = Array.isArray(raw?.database?.missingTables) ? raw.database.missingTables : []
  return sqliteFoundationSource?.exists === true
    && raw?.gate === M4_SQLITE_FOUNDATION_GATE
    && raw?.ok === true
    && raw?.sqlite?.engine === 'node:sqlite'
    && missingTables.length === 0
}

function isLocalStorageSnapshotBackupReady(sqliteFoundationSource) {
  const raw = sqliteFoundationSource?.value
  return isSqliteFoundationReady(sqliteFoundationSource)
    && raw?.migrationPlan?.localStorageSnapshotBackupReady === true
    && raw?.ipcStatus?.snapshotBackup?.ready === true
}

function isLocalStorageStructuredCopyReady(sqliteFoundationSource) {
  const raw = sqliteFoundationSource?.value
  return isLocalStorageSnapshotBackupReady(sqliteFoundationSource)
    && raw?.migrationPlan?.localStorageStructuredCopyReady === true
    && raw?.ipcStatus?.structuredCopy?.ready === true
}

function isLocalStorageSnapshotCopyEvidenceReady(snapshotCopyEvidenceSource) {
  const raw = snapshotCopyEvidenceSource?.value
  return snapshotCopyEvidenceSource?.exists === true
    && raw?.gate === M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_GATE
    && raw?.ok === true
    && raw?.backup?.ok === true
    && raw?.copy?.ok === true
    && raw?.copy?.failedItemCount === 0
    && raw?.copy?.copiedItemCount > 0
    && raw?.migrationPlan?.snapshotBackupEvidenceReady === true
    && raw?.migrationPlan?.structuredCopyEvidenceReady === true
    && raw?.migrationPlan?.runtimeMigrationEnabled === false
    && raw?.migrationPlan?.readThroughMigrationEnabled === false
    && raw?.migrationPlan?.sourceLocalStoragePreserved === true
    && raw?.privacy?.localStorageValuesCopiedToReport === false
    && raw?.privacy?.absolutePathsExposed === false
    && raw?.privacy?.sourceLocalStorageMutated === false
}

function summarizeDependencyStatus(packageSource, sqliteFoundationSource) {
  const deps = {
    ...(packageSource.value?.dependencies ?? {}),
    ...(packageSource.value?.devDependencies ?? {}),
    ...(packageSource.value?.optionalDependencies ?? {}),
  }
  const selectedDependencies = SQLITE_DEPENDENCY_NAMES.filter((name) => (
    typeof deps[name] === 'string' && deps[name].length > 0
  ))
  const foundationReady = isSqliteFoundationReady(sqliteFoundationSource)
  return {
    status: foundationReady
      ? 'selected-built-in'
      : selectedDependencies.length > 0
        ? 'selected'
        : 'not-selected',
    selectedDependencies: foundationReady ? ['node:sqlite'] : selectedDependencies,
    requiresDependencyReview: foundationReady ? false : selectedDependencies.length === 0,
    foundationEvidencePath: sqliteFoundationSource?.path || DEFAULT_M4_SQLITE_FOUNDATION_FILE,
    foundationReady,
    note: foundationReady
      ? 'Built-in node:sqlite foundation is ready; keep fallback and packaging evidence before enabling runtime migration.'
      : selectedDependencies.length > 0
      ? 'SQLite dependency is present; packaging and native-module behavior still need review.'
      : 'No SQLite dependency is selected yet; M4 must review packaging, native module, and cross-platform update impact before adding one.',
  }
}

export async function buildM4StorageMigrationReport(options = {}, context = {}) {
  const rootDir = context.rootDir || process.cwd()
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const packageSource = await readJsonStatus(rootDir, PACKAGE_JSON_PATH)
  const sqliteFoundationSource = await readJsonStatus(
    rootDir,
    options.sqliteFoundationFile || DEFAULT_M4_SQLITE_FOUNDATION_FILE,
  )
  const snapshotCopyEvidenceSource = await readJsonStatus(
    rootDir,
    options.snapshotCopyEvidenceFile || DEFAULT_M4_STORAGE_SNAPSHOT_COPY_EVIDENCE_FILE,
  )
  const sourceFiles = (await Promise.all(SOURCE_DIRS.map((dir) => listSourceFiles(rootDir, dir)))).flat()
  const sources = await Promise.all(sourceFiles.map(async (relativePath) => ({
    relativePath,
    source: await fs.readFile(path.resolve(rootDir, relativePath), 'utf8'),
  })))
  const storageKeys = sources
    .flatMap(({ relativePath, source }) => extractStorageKeys(source, relativePath))
    .sort((a, b) => a.key.localeCompare(b.key) || a.file.localeCompare(b.file) || a.line - b.line)
  const uniqueStorageKeys = unique(storageKeys.map((entry) => entry.key))
  const directStorageAccesses = sources
    .flatMap(({ relativePath, source }) => extractDirectStorageAccesses(source, relativePath))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const directStorageOutsideCore = directStorageAccesses.filter((entry) => !entry.insideStorageCore)
  const domainCoverage = summarizeDomainCoverage(storageKeys)
  const missingDomainIds = domainCoverage
    .filter((entry) => !entry.covered)
    .map((entry) => entry.domain)
  const sqliteDependency = summarizeDependencyStatus(packageSource, sqliteFoundationSource)
  const localStorageSnapshotBackupReady = isLocalStorageSnapshotBackupReady(sqliteFoundationSource)
  const localStorageStructuredCopyReady = isLocalStorageStructuredCopyReady(sqliteFoundationSource)
  const localStorageSnapshotCopyEvidenceReady = isLocalStorageSnapshotCopyEvidenceReady(snapshotCopyEvidenceSource)

  const migrationReady = false
  const inventoryReady = packageSource.exists
    && storageKeys.length > 0
    && missingDomainIds.length === 0
  const blockingIssueIds = [
    ...(!packageSource.exists ? ['package-json-missing'] : []),
    ...(storageKeys.length === 0 ? ['storage-key-inventory-empty'] : []),
    ...missingDomainIds.map((domain) => `missing-domain:${domain}`),
    ...(options.requireMigrationReady && !migrationReady ? ['sqlite-migration-not-implemented'] : []),
  ]
  const ok = blockingIssueIds.length === 0

  return {
    schemaVersion: 1,
    gate: M4_STORAGE_MIGRATION_GATE,
    generatedAt,
    ok,
    overallStatus: migrationReady
      ? 'migration-ready'
      : inventoryReady
        ? 'inventory-ready-migration-not-started'
        : 'needs-storage-inventory-work',
    targetMilestone: 'M4',
    inventoryReady,
    migrationReady,
    totals: {
      storageKeyReferenceCount: storageKeys.length,
      uniqueStorageKeyCount: uniqueStorageKeys.length,
      sourceFileCount: sourceFiles.length,
      storageSourceFileCount: unique(storageKeys.map((entry) => entry.file)).length,
      directStorageAccessCount: directStorageAccesses.length,
      directStorageAccessOutsideCoreCount: directStorageOutsideCore.length,
    },
    domainCoverage,
    sqliteDependency,
    migrationPlan: {
      runtimeMigrationEnabled: false,
      sqliteFoundationReady: sqliteDependency.foundationReady === true,
      localStorageSnapshotBackupReady,
      localStorageStructuredCopyReady,
      localStorageSnapshotCopyEvidenceReady,
      destructiveMigrationDetected: false,
      sourceLocalStoragePreservationRequired: true,
      backupBeforeMutationRequired: true,
      rollbackToolRequired: true,
      crossPlatformCoverageRequired: ['macos', 'windows', 'linux'],
      recommendedFirstTables: ['chat_messages', 'chat_sessions', 'memories', 'memory_sources', 'audit_events'],
    },
    storageKeys,
    directStorageAccesses,
    requirementMode: {
      requireInventoryReady: Boolean(options.requireInventoryReady),
      requireMigrationReady: Boolean(options.requireMigrationReady),
      snapshotCopyEvidenceFile: snapshotCopyEvidenceSource.path,
    },
    blockingIssueIds,
    nextActions: migrationReady
      ? []
      : [
          ...(sqliteDependency.foundationReady === true ? [] : ['choose-sqlite-dependency-after-packaging-review']),
          ...(localStorageSnapshotBackupReady && !localStorageSnapshotCopyEvidenceReady ? ['capture-chat-memory-local-storage-snapshot-backup-evidence'] : []),
          ...(localStorageStructuredCopyReady && !localStorageSnapshotCopyEvidenceReady ? ['capture-chat-memory-structured-copy-evidence'] : []),
          ...(!localStorageSnapshotBackupReady ? ['extend-main-process-storage-ipc-for-read-through-migration'] : []),
          ...(!localStorageStructuredCopyReady ? ['copy-chat-memory-snapshot-into-structured-sqlite'] : []),
          'implement-read-through-migration-with-localstorage-preservation',
          'add-backup-restore-and-rollback-fixtures',
        ],
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'localStorage values',
        'chat messages and transcripts',
        'memory bodies and source ids',
        'API keys and provider secrets',
        'audit log contents',
        'local file contents',
      ],
    },
  }
}

async function writeReportFile(report, outputPath) {
  const target = cleanString(outputPath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runM4StorageMigrationCli(argv = process.argv.slice(2), context = {}) {
  const options = parseM4StorageMigrationArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  const report = await buildM4StorageMigrationReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return (options.requireInventoryReady || options.requireMigrationReady) && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM4StorageMigrationCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
