#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildMessageAwarenessReleaseStatusReport,
} from './message-awareness-release-status.mjs'
import {
  buildStabilizationEvidenceStatusReport,
} from './stabilization-evidence-status.mjs'

export const V04_READINESS_STATUS_GATE = 'nexus-v04-readiness-status'
export const DEFAULT_V04_ARTIFACT_DIR = 'artifacts/v0.3.4'
export const DEFAULT_V04_LOCAL_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-local.json'
export const DEFAULT_V04_LIVE_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-live.json'
export const DEFAULT_V04_LIVE_PREFLIGHT_FILE = 'artifacts/v0.4.0/message-awareness-live-preflight.json'
export const DEFAULT_V04_MACOS_LIVE_PROBE_FILE = 'artifacts/v0.4.0/message-awareness-macos-live-probe.json'
export const DEFAULT_V04_LIVE_SESSION_FILE = 'artifacts/v0.4.0/message-awareness-live-session.json'
export const DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE = 'artifacts/v0.4.0/message-awareness-live-session.md'
export const DEFAULT_V04_COMPLETE_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-complete.json'
export const DEFAULT_V04_REDACTED_OUTPUT_FILE = 'docs/release-evidence/v0.4.0-message-awareness.json'
export const DEFAULT_V04_PRIVACY_SAFETY_FILE = 'artifacts/v0.3.4/privacy-safety.json'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/v04-readiness-status.mjs [options]',
    '',
    'Options:',
    `  --artifact-dir <path>             Directory containing P1/P2 evidence artifacts (default: ${DEFAULT_V04_ARTIFACT_DIR})`,
    '  --generated-at <iso>              Override report timestamp',
    `  --local-evidence-file <path>      Message-awareness local evidence file (default: ${DEFAULT_V04_LOCAL_EVIDENCE_FILE})`,
    `  --live-evidence-file <path>       Message-awareness live evidence file (default: ${DEFAULT_V04_LIVE_EVIDENCE_FILE})`,
    `  --live-preflight-file <path>      Message-awareness live preflight report (default: ${DEFAULT_V04_LIVE_PREFLIGHT_FILE})`,
    `  --macos-live-probe-file <path>    macOS live probe report (default: ${DEFAULT_V04_MACOS_LIVE_PROBE_FILE})`,
    `  --live-session-file <path>         Message live-session checklist report (default: ${DEFAULT_V04_LIVE_SESSION_FILE})`,
    `  --live-session-markdown-file <path> Message live-session Markdown operator packet (default: ${DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE})`,
    `  --complete-evidence-file <path>   Message-awareness merged release evidence file (default: ${DEFAULT_V04_COMPLETE_EVIDENCE_FILE})`,
    `  --redacted-output-file <path>     Commit-safe redacted evidence output (default: ${DEFAULT_V04_REDACTED_OUTPUT_FILE})`,
    `  --privacy-safety-file <path>      Privacy/safety evidence file (default: <artifact-dir>/privacy-safety.json)`,
    '  --output <path>                   Write the private-safe status JSON to a file',
    '  --require-ready                   Exit non-zero unless all v0.4 evidence gates are ready',
    '  --verify-release-ran              Assert npm run verify:release already ran in this release-gate chain',
    '  --help                           Show this help',
    '',
    'Examples:',
    '  npm run v04:readiness:status',
    '  npm run v04:readiness:status -- --require-ready',
    '  npm run v04:release:gate',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').trim()
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

function assignOption(options, name, value) {
  switch (name) {
    case '--artifact-dir':
    case '--artifacts-dir':
    case '--input-dir':
      options.artifactDir = value
      return
    case '--generated-at':
      options.generatedAt = value
      return
    case '--local-evidence-file':
      options.localEvidenceFile = value
      return
    case '--live-evidence-file':
      options.liveEvidenceFile = value
      return
    case '--live-preflight-file':
      options.livePreflightFile = value
      return
    case '--macos-live-probe-file':
      options.macosLiveProbeFile = value
      return
    case '--live-session-file':
    case '--message-live-session-file':
      options.liveSessionFile = value
      return
    case '--live-session-markdown-file':
    case '--message-live-session-markdown-file':
    case '--operator-packet-file':
      options.liveSessionMarkdownFile = value
      return
    case '--complete-evidence-file':
      options.completeEvidenceFile = value
      return
    case '--redacted-output-file':
      options.redactedOutputFile = value
      return
    case '--privacy-safety-file':
      options.privacySafetyFile = value
      return
    case '--output':
    case '--output-file':
    case '--evidence-file':
      options.outputPath = value
      return
    default:
      throw new Error(`Unknown option: ${name}`)
  }
}

export function parseV04ReadinessStatusArgs(argv) {
  const options = {
    artifactDir: DEFAULT_V04_ARTIFACT_DIR,
    completeEvidenceFile: DEFAULT_V04_COMPLETE_EVIDENCE_FILE,
    generatedAt: '',
    help: false,
    liveEvidenceFile: DEFAULT_V04_LIVE_EVIDENCE_FILE,
    livePreflightFile: DEFAULT_V04_LIVE_PREFLIGHT_FILE,
    macosLiveProbeFile: DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
    liveSessionFile: DEFAULT_V04_LIVE_SESSION_FILE,
    liveSessionMarkdownFile: DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE,
    localEvidenceFile: DEFAULT_V04_LOCAL_EVIDENCE_FILE,
    outputPath: '',
    privacySafetyFile: '',
    redactedOutputFile: DEFAULT_V04_REDACTED_OUTPUT_FILE,
    requireReady: false,
    verifyReleaseRan: false,
  }
  const positional = []

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
    if (arg === '--verify-release-ran') {
      options.verifyReleaseRan = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      assignOption(options, name, parsed.value)
      index = parsed.nextIndex
      continue
    }
    positional.push(arg)
  }

  if (positional.length > 0 && options.artifactDir === DEFAULT_V04_ARTIFACT_DIR) {
    options.artifactDir = positional[0]
  }

  return options
}

