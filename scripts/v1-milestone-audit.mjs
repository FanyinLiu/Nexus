#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const V1_MILESTONE_AUDIT_GATE = 'nexus-v1-milestone-governance'
export const DEFAULT_V1_MILESTONE_FILE = 'docs/V1_MILESTONES.md'
export const M1_FIRST_RUN_STATUS_GATE = 'nexus-v1-m1-first-run-status'
export const DEFAULT_M1_FIRST_RUN_STATUS_FILE = 'artifacts/v1/m1-first-run-status.json'
export const M2_DISTRIBUTION_TRUST_GATE = 'nexus-v1-m2-distribution-trust'
export const DEFAULT_M2_DISTRIBUTION_TRUST_FILE = 'artifacts/v1/m2-distribution-trust.json'
export const M3_IPC_SECURITY_GATE = 'nexus-v1-m3-ipc-security-inventory'
export const DEFAULT_M3_IPC_SECURITY_FILE = 'artifacts/v1/m3-ipc-security.json'
export const M4_STORAGE_MIGRATION_GATE = 'nexus-v1-m4-storage-migration-inventory'
export const DEFAULT_M4_STORAGE_MIGRATION_FILE = 'artifacts/v1/m4-storage-migration.json'

const REQUIRED_DOCS = [
  'docs/ROADMAP.md',
  'docs/ARCHITECTURE.md',
  'CHANGELOG.md',
]

const PACKAGE_JSON_PATH = 'package.json'

const REQUIRED_MILESTONE_SECTIONS = [
  'Objective',
  'Problem Analysis',
  'Technical Design',
  'Impact Scope',
  'Risks',
  'Rollback Plan',
  'Data Migration And Rollback',
  'Tests And Evidence',
  'User Documentation',
  'Acceptance Results',
  'Known Gaps',
  'Next Stage Tasks',
]

const REQUIRED_PRIORITY_COVERAGE = [
  {
    id: 'first-run-model-setup',
    terms: ['M1', 'Ollama', 'API connection', 'first conversation'],
  },
  {
    id: 'distribution-updates',
    terms: ['M2', 'macOS', 'Windows', 'Linux', 'auto-update'],
  },
  {
    id: 'ipc-permissions-secrets-audit',
    terms: ['M3', 'IPC', 'permission', 'secret', 'audit'],
  },
  {
    id: 'sqlite-storage-migration',
    terms: ['M4', 'SQLite', 'chat', 'memory', 'localStorage'],
  },
  {
    id: 'white-box-memory',
    terms: ['M5', 'viewable', 'editable', 'deletable', 'recall-pausable'],
  },
  {
    id: 'desktop-presence-state',
    terms: ['M6', 'idle', 'thinking', 'listening', 'speaking', 'error'],
  },
  {
    id: 'voice-reliability',
    terms: ['M7', 'TTS', 'VAD', 'interruption', 'lazy'],
  },
  {
    id: 'local-rag-citations',
    terms: ['M8', 'file indexing', 'RAG', 'citations'],
  },
  {
    id: 'tool-registry-task-lifecycle',
    terms: ['M9', 'Tool Registry', 'Planner/Executor', 'pause', 'cancel'],
  },
  {
    id: 'mcp-plugins-advanced-automation',
    terms: ['M10', 'MCP', 'plugins', 'advanced automation', 'opt-in'],
  },
]

