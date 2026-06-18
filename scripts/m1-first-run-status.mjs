#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const M1_FIRST_RUN_STATUS_GATE = 'nexus-v1-m1-first-run-status'
export const M1_FIRST_RUN_AUDIT_GATE = 'nexus-v1-m1-first-run-audit'
export const M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE = 'nexus-v1-m1-first-run-operator-evidence'
export const DEFAULT_M1_FIRST_RUN_AUDIT_FILE = 'artifacts/v1/m1-first-run-audit.json'
export const DEFAULT_M1_FIRST_RUN_OPERATOR_DIR = 'artifacts/v1'
export const REQUIRED_M1_FIRST_RUN_PLATFORMS = ['macos', 'windows', 'linux']

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m1-first-run-status.mjs [options]',
    '',
    'Summarizes private-safe v1 M1 first-run readiness evidence.',
    'It requires a runtime M1 audit report plus real first-reply operator',
    'evidence on macOS, Windows, and Linux before reporting ready.',
    '',
    'Options:',
    `  --audit-file <path>              M1 audit report (default: ${DEFAULT_M1_FIRST_RUN_AUDIT_FILE})`,
    `  --operator-dir <path>            Directory to scan for operator evidence (default: ${DEFAULT_M1_FIRST_RUN_OPERATOR_DIR})`,
    '  --operator-evidence-file <path>  Additional operator evidence JSON; repeatable',
    '  --generated-at <iso>             Override report timestamp',
    '  --output <path>                  Write private-safe status JSON',
    '  --require-ready                  Exit non-zero unless runtime audit and all platform records are ready',
    '  --list                          Print required platform ids',
    '  --help                          Show this help',
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

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

export function parseM1FirstRunStatusArgs(argv) {
  const options = {
    auditFile: DEFAULT_M1_FIRST_RUN_AUDIT_FILE,
    generatedAt: '',
    help: false,
    list: false,
    operatorDir: DEFAULT_M1_FIRST_RUN_OPERATOR_DIR,
    operatorEvidenceFiles: [],
    outputPath: '',
    requireReady: false,
  }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--list') {
      options.list = true
      continue
    }
    if (arg === '--require-ready') {
      options.requireReady = true
      continue
    }

    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      if (
        name === '--audit-file'
        || name === '--audit'
        || name === '--input'
        || name === '--operator-dir'
        || name === '--operator-evidence-dir'
        || name === '--operator-evidence-file'
        || name === '--operator-file'
        || name === '--generated-at'
        || name === '--output'
        || name === '--output-file'
      ) {
        const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
        const value = String(parsed.value)
        if (name === '--audit-file' || name === '--audit' || name === '--input') {
          options.auditFile = value
        } else if (name === '--operator-dir' || name === '--operator-evidence-dir') {
          options.operatorDir = value
        } else if (name === '--operator-evidence-file' || name === '--operator-file') {
          options.operatorEvidenceFiles.push(value)
        } else if (name === '--generated-at') {
          options.generatedAt = value
        } else {
          options.outputPath = value
        }
        index = parsed.nextIndex
        continue
      }

      throw new Error(`Unknown option: ${arg}`)
    }

    positional.push(arg)
  }

  if (positional.length > 0 && options.auditFile === DEFAULT_M1_FIRST_RUN_AUDIT_FILE) {
    options.auditFile = positional[0]
  }

  return options
}

async function readJsonFile(filePath) {
  const normalized = cleanString(filePath)
  const result = {
    path: normalized,
    exists: false,
    error: null,
    raw: null,
  }
  if (!normalized) {
    result.error = 'missing-path'
    return result
  }
  try {
    const text = await fs.readFile(normalized, 'utf8')
    result.exists = true
    result.raw = JSON.parse(text)
  } catch (error) {
    result.error = error?.code === 'ENOENT' ? 'missing' : 'invalid-json'
  }
  return result
}