function buildLivePreflightFailureReport({ generatedAt, path: filePath, reason }) {
  return {
    schemaVersion: 1,
    gate: 'message-awareness-live-preflight',
    generatedAt,
    ok: false,
    overallStatus: 'missing',
    releaseGateComplete: false,
    checks: [],
    blockingCheckIds: [],
    file: {
      path: filePath,
      exists: false,
      error: reason,
    },
  }
}

function summarizeLivePreflightReport(raw, { generatedAt, path: filePath }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return buildLivePreflightFailureReport({ generatedAt, path: filePath, reason: 'not-object' })
  }
  if (raw.gate !== 'message-awareness-live-preflight') {
    return buildLivePreflightFailureReport({ generatedAt, path: filePath, reason: 'wrong-gate' })
  }
  const checks = Array.isArray(raw.checks)
    ? raw.checks
      .filter((check) => check && typeof check === 'object')
      .map((check) => ({
        id: cleanString(check.id) || 'unknown',
        status: cleanString(check.status) || 'unknown',
        blocking: check.blocking === true,
        machineChecked: check.diagnostics?.machineChecked === true,
      }))
    : []
  const blockingCheckIds = Array.isArray(raw.blockingCheckIds)
    ? raw.blockingCheckIds.map(cleanString).filter(Boolean)
    : checks.filter((check) => check.blocking).map((check) => check.id)
  return {
    schemaVersion: 1,
    gate: 'message-awareness-live-preflight',
    generatedAt: normalizeIso(raw.generatedAt || generatedAt),
    ok: raw.ok === true && blockingCheckIds.length === 0,
    overallStatus: cleanString(raw.overallStatus) || (blockingCheckIds.length > 0 ? 'environment-blocked' : 'unknown'),
    releaseGateComplete: false,
    checks,
    blockingCheckIds,
    file: {
      path: filePath,
      exists: true,
      error: null,
    },
  }
}

async function readLivePreflightReport(filePath, generatedAt) {
  const target = cleanString(filePath)
  const resolved = path.resolve(process.cwd(), target)
  try {
    const raw = JSON.parse(await fs.readFile(resolved, 'utf8'))
    return summarizeLivePreflightReport(raw, { generatedAt, path: target })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return buildLivePreflightFailureReport({ generatedAt, path: target, reason: 'missing' })
    }
    return buildLivePreflightFailureReport({ generatedAt, path: target, reason: 'invalid-json' })
  }
}

function buildLiveSessionFailureReport({ generatedAt, path: filePath, reason }) {
  return {
    schemaVersion: 1,
    gate: 'nexus-v04-message-live-session',
    generatedAt,
    ok: false,
    overallStatus: 'missing',
    readyToRecordPendingChecks: false,
    safeToRunPendingRecordCommands: false,
    pendingCheckIds: [],
    recordSafetySummary: {
      pendingRecordCount: 0,
      readyToAttemptCount: 0,
      safeToRunCount: 0,
      blockedCount: 0,
      needsOperatorValuesCount: 0,
      unavailableCount: 0,
      unknownCount: 0,
      unsafeRecordStepIds: [],
    },
    stepExecutionSummary: {
      automationSafeCommandCount: 0,
      manualRecordStepCount: 0,
      blockedStepCount: 0,
      unsafeRecordStepCount: 0,
      automationSafeCommandIds: [],
      manualRecordStepIds: [],
      blockedStepIds: [],
      unsafeRecordStepIds: [],
    },
    bridgeTrace: {
      exists: false,
      error: reason,
      telegramHasTraceEvidence: false,
      discordHasTraceEvidence: false,
    },
    macosRecord: null,
    recordSteps: [],
    file: {
      path: filePath,
      exists: false,
      error: reason,
      updatedAt: null,
      mtimeMs: null,
    },
  }
}

function summarizeStepExecutionSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return {
      automationSafeCommandCount: 0,
      manualRecordStepCount: 0,
      blockedStepCount: 0,
      unsafeRecordStepCount: 0,
      automationSafeCommandIds: [],
      manualRecordStepIds: [],
      blockedStepIds: [],
      unsafeRecordStepIds: [],
    }
  }
  return {
    automationSafeCommandCount: Number.isFinite(Number(summary.automationSafeCommandCount))
      ? Number(summary.automationSafeCommandCount)
      : 0,
    manualRecordStepCount: Number.isFinite(Number(summary.manualRecordStepCount))
      ? Number(summary.manualRecordStepCount)
      : 0,
    blockedStepCount: Number.isFinite(Number(summary.blockedStepCount))
      ? Number(summary.blockedStepCount)
      : 0,
    unsafeRecordStepCount: Number.isFinite(Number(summary.unsafeRecordStepCount))
      ? Number(summary.unsafeRecordStepCount)
      : 0,
    automationSafeCommandIds: Array.isArray(summary.automationSafeCommandIds)
      ? summary.automationSafeCommandIds.map(cleanString).filter(Boolean)
      : [],
    manualRecordStepIds: Array.isArray(summary.manualRecordStepIds)
      ? summary.manualRecordStepIds.map(cleanString).filter(Boolean)
      : [],
    blockedStepIds: Array.isArray(summary.blockedStepIds)
      ? summary.blockedStepIds.map(cleanString).filter(Boolean)
      : [],
    unsafeRecordStepIds: Array.isArray(summary.unsafeRecordStepIds)
      ? summary.unsafeRecordStepIds.map(cleanString).filter(Boolean)
      : [],
  }
}

function summarizeRecordCommandSafety(safety) {
  if (!safety || typeof safety !== 'object' || Array.isArray(safety)) return null
  return {
    status: cleanString(safety.status) || null,
    safeToRunRecordCommand: safety.safeToRunRecordCommand === true,
    dryRunRecommended: safety.dryRunRecommended === true,
    preflightRecommended: safety.preflightRecommended === true,
    placeholderTokens: Array.isArray(safety.placeholderTokens)
      ? safety.placeholderTokens.map(cleanString).filter(Boolean)
      : [],
    missingProofFieldIds: Array.isArray(safety.missingProofFieldIds)
      ? safety.missingProofFieldIds.map(cleanString).filter(Boolean)
      : [],
    reasons: Array.isArray(safety.reasons)
      ? safety.reasons.map(cleanString).filter(Boolean)
      : [],
  }
}

function summarizeRecordSafetySummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return {
      pendingRecordCount: 0,
      readyToAttemptCount: 0,
      safeToRunCount: 0,
      blockedCount: 0,
      needsOperatorValuesCount: 0,
      unavailableCount: 0,
      unknownCount: 0,
      unsafeRecordStepIds: [],
    }
  }
  return {
    pendingRecordCount: Number.isFinite(Number(summary.pendingRecordCount)) ? Number(summary.pendingRecordCount) : 0,
    readyToAttemptCount: Number.isFinite(Number(summary.readyToAttemptCount)) ? Number(summary.readyToAttemptCount) : 0,
    safeToRunCount: Number.isFinite(Number(summary.safeToRunCount)) ? Number(summary.safeToRunCount) : 0,
    blockedCount: Number.isFinite(Number(summary.blockedCount)) ? Number(summary.blockedCount) : 0,
    needsOperatorValuesCount: Number.isFinite(Number(summary.needsOperatorValuesCount)) ? Number(summary.needsOperatorValuesCount) : 0,
    unavailableCount: Number.isFinite(Number(summary.unavailableCount)) ? Number(summary.unavailableCount) : 0,
    unknownCount: Number.isFinite(Number(summary.unknownCount)) ? Number(summary.unknownCount) : 0,
    unsafeRecordStepIds: Array.isArray(summary.unsafeRecordStepIds)
      ? summary.unsafeRecordStepIds.map(cleanString).filter(Boolean)
      : [],
  }
}

function summarizeLiveSessionRecordStep(step) {
  return {
    id: cleanString(step?.id) || null,
    checkId: cleanString(step?.checkId) || null,
    status: cleanString(step?.status) || null,
    readyToAttempt: step?.readyToAttempt === true,
    bridgeTraceApplied: step?.bridgeTraceApplied === true,
    machinePrerequisite: step?.machinePrerequisite
      ? {
          id: cleanString(step.machinePrerequisite.id) || null,
          status: cleanString(step.machinePrerequisite.status) || null,
          releaseEvidenceCandidate: step.machinePrerequisite.releaseEvidenceCandidate === true,
        }
      : null,
    recordCommandSafety: summarizeRecordCommandSafety(step?.recordCommandSafety),
  }
}

function summarizeLiveSessionReport(raw, { generatedAt, path: filePath, stat = null }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return buildLiveSessionFailureReport({ generatedAt, path: filePath, reason: 'not-object' })
  }
  if (raw.gate !== 'nexus-v04-message-live-session') {
    return buildLiveSessionFailureReport({ generatedAt, path: filePath, reason: 'wrong-gate' })
  }
  const steps = Array.isArray(raw.steps) ? raw.steps : []
  const macosRecord = steps.find((step) => step?.id === 'record-macos-notification-center-live')
  const recordSteps = steps
    .filter((step) => cleanString(step?.id).startsWith('record-'))
    .map(summarizeLiveSessionRecordStep)
    .filter((step) => step.id)
  const bridgeTrace = raw.sourceReports?.bridgeTrace
  return {
    schemaVersion: 1,
    gate: 'nexus-v04-message-live-session',
    generatedAt: normalizeIso(raw.generatedAt || generatedAt),
    ok: raw.ok === true,
    overallStatus: cleanString(raw.overallStatus) || 'unknown',
    readyToRecordPendingChecks: raw.readyToRecordPendingChecks === true,
    safeToRunPendingRecordCommands: raw.safeToRunPendingRecordCommands === true,
    recordSafetySummary: summarizeRecordSafetySummary(raw.recordSafetySummary),
    stepExecutionSummary: summarizeStepExecutionSummary(raw.stepExecutionSummary),
    pendingCheckIds: Array.isArray(raw.pendingCheckIds)
      ? raw.pendingCheckIds.map(cleanString).filter(Boolean)
      : [],
    bridgeTrace: {
      exists: bridgeTrace?.exists === true,
      error: bridgeTrace?.error ?? null,
      telegramHasTraceEvidence: bridgeTrace?.telegram?.hasTraceEvidence === true,
      discordHasTraceEvidence: bridgeTrace?.discord?.hasTraceEvidence === true,
    },
    macosRecord: macosRecord
      ? {
          readyToAttempt: macosRecord.readyToAttempt === true,
          machinePrerequisite: macosRecord.machinePrerequisite
            ? {
                id: cleanString(macosRecord.machinePrerequisite.id) || null,
                status: cleanString(macosRecord.machinePrerequisite.status) || null,
                releaseEvidenceCandidate: macosRecord.machinePrerequisite.releaseEvidenceCandidate === true,
              }
            : null,
        }
      : null,
    recordSteps,
    file: {
      path: filePath,
      exists: true,
      error: null,
      updatedAt: typeof stat?.mtimeMs === 'number' ? new Date(stat.mtimeMs).toISOString() : null,
      mtimeMs: typeof stat?.mtimeMs === 'number' ? stat.mtimeMs : null,
    },
  }
}

async function readLiveSessionReport(filePath, generatedAt) {
  const target = cleanString(filePath)
  const resolved = path.resolve(process.cwd(), target)
  try {
    const [text, stat] = await Promise.all([
      fs.readFile(resolved, 'utf8'),
      fs.stat(resolved),
    ])
    const raw = JSON.parse(text)
    return summarizeLiveSessionReport(raw, { generatedAt, path: target, stat })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return buildLiveSessionFailureReport({ generatedAt, path: target, reason: 'missing' })
    }
    return buildLiveSessionFailureReport({ generatedAt, path: target, reason: 'invalid-json' })
  }
}