const REQUIRED_EVIDENCE_GATES = [
  {
    id: 'm1-first-run-gates',
    milestoneId: 'M1',
    label: 'M1 first-run setup evidence gates',
    scriptNames: [
      'm1:first-run:audit',
      'm1:first-run:record',
      'm1:first-run:status',
    ],
    docs: [
      'docs/V1_M1_FIRST_RUN_SETUP.md',
      'docs/V1_MILESTONES.md',
    ],
    terms: [
      'm1:first-run:audit',
      'm1:first-run:record',
      'm1:first-run:status',
    ],
  },
  {
    id: 'm2-distribution-trust-gate',
    milestoneId: 'M2',
    label: 'M2 distribution and update trust evidence gate',
    scriptNames: [
      'm2:distribution:trust',
    ],
    docs: [
      'docs/V1_M2_DISTRIBUTION_TRUST.md',
      'docs/V1_MILESTONES.md',
    ],
    terms: [
      'm2:distribution:trust',
      'unsigned fallback',
      'electron-updater',
    ],
  },
  {
    id: 'm3-ipc-security-gate',
    milestoneId: 'M3',
    label: 'M3 IPC validation, secrets, and audit inventory gate',
    scriptNames: [
      'm3:ipc:audit',
    ],
    docs: [
      'docs/V1_M3_IPC_SECURITY.md',
      'docs/V1_MILESTONES.md',
    ],
    terms: [
      'm3:ipc:audit',
      'trusted sender',
      'vault refs',
      'audit inventory',
    ],
  },
  {
    id: 'm4-storage-migration-gate',
    milestoneId: 'M4',
    label: 'M4 localStorage-to-SQLite migration inventory gate',
    scriptNames: [
      'm4:storage:audit',
      'm4:sqlite:foundation',
      'm4:storage:snapshot-copy:evidence',
      'm4:storage:restore:evidence',
      'm4:storage:read-through:evidence',
    ],
    docs: [
      'docs/V1_M4_STORAGE_MIGRATION.md',
      'docs/V1_MILESTONES.md',
    ],
    terms: [
      'm4:storage:audit',
      'm4:sqlite:foundation',
      'm4:storage:snapshot-copy:evidence',
      'm4:storage:restore:evidence',
      'm4:storage:read-through:evidence',
      'localStorage',
      'SQLite',
      'rollback',
    ],
  },
]

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/v1-milestone-audit.mjs [options]',
    '',
    'Checks the v1.0 milestone governance contract without copying private user data.',
    '',
    'Options:',
    `  --milestone-file <path>   Milestone contract markdown (default: ${DEFAULT_V1_MILESTONE_FILE})`,
    `  --m1-status-file <path>   M1 first-run status JSON (default: ${DEFAULT_M1_FIRST_RUN_STATUS_FILE})`,
    `  --m2-trust-file <path>    M2 distribution trust JSON (default: ${DEFAULT_M2_DISTRIBUTION_TRUST_FILE})`,
    `  --m3-ipc-file <path>      M3 IPC security inventory JSON (default: ${DEFAULT_M3_IPC_SECURITY_FILE})`,
    `  --m4-storage-file <path>  M4 storage migration inventory JSON (default: ${DEFAULT_M4_STORAGE_MIGRATION_FILE})`,
    '  --generated-at <iso>      Override report timestamp',
    '  --output <path>           Write JSON report to a file',
    '  --require-ready           Exit non-zero unless the governance contract is ready',
    '  --require-acceptance-evidence',
    '                            Also fail unless milestone acceptance evidence is ready',
    '  --help                    Show this help',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
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

