#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildMessageAwarenessGateEvidenceAudit,
  buildMessageAwarenessLiveEvidenceAudit,
  mergeMessageAwarenessEvidence,
  normalizeLiveEvidenceChecks,
  redactMessageAwarenessEvidence,
} from './validate-message-awareness.mjs'
import {
  buildMessageAwarenessReleaseStatusReport,
} from './message-awareness-release-status.mjs'

export const DEFAULT_V04_LOCAL_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-local.json'
export const DEFAULT_V04_LIVE_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-live.json'
export const DEFAULT_V04_COMPLETE_EVIDENCE_FILE = 'artifacts/v0.4.0/message-awareness-complete.json'
export const DEFAULT_V04_REDACTED_OUTPUT_FILE = 'docs/release-evidence/v0.4.0-message-awareness.json'
export const DEFAULT_V04_STATUS_OUTPUT_FILE = 'artifacts/v0.4.0/message-awareness-status.json'

function cleanString(value) {
  return String(value ?? '').trim()
}

function splitOption(arg) {
  const eq = arg.indexOf('=')
  if (eq < 0) return [arg, null]
  return [arg.slice(0, eq), arg.slice(eq + 1)]
}

function readOptionValue(argv, index, inlineValue, optionName) {
  if (inlineValue !== null) return { value: inlineValue, nextIndex: index }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return { value, nextIndex: index + 1 }
}

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/v04-message-release-finalize.mjs [options]',
    '',
    'Finalizes v0.4 message-awareness release evidence after real live proof',
    'has been recorded. The command refuses to write complete/redacted release',
    'evidence until local webhook evidence and all live checks pass.',
    '',
    'Options:',
    `  --local-evidence-file <path>     Local evidence file (default: ${DEFAULT_V04_LOCAL_EVIDENCE_FILE})`,
    `  --live-evidence-file <path>      Live evidence file (default: ${DEFAULT_V04_LIVE_EVIDENCE_FILE})`,
    `  --complete-evidence-file <path>  Raw complete evidence output (default: ${DEFAULT_V04_COMPLETE_EVIDENCE_FILE})`,
    `  --redacted-output-file <path>    Commit-safe evidence output (default: ${DEFAULT_V04_REDACTED_OUTPUT_FILE})`,
    `  --status-output <path>           Private-safe status output (default: ${DEFAULT_V04_STATUS_OUTPUT_FILE})`,
    '  --generated-at <iso>             Fixed timestamp for deterministic evidence',
    '  --help                          Show this help',
    '',
  ].join('\n'))
}

export function parseV04MessageReleaseFinalizeArgs(argv) {
  const options = {
    completeEvidenceFile: DEFAULT_V04_COMPLETE_EVIDENCE_FILE,
    generatedAt: '',
    help: false,
    liveEvidenceFile: DEFAULT_V04_LIVE_EVIDENCE_FILE,
    localEvidenceFile: DEFAULT_V04_LOCAL_EVIDENCE_FILE,
    redactedOutputFile: DEFAULT_V04_REDACTED_OUTPUT_FILE,
    statusOutputFile: DEFAULT_V04_STATUS_OUTPUT_FILE,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    const [name, inlineValue] = splitOption(arg)
    if (
      name === '--local-evidence-file'
      || name === '--live-evidence-file'
      || name === '--complete-evidence-file'
      || name === '--redacted-output-file'
      || name === '--status-output'
      || name === '--output-status'
      || name === '--generated-at'
    ) {
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--local-evidence-file') options.localEvidenceFile = parsed.value
      else if (name === '--live-evidence-file') options.liveEvidenceFile = parsed.value
      else if (name === '--complete-evidence-file') options.completeEvidenceFile = parsed.value
      else if (name === '--redacted-output-file') options.redactedOutputFile = parsed.value
      else if (name === '--status-output' || name === '--output-status') options.statusOutputFile = parsed.value
      else options.generatedAt = parsed.value
      index = parsed.nextIndex
      continue
    }

    throw new Error(`Unsupported option: ${arg}`)
  }

  return options
}