async function readPrivateSafeFileStatus(filePath) {
  const target = cleanString(filePath)
  const summary = {
    path: target,
    exists: false,
    error: target ? null : 'missing-path',
    sizeBytes: null,
    updatedAt: null,
    mtimeMs: null,
  }
  if (!target) return summary
  try {
    const stat = await fs.stat(path.resolve(process.cwd(), target))
    return {
      ...summary,
      exists: stat.isFile(),
      error: stat.isFile() ? null : 'not-file',
      sizeBytes: stat.isFile() ? stat.size : null,
      updatedAt: stat.isFile() ? new Date(stat.mtimeMs).toISOString() : null,
      mtimeMs: stat.isFile() ? stat.mtimeMs : null,
    }
  } catch (error) {
    return {
      ...summary,
      error: error?.code === 'ENOENT' ? 'missing' : 'stat-failed',
    }
  }
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function buildCheck({ id, area, label, pass, status, detail, evidence, command }) {
  return {
    id,
    area,
    label,
    pass,
    status,
    detail,
    evidence,
    ...(command ? { command } : {}),
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOperatorPacketStale(liveSession, liveSessionMarkdown) {
  if (liveSession?.file?.exists !== true || liveSessionMarkdown?.exists !== true) return false
  const liveSessionMtimeMs = liveSession.file.mtimeMs
  const packetMtimeMs = liveSessionMarkdown.mtimeMs
  if (!isFiniteNumber(liveSessionMtimeMs) || !isFiniteNumber(packetMtimeMs)) return false
  return packetMtimeMs + 1 < liveSessionMtimeMs
}

function summarizeOperatorPacket(liveSession, liveSessionMarkdown) {
  if (!liveSessionMarkdown) return null
  return {
    path: liveSessionMarkdown.path,
    exists: liveSessionMarkdown.exists === true,
    error: liveSessionMarkdown.error ?? null,
    sizeBytes: isFiniteNumber(liveSessionMarkdown.sizeBytes)
      ? liveSessionMarkdown.sizeBytes
      : null,
    updatedAt: cleanString(liveSessionMarkdown.updatedAt) || null,
    stale: isOperatorPacketStale(liveSession, liveSessionMarkdown),
  }
}

function recordStepForCommandId(liveSession, commandId) {
  const rawTarget = cleanString(commandId)
  const target = rawTarget.startsWith('message-record-')
    ? rawTarget.replace(/^message-/, '')
    : rawTarget
  if (!target.startsWith('record-')) return null
  const steps = Array.isArray(liveSession?.recordSteps) ? liveSession.recordSteps : []
  return steps.find((step) => step.id === target) ?? null
}

function summarizeRecordCommandExecution(liveSessionRecordStep) {
  const safety = liveSessionRecordStep?.recordCommandSafety
  if (!safety) {
    return {
      safeToRun: false,
      executionMode: 'record-safety-unknown',
    }
  }
  if (safety.safeToRunRecordCommand === true) {
    return {
      safeToRun: true,
      executionMode: 'ready-record-command',
    }
  }
  if (safety.status === 'blocked') {
    return {
      safeToRun: false,
      executionMode: 'blocked-record-command',
    }
  }
  if (safety.status === 'needs-operator-values') {
    return {
      safeToRun: false,
      executionMode: 'manual-template-record-command',
    }
  }
  return {
    safeToRun: false,
    executionMode: cleanString(safety.status) || 'record-safety-unknown',
  }
}

function nextCommandIdentity(entry) {
  const id = cleanString(entry?.id)
  const command = cleanString(entry?.command)
  if (!id || !command) return null
  return { id, command }
}

function isRecordNextCommand(entry, id) {
  return id.startsWith('message-record-')
    || Boolean(entry?.recordCommandSafety)
    || cleanString(entry?.executionMode).includes('record-command')
}

function classifyNextCommand(entry) {
  const identity = nextCommandIdentity(entry)
  if (!identity) return null
  const executionMode = cleanString(entry?.executionMode)
  const recordCommand = isRecordNextCommand(entry, identity.id)
  const manualTemplate = entry?.isTemplate === true
    || entry?.mustReplacePlaceholders === true
    || executionMode === 'manual-template-record-command'
  const blocked = executionMode === 'blocked-record-command'
    || entry?.recordCommandSafety?.status === 'blocked'
  const safeToRun = entry?.safeToRun === true
    ? true
    : entry?.safeToRun === false
      ? false
      : recordCommand
        ? false
        : !manualTemplate

  return {
    ...identity,
    blocked,
    executionMode,
    manualTemplate,
    recordCommand,
    safeToRun,
  }
}

export function summarizeNextCommandAutomation(nextCommands = []) {
  const classifications = Array.isArray(nextCommands)
    ? nextCommands.map(classifyNextCommand).filter(Boolean)
    : []
  const automationSafeCommandIds = []
  const manualCommandIds = []
  const unsafeCommandIds = []
  const blockedCommandIds = []
  const recordSummary = {
    totalRecordCommandCount: 0,
    safeToRunCount: 0,
    manualTemplateCount: 0,
    blockedCount: 0,
    unknownCount: 0,
    unsafeRecordCommandIds: [],
  }

  for (const entry of classifications) {
    if (entry.safeToRun) {
      automationSafeCommandIds.push(entry.id)
    } else {
      unsafeCommandIds.push(entry.id)
    }
    if (!entry.safeToRun && (entry.manualTemplate || entry.recordCommand)) {
      manualCommandIds.push(entry.id)
    }
    if (entry.blocked) blockedCommandIds.push(entry.id)

    if (entry.recordCommand) {
      recordSummary.totalRecordCommandCount += 1
      if (entry.safeToRun) recordSummary.safeToRunCount += 1
      if (entry.manualTemplate) recordSummary.manualTemplateCount += 1
      if (entry.blocked) recordSummary.blockedCount += 1
      if (!entry.safeToRun) recordSummary.unsafeRecordCommandIds.push(entry.id)
      if (
        !entry.safeToRun
        && !entry.manualTemplate
        && !entry.blocked
        && !entry.executionMode
      ) {
        recordSummary.unknownCount += 1
      }
    }
  }

  return {
    automationSafeCount: automationSafeCommandIds.length,
    manualCount: manualCommandIds.length,
    unsafeCount: unsafeCommandIds.length,
    blockedCount: blockedCommandIds.length,
    automationSafeCommandIds,
    manualCommandIds,
    unsafeCommandIds,
    blockedCommandIds,
    recordCommandExecutionSummary: recordSummary,
  }
}

function filterAutomationSafeNextCommands(nextCommands, automationSummary) {
  const safeIds = new Set(automationSummary.automationSafeCommandIds)
  return Array.isArray(nextCommands)
    ? nextCommands.filter((entry) => safeIds.has(cleanString(entry?.id)))
    : []
}

function summarizeMessageEvidence(message, liveSession = null, liveSessionMarkdown = null) {
  const localWebhookPass = message.localEvidence?.audit?.localWebhook?.pass === true
    || message.completeEvidence?.audit?.localWebhook?.pass === true
  const rawReleaseGateComplete = message.rawReleaseGateComplete === true
    || message.completeEvidence?.audit?.releaseGateComplete === true
  const liveAudit = rawReleaseGateComplete
    ? message.completeEvidence?.audit?.liveEvidence ?? message.liveEvidence?.audit
    : message.liveEvidence?.audit ?? message.completeEvidence?.audit?.liveEvidence
  const pendingCheckIds = Array.isArray(liveAudit?.pendingCheckIds)
    ? liveAudit.pendingCheckIds.filter((entry) => typeof entry === 'string')
    : []
  const redactionGateComplete = message.redactionGateComplete === true
    || message.redactedEvidence?.redactionGateComplete === true
  const releaseGateComplete = message.releaseGateComplete === true

  return {
    localWebhookPass,
    liveGateComplete: liveAudit?.liveGateComplete === true,
    livePassedCount: typeof liveAudit?.passedCount === 'number' ? liveAudit.passedCount : null,
    liveTotalCount: typeof liveAudit?.totalCount === 'number' ? liveAudit.totalCount : null,
    pendingCheckIds,
    rawReleaseGateComplete,
    redactionGateComplete,
    releaseGateComplete,
    macosLiveProbe: message.macosLiveProbe
      ? {
          exists: message.macosLiveProbe.exists === true,
          ok: message.macosLiveProbe.ok === true,
          status: message.macosLiveProbe.status ?? null,
          releaseEvidenceCandidate: message.macosLiveProbe.releaseEvidenceCandidate === true,
          diagnostics: message.macosLiveProbe.diagnostics ?? null,
        }
      : null,
    liveSession: liveSession
      ? {
          exists: liveSession.file?.exists === true,
          ok: liveSession.ok === true,
          overallStatus: liveSession.overallStatus ?? null,
          readyToRecordPendingChecks: liveSession.readyToRecordPendingChecks === true,
          safeToRunPendingRecordCommands: liveSession.safeToRunPendingRecordCommands === true,
          recordSafetySummary: liveSession.recordSafetySummary ?? null,
          stepExecutionSummary: liveSession.stepExecutionSummary ?? null,
          pendingCheckIds: Array.isArray(liveSession.pendingCheckIds) ? liveSession.pendingCheckIds : [],
          bridgeTrace: liveSession.bridgeTrace ?? null,
          macosRecord: liveSession.macosRecord ?? null,
          recordSteps: Array.isArray(liveSession.recordSteps) ? liveSession.recordSteps : [],
          operatorPacket: summarizeOperatorPacket(liveSession, liveSessionMarkdown),
        }
      : null,
  }
}

function summarizeMessagePendingDetail(messageSummary) {
  if (messageSummary.pendingCheckIds.length > 0) {
    return messageSummary.pendingCheckIds.join(', ')
  }
  if (messageSummary.rawReleaseGateComplete && !messageSummary.redactionGateComplete) {
    return 'redacted release evidence is not green'
  }
  if (!messageSummary.rawReleaseGateComplete) {
    return 'complete evidence is not green'
  }
  return 'message-awareness release evidence is not green'
}

function buildPrivacySafetyFileFailureReport({ generatedAt, path: filePath, reason }) {
  return {
    schemaVersion: 1,
    gate: 'v0.4-privacy-safety-boundaries',
    generatedAt,
    ok: false,
    policy: {},
    checks: [
      {
        id: 'privacy-safety-evidence-file',
        pass: false,
        detail: `Privacy/safety evidence file is ${reason}.`,
        evidence: {
          path: filePath,
          reason,
        },
      },
    ],
    failedCheckIds: ['privacy-safety-evidence-file'],
  }
}

function summarizePrivacySafetyEvidence(raw, { generatedAt, path: filePath }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return buildPrivacySafetyFileFailureReport({ generatedAt, path: filePath, reason: 'not-object' })
  }
  if (raw.gate !== 'v0.4-privacy-safety-boundaries') {
    return buildPrivacySafetyFileFailureReport({ generatedAt, path: filePath, reason: 'wrong-gate' })
  }
  const checks = Array.isArray(raw.checks)
    ? raw.checks
      .filter((check) => check && typeof check === 'object')
      .map((check) => ({
        id: cleanString(check.id) || 'unknown',
        pass: check.pass === true,
        detail: cleanString(check.detail),
        evidence: check.evidence && typeof check.evidence === 'object' && !Array.isArray(check.evidence)
          ? { ...check.evidence }
          : {},
      }))
    : []
  const failedCheckIds = Array.isArray(raw.failedCheckIds)
    ? raw.failedCheckIds.map(cleanString).filter(Boolean)
    : checks.filter((check) => !check.pass).map((check) => check.id)
  return {
    schemaVersion: 1,
    gate: 'v0.4-privacy-safety-boundaries',
    generatedAt: normalizeIso(raw.generatedAt || generatedAt),
    ok: raw.ok === true && failedCheckIds.length === 0 && checks.length > 0,
    policy: raw.policy && typeof raw.policy === 'object' && !Array.isArray(raw.policy)
      ? { ...raw.policy }
      : {},
    checks,
    failedCheckIds,
  }
}

async function readPrivacySafetyEvidenceReport(filePath, generatedAt) {
  const target = cleanString(filePath)
  const resolved = path.resolve(process.cwd(), target)
  try {
    const raw = JSON.parse(await fs.readFile(resolved, 'utf8'))
    return summarizePrivacySafetyEvidence(raw, { generatedAt, path: target })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return buildPrivacySafetyFileFailureReport({ generatedAt, path: target, reason: 'missing' })
    }
    return buildPrivacySafetyFileFailureReport({ generatedAt, path: target, reason: 'invalid-json' })
  }
}

function buildChecks({ stabilization, message, livePreflight, liveSession, liveSessionMarkdown, privacySafety, verifyReleaseRan }) {
  const messageSummary = summarizeMessageEvidence(message, liveSession, liveSessionMarkdown)
  const livePreflightBlockingCheckIds = Array.isArray(livePreflight?.blockingCheckIds)
    ? livePreflight.blockingCheckIds
    : []
  const stabilizationRequiredBlocking = [
    ...stabilization.missingCheckIds,
    ...stabilization.failedCheckIds,
    ...stabilization.invalidCheckIds,
  ]
  const checks = [
    buildCheck({
      id: 'release.verify_release_command',
      area: 'release',
      label: 'Release verification command',
      pass: verifyReleaseRan === true,
      status: verifyReleaseRan === true ? 'ready' : 'external-required',
      detail: verifyReleaseRan === true
        ? 'npm run verify:release already ran earlier in this v0.4 release-gate chain.'
        : 'Run npm run verify:release in the current worktree before cutting v0.4.',
      evidence: {
        command: 'npm run verify:release',
        notRunByStatusScript: verifyReleaseRan !== true,
        assertedByCaller: verifyReleaseRan === true,
      },
      command: 'npm run verify:release',
    }),
    buildCheck({
      id: 'evidence.stabilization_status',
      area: 'evidence',
      label: 'P1/P2 stabilization evidence',
      pass: stabilization.ok === true,
      status: stabilization.ok === true
        ? stabilization.overallStatus
        : 'needs-evidence',
      detail: stabilization.ok === true
        ? `${stabilization.requiredPassCount}/${stabilization.requiredTotalCount} required stabilization artifact(s) pass.`
        : `Required stabilization artifact gap(s): ${stabilizationRequiredBlocking.join(', ') || 'unknown'}.`,
      evidence: {
        overallStatus: stabilization.overallStatus,
        requiredPassCount: stabilization.requiredPassCount,
        requiredTotalCount: stabilization.requiredTotalCount,
        missingCheckIds: stabilization.missingCheckIds,
        failedCheckIds: stabilization.failedCheckIds,
        invalidCheckIds: stabilization.invalidCheckIds,
        optionalFailedCheckIds: stabilization.optionalFailedCheckIds,
      },
      command: 'npm run stabilization:evidence:status -- --require-ready',
    }),
    buildCheck({
      id: 'message_awareness.release_gate',
      area: 'message_awareness',
      label: 'Message-awareness release gate',
      pass: messageSummary.releaseGateComplete,
      status: messageSummary.releaseGateComplete
        ? 'ready'
        : livePreflightBlockingCheckIds.length > 0
          ? 'environment-blocked'
          : messageSummary.localWebhookPass || (messageSummary.livePassedCount ?? 0) > 0
          ? 'partial'
          : 'needs-live-evidence',
      detail: messageSummary.releaseGateComplete
        ? 'Message-awareness local smoke, live checks, merged release evidence, and redacted release evidence are complete.'
        : livePreflightBlockingCheckIds.length > 0
          ? `Message-awareness live preflight blocked by host environment: ${livePreflightBlockingCheckIds.join(', ')}.`
          : `Message-awareness release gate pending: ${summarizeMessagePendingDetail(messageSummary)}.`,
      evidence: {
        ...messageSummary,
        livePreflight: {
          exists: livePreflight?.file?.exists === true,
          ok: livePreflight?.ok === true,
          overallStatus: livePreflight?.overallStatus ?? null,
          blockingCheckIds: livePreflightBlockingCheckIds,
        },
      },
      command: 'npm run v04:message:status:release',
    }),
    buildCheck({
      id: 'privacy_safety.boundaries',
      area: 'privacy_safety',
      label: 'Privacy and safety boundaries',
      pass: privacySafety.ok === true,
      status: privacySafety.ok === true ? 'ready' : 'needs-policy-evidence',
      detail: privacySafety.ok
        ? 'AI disclosure, crisis support, age posture, and adult-market boundaries pass.'
        : `Privacy/safety failed check(s): ${privacySafety.failedCheckIds.join(', ') || 'unknown'}.`,
      evidence: {
        gate: privacySafety.gate,
        failedCheckIds: privacySafety.failedCheckIds,
        checkCount: privacySafety.checks.length,
        adultOrNsfwMarketplaceAllowed: privacySafety.policy?.adultOrNsfwMarketplaceAllowed ?? null,
        dependencyReinforcementMechanicsAllowed: privacySafety.policy?.dependencyReinforcementMechanicsAllowed ?? null,
        humanRelationshipSubstituteClaimAllowed: privacySafety.policy?.humanRelationshipSubstituteClaimAllowed ?? null,
        minorDirectedExperienceAllowed: privacySafety.policy?.minorDirectedExperienceAllowed ?? null,
        relationshipScoreMechanicsAllowed: privacySafety.policy?.relationshipScoreMechanicsAllowed ?? null,
      },
      command: 'npm run privacy:safety:report -- --output artifacts/v0.3.4/privacy-safety.json --require-ready',
    }),
  ]

  return checks
}

function buildNextCommands(checks, stabilization, message, liveSession, liveSessionMarkdown) {
  const commands = []
  if (checks.some((check) => check.id === 'release.verify_release_command' && !check.pass)) {
    commands.push({
      id: 'verify-release',
      command: 'npm run verify:release',
      reason: 'the v0.4 status script does not run the full build/lint/test/distribution audit itself',
    })
  }
  if (checks.some((check) => check.id === 'privacy_safety.boundaries' && !check.pass)) {
    commands.push({
      id: 'privacy-safety-report',
      command: 'npm run privacy:safety:report -- --output artifacts/v0.3.4/privacy-safety.json --require-ready',
      reason: 'v0.4 readiness reads source-backed privacy/safety posture from the local evidence artifact',
    })
  }
  for (const command of stabilization.nextCommands ?? []) {
    commands.push({
      id: `stabilization-${command.id}`,
      command: command.command,
      reason: command.reason,
    })
  }
  const messageCheck = checks.find((check) => check.id === 'message_awareness.release_gate')
  const liveSessionMissing = liveSession?.file?.exists !== true
  const operatorPacketMissing = liveSessionMarkdown?.exists !== true
  const operatorPacketStale = isOperatorPacketStale(liveSession, liveSessionMarkdown)
  if (messageCheck?.pass !== true && (liveSessionMissing || operatorPacketMissing || operatorPacketStale)) {
    commands.push({
      id: 'message-live-session',
      command: 'npm run v04:message:live:session',
      reason: liveSessionMissing
        ? 'write the private-safe JSON and Markdown live evidence operator packet before recording real external checks'
        : operatorPacketStale
          ? 'refresh the stale private-safe Markdown live evidence operator packet after the JSON checklist changed'
          : 'refresh the private-safe Markdown live evidence operator packet before recording real external checks',
    })
  }
  for (const command of message.nextCommands ?? []) {
    const commandId = shouldPreferV04FinalizeCommand(command, message)
      ? 'finalize-release-evidence'
      : command.id
    const liveSessionRecordStep = recordStepForCommandId(liveSession, commandId)
    const recordCommandExecution = liveSessionRecordStep
      ? summarizeRecordCommandExecution(liveSessionRecordStep)
      : null
    commands.push({
      id: `message-${commandId}`,
      command: toV04MessageCommand(commandId, command.command, message),
      reason: command.reason,
      ...(liveSessionRecordStep
        ? {
            ...recordCommandExecution,
            readyToAttempt: liveSessionRecordStep.readyToAttempt === true,
            liveSessionStepStatus: liveSessionRecordStep.status,
            bridgeTraceApplied: liveSessionRecordStep.bridgeTraceApplied === true,
            ...(liveSessionRecordStep.machinePrerequisite
              ? { machinePrerequisite: liveSessionRecordStep.machinePrerequisite }
              : {}),
            ...(liveSessionRecordStep.recordCommandSafety
              ? { recordCommandSafety: liveSessionRecordStep.recordCommandSafety }
              : {}),
          }
        : {}),
      ...(command.dryRunCommand ? { dryRunCommand: toV04MessageCommand(commandId, command.dryRunCommand, message) } : {}),
      ...(command.preflightCommand ? { preflightCommand: toV04MessageCommand(commandId, command.preflightCommand, message) } : {}),
      ...(command.isTemplate === true ? { isTemplate: true } : {}),
      ...(command.mustReplacePlaceholders === true ? { mustReplacePlaceholders: true } : {}),
      ...(Array.isArray(command.placeholderFields) ? { placeholderFields: command.placeholderFields } : {}),
      ...(Array.isArray(command.placeholderValues) ? { placeholderValues: command.placeholderValues } : {}),
    })
  }
  return commands
}

function shellQuote(value) {
  return `"${String(value ?? '').replace(/(["\\$`])/g, '\\$1')}"`
}