export function parseV1MilestoneAuditArgs(argv) {
  const options = {
    generatedAt: '',
    help: false,
    m1StatusFile: DEFAULT_M1_FIRST_RUN_STATUS_FILE,
    m2TrustFile: DEFAULT_M2_DISTRIBUTION_TRUST_FILE,
    m3IpcFile: DEFAULT_M3_IPC_SECURITY_FILE,
    m4StorageFile: DEFAULT_M4_STORAGE_MIGRATION_FILE,
    milestoneFile: DEFAULT_V1_MILESTONE_FILE,
    outputPath: '',
    requireAcceptanceEvidence: false,
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
    if (arg === '--require-acceptance-evidence' || arg === '--require-milestone-evidence') {
      options.requireAcceptanceEvidence = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      if (name === '--milestone-file' || name === '--input') {
        options.milestoneFile = parsed.value
      } else if (name === '--m1-status-file' || name === '--m1-first-run-status-file') {
        options.m1StatusFile = parsed.value
      } else if (name === '--m2-trust-file' || name === '--m2-distribution-trust-file') {
        options.m2TrustFile = parsed.value
      } else if (name === '--m3-ipc-file' || name === '--m3-ipc-security-file') {
        options.m3IpcFile = parsed.value
      } else if (name === '--m4-storage-file' || name === '--m4-storage-migration-file') {
        options.m4StorageFile = parsed.value
      } else if (name === '--generated-at') {
        options.generatedAt = parsed.value
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

async function readTextStatus(filePath) {
  const target = cleanString(filePath)
  try {
    return {
      exists: true,
      path: target,
      text: await fs.readFile(path.resolve(process.cwd(), target), 'utf8'),
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

async function readJsonStatus(filePath) {
  const target = cleanString(filePath)
  try {
    const text = await fs.readFile(path.resolve(process.cwd(), target), 'utf8')
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

function hasTerm(text, term) {
  return text.toLowerCase().includes(String(term).toLowerCase())
}

function extractMilestones(markdown) {
  const matches = [...markdown.matchAll(/^## (M\d+) - ([^\n]+)$/gm)]
  return matches.map((match, index) => {
    const start = match.index ?? 0
    const end = index + 1 < matches.length ? matches[index + 1].index ?? markdown.length : markdown.length
    const body = markdown.slice(start, end)
    return {
      id: match[1],
      title: cleanString(match[2]),
      body,
    }
  })
}

function summarizeMilestone(milestone) {
  const presentSections = REQUIRED_MILESTONE_SECTIONS.filter((section) => (
    new RegExp(`^### ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(milestone.body)
  ))
  const missingSections = REQUIRED_MILESTONE_SECTIONS.filter((section) => !presentSections.includes(section))
  return {
    id: milestone.id,
    title: milestone.title,
    status: missingSections.length === 0 ? 'ready' : 'missing-sections',
    presentSectionCount: presentSections.length,
    requiredSectionCount: REQUIRED_MILESTONE_SECTIONS.length,
    missingSections,
  }
}

function summarizePriorityCoverage(markdown) {
  return REQUIRED_PRIORITY_COVERAGE.map((priority) => {
    const missingTerms = priority.terms.filter((term) => !hasTerm(markdown, term))
    return {
      id: priority.id,
      status: missingTerms.length === 0 ? 'covered' : 'missing-terms',
      missingTerms,
    }
  })
}

function summarizeRequiredDocs(requiredDocStatuses, milestoneText) {
  return requiredDocStatuses.map((doc) => ({
    path: doc.path,
    exists: doc.exists,
    error: doc.error,
    linkedFromMilestoneContract: hasTerm(milestoneText, doc.path),
  }))
}

function summarizeEvidenceGates(gateDefinitions, packageSource, documentSources) {
  const scripts = packageSource.value?.scripts && typeof packageSource.value.scripts === 'object'
    ? packageSource.value.scripts
    : {}
  const docsByPath = new Map(documentSources.map((source) => [source.path, source]))

  return gateDefinitions.map((gate) => {
    const missingScripts = gate.scriptNames.filter((scriptName) => (
      typeof scripts[scriptName] !== 'string' || scripts[scriptName].length === 0
    ))
    const missingDocs = gate.docs.filter((docPath) => docsByPath.get(docPath)?.exists !== true)
    const missingDocTerms = []

    for (const docPath of gate.docs) {
      const source = docsByPath.get(docPath)
      if (!source?.exists) continue
      for (const term of gate.terms) {
        if (!hasTerm(source.text, term)) {
          missingDocTerms.push(`${docPath}:${term}`)
        }
      }
    }

    return {
      id: gate.id,
      milestoneId: gate.milestoneId,
      label: gate.label,
      status: missingScripts.length === 0 && missingDocs.length === 0 && missingDocTerms.length === 0
        ? 'ready'
        : 'missing-evidence-gate-wiring',
      scriptNames: gate.scriptNames,
      missingScripts,
      docPaths: gate.docs,
      missingDocs,
      missingDocTerms,
    }
  })
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function summarizeM1AcceptanceEvidence(source) {
  const raw = source.value
  const gateOk = raw?.gate === M1_FIRST_RUN_STATUS_GATE
  const platformCoverage = safeArray(raw?.platformCoverage)
    .map((coverage) => ({
      platform: cleanString(coverage?.platform) || 'unknown',
      pass: coverage?.pass === true,
      status: cleanString(coverage?.status) || 'unknown',
    }))
    .filter((coverage) => coverage.platform)
  const missingPlatformIds = safeArray(raw?.missingPlatformIds)
    .map(cleanString)
    .filter(Boolean)
  const nextActions = safeArray(raw?.nextActions)
    .map(cleanString)
    .filter(Boolean)
  const ready = source.exists && gateOk && raw?.ok === true

  return {
    id: 'm1-first-run-status',
    milestoneId: 'M1',
    label: 'M1 first-run runtime and platform status',
    path: source.path,
    exists: source.exists,
    error: source.error,
    gateOk,
    ready,
    status: ready
      ? 'ready'
      : source.exists
        ? gateOk
          ? 'not-ready'
          : 'invalid-gate'
        : 'missing',
    overallStatus: cleanString(raw?.overallStatus) || (source.exists ? 'unknown' : 'missing'),
    auditRuntimeEvidence: raw?.audit?.runtimeEvidence === true,
    missingPlatformIds,
    platformCoverage,
    nextActions,
  }
}

function summarizeM2AcceptanceEvidence(source) {
  const raw = source.value
  const gateOk = raw?.gate === M2_DISTRIBUTION_TRUST_GATE
  const packageSmoke = raw?.packageSmoke && typeof raw.packageSmoke === 'object'
    ? raw.packageSmoke
    : {}
  const missingPackageSmokePlatformIds = safeArray(packageSmoke.missingPlatformIds)
    .map(cleanString)
    .filter(Boolean)
  const platformReadiness = safeArray(raw?.platformReadiness)
    .map((coverage) => ({
      platform: cleanString(coverage?.platform) || 'unknown',
      ready: coverage?.ready === true,
      status: cleanString(coverage?.status) || 'unknown',
      signingStatus: cleanString(coverage?.signingStatus) || 'unknown',
    }))
    .filter((coverage) => coverage.platform)
  const packageSmokeCoverage = safeArray(packageSmoke.platformCoverage)
    .map((coverage) => ({
      platform: cleanString(coverage?.platform) || 'unknown',
      pass: coverage?.pass === true,
      status: cleanString(coverage?.status) || 'unknown',
      evidenceFileCount: safeArray(coverage?.evidenceFiles).length,
    }))
    .filter((coverage) => coverage.platform)
  const blockingIssueIds = safeArray(raw?.blockingIssueIds)
    .map(cleanString)
    .filter(Boolean)
  const nextActions = safeArray(raw?.nextActions)
    .map(cleanString)
    .filter(Boolean)
  const packageSmokeReady = packageSmoke.ready === true
    && missingPackageSmokePlatformIds.length === 0
  const ready = source.exists && gateOk && raw?.ok === true && packageSmokeReady

  return {
    id: 'm2-distribution-trust',
    milestoneId: 'M2',
    label: 'M2 distribution trust and package-smoke status',
    path: source.path,
    exists: source.exists,
    error: source.error,
    gateOk,
    ready,
    status: ready
      ? 'ready'
      : source.exists
        ? gateOk
          ? 'not-ready'
          : 'invalid-gate'
        : 'missing',
    overallStatus: cleanString(raw?.overallStatus) || (source.exists ? 'unknown' : 'missing'),
    configurationReady: source.exists && gateOk && raw?.ok === true,
    packageSmokeReady,
    packageSmokeRecordCount: Number.isFinite(Number(packageSmoke.totalRecordCount))
      ? Number(packageSmoke.totalRecordCount)
      : 0,
    packageSmokePassingRecordCount: Number.isFinite(Number(packageSmoke.passingRecordCount))
      ? Number(packageSmoke.passingRecordCount)
      : 0,
    missingPackageSmokePlatformIds,
    platformReadiness,
    packageSmokeCoverage,
    blockingIssueIds,
    nextActions: packageSmokeReady
      ? nextActions
      : nextActions.length > 0
        ? nextActions
        : missingPackageSmokePlatformIds.map((platform) => `run-${platform}-package-smoke`),
  }
}

function summarizeM3AcceptanceEvidence(source) {
  const raw = source.value
  const gateOk = raw?.gate === M3_IPC_SECURITY_GATE
  const requestValidation = raw?.requestValidation && typeof raw.requestValidation === 'object'
    ? raw.requestValidation
    : {}
  const highRiskAudit = raw?.highRiskAudit && typeof raw.highRiskAudit === 'object'
    ? raw.highRiskAudit
    : {}
  const trustedSender = raw?.trustedSender && typeof raw.trustedSender === 'object'
    ? raw.trustedSender
    : {}
  const secretBoundary = raw?.secretBoundary && typeof raw.secretBoundary === 'object'
    ? raw.secretBoundary
    : {}
  const globalHighRiskAudit = raw?.globalHighRiskAudit && typeof raw.globalHighRiskAudit === 'object'
    ? raw.globalHighRiskAudit
    : {}
  const auditLog = raw?.auditLog && typeof raw.auditLog === 'object'
    ? raw.auditLog
    : {}
  const preloadContract = raw?.preloadContract && typeof raw.preloadContract === 'object'
    ? raw.preloadContract
    : {}
  const totals = raw?.totals && typeof raw.totals === 'object'
    ? raw.totals
    : {}
  const nextActions = safeArray(raw?.nextActions)
    .map(cleanString)
    .filter(Boolean)
  const missingHandlerChannels = safeArray(preloadContract.missingHandlerChannels)
    .map(cleanString)
    .filter(Boolean)
  const handlersNotExposedToPreload = safeArray(preloadContract.handlersNotExposedToPreload)
    .map(cleanString)
    .filter(Boolean)
  const missingSubscriptionSources = safeArray(preloadContract.missingSubscriptionSources)
    .map(cleanString)
    .filter(Boolean)
  const missingTrustedSenderChannels = safeArray(trustedSender.missingTrustedSenderChannels)
    .map(cleanString)
    .filter(Boolean)
  const unvalidatedPayloadChannels = safeArray(requestValidation.unvalidatedPayloadChannels)
    .map(cleanString)
    .filter(Boolean)
  const unauditedHighRiskChannels = safeArray(highRiskAudit.unauditedHighRiskChannels)
    .map(cleanString)
    .filter(Boolean)
  const blockingIssueIds = safeArray(raw?.blockingIssueIds)
    .map(cleanString)
    .filter(Boolean)
  const requestValidationReady = requestValidation.fullRequestValidationReady === true
    && unvalidatedPayloadChannels.length === 0
  const highRiskAuditReady = highRiskAudit.highRiskAuditReady === true
    && unauditedHighRiskChannels.length === 0
  const ready = source.exists
    && gateOk
    && raw?.ok === true
    && trustedSender.ready === true
    && requestValidationReady
    && highRiskAuditReady
    && secretBoundary.ready === true
    && globalHighRiskAudit.ready === true
    && auditLog.appendOnlyJsonLines === true
    && auditLog.rotationConfigured === true

  return {
    id: 'm3-ipc-security',
    milestoneId: 'M3',
    label: 'M3 IPC validation, secret boundary, and high-risk audit status',
    path: source.path,
    exists: source.exists,
    error: source.error,
    gateOk,
    ready,
    status: ready
      ? 'ready'
      : source.exists
        ? gateOk
          ? 'not-ready'
          : 'invalid-gate'
        : 'missing',
    overallStatus: cleanString(raw?.overallStatus) || (source.exists ? 'unknown' : 'missing'),
    handlerCount: Number.isFinite(Number(totals.ipcHandlerCount))
      ? Number(totals.ipcHandlerCount)
      : 0,
    preloadInvokeChannelCount: Number.isFinite(Number(totals.preloadInvokeChannelCount))
      ? Number(totals.preloadInvokeChannelCount)
      : 0,
    preloadSubscriptionChannelCount: Number.isFinite(Number(totals.preloadSubscriptionChannelCount))
      ? Number(totals.preloadSubscriptionChannelCount)
      : 0,
    missingHandlerChannels,
    handlersNotExposedToPreload,
    missingSubscriptionSources,
    trustedSenderReady: trustedSender.ready === true,
    missingTrustedSenderChannels,
    requestValidationReady,
    payloadHandlerCount: Number.isFinite(Number(requestValidation.payloadHandlerCount))
      ? Number(requestValidation.payloadHandlerCount)
      : 0,
    unvalidatedPayloadChannels,
    responseValidationReady: requestValidation.responseValidationReady === true,
    highRiskAuditReady,
    highRiskHandlerCount: Number.isFinite(Number(highRiskAudit.highRiskHandlerCount))
      ? Number(highRiskAudit.highRiskHandlerCount)
      : 0,
    unauditedHighRiskChannels,
    secretBoundaryReady: secretBoundary.ready === true,
    outboundRefResolutionChannelCount: Number.isFinite(Number(secretBoundary.outboundRefResolutionChannelCount))
      ? Number(secretBoundary.outboundRefResolutionChannelCount)
      : 0,
    globalHighRiskAuditReady: globalHighRiskAudit.ready === true,
    auditLogReady: auditLog.appendOnlyJsonLines === true && auditLog.rotationConfigured === true,
    blockingIssueIds,
    nextActions: nextActions.length > 0
      ? nextActions
      : ready
        ? []
        : ['run-m3-ipc-audit-with-full-validation-and-high-risk-audit'],
  }
}

function summarizeM4AcceptanceEvidence(source) {
  const raw = source.value
  const gateOk = raw?.gate === M4_STORAGE_MIGRATION_GATE
  const totals = raw?.totals && typeof raw.totals === 'object' ? raw.totals : {}
  const sqliteDependency = raw?.sqliteDependency && typeof raw.sqliteDependency === 'object'
    ? raw.sqliteDependency
    : {}
  const migrationPlan = raw?.migrationPlan && typeof raw.migrationPlan === 'object'
    ? raw.migrationPlan
    : {}
  const domainCoverage = safeArray(raw?.domainCoverage)
    .map((coverage) => ({
      domain: cleanString(coverage?.domain) || 'unknown',
      keyCount: Number.isFinite(Number(coverage?.keyCount)) ? Number(coverage.keyCount) : 0,
      covered: coverage?.covered === true,
      migrationPriority: cleanString(coverage?.migrationPriority) || 'unknown',
    }))
    .filter((coverage) => coverage.domain)
  const missingDomainIds = domainCoverage
    .filter((coverage) => !coverage.covered)
    .map((coverage) => coverage.domain)
  const nextActions = safeArray(raw?.nextActions)
    .map(cleanString)
    .filter(Boolean)
  const ready = source.exists
    && gateOk
    && raw?.ok === true
    && raw?.inventoryReady === true
    && raw?.migrationReady === true

  return {
    id: 'm4-storage-migration',
    milestoneId: 'M4',
    label: 'M4 main-process SQLite storage migration status',
    path: source.path,
    exists: source.exists,
    error: source.error,
    gateOk,
    ready,
    status: ready
      ? 'ready'
      : source.exists
        ? gateOk
          ? 'not-ready'
          : 'invalid-gate'
        : 'missing',
    overallStatus: cleanString(raw?.overallStatus) || (source.exists ? 'unknown' : 'missing'),
    inventoryReady: raw?.inventoryReady === true,
    migrationReady: raw?.migrationReady === true,
    uniqueStorageKeyCount: Number.isFinite(Number(totals.uniqueStorageKeyCount))
      ? Number(totals.uniqueStorageKeyCount)
      : 0,
    directStorageAccessOutsideCoreCount: Number.isFinite(Number(totals.directStorageAccessOutsideCoreCount))
      ? Number(totals.directStorageAccessOutsideCoreCount)
      : 0,
    domainCoverage,
    missingDomainIds,
    sqliteDependencyStatus: cleanString(sqliteDependency.status) || 'unknown',
    sqliteDependencyReviewRequired: sqliteDependency.requiresDependencyReview === true,
    runtimeMigrationEnabled: migrationPlan.runtimeMigrationEnabled === true,
    localStorageSnapshotBackupReady: migrationPlan.localStorageSnapshotBackupReady === true,
    localStorageStructuredCopyReady: migrationPlan.localStorageStructuredCopyReady === true,
    localStorageSnapshotCopyEvidenceReady: migrationPlan.localStorageSnapshotCopyEvidenceReady === true,
    localStorageRestoreEvidenceReady: migrationPlan.localStorageRestoreEvidenceReady === true,
    localStorageReadThroughEvidenceReady: migrationPlan.localStorageReadThroughEvidenceReady === true,
    sourceLocalStoragePreservationRequired: migrationPlan.sourceLocalStoragePreservationRequired === true,
    backupBeforeMutationRequired: migrationPlan.backupBeforeMutationRequired === true,
    rollbackToolRequired: migrationPlan.rollbackToolRequired === true,
    blockingIssueIds: safeArray(raw?.blockingIssueIds).map(cleanString).filter(Boolean),
    nextActions: nextActions.length > 0
      ? nextActions
      : ready
        ? []
        : ['run-m4-storage-audit-and-implement-sqlite-migration'],
  }
}

export async function buildV1MilestoneAuditReport(options = {}, context = {}) {
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const milestoneFile = options.milestoneFile || DEFAULT_V1_MILESTONE_FILE
  const m1StatusFile = options.m1StatusFile || DEFAULT_M1_FIRST_RUN_STATUS_FILE
  const m2TrustFile = options.m2TrustFile || DEFAULT_M2_DISTRIBUTION_TRUST_FILE
  const m3IpcFile = options.m3IpcFile || DEFAULT_M3_IPC_SECURITY_FILE
  const m4StorageFile = options.m4StorageFile || DEFAULT_M4_STORAGE_MIGRATION_FILE
  const evidenceGateDefinitions = REQUIRED_EVIDENCE_GATES.map((gate) => ({
    ...gate,
    docs: gate.docs.map((docPath) => (
      docPath === DEFAULT_V1_MILESTONE_FILE ? milestoneFile : docPath
    )),
  }))
  const requiredEvidenceDocPaths = evidenceGateDefinitions.flatMap((gate) => gate.docs)
  const extraEvidenceDocPaths = [...new Set(requiredEvidenceDocPaths.filter((docPath) => (
    docPath !== milestoneFile && !REQUIRED_DOCS.includes(docPath)
  )))]
  const [
    milestoneSource,
    packageSource,
    m1StatusSource,
    m2TrustSource,
    m3IpcSource,
    m4StorageSource,
    ...documentSources
  ] = await Promise.all([
    readTextStatus(milestoneFile),
    readJsonStatus(PACKAGE_JSON_PATH),
    readJsonStatus(m1StatusFile),
    readJsonStatus(m2TrustFile),
    readJsonStatus(m3IpcFile),
    readJsonStatus(m4StorageFile),
    ...REQUIRED_DOCS.map(readTextStatus),
    ...extraEvidenceDocPaths.map(readTextStatus),
  ])
  const requiredDocSources = documentSources.slice(0, REQUIRED_DOCS.length)
  const evidenceDocSources = [
    milestoneSource,
    ...requiredDocSources,
    ...documentSources.slice(REQUIRED_DOCS.length),
  ]
  const milestoneText = milestoneSource.text
  const milestones = extractMilestones(milestoneText).map(summarizeMilestone)
  const priorityCoverage = summarizePriorityCoverage(milestoneText)
  const requiredDocs = summarizeRequiredDocs(requiredDocSources, milestoneText)
  const evidenceGates = summarizeEvidenceGates(evidenceGateDefinitions, packageSource, evidenceDocSources)
  const acceptanceEvidence = [
    summarizeM1AcceptanceEvidence(m1StatusSource),
    summarizeM2AcceptanceEvidence(m2TrustSource),
    summarizeM3AcceptanceEvidence(m3IpcSource),
    summarizeM4AcceptanceEvidence(m4StorageSource),
  ]

  const missingPackageIds = packageSource.exists ? [] : [PACKAGE_JSON_PATH]
  const missingDocIds = requiredDocs
    .filter((doc) => !doc.exists)
    .map((doc) => doc.path)
  const unlinkedDocIds = requiredDocs
    .filter((doc) => doc.exists && !doc.linkedFromMilestoneContract)
    .map((doc) => doc.path)
  const incompleteMilestoneIds = milestones
    .filter((milestone) => milestone.status !== 'ready')
    .map((milestone) => milestone.id)
  const missingPriorityIds = priorityCoverage
    .filter((priority) => priority.status !== 'covered')
    .map((priority) => priority.id)
  const missingEvidenceGateIds = evidenceGates
    .filter((gate) => gate.status !== 'ready')
    .map((gate) => gate.id)
  const incompleteAcceptanceEvidenceIds = options.requireAcceptanceEvidence
    ? acceptanceEvidence
        .filter((evidence) => !evidence.ready)
        .map((evidence) => evidence.id)
    : []
  const expectedMilestoneIds = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10']
  const presentMilestoneIds = milestones.map((milestone) => milestone.id)
  const missingMilestoneIds = expectedMilestoneIds.filter((id) => !presentMilestoneIds.includes(id))

  const blockingIssueIds = [
    ...(!milestoneSource.exists ? ['milestone-contract-missing'] : []),
    ...missingPackageIds.map((id) => `missing-package:${id}`),
    ...missingDocIds.map((id) => `missing-doc:${id}`),
    ...unlinkedDocIds.map((id) => `unlinked-doc:${id}`),
    ...missingMilestoneIds.map((id) => `missing-milestone:${id}`),
    ...incompleteMilestoneIds.map((id) => `incomplete-milestone:${id}`),
    ...missingPriorityIds.map((id) => `missing-priority:${id}`),
    ...missingEvidenceGateIds.map((id) => `missing-evidence-gate:${id}`),
    ...incompleteAcceptanceEvidenceIds.map((id) => `missing-acceptance-evidence:${id}`),
  ]
  const ok = blockingIssueIds.length === 0

  return {
    schemaVersion: 1,
    gate: V1_MILESTONE_AUDIT_GATE,
    generatedAt,
    ok,
    overallStatus: ok ? 'ready' : 'needs-governance-work',
    milestoneFile: {
      path: cleanString(milestoneFile),
      exists: milestoneSource.exists,
      error: milestoneSource.error,
    },
    requiredDocs,
    milestoneCount: milestones.length,
    expectedMilestoneIds,
    missingMilestoneIds,
    milestones,
    priorityCoverage,
    evidenceGates,
    acceptanceEvidence,
    acceptanceEvidenceRequired: Boolean(options.requireAcceptanceEvidence),
    blockingIssueIds,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'user chat text',
        'memory bodies and source ids',
        'API keys and provider secrets',
        'local file contents',
        'message sender/text/id values',
        'raw audit logs',
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

export async function runV1MilestoneAuditCli(argv = process.argv.slice(2), context = {}) {
  const options = parseV1MilestoneAuditArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  const report = await buildV1MilestoneAuditReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return (options.requireReady || options.requireAcceptanceEvidence) && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runV1MilestoneAuditCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
