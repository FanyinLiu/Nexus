#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE = 'nexus-v1-m1-first-run-operator-evidence'
export const DEFAULT_M1_FIRST_RUN_OPERATOR_EVIDENCE_FILE = 'artifacts/v1/m1-first-run-operator.json'
export const DEFAULT_M1_FIRST_CONVERSATION_BUDGET_MINUTES = 1

const PLATFORM_ALIASES = new Map([
  ['darwin', 'macos'],
  ['mac', 'macos'],
  ['macos', 'macos'],
  ['win32', 'windows'],
  ['windows', 'windows'],
  ['linux', 'linux'],
])

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/m1-first-run-record.mjs [options]',
    '',
    'Records private-safe operator evidence for the v1 M1 first real conversation.',
    'It stores booleans and timing only; it does not copy prompts, replies, model',
    'names, API keys, endpoints, operator names, or notes.',
    '',
    'Required proof options:',
    '  --observed-at <iso>                 When the operator observed the first reply',
    '  --operator <name>                   Operator name, omitted from the artifact',
    '  --app-started                       Nexus launched and the Panel was visible',
    '  --model-connection-checked          Text model connection was checked first',
    '  --first-message-sent                A real first user message was sent',
    '  --assistant-reply-observed          First assistant reply was observed',
    '  --panel-guide-ready                 Panel first-reply guide reached ready/hidden',
    '  --private-safe-report-copied        Runtime M1 private-safe report was copied',
    '  --no-transcript-copied              No prompt, reply, transcript, or model name was copied',
    '  --latency-ms <ms>                   First user message to first assistant reply latency',
    '',
    'Other options:',
    '  --platform <name>                   macos, windows, or linux (default: current host)',
    '  --provider-id <id>                  Provider id only, e.g. ollama or openai',
    '  --first-conversation-budget-minutes <n>  Latency budget (default: 1)',
    '  --note <text>                       Operator note; artifact records only that a note existed',
    `  --output <path>                     Write JSON evidence (default: ${DEFAULT_M1_FIRST_RUN_OPERATOR_EVIDENCE_FILE})`,
    '  --stdout-only                       Do not write the default output file',
    '  --require-ready                     Exit non-zero unless all proof checks pass',
    '  --help                             Show this help',
    '',
  ].join('\n'))
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

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeIso(value) {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function positiveNumberOrNull(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizePlatform(value = process.platform) {
  const key = cleanString(value).toLowerCase()
  return PLATFORM_ALIASES.get(key) ?? 'unknown'
}

function normalizeBudgetMinutes(value) {
  const parsed = positiveNumberOrNull(value)
  return parsed === null || parsed === 0
    ? DEFAULT_M1_FIRST_CONVERSATION_BUDGET_MINUTES
    : parsed
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export function parseM1FirstRunRecordArgs(argv) {
  const options = {
    appStarted: false,
    assistantReplyObserved: false,
    firstConversationBudgetMinutes: DEFAULT_M1_FIRST_CONVERSATION_BUDGET_MINUTES,
    firstMessageSent: false,
    help: false,
    latencyMs: null,
    modelConnectionChecked: false,
    noTranscriptCopied: false,
    note: '',
    observedAt: '',
    operator: '',
    outputPath: DEFAULT_M1_FIRST_RUN_OPERATOR_EVIDENCE_FILE,
    panelGuideReady: false,
    platform: normalizePlatform(),
    privateSafeReportCopied: false,
    providerId: 'unknown',
    requireReady: false,
    stdoutOnly: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--app-started') {
      options.appStarted = true
      continue
    }
    if (arg === '--model-connection-checked') {
      options.modelConnectionChecked = true
      continue
    }
    if (arg === '--first-message-sent') {
      options.firstMessageSent = true
      continue
    }
    if (arg === '--assistant-reply-observed') {
      options.assistantReplyObserved = true
      continue
    }
    if (arg === '--panel-guide-ready') {
      options.panelGuideReady = true
      continue
    }
    if (arg === '--private-safe-report-copied') {
      options.privateSafeReportCopied = true
      continue
    }
    if (arg === '--no-transcript-copied') {
      options.noTranscriptCopied = true
      continue
    }
    if (arg === '--require-ready') {
      options.requireReady = true
      continue
    }
    if (arg === '--stdout-only') {
      options.stdoutOnly = true
      continue
    }

    const [name, inlineValue] = splitOption(arg)
    if (
      name === '--observed-at'
      || name === '--operator'
      || name === '--platform'
      || name === '--provider-id'
      || name === '--latency-ms'
      || name === '--first-reply-latency-ms'
      || name === '--first-conversation-budget-minutes'
      || name === '--budget-minutes'
      || name === '--note'
      || name === '--output'
      || name === '--output-file'
      || name === '--evidence-file'
    ) {
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      const value = String(parsed.value)
      if (name === '--observed-at') {
        options.observedAt = value
      } else if (name === '--operator') {
        options.operator = value
      } else if (name === '--platform') {
        options.platform = normalizePlatform(value)
      } else if (name === '--provider-id') {
        options.providerId = cleanString(value) || 'unknown'
      } else if (name === '--latency-ms' || name === '--first-reply-latency-ms') {
        options.latencyMs = positiveNumberOrNull(value)
      } else if (name === '--first-conversation-budget-minutes' || name === '--budget-minutes') {
        options.firstConversationBudgetMinutes = normalizeBudgetMinutes(value)
      } else if (name === '--note') {
        options.note = value
      } else {
        options.outputPath = value
        options.stdoutOnly = false
      }
      index = parsed.nextIndex
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function buildMissingCheckIds(options, observedAt, latencyWithinBudget) {
  const missing = []
  if (!observedAt) missing.push('observed-at')
  if (!cleanString(options.operator)) missing.push('operator')
  if (!options.appStarted) missing.push('app-started')
  if (!options.modelConnectionChecked) missing.push('model-connection-checked')
  if (!options.firstMessageSent) missing.push('first-message-sent')
  if (!options.assistantReplyObserved) missing.push('assistant-reply-observed')
  if (!options.panelGuideReady) missing.push('panel-guide-ready')
  if (!options.privateSafeReportCopied) missing.push('private-safe-report-copied')
  if (!options.noTranscriptCopied) missing.push('no-transcript-copied')
  if (options.latencyMs === null) missing.push('first-reply-latency')
  if (latencyWithinBudget === false) missing.push('first-reply-latency-within-budget')
  return unique(missing)
}

function buildNextActions(missingCheckIds) {
  const actions = []
  if (missingCheckIds.includes('observed-at')) actions.push('record-first-reply-observed-at')
  if (missingCheckIds.includes('operator')) actions.push('record-operator-presence-without-name')
  if (missingCheckIds.includes('app-started')) actions.push('launch-nexus-and-open-panel')
  if (missingCheckIds.includes('model-connection-checked')) actions.push('run-text-model-connection-check')
  if (missingCheckIds.includes('first-message-sent')) actions.push('send-one-real-message-from-panel-guide')
  if (missingCheckIds.includes('assistant-reply-observed')) actions.push('observe-first-assistant-reply')
  if (missingCheckIds.includes('panel-guide-ready')) actions.push('confirm-panel-first-reply-guide-ready')
  if (missingCheckIds.includes('private-safe-report-copied')) actions.push('copy-runtime-m1-private-safe-report')
  if (missingCheckIds.includes('no-transcript-copied')) actions.push('avoid-copying-prompts-replies-transcripts-or-model-names')
  if (missingCheckIds.includes('first-reply-latency')) actions.push('record-first-reply-latency-ms')
  if (missingCheckIds.includes('first-reply-latency-within-budget')) actions.push('reduce-first-conversation-latency')
  return unique(actions)
}

export function buildM1FirstRunOperatorEvidence(
  options,
  generatedAt = new Date().toISOString(),
) {
  const observedAt = normalizeIso(options.observedAt)
  const latencyMs = positiveNumberOrNull(options.latencyMs)
  const budgetMinutes = normalizeBudgetMinutes(options.firstConversationBudgetMinutes)
  const latencyBudgetMs = budgetMinutes * 60 * 1000
  const latencyWithinBudget = latencyMs === null ? null : latencyMs <= latencyBudgetMs
  const missingCheckIds = buildMissingCheckIds({
    ...options,
    latencyMs,
  }, observedAt, latencyWithinBudget)
  const ok = missingCheckIds.length === 0
  const firstConversationSucceeded = Boolean(
    options.firstMessageSent
      && options.assistantReplyObserved
      && options.panelGuideReady
      && options.noTranscriptCopied
  )

  return {
    schemaVersion: 1,
    gate: M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE,
    generatedAt: normalizeIso(generatedAt) ?? new Date().toISOString(),
    ok,
    overallStatus: ok ? 'ready' : 'needs-first-run-operator-evidence',
    targetMilestone: 'M1',
    evidenceSource: 'operator-first-run',
    observedAt,
    platform: normalizePlatform(options.platform),
    providerId: cleanString(options.providerId) || 'unknown',
    operatorProvided: Boolean(cleanString(options.operator)),
    noteProvided: Boolean(cleanString(options.note)),
    budget: {
      firstConversationBudgetMinutes: budgetMinutes,
    },
    checks: {
      appStarted: options.appStarted === true,
      assistantReplyObserved: options.assistantReplyObserved === true,
      firstMessageSent: options.firstMessageSent === true,
      modelConnectionChecked: options.modelConnectionChecked === true,
      noTranscriptCopied: options.noTranscriptCopied === true,
      panelGuideReady: options.panelGuideReady === true,
      privateSafeReportCopied: options.privateSafeReportCopied === true,
    },
    modelSetup: {
      providerId: cleanString(options.providerId) || 'unknown',
      connectionChecked: options.modelConnectionChecked === true,
      providerReachable: options.modelConnectionChecked === true ? true : null,
      modelAvailable: options.assistantReplyObserved === true ? true : null,
    },
    firstConversation: {
      attempted: options.firstMessageSent === true,
      evidencePresent: firstConversationSucceeded,
      latencyMs,
      latencyWithinBudget,
      succeeded: firstConversationSucceeded,
    },
    missingCheckIds,
    nextActions: buildNextActions(missingCheckIds),
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'operator name',
        'operator notes',
        'user message text',
        'assistant reply text',
        'voice transcripts',
        'selected model name',
        'API keys',
        'provider endpoint URLs',
        'webhook URLs',
        'webhook auth headers',
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

export async function runM1FirstRunRecordCli(argv = process.argv.slice(2)) {
  const options = parseM1FirstRunRecordArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const report = buildM1FirstRunOperatorEvidence(options)
  if (!options.stdoutOnly) {
    await writeReportFile(report, options.outputPath)
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM1FirstRunRecordCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