function hasCompleteMessageLiveEvidence(message) {
  return message.localEvidence?.audit?.localWebhook?.pass === true
    && message.liveEvidence?.audit?.liveGateComplete === true
    && message.completeEvidence?.audit?.releaseGateComplete !== true
}

function shouldPreferV04FinalizeCommand(command, message) {
  return command?.id === 'merge-release-evidence'
    && hasCompleteMessageLiveEvidence(message)
}

function buildV04FinalizeCommand(message) {
  const files = message.files ?? {}
  const localEvidenceFile = cleanString(files.local?.path)
  const liveEvidenceFile = cleanString(files.live?.path)
  const completeEvidenceFile = cleanString(files.complete?.path)
  const redactedOutputFile = cleanString(files.redactedOutput?.path)
  const usesDefaultPaths = localEvidenceFile === DEFAULT_V04_LOCAL_EVIDENCE_FILE
    && liveEvidenceFile === DEFAULT_V04_LIVE_EVIDENCE_FILE
    && completeEvidenceFile === DEFAULT_V04_COMPLETE_EVIDENCE_FILE
    && redactedOutputFile === DEFAULT_V04_REDACTED_OUTPUT_FILE

  if (usesDefaultPaths) return 'npm run v04:message:finalize'

  const args = ['npm run v04:message:finalize --']
  if (localEvidenceFile) args.push('--local-evidence-file', shellQuote(localEvidenceFile))
  if (liveEvidenceFile) args.push('--live-evidence-file', shellQuote(liveEvidenceFile))
  if (completeEvidenceFile) args.push('--complete-evidence-file', shellQuote(completeEvidenceFile))
  if (redactedOutputFile) args.push('--redacted-output-file', shellQuote(redactedOutputFile))
  return args.join(' ')
}

