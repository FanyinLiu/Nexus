#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const STABILIZATION_EVIDENCE_STATUS_GATE = 'nexus-p1-p2-evidence-status'

export const STABILIZATION_EVIDENCE_ARTIFACTS = [
  {
    id: 'p1.companion_readiness',
    area: 'P1',
    label: 'Companion readiness health',
    fileNames: ['companion-readiness.json'],
    marker: { field: 'gate', value: 'companion-readiness-health' },
    command: 'npm run companion:readiness:report -- --sample --output artifacts/v0.3.4/companion-readiness.json --require-ready',
  },
  {
    id: 'p1.memory_map',
    area: 'P1',
    label: 'Memory Map derived view coverage',
    fileNames: ['memory-map.json'],
    marker: { field: 'gate', value: 'memory-map-observability' },
    command: 'npm run memory:map:report -- --sample --output artifacts/v0.3.4/memory-map.json --require-ready',
  },
  {
    id: 'p1.proactive_care',
    area: 'P1',
    label: 'Proactive-care observability',
    fileNames: ['proactive-care-evidence.json'],
    marker: { field: 'gate', value: 'proactive-care-observability' },
    rejectedEvidenceSources: ['sample-qa'],
    includeFailedCheckHints: true,
    command: 'npm run proactive:care:rehearsal -- --output artifacts/v0.3.4/proactive-care-evidence.json --require-ready',
  },
  {
    id: 'p2.live2d_action_map',
    area: 'P2',
    label: 'Live2D action-map coverage',
    fileNames: ['live2d-action-map.json'],
    marker: { field: 'gate', value: 'live2d-action-map-coverage' },
    command: 'npm run live2d:action-map:report -- --model mao --output artifacts/v0.3.4/live2d-action-map.json --require-ready',
  },
  {
    id: 'p2.character_card_import',
    area: 'P2',
    label: 'Character Card import coverage',
    fileNames: ['character-card-import.json'],
    marker: { field: 'gate', value: 'character-card-import' },
    command: 'npm run character:card:report -- --sample --output artifacts/v0.3.4/character-card-import.json --require-ready',
  },
  {
    id: 'p2.voice_diagnostics',
    area: 'P2',
    label: 'Voice diagnostics timing evidence',
    fileNames: ['voice-diagnostics.json'],
    marker: { field: 'schema', value: 'nexus.voice-diagnostics.v1' },
    command: 'npm run voice:diagnostics:report -- --input artifacts/voice-diagnostics-input.json --output artifacts/v0.3.4/voice-diagnostics.json --require-ready',
  },
  {
    id: 'p2.local_tts_adapter_smoke',
    area: 'P2',
    label: 'Local TTS adapter first-byte smoke',
    fileNames: ['tts-adapter-smoke.json', 'tts-smoke.json'],
    marker: { field: 'gate', value: 'nexus-tts-adapter-smoke' },
    includeSafeFailureHints: true,
    optionalForTargets: ['0.4'],
    optionalReason: 'Target local TTS adapters are Beta for v0.4 and are not part of the default first-run voice path.',
    command: 'npm run tts:adapter:smoke -- --provider voxtral-local --output artifacts/v0.3.4/tts-adapter-smoke.json --require-ready',
  },
]

const SAFE_PROACTIVE_CARE_CHECK_IDS = new Set([
  'has-events',
  'has-fired',
  'has-skipped',
  'has-quiet-hours-skip',
  'has-rate-limit-skip',
  'has-key-decision-window-coverage',
  'has-source-refs',
  'has-openable-source-refs',
  'has-openable-source-ref-coverage',
  'has-source-ref-coverage',
  'has-all-sources-observed',
  'has-multi-hour-coverage',
  'has-v2-policy-events',
  'has-user-visible-reasons',
  'has-user-feedback-actions',
])

