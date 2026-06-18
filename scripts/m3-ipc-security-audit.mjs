#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const M3_IPC_SECURITY_GATE = 'nexus-v1-m3-ipc-security-inventory'
export const DEFAULT_M3_IPC_SECURITY_FILE = 'artifacts/v1/m3-ipc-security.json'

const IPC_DIR = 'electron/ipc'
const PRELOAD_PATH = 'electron/preload.js'
const IPC_REGISTRY_PATH = 'electron/ipcRegistry.js'
const AUDITED_IPC_PATH = 'electron/ipc/auditedIpc.js'
const AUDIT_LOG_PATH = 'electron/services/auditLog.js'
const VAULT_IPC_PATH = 'electron/ipc/vaultIpc.js'
const VAULT_REFS_PATH = 'electron/services/vaultRefs.js'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m3-ipc-security-audit.mjs [options]',
    '',
    'Builds a private-safe M3 IPC, permission, secret-boundary, and audit inventory.',
    '',
    'Options:',
    '  --generated-at <iso>        Override report timestamp',
    `  --output <path>             Write JSON report (default: ${DEFAULT_M3_IPC_SECURITY_FILE})`,
    '  --require-ready             Exit non-zero unless the IPC inventory baseline is ready',
    '  --require-full-validation   Also require every payload-taking handler to have request validation',
    '  --require-high-risk-audit   Also require every high-risk handler to call the audit log',
    '  --help                      Show this help',
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