function toV04MessageCommand(id, command, message = {}) {
  if (id === 'finalize-release-evidence') return buildV04FinalizeCommand(message)

  const text = String(command ?? '')
  const usesDefaultV04Paths = text.includes(DEFAULT_V04_LOCAL_EVIDENCE_FILE)
    || text.includes(DEFAULT_V04_LIVE_EVIDENCE_FILE)
    || text.includes(DEFAULT_V04_COMPLETE_EVIDENCE_FILE)
    || text.includes(DEFAULT_V04_REDACTED_OUTPUT_FILE)

  if (!usesDefaultV04Paths) return command

  if (id === 'local-webhook-smoke') return 'npm run v04:message:smoke:local'
  if (id === 'live-template') return 'npm run v04:message:live:template'
  if (id === 'live-gate') return 'npm run v04:message:gate:live'
  if (id === 'merge-release-evidence') return 'npm run v04:message:merge:release'
  if (id === 'finalize-release-evidence') return 'npm run v04:message:finalize'
  if (id === 'release-gate') return 'npm run v04:message:gate:release'
  if (id === 'redact-release-evidence') return 'npm run v04:message:release:redact'

  if (id.startsWith('record-')) {
    return text
      .replace(/^npm run message:live:record -- /, 'npm run v04:message:live:record -- ')
      .replace(` --live-evidence-file "${DEFAULT_V04_LIVE_EVIDENCE_FILE}"`, '')
  }

  return command
}