async function readJsonFile(filePath, label) {
  const target = cleanString(filePath)
  if (!target) throw new Error(`${label} path is required`)
  const resolvedPath = path.resolve(process.cwd(), target)
  try {
    return JSON.parse(await fs.readFile(resolvedPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing: ${target}`)
    }
    throw error
  }
}

async function writeJsonFile(filePath, value) {
  const target = cleanString(filePath)
  if (!target) return ''
  const resolvedPath = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return resolvedPath
}

function summarizeLiveGate(audit) {
  return {
    overallStatus: audit.overallStatus,
    liveGateComplete: audit.liveGateComplete,
    passedCount: audit.passedCount,
    totalCount: audit.totalCount,
    pendingCheckIds: audit.pendingCheckIds,
    failedCheckIds: audit.failedCheckIds,
  }
}

function summarizeReleaseGate(audit) {
  return {
    overallStatus: audit.overallStatus,
    releaseGateComplete: audit.releaseGateComplete,
    missingCheckIds: audit.missingCheckIds,
    inconsistencies: audit.inconsistencies,
    localWebhook: audit.localWebhook,
    liveEvidence: summarizeLiveGate(audit.liveEvidence),
  }
}

function buildFilesSummary(options) {
  return {
    completeEvidenceFile: options.completeEvidenceFile,
    liveEvidenceFile: options.liveEvidenceFile,
    localEvidenceFile: options.localEvidenceFile,
    redactedOutputFile: options.redactedOutputFile,
    statusOutputFile: options.statusOutputFile,
  }
}

async function buildStatusReport(options, now) {
  return buildMessageAwarenessReleaseStatusReport({
    completeEvidenceFile: options.completeEvidenceFile,
    liveEvidenceFile: options.liveEvidenceFile,
    localEvidenceFile: options.localEvidenceFile,
    redactedOutputFile: options.redactedOutputFile,
  }, { now })
}

async function writeStatusReport(options, now) {
  const statusReport = await buildStatusReport(options, now)
  await writeJsonFile(options.statusOutputFile, statusReport)
  return statusReport
}

function resolveNow(options, context) {
  const raw = cleanString(options.generatedAt) || context.generatedAt || context.now
  if (!raw) return new Date()
  const date = new Date(raw)
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid --generated-at timestamp: ${raw}`)
  }
  return date
}

export async function finalizeV04MessageRelease(options = {}, context = {}) {
  const normalized = {
    ...parseV04MessageReleaseFinalizeArgs([]),
    ...options,
  }
  const now = resolveNow(normalized, context)
  const files = buildFilesSummary(normalized)
  const statusBefore = await writeStatusReport(normalized, now)

  if (statusBefore.localEvidence?.audit?.localWebhook?.pass !== true) {
    return {
      ok: false,
      status: 'local-webhook-pending',
      files,
      localEvidence: statusBefore.localEvidence,
      liveEvidence: statusBefore.liveEvidence,
      nextCommands: statusBefore.nextCommands,
      statusReport: statusBefore,
    }
  }

  if (statusBefore.liveEvidence?.audit?.liveGateComplete !== true) {
    return {
      ok: false,
      status: 'live-evidence-pending',
      files,
      localEvidence: statusBefore.localEvidence,
      liveEvidence: statusBefore.liveEvidence,
      nextCommands: statusBefore.nextCommands,
      statusReport: statusBefore,
    }
  }

  const localRaw = await readJsonFile(normalized.localEvidenceFile, 'Local message-awareness evidence')
  const liveRaw = await readJsonFile(normalized.liveEvidenceFile, 'Live message-awareness evidence')
  const liveEvidenceChecks = normalizeLiveEvidenceChecks(liveRaw)
  const liveAudit = buildMessageAwarenessLiveEvidenceAudit(liveEvidenceChecks, { gateVersion: 'v0.4' })
  if (!liveAudit.liveGateComplete) {
    return {
      ok: false,
      status: 'live-evidence-pending',
      files,
      liveEvidence: { audit: summarizeLiveGate(liveAudit) },
      nextCommands: statusBefore.nextCommands,
      statusReport: statusBefore,
    }
  }

  const completeEvidence = mergeMessageAwarenessEvidence(localRaw, liveEvidenceChecks, {
    completedAt: now,
    gateVersion: 'v0.4',
  })
  const completeAudit = buildMessageAwarenessGateEvidenceAudit(completeEvidence)
  if (!completeAudit.releaseGateComplete) {
    return {
      ok: false,
      status: 'release-gate-pending',
      files,
      releaseGate: summarizeReleaseGate(completeAudit),
      nextCommands: statusBefore.nextCommands,
      statusReport: statusBefore,
    }
  }

  const redactEvidence = context.redactMessageAwarenessEvidence ?? redactMessageAwarenessEvidence
  const redactedEvidence = redactEvidence(completeEvidence)
  const redactedAudit = buildMessageAwarenessGateEvidenceAudit(redactedEvidence)
  if (!redactedAudit.releaseGateComplete) {
    return {
      ok: false,
      status: 'redacted-release-gate-pending',
      files,
      releaseGate: summarizeReleaseGate(completeAudit),
      redactedGate: summarizeReleaseGate(redactedAudit),
      nextCommands: statusBefore.nextCommands,
      statusReport: statusBefore,
    }
  }

  await writeJsonFile(normalized.completeEvidenceFile, completeEvidence)
  await writeJsonFile(normalized.redactedOutputFile, redactedEvidence)

  const statusAfter = await writeStatusReport(normalized, now)
  return {
    ok: true,
    status: 'pass',
    files,
    releaseGate: summarizeReleaseGate(completeAudit),
    redactedGate: summarizeReleaseGate(redactedAudit),
    statusReport: statusAfter,
  }
}

export async function runV04MessageReleaseFinalize(argv = process.argv.slice(2), context = {}) {
  const options = parseV04MessageReleaseFinalizeArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = await finalizeV04MessageRelease(options, context)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return report.ok ? 0 : 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runV04MessageReleaseFinalize().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