const SAFE_PROACTIVE_CARE_STATUS_ACTIONS = new Map([
  ['has-events', 'Run Nexus with proactive care enabled until runtime decisions are recorded.'],
  ['has-fired', 'Keep the panel closed and let at least one due proactive item fire through the native notification path.'],
  ['has-rate-limit-skip', 'Run through a second eligible bracket or cooldown window to capture a rate-limit skip.'],
  ['has-key-decision-window-coverage', 'Collect due-item, quiet-hours, and rate-limit windows before using this as release evidence.'],
  ['has-all-sources-observed', 'Enable away notifications, daily brackets, open arcs, and future capsules long enough for each source to record a decision.'],
  ['has-multi-hour-coverage', 'Keep Nexus running for at least two hours of real proactive-care decisions.'],
  ['has-v2-policy-events', 'Record fresh v0.4 proactive-care runtime decisions so carePolicyVersion=2 appears in release evidence.'],
  ['has-user-visible-reasons', 'Record fresh v0.4 care decisions with userVisibleReason so users can see why Nexus appeared or stayed quiet.'],
  ['has-user-feedback-actions', 'Exercise one proactive-care panel action such as snooze, less-like-this, mute-source, or open-source.'],
])

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/stabilization-evidence-status.mjs [options]',
    '',
    'Options:',
    '  --artifact-dir <path>     Directory containing P1/P2 evidence artifacts (default: artifacts/v0.3.4)',
    '  --generated-at <iso>      Override report timestamp',
    '  --target-version <semver> Evidence target profile (default: 0.3.4)',
    '  --output <path>           Write the private-safe status JSON to a file',
    '  --require-ready           Exit non-zero unless every expected artifact is present and passing',
    '  --list                    Print expected artifact manifest',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  npm run stabilization:evidence:status',
    '  npm run stabilization:evidence:status -- --artifact-dir artifacts/v0.3.4 --require-ready',
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
    case '--target-version':
    case '--target':
    case '--version':
      options.targetVersion = value
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