export async function buildV04ReadinessStatusReport(options = {}, context = {}) {
  const generatedAt = normalizeIso(options.generatedAt || context.now || new Date())
  const artifactDir = options.artifactDir || DEFAULT_V04_ARTIFACT_DIR
  const stabilization = await buildStabilizationEvidenceStatusReport({
    artifactDir,
    generatedAt,
    targetVersion: '0.4',
  })
  const message = await buildMessageAwarenessReleaseStatusReport({
    completeEvidenceFile: options.completeEvidenceFile || DEFAULT_V04_COMPLETE_EVIDENCE_FILE,
    liveEvidenceFile: options.liveEvidenceFile || DEFAULT_V04_LIVE_EVIDENCE_FILE,
    macosLiveProbeFile: options.macosLiveProbeFile || DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
    localEvidenceFile: options.localEvidenceFile || DEFAULT_V04_LOCAL_EVIDENCE_FILE,
    redactedOutputFile: options.redactedOutputFile || DEFAULT_V04_REDACTED_OUTPUT_FILE,
  }, { now: new Date(generatedAt) })
  const livePreflight = await readLivePreflightReport(
    options.livePreflightFile || DEFAULT_V04_LIVE_PREFLIGHT_FILE,
    generatedAt,
  )
  const liveSession = await readLiveSessionReport(
    options.liveSessionFile || DEFAULT_V04_LIVE_SESSION_FILE,
    generatedAt,
  )
  const liveSessionMarkdown = await readPrivateSafeFileStatus(
    options.liveSessionMarkdownFile || DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE,
  )
  const privacySafetyFile = options.privacySafetyFile
    || path.join(artifactDir, 'privacy-safety.json')
  const privacySafety = await readPrivacySafetyEvidenceReport(privacySafetyFile, generatedAt)
  const verifyReleaseRan = options.verifyReleaseRan === true
  const checks = buildChecks({
    stabilization,
    message,
    livePreflight,
    liveSession,
    liveSessionMarkdown,
    privacySafety,
    verifyReleaseRan,
  })
  const readyChecks = checks.filter((check) => check.pass)
  const evidenceReady = checks
    .filter((check) => check.id !== 'release.verify_release_command')
    .every((check) => check.pass)
  const releaseCommandRequired = !verifyReleaseRan
  const ok = evidenceReady
  const nextCommands = buildNextCommands(checks, stabilization, message, liveSession, liveSessionMarkdown)
  const nextCommandAutomation = summarizeNextCommandAutomation(nextCommands)

  return {
    schemaVersion: 1,
    gate: V04_READINESS_STATUS_GATE,
    generatedAt,
    targetVersion: '0.4',
    ok,
    overallStatus: evidenceReady
      ? verifyReleaseRan
        ? 'ready'
        : 'evidence-ready-release-command-required'
      : 'needs-evidence',
    releaseCommandRequired,
    passCount: readyChecks.length,
    totalCount: checks.length,
    checks,
    blockingCheckIds: checks
      .filter((check) => !check.pass && check.id !== 'release.verify_release_command')
      .map((check) => check.id),
    nextCommands,
    automationSafeNextCommands: filterAutomationSafeNextCommands(nextCommands, nextCommandAutomation),
    nextCommandAutomation,
    sourceReports: {
      stabilization: {
        ok: stabilization.ok,
        overallStatus: stabilization.overallStatus,
        requiredPassCount: stabilization.requiredPassCount,
        requiredTotalCount: stabilization.requiredTotalCount,
        optionalFailedCheckIds: stabilization.optionalFailedCheckIds,
      },
      messageAwareness: {
        ok: message.ok,
        rawReleaseGateComplete: message.rawReleaseGateComplete,
        redactionGateComplete: message.redactionGateComplete,
        releaseGateComplete: message.releaseGateComplete,
        macosLiveProbe: message.macosLiveProbe
          ? {
              exists: message.macosLiveProbe.exists === true,
              ok: message.macosLiveProbe.ok === true,
              status: message.macosLiveProbe.status ?? null,
              releaseEvidenceCandidate: message.macosLiveProbe.releaseEvidenceCandidate === true,
              diagnostics: message.macosLiveProbe.diagnostics ?? null,
            }
          : null,
      },
      messageMacosLiveProbe: {
        ok: message.macosLiveProbe?.ok === true,
        status: message.macosLiveProbe?.status ?? null,
        releaseEvidenceCandidate: message.macosLiveProbe?.releaseEvidenceCandidate === true,
        fileExists: message.macosLiveProbe?.file?.exists === true || message.macosLiveProbe?.exists === true,
      },
      messageLivePreflight: {
        ok: livePreflight.ok,
        overallStatus: livePreflight.overallStatus,
        blockingCheckIds: livePreflight.blockingCheckIds,
        fileExists: livePreflight.file?.exists === true,
      },
      messageLiveSession: {
        ok: liveSession.ok,
        overallStatus: liveSession.overallStatus,
        readyToRecordPendingChecks: liveSession.readyToRecordPendingChecks,
        safeToRunPendingRecordCommands: liveSession.safeToRunPendingRecordCommands,
        recordSafetySummary: liveSession.recordSafetySummary,
        stepExecutionSummary: liveSession.stepExecutionSummary,
        pendingCheckIds: liveSession.pendingCheckIds,
        fileExists: liveSession.file?.exists === true,
        operatorPacket: summarizeOperatorPacket(liveSession, liveSessionMarkdown),
        bridgeTrace: liveSession.bridgeTrace,
        macosRecord: liveSession.macosRecord,
        recordSteps: liveSession.recordSteps,
      },
      privacySafety: {
        ok: privacySafety.ok,
        failedCheckIds: privacySafety.failedCheckIds,
      },
    },
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'message sender/text/id values',
        'webhook payloads and responses',
        'live-preflight notification title/body/sender/chat values',
        'macOS live probe notification title/body/sender/chat/message ids',
        'live-session record commands and bridge trace target/error values',
        'live-session Markdown operator packet contents',
        'Telegram and Discord tokens, chat ids, and channel ids',
        'live-check operators and notes',
        'voice transcripts',
        'role/card text',
        'companion readiness endpoint and credential details',
        'memory bodies and source ids',
        'memory-map node labels and timeline details',
        'TTS request text and endpoint details',
      ],
    },
  }
}

async function writeReportFile(report, outputPath) {
  const cleanPath = cleanString(outputPath)
  if (!cleanPath) return
  const resolvedPath = path.resolve(process.cwd(), cleanPath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function runV04ReadinessStatusCli(argv = process.argv.slice(2), context = {}) {
  const options = parseV04ReadinessStatusArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = await buildV04ReadinessStatusReport(options, context)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runV04ReadinessStatusCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