async function listOperatorEvidenceFiles(operatorDir, explicitFiles) {
  const files = [...explicitFiles.map(cleanString).filter(Boolean)]
  const normalizedDir = cleanString(operatorDir)
  if (normalizedDir) {
    try {
      const entries = await fs.readdir(normalizedDir)
      for (const entry of entries) {
        if (/^m1-first-run-operator.*\.json$/i.test(entry)) {
          files.push(path.join(normalizedDir, entry))
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return unique(files)
}

function summarizeAudit(source) {
  const raw = source.raw
  const gateOk = raw?.gate === M1_FIRST_RUN_AUDIT_GATE
  const scaffoldOnly = raw?.evidenceSource === 'sample-m1-first-run'
  const runtimeEvidence = gateOk && raw?.ok === true && !scaffoldOnly

  return {
    path: source.path,
    exists: source.exists,
    error: source.error,
    gateOk,
    ok: raw?.ok === true,
    runtimeEvidence,
    scaffoldOnly,
    evidenceSource: cleanString(raw?.evidenceSource) || null,
    overallStatus: cleanString(raw?.overallStatus) || (source.exists ? 'unknown' : 'missing'),
    nextActions: safeArray(raw?.nextActions).map(cleanString).filter(Boolean),
  }
}

function summarizeOperatorEvidence(source) {
  const raw = source.raw
  const gateOk = raw?.gate === M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE
  const platform = cleanString(raw?.platform).toLowerCase() || 'unknown'
  const latencyMs = Number(raw?.firstConversation?.latencyMs)

  return {
    path: source.path,
    exists: source.exists,
    error: source.error,
    gateOk,
    ok: raw?.ok === true,
    platform,
    observedAt: cleanString(raw?.observedAt) || null,
    providerId: cleanString(raw?.providerId) || 'unknown',
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    latencyWithinBudget: typeof raw?.firstConversation?.latencyWithinBudget === 'boolean'
      ? raw.firstConversation.latencyWithinBudget
      : null,
    firstConversationSucceeded: raw?.firstConversation?.succeeded === true,
    privateSafe: raw?.privacy?.artifactContentsCopied === false,
    missingCheckIds: safeArray(raw?.missingCheckIds).map(cleanString).filter(Boolean),
    nextActions: safeArray(raw?.nextActions).map(cleanString).filter(Boolean),
  }
}

function buildPlatformCoverage(operatorRecords) {
  return REQUIRED_M1_FIRST_RUN_PLATFORMS.map((platform) => {
    const records = operatorRecords.filter((record) => record.platform === platform)
    const passing = records.filter((record) => (
      record.exists
      && record.gateOk
      && record.ok
      && record.firstConversationSucceeded
      && record.latencyWithinBudget !== false
      && record.privateSafe
    ))
    const best = passing[0] ?? records[0] ?? null

    return {
      platform,
      status: passing.length > 0 ? 'pass' : 'missing',
      pass: passing.length > 0,
      evidenceFiles: records.map((record) => record.path),
      observedAt: best?.observedAt ?? null,
      providerId: best?.providerId ?? null,
      latencyMs: best?.latencyMs ?? null,
      missingCheckIds: best?.missingCheckIds ?? ['operator-evidence-missing'],
      nextActions: passing.length > 0
        ? []
        : [`record-${platform}-first-run-operator-evidence`],
    }
  })
}

export async function buildM1FirstRunStatusReport(options, generatedAt = new Date().toISOString()) {
  const auditSource = await readJsonFile(options.auditFile)
  const audit = summarizeAudit(auditSource)
  const operatorFiles = await listOperatorEvidenceFiles(options.operatorDir, options.operatorEvidenceFiles)
  const operatorSources = await Promise.all(operatorFiles.map((filePath) => readJsonFile(filePath)))
  const operatorRecords = operatorSources.map(summarizeOperatorEvidence)
  const platformCoverage = buildPlatformCoverage(operatorRecords)
  const missingPlatformIds = platformCoverage
    .filter((coverage) => !coverage.pass)
    .map((coverage) => coverage.platform)

  const nextActions = []
  if (!audit.exists) nextActions.push('run-m1-first-run-audit')
  if (audit.exists && !audit.gateOk) nextActions.push('regenerate-m1-first-run-audit')
  if (audit.gateOk && audit.scaffoldOnly) nextActions.push('replace-sample-m1-audit-with-runtime-report')
  if (audit.gateOk && !audit.ok) nextActions.push(...audit.nextActions)
  for (const platform of missingPlatformIds) {
    nextActions.push(`record-${platform}-first-run-operator-evidence`)
  }

  const ok = audit.runtimeEvidence && missingPlatformIds.length === 0

  return {
    schemaVersion: 1,
    gate: M1_FIRST_RUN_STATUS_GATE,
    generatedAt: normalizeIso(generatedAt),
    ok,
    overallStatus: ok
      ? 'ready'
      : audit.scaffoldOnly
        ? 'runtime-and-platform-evidence-required'
        : 'needs-first-run-evidence',
    targetMilestone: 'M1',
    audit,
    operatorEvidence: {
      scannedDir: cleanString(options.operatorDir) || null,
      totalRecordCount: operatorRecords.length,
      passingRecordCount: operatorRecords.filter((record) => record.ok && record.gateOk).length,
      invalidRecordCount: operatorRecords.filter((record) => record.exists && !record.gateOk).length,
      records: operatorRecords,
    },
    platformCoverage,
    missingPlatformIds,
    nextActions: unique(nextActions),
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'operator names and notes',
        'user message text',
        'assistant reply text',
        'voice transcripts',
        'selected model names',
        'API keys',
        'provider endpoint URLs',
        'webhook URLs and auth headers',
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

export async function runM1FirstRunStatusCli(argv = process.argv.slice(2)) {
  const options = parseM1FirstRunStatusArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  if (options.list) {
    process.stdout.write(`${JSON.stringify({
      requiredPlatformIds: REQUIRED_M1_FIRST_RUN_PLATFORMS,
      defaultAuditFile: DEFAULT_M1_FIRST_RUN_AUDIT_FILE,
      defaultOperatorDir: DEFAULT_M1_FIRST_RUN_OPERATOR_DIR,
    }, null, 2)}\n`)
    return 0
  }

  const report = await buildM1FirstRunStatusReport(
    options,
    options.generatedAt || new Date().toISOString(),
  )
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM1FirstRunStatusCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