export function parseStabilizationEvidenceStatusArgs(argv) {
  const options = {
    artifactDir: 'artifacts/v0.3.4',
    generatedAt: '',
    outputPath: '',
    requireReady: false,
    targetVersion: '0.3.4',
    list: false,
    help: false,
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
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      assignOption(options, name, parsed.value)
      index = parsed.nextIndex
      continue
    }
    positional.push(arg)
  }

  if (positional.length > 0 && options.artifactDir === 'artifacts/v0.3.4') {
    options.artifactDir = positional[0]
  }

  return options
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return { exists: true, value: JSON.parse(text), error: null }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, value: null, error: null }
    return {
      exists: true,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function markerMatches(report, marker) {
  return report && typeof report === 'object' && report[marker.field] === marker.value
}

function safeSummaryText(value, maxLength = 180) {
  const text = cleanString(value)
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

function buildSafeFailureHints(report, definition) {
  if (!definition.includeSafeFailureHints || !report || typeof report !== 'object') return {}
  const errorKind = safeSummaryText(report.error?.kind, 80)
  const nextActions = Array.isArray(report.nextActions)
    ? report.nextActions
      .map((entry) => safeSummaryText(entry))
      .filter(Boolean)
      .slice(0, 3)
    : []
  return {
    ...(errorKind ? { artifactErrorKind: errorKind } : {}),
    ...(nextActions.length ? { artifactNextActions: nextActions } : {}),
  }
}

function buildFailedCheckHints(report, definition) {
  if (!definition.includeFailedCheckHints || !report || typeof report !== 'object') return {}
  const failedChecks = Array.isArray(report.checks)
    ? report.checks
      .filter((entry) => entry && typeof entry === 'object' && entry.pass === false)
      .map((entry) => cleanString(entry.id))
      .filter((id) => SAFE_PROACTIVE_CARE_CHECK_IDS.has(id))
      .slice(0, 9)
    : []
  return failedChecks.length ? { artifactFailedChecks: failedChecks } : {}
}

function buildNextCommandReason(check) {
  const errorKind = safeSummaryText(check.artifactErrorKind, 80)
  const firstAction = Array.isArray(check.artifactNextActions)
    ? safeSummaryText(check.artifactNextActions[0], 140)
    : ''
  const failedChecks = Array.isArray(check.artifactFailedChecks)
    ? check.artifactFailedChecks.map((entry) => safeSummaryText(entry, 80)).filter(Boolean)
    : []
  if (errorKind && firstAction) return `${check.detail} ${errorKind}: ${firstAction}`
  if (errorKind) return `${check.detail} ${errorKind}.`
  if (firstAction) return `${check.detail} ${firstAction}`
  const failedCheckActions = failedChecks
    .map((entry) => SAFE_PROACTIVE_CARE_STATUS_ACTIONS.get(entry))
    .filter((entry) => Boolean(entry))
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .slice(0, 8)
  if (failedCheckActions.length) {
    return `${check.detail} ${failedCheckActions.join(' ')} Failed checks: ${failedChecks.join(', ')}.`
  }
  if (failedChecks.length) return `${check.detail} Failed checks: ${failedChecks.join(', ')}.`
  return check.detail
}

function normalizeTargetVersion(value) {
  const version = cleanString(value)
  return version || '0.3.4'
}

function isOptionalForTarget(definition, targetVersion) {
  return Array.isArray(definition.optionalForTargets)
    && definition.optionalForTargets.includes(targetVersion)
}

function applyOptionalTargetPolicy(check, definition, targetVersion) {
  const optional = isOptionalForTarget(definition, targetVersion)
  if (!optional) {
    return {
      ...check,
      required: true,
      blocking: !check.pass,
    }
  }

  return {
    ...check,
    required: false,
    blocking: false,
    optionalReason: definition.optionalReason ?? `Optional for target ${targetVersion}.`,
    status: check.pass
      ? 'pass'
      : check.status === 'missing'
        ? 'optional_missing'
        : check.status === 'invalid'
          ? 'optional_invalid'
          : 'optional_failed',
    detail: check.pass
      ? check.detail
      : `${definition.optionalReason ?? `Optional for target ${targetVersion}.`} ${check.detail}`,
  }
}

async function checkArtifact(definition, artifactDir) {
  const candidates = definition.fileNames.map((fileName) => ({
    fileName,
    filePath: path.join(artifactDir, fileName),
  }))
  let found = null
  for (const candidate of candidates) {
    const result = await readJsonIfExists(candidate.filePath)
    if (result.exists) {
      found = { fileName: candidate.fileName, result }
      break
    }
  }

  if (!found) {
    return {
      id: definition.id,
      area: definition.area,
      label: definition.label,
      status: 'missing',
      pass: false,
      path: definition.fileNames[0],
      acceptedFileNames: definition.fileNames,
      marker: definition.marker,
      artifactOk: false,
      detail: `Missing ${definition.fileNames.join(' or ')}`,
      command: definition.command,
    }
  }

  const { fileName, result } = found
  if (result.error) {
    return {
      id: definition.id,
      area: definition.area,
      label: definition.label,
      status: 'invalid',
      pass: false,
      path: fileName,
      acceptedFileNames: definition.fileNames,
      marker: definition.marker,
      artifactOk: false,
      detail: `Could not read JSON: ${result.error}`,
      command: definition.command,
    }
  }

  const markerOk = markerMatches(result.value, definition.marker)
  const artifactOk = result.value?.ok === true
  const evidenceSource = typeof result.value?.evidenceSource === 'string' ? result.value.evidenceSource : null
  const sourceRejected = definition.rejectedEvidenceSources?.includes(evidenceSource) ?? false
  const pass = markerOk && artifactOk && !sourceRejected
  const failedDetail = sourceRejected
    ? `Artifact source "${evidenceSource}" is for QA only; release evidence requires exported runtime events or the runtime rehearsal gate.`
    : `Artifact present but ${markerOk ? 'ok is not true' : `marker ${definition.marker.field} does not match ${definition.marker.value}`}.`
  const safeFailureHints = buildSafeFailureHints(result.value, definition)
  const failedCheckHints = buildFailedCheckHints(result.value, definition)
  return {
    id: definition.id,
    area: definition.area,
    label: definition.label,
    status: pass ? 'pass' : 'failed',
    pass,
    path: fileName,
    acceptedFileNames: definition.fileNames,
    marker: definition.marker,
    artifactGeneratedAt: typeof result.value?.generatedAt === 'string' ? result.value.generatedAt : null,
    evidenceSource,
    artifactOk,
    markerOk,
    sourceRejected,
    detail: pass
      ? 'Artifact is present, marker matches, and ok=true.'
      : failedDetail,
    ...safeFailureHints,
    ...failedCheckHints,
    command: definition.command,
  }
}

export async function buildStabilizationEvidenceStatusReport({
  artifactDir = 'artifacts/v0.3.4',
  generatedAt = new Date(),
  targetVersion = '0.3.4',
} = {}) {
  const artifactDirInput = cleanString(artifactDir) || 'artifacts/v0.3.4'
  const resolvedArtifactDir = path.resolve(process.cwd(), artifactDirInput)
  const normalizedTargetVersion = normalizeTargetVersion(targetVersion)
  const checks = []
  for (const definition of STABILIZATION_EVIDENCE_ARTIFACTS) {
    const check = await checkArtifact(definition, resolvedArtifactDir)
    checks.push(applyOptionalTargetPolicy(check, definition, normalizedTargetVersion))
  }
  const requiredChecks = checks.filter((check) => check.required)
  const optionalChecks = checks.filter((check) => !check.required)
  const missingCheckIds = requiredChecks.filter((check) => check.status === 'missing').map((check) => check.id)
  const failedCheckIds = requiredChecks.filter((check) => check.status === 'failed').map((check) => check.id)
  const invalidCheckIds = requiredChecks.filter((check) => check.status === 'invalid').map((check) => check.id)
  const optionalCheckIds = optionalChecks.map((check) => check.id)
  const optionalFailedCheckIds = optionalChecks.filter((check) => !check.pass).map((check) => check.id)
  const passCount = checks.filter((check) => check.pass).length
  const requiredPassCount = requiredChecks.filter((check) => check.pass).length
  const ok = requiredPassCount === requiredChecks.length

  return {
    schemaVersion: 1,
    gate: STABILIZATION_EVIDENCE_STATUS_GATE,
    generatedAt: normalizeIso(generatedAt),
    targetVersion: normalizedTargetVersion,
    ok,
    overallStatus: ok
      ? optionalFailedCheckIds.length > 0
        ? 'ready-with-optional-gaps'
        : 'ready'
      : 'needs-evidence',
    artifactDir: path.isAbsolute(artifactDirInput) ? '<custom-artifact-dir>' : artifactDirInput,
    passCount,
    totalCount: checks.length,
    requiredPassCount,
    requiredTotalCount: requiredChecks.length,
    missingCheckIds,
    failedCheckIds,
    invalidCheckIds,
    optionalCheckIds,
    optionalFailedCheckIds,
    checks,
    nextCommands: checks
      .filter((check) => check.required && !check.pass)
      .map((check) => ({
        id: check.id,
        command: check.command,
        reason: buildNextCommandReason(check),
      })),
    optionalNextCommands: checks
      .filter((check) => !check.required && !check.pass)
      .map((check) => ({
        id: check.id,
        command: check.command,
        reason: buildNextCommandReason(check),
      })),
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'artifact payload bodies',
        'message sender/text/id values',
        'voice transcripts',
        'trace details',
        'role/card text',
        'companion readiness endpoint and credential details',
        'memory-map node labels and source ids',
        'TTS model/voice request values',
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

export async function runStabilizationEvidenceStatusCli(argv = process.argv.slice(2)) {
  const options = parseStabilizationEvidenceStatusArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  if (options.list) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      gate: STABILIZATION_EVIDENCE_STATUS_GATE,
      artifacts: STABILIZATION_EVIDENCE_ARTIFACTS,
    }, null, 2)}\n`)
    return 0
  }

  const report = await buildStabilizationEvidenceStatusReport({
    artifactDir: options.artifactDir,
    generatedAt: options.generatedAt || new Date(),
    targetVersion: options.targetVersion,
  })
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runStabilizationEvidenceStatusCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