export function parseM3IpcSecurityArgs(argv) {
  const options = {
    generatedAt: '',
    help: false,
    outputPath: DEFAULT_M3_IPC_SECURITY_FILE,
    requireFullValidation: false,
    requireHighRiskAudit: false,
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
    if (arg === '--require-full-validation') {
      options.requireFullValidation = true
      continue
    }
    if (arg === '--require-high-risk-audit') {
      options.requireHighRiskAudit = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      if (name === '--generated-at') {
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

async function listIpcSourceFiles(rootDir) {
  const dir = path.resolve(rootDir, IPC_DIR)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.posix.join(IPC_DIR, entry.name))
    .sort()
}

async function listJsFilesRecursive(rootDir, relativeDir) {
  const dir = path.resolve(rootDir, relativeDir)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listJsFilesRecursive(rootDir, relativePath))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

function lineForIndex(source, index) {
  return source.slice(0, index).split('\n').length
}

function extractStringMatches(source, regex) {
  return [...source.matchAll(regex)].map((match) => cleanString(match[1])).filter(Boolean)
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function countPayloadParams(paramsText) {
  const params = paramsText.split(',')
    .map((param) => cleanString(param.replace(/=.*$/, '')))
    .filter(Boolean)
  return Math.max(0, params.length - 1)
}

function classifyChannel(channel) {
  const categories = []
  const mutatingPattern = /:(abort|approve|assemble|connect|create|delete|disable|disconnect|download|enable|execute|feed|finish|import|index|install|mark-used|open|publish|remove|restart|revoke|save|send|set|start|stop|store|subscribe|sync|transcribe|unsubscribe|update)/

  if (channel.startsWith('vault:')) categories.push('secret-vault')
  if (/^(chat|service|audio|tts|tencent-asr|telegram|discord|mcp|notification|doctor|integrations):/.test(channel)
    || channel === 'tool:web-search'
    || channel === 'tool:get-weather') {
    categories.push('network-or-integration')
  }
  if (/^(file|pet-model|persona|plugin|plugin-bus|skill|memory|storage):/.test(channel)) {
    categories.push('local-data-or-files')
  }
  if (/^(tool:open-external|updater:install|app:set-launch-on-startup|media-session:control|window:|pet-window:|panel-window:|runtime-state:update|proactive:show-notification)/.test(channel)) {
    categories.push('system-action')
  }
  if (mutatingPattern.test(channel)) categories.push('mutating')

  return unique(categories)
}

function classifyRequestValidation(segment, payloadParamCount) {
  if (payloadParamCount === 0) {
    return {
      status: 'no-payload',
      evidence: [],
    }
  }
  const evidence = []
  if (/\bvalidate(?:Ipc)?[A-Za-z0-9]*(?:Payload|Request)\s*\(/.test(segment) || /\bvalidateIpcPayload\s*\(/.test(segment)) {
    evidence.push('schema-validator')
  }
  if (/\b(requireString|expectString|requireObject|requireSlotName|requireSlotNames|requireVaultEntries|assertNumber|assertArray|assertOptionalString)\s*\(/.test(segment)) {
    evidence.push('manual-validator')
  }
  if (/\b(Array\.isArray|Number\.isFinite|instanceof\s+Float32Array|new\s+Float32Array)\b/.test(segment) || /\.length\s*>\s*\d+/.test(segment)) {
    evidence.push('bounded-special-case')
  }
  if (evidence.includes('schema-validator')) return { status: 'schema', evidence }
  if (evidence.includes('manual-validator')) return { status: 'manual-validator', evidence }
  if (evidence.includes('bounded-special-case')) return { status: 'bounded-special-case', evidence }
  return { status: 'missing', evidence: [] }
}

function summarizeHandler(source, relativePath, match, segment, globalHighRiskAuditReady) {
  const [, , channel, paramsText] = match
  const payloadParamCount = countPayloadParams(paramsText)
  const validation = classifyRequestValidation(segment, payloadParamCount)
  const categories = classifyChannel(channel)
  const highRisk = categories.some((category) => (
    category === 'secret-vault'
    || category === 'local-data-or-files'
    || category === 'system-action'
    || category === 'network-or-integration'
  ))
  const directAuditCall = /\baudit\s*\(/.test(segment)
  const coveredByGlobalAudit = highRisk && globalHighRiskAuditReady

  return {
    channel,
    file: relativePath,
    line: lineForIndex(source, match.index ?? 0),
    payloadParamCount,
    hasTrustedSenderCheck: /\b(?:requireTrustedSender|trustedSenderCheck)\s*\(\s*event\s*\)/.test(segment),
    requestValidationStatus: validation.status,
    requestValidationEvidence: validation.evidence,
    usesVaultRefResolution: /\bresolveVaultRefsForSender\s*\(/.test(segment),
    directAuditCall,
    coveredByGlobalAudit,
    hasAuditCall: directAuditCall || coveredByGlobalAudit,
    auditCoverage: directAuditCall ? 'direct' : coveredByGlobalAudit ? 'global-wrapper' : 'none',
    categories,
    highRisk,
  }
}

function extractHandlersFromSource(source, relativePath, globalHighRiskAuditReady) {
  const regex = /(?:ipcMain|ipcMainLike)\.handle\(\s*(['"`])([^'"`]+)\1\s*,\s*(?:async\s*)?\(([^)]*)\)\s*=>/g
  const matches = [...source.matchAll(regex)]
  return matches.map((match, index) => {
    const start = match.index ?? 0
    const end = index + 1 < matches.length ? matches[index + 1].index ?? source.length : source.length
    return summarizeHandler(source, relativePath, match, source.slice(start, end), globalHighRiskAuditReady)
  })
}

async function collectHandlers(rootDir, globalHighRiskAuditReady = false) {
  const files = await listIpcSourceFiles(rootDir)
  const sources = await Promise.all(files.map(async (relativePath) => ({
    relativePath,
    source: await fs.readFile(path.resolve(rootDir, relativePath), 'utf8'),
  })))
  return sources.flatMap(({ relativePath, source }) => (
    extractHandlersFromSource(source, relativePath, globalHighRiskAuditReady)
  ))
}

function summarizePreload(preloadSource, handlers) {
  const invokeChannels = unique(extractStringMatches(preloadSource, /ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)).sort()
  const subscriptionChannels = unique(extractStringMatches(preloadSource, /ipcRenderer\.on\(['"]([^'"]+)['"]/g)).sort()
  const handlerChannels = new Set(handlers.map((handler) => handler.channel))
  const invokeChannelSet = new Set(invokeChannels)

  return {
    invokeChannelCount: invokeChannels.length,
    subscriptionChannelCount: subscriptionChannels.length,
    missingHandlerChannels: invokeChannels.filter((channel) => !handlerChannels.has(channel)),
    handlersNotExposedToPreload: [...handlerChannels].filter((channel) => !invokeChannelSet.has(channel)).sort(),
    subscriptionChannels,
  }
}

function summarizeSubscriptionSources(subscriptionChannels, electronSourceText) {
  return subscriptionChannels
    .filter((channel) => !electronSourceText.includes(channel))
    .sort()
}

function summarizeValidation(handlers) {
  const payloadHandlers = handlers.filter((handler) => handler.payloadParamCount > 0)
  const unvalidatedPayloadChannels = payloadHandlers
    .filter((handler) => handler.requestValidationStatus === 'missing')
    .map((handler) => handler.channel)
    .sort()

  return {
    payloadHandlerCount: payloadHandlers.length,
    noPayloadHandlerCount: handlers.length - payloadHandlers.length,
    schemaValidatedCount: payloadHandlers.filter((handler) => handler.requestValidationStatus === 'schema').length,
    manualValidatedCount: payloadHandlers.filter((handler) => handler.requestValidationStatus === 'manual-validator').length,
    boundedSpecialCaseCount: payloadHandlers.filter((handler) => handler.requestValidationStatus === 'bounded-special-case').length,
    unvalidatedPayloadCount: unvalidatedPayloadChannels.length,
    unvalidatedPayloadChannels,
    fullRequestValidationReady: unvalidatedPayloadChannels.length === 0,
    responseValidationReady: false,
  }
}

function summarizeHighRisk(handlers) {
  const highRiskHandlers = handlers.filter((handler) => handler.highRisk)
  const unauditedHighRiskChannels = highRiskHandlers
    .filter((handler) => !handler.hasAuditCall)
    .map((handler) => handler.channel)
    .sort()

  return {
    highRiskHandlerCount: highRiskHandlers.length,
    auditedHighRiskHandlerCount: highRiskHandlers.length - unauditedHighRiskChannels.length,
    unauditedHighRiskCount: unauditedHighRiskChannels.length,
    unauditedHighRiskChannels,
    highRiskAuditReady: unauditedHighRiskChannels.length === 0,
  }
}

function summarizeGlobalHighRiskAudit({ auditedIpcText, ipcRegistryText }) {
  const installerExported = /\bexport\s+function\s+installHighRiskIpcAudit\b/.test(auditedIpcText)
  const highRiskClassifierExported = /\bexport\s+function\s+isHighRiskIpcChannel\b/.test(auditedIpcText)
  const writesAuditLog = /\bauditFn\s*\(\s*['"]ipc['"]\s*,\s*['"]high-risk-invoke['"]/.test(auditedIpcText)
    && /\bauditFn\s*:\s*audit\b/.test(ipcRegistryText)
  const avoidsPayloadCopy = !/\bargs\b[\s\S]{0,120}\baudit\s*\(/.test(auditedIpcText)
    && !/\bpayload\b[\s\S]{0,120}\baudit\s*\(/.test(auditedIpcText)
  const installedBeforeRegistration = /installHighRiskIpcAudit\s*\([^)]*\)[\s\S]*?windowIpc\.register\s*\(/.test(ipcRegistryText)
  const ready = installerExported
    && highRiskClassifierExported
    && writesAuditLog
    && avoidsPayloadCopy
    && installedBeforeRegistration

  return {
    ready,
    installerExported,
    highRiskClassifierExported,
    writesAuditLog,
    avoidsPayloadCopy,
    installedBeforeRegistration,
  }
}

function summarizeSecretBoundary({ vaultIpcText, vaultRefsText, handlers }) {
  const vaultRetrieveReturnsRefs = /ipcMain\.handle\(['"]vault:retrieve['"][\s\S]*?issueVaultRefForSender\s*\(/.test(vaultIpcText)
  const vaultRetrieveManyReturnsRefs = /ipcMain\.handle\(['"]vault:retrieve-many['"][\s\S]*?issueVaultRefForSender\s*\(/.test(vaultIpcText)
  const directVaultRetrieveImported = /import\s*\{[^}]*\bvaultRetrieve\b/.test(vaultIpcText)
  const outboundRefResolutionChannels = handlers
    .filter((handler) => handler.usesVaultRefResolution)
    .map((handler) => handler.channel)
    .sort()
  const refResolutionAvailable = /\bexport\s+async\s+function\s+resolveVaultRefsForSender\b/.test(vaultRefsText)
  const ready = vaultRetrieveReturnsRefs
    && vaultRetrieveManyReturnsRefs
    && !directVaultRetrieveImported
    && refResolutionAvailable
    && outboundRefResolutionChannels.length > 0

  return {
    ready,
    vaultRetrieveReturnsRefs,
    vaultRetrieveManyReturnsRefs,
    directVaultRetrieveImported,
    refResolutionAvailable,
    outboundRefResolutionChannelCount: outboundRefResolutionChannels.length,
    outboundRefResolutionChannels,
  }
}

function summarizeAuditLog(auditLogText) {
  return {
    exists: Boolean(auditLogText),
    appendOnlyJsonLines: auditLogText.includes('JSON.stringify(entry)') && auditLogText.includes("'\\n'"),
    rotationConfigured: auditLogText.includes('MAX_LOG_SIZE') && auditLogText.includes('MAX_ROTATED_FILES'),
    closeHookExported: auditLogText.includes('export function closeAuditLog'),
  }
}

export async function buildM3IpcSecurityReport(options = {}, context = {}) {
  const rootDir = context.rootDir || process.cwd()
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const [
    preloadSource,
    ipcRegistrySource,
    auditedIpcSource,
    auditLogSource,
    vaultIpcSource,
    vaultRefsSource,
  ] = await Promise.all([
    readText(rootDir, PRELOAD_PATH),
    readText(rootDir, IPC_REGISTRY_PATH),
    readText(rootDir, AUDITED_IPC_PATH),
    readText(rootDir, AUDIT_LOG_PATH),
    readText(rootDir, VAULT_IPC_PATH),
    readText(rootDir, VAULT_REFS_PATH),
  ])
  const globalHighRiskAudit = summarizeGlobalHighRiskAudit({
    auditedIpcText: auditedIpcSource.text,
    ipcRegistryText: ipcRegistrySource.text,
  })
  const handlers = await collectHandlers(rootDir, globalHighRiskAudit.ready)
  const electronSourceFiles = (await listJsFilesRecursive(rootDir, 'electron'))
    .filter((relativePath) => relativePath !== PRELOAD_PATH)
  const electronSources = await Promise.all(electronSourceFiles.map((relativePath) => (
    fs.readFile(path.resolve(rootDir, relativePath), 'utf8')
  )))
  const preload = summarizePreload(preloadSource.text, handlers)
  const missingSubscriptionSources = summarizeSubscriptionSources(preload.subscriptionChannels, electronSources.join('\n'))
  const missingTrustedSenderChannels = handlers
    .filter((handler) => !handler.hasTrustedSenderCheck)
    .map((handler) => handler.channel)
    .sort()
  const validation = summarizeValidation(handlers)
  const highRisk = summarizeHighRisk(handlers)
  const secretBoundary = summarizeSecretBoundary({
    vaultIpcText: vaultIpcSource.text,
    vaultRefsText: vaultRefsSource.text,
    handlers,
  })
  const auditLog = summarizeAuditLog(auditLogSource.text)
  const missingSourceIds = [
    preloadSource,
    ipcRegistrySource,
    auditedIpcSource,
    auditLogSource,
    vaultIpcSource,
    vaultRefsSource,
  ].filter((source) => !source.exists || source.error).map((source) => source.path)
  const baselineBlockingIssueIds = [
    ...missingSourceIds.map((id) => `missing-source:${id}`),
    ...preload.missingHandlerChannels.map((channel) => `missing-handler:${channel}`),
    ...preload.handlersNotExposedToPreload.map((channel) => `handler-not-exposed:${channel}`),
    ...missingSubscriptionSources.map((channel) => `missing-event-source:${channel}`),
    ...missingTrustedSenderChannels.map((channel) => `missing-trusted-sender:${channel}`),
    ...(!secretBoundary.ready ? ['secret-boundary-not-ready'] : []),
    ...(!auditLog.appendOnlyJsonLines || !auditLog.rotationConfigured ? ['audit-log-baseline-not-ready'] : []),
  ]
  const fullValidationBlockingIssueIds = options.requireFullValidation
    ? validation.unvalidatedPayloadChannels.map((channel) => `unvalidated-payload:${channel}`)
    : []
  const highRiskAuditBlockingIssueIds = options.requireHighRiskAudit
    ? highRisk.unauditedHighRiskChannels.map((channel) => `unaudited-high-risk:${channel}`)
    : []
  const blockingIssueIds = [
    ...baselineBlockingIssueIds,
    ...fullValidationBlockingIssueIds,
    ...highRiskAuditBlockingIssueIds,
  ]
  const ok = blockingIssueIds.length === 0

  return {
    schemaVersion: 1,
    gate: M3_IPC_SECURITY_GATE,
    generatedAt,
    ok,
    overallStatus: ok
      ? validation.fullRequestValidationReady && highRisk.highRiskAuditReady
        ? 'ready'
        : 'inventory-ready-with-known-gaps'
      : 'needs-ipc-security-work',
    targetMilestone: 'M3',
    sourceFiles: [
      { path: PRELOAD_PATH, exists: preloadSource.exists, error: preloadSource.error },
      { path: IPC_REGISTRY_PATH, exists: ipcRegistrySource.exists, error: ipcRegistrySource.error },
      { path: AUDITED_IPC_PATH, exists: auditedIpcSource.exists, error: auditedIpcSource.error },
      { path: AUDIT_LOG_PATH, exists: auditLogSource.exists, error: auditLogSource.error },
      { path: VAULT_IPC_PATH, exists: vaultIpcSource.exists, error: vaultIpcSource.error },
      { path: VAULT_REFS_PATH, exists: vaultRefsSource.exists, error: vaultRefsSource.error },
    ],
    totals: {
      ipcHandlerCount: handlers.length,
      preloadInvokeChannelCount: preload.invokeChannelCount,
      preloadSubscriptionChannelCount: preload.subscriptionChannelCount,
      ipcSourceFileCount: unique(handlers.map((handler) => handler.file)).length,
    },
    preloadContract: {
      missingHandlerChannels: preload.missingHandlerChannels,
      handlersNotExposedToPreload: preload.handlersNotExposedToPreload,
      missingSubscriptionSources,
    },
    trustedSender: {
      ready: missingTrustedSenderChannels.length === 0,
      missingTrustedSenderChannels,
    },
    requestValidation: validation,
    highRiskAudit: highRisk,
    globalHighRiskAudit,
    secretBoundary,
    auditLog,
    handlers,
    requirementMode: {
      requireFullValidation: Boolean(options.requireFullValidation),
      requireHighRiskAudit: Boolean(options.requireHighRiskAudit),
    },
    blockingIssueIds,
    nextActions: [
      ...(validation.fullRequestValidationReady ? [] : ['add-schema-or-manual-validation-for-payload-handlers']),
      ...(highRisk.highRiskAuditReady ? [] : ['add-redacted-audit-records-for-high-risk-handlers']),
      'add-response-shape-validation-to-high-risk-ipc-contracts',
      'promote-handler-contracts-into-a-central-registry',
    ],
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'IPC payload values',
        'API keys and vault plaintext',
        'chat messages and memory bodies',
        'local file contents',
        'plugin message data',
        'audit log entries',
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

export async function runM3IpcSecurityCli(argv = process.argv.slice(2)) {
  const options = parseM3IpcSecurityArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  const report = await buildM3IpcSecurityReport(options)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return (options.requireReady || options.requireFullValidation || options.requireHighRiskAudit) && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM3IpcSecurityCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
