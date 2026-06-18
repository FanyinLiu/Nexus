#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildCompanionHealthSummary,
} from '../src/features/onboarding/companionHealth.ts'
import {
  buildM1FirstRunModelSetupEvidence,
} from '../src/features/onboarding/firstRunAuditInput.ts'
import {
  DEFAULT_PET_MODEL_ID,
  getPetModelPreset,
} from '../src/features/pet/models.ts'

export const M1_FIRST_RUN_AUDIT_GATE = 'nexus-v1-m1-first-run-audit'
export const M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE = 'nexus-v1-m1-first-run-operator-evidence'

const SAMPLE_HEALTH_INPUT = {
  platformProfile: {
    voice: {
      continuousVoiceSupported: true,
      dependencyHint: null,
      speechInputAvailable: true,
      speechInputSupported: true,
      speechOutputAvailable: true,
      speechOutputSupported: true,
      vadSupported: true,
      wakewordSupported: true,
    },
  },
  petModel: getPetModelPreset(DEFAULT_PET_MODEL_ID),
  quietReason: null,
  settings: {
    apiBaseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    apiProviderId: 'ollama',
    autonomyNotificationMessagePreviewEnabled: false,
    autonomyNotificationsEnabled: true,
    companionName: 'Xinghui',
    contextAwarenessEnabled: true,
    continuousVoiceModeEnabled: false,
    discordAnnounceMessagePreview: false,
    macosMessageWatcherEnabled: true,
    model: 'qwen3:8b',
    petModelId: DEFAULT_PET_MODEL_ID,
    speechInputApiBaseUrl: '',
    speechInputEnabled: true,
    speechInputProviderId: 'local-sensevoice',
    speechOutputApiBaseUrl: '',
    speechOutputEnabled: true,
    speechOutputProviderId: 'edge-tts',
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
    systemPrompt: 'You are an AI desktop companion, not a general-purpose agent.',
    telegramAnnounceMessagePreview: false,
    userName: 'Release User',
    voiceTriggerMode: 'manual_confirm',
  },
  voicePipeline: {
    detail: 'Waiting for the next turn.',
    step: 'idle',
    updatedAt: '2026-06-18T08:00:00.000Z',
  },
  voiceState: 'idle',
  watcherStatus: {
    lastError: null,
    platformSupported: true,
    status: 'running',
  },
  webhookInfo: {
    authHeader: 'Bearer sample-token',
    url: 'http://127.0.0.1:47830/webhook',
  },
}

const SAMPLE_INPUT = {
  companionHealth: SAMPLE_HEALTH_INPUT,
  budget: {
    firstConversationBudgetMinutes: 1,
    installBudgetMinutes: 1,
    modelSetupBudgetMinutes: 2,
  },
  modelSetup: {
    connectionChecked: true,
    modelAvailable: true,
    providerReachable: true,
  },
  firstConversation: {
    attempted: true,
    latencyMs: 1800,
    succeeded: true,
  },
}

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/m1-first-run-audit.mjs [options]',
    '',
    'Builds a private-safe v1 M1 first-run setup and model repair audit.',
    '',
    'Options:',
    '  --input <path>            First-run audit input JSON file, or - for stdin',
    '  --json <path>             Alias for --input',
    '  --sample                  Use the built-in private-safe first-run sample',
    '  --generated-at <iso>      Override report timestamp',
    '  --output <path>           Write the private-safe report JSON to a file',
    '  --require-ready           Exit non-zero unless the first-run path is ready',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  npm run m1:first-run:audit -- --sample',
    '  npm run m1:first-run:audit -- --sample --output artifacts/v1/m1-first-run-audit.json --require-ready',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').trim()
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

function assignOption(options, name, value) {
  switch (name) {
    case '--input':
    case '--json':
      options.inputPath = value
      return
    case '--generated-at':
      options.generatedAt = value
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

export function parseM1FirstRunAuditArgs(argv) {
  const options = {
    generatedAt: '',
    help: false,
    inputPath: '',
    outputPath: '',
    requireReady: false,
    sample: false,
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
    if (arg === '--sample') {
      options.sample = true
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

  if (!options.inputPath && positional.length > 0) {
    options.inputPath = positional[0]
  }

  return options
}

async function readStdinText() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readJsonInput(inputPath) {
  const target = cleanString(inputPath)
  if (!target) throw new Error('--input or --sample is required')
  const text = target === '-'
    ? await readStdinText()
    : await fs.readFile(path.resolve(process.cwd(), target), 'utf8')
  return JSON.parse(text)
}

async function writeReportFile(report, outputPath) {
  const target = cleanString(outputPath)
  if (!target) return
  const resolved = path.resolve(process.cwd(), target)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasText(value) {
  return Boolean(cleanString(value))
}

function finiteNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function readHealthInput(rawInput) {
  if (isPlainObject(rawInput?.companionHealth)) return rawInput.companionHealth
  return isPlainObject(rawInput) ? rawInput : {}
}

function normalizeHealthInput(rawInput) {
  const raw = readHealthInput(rawInput)
  const settings = {
    ...SAMPLE_HEALTH_INPUT.settings,
    ...(raw.settings ?? {}),
  }
  const merged = {
    ...SAMPLE_HEALTH_INPUT,
    ...raw,
    platformProfile: {
      ...SAMPLE_HEALTH_INPUT.platformProfile,
      ...(raw.platformProfile ?? {}),
      voice: {
        ...SAMPLE_HEALTH_INPUT.platformProfile.voice,
        ...(raw.platformProfile?.voice ?? {}),
      },
    },
    settings,
    voicePipeline: {
      ...SAMPLE_HEALTH_INPUT.voicePipeline,
      ...(raw.voicePipeline ?? {}),
    },
    watcherStatus: raw.watcherStatus === null
      ? null
      : {
          ...SAMPLE_HEALTH_INPUT.watcherStatus,
          ...(raw.watcherStatus ?? {}),
        },
    webhookInfo: raw.webhookInfo === null
      ? null
      : {
          ...SAMPLE_HEALTH_INPUT.webhookInfo,
          ...(raw.webhookInfo ?? {}),
        },
  }

  if (!merged.petModel && settings.petModelId) {
    merged.petModel = getPetModelPreset(settings.petModelId)
  }
  return merged
}

function readBudget(rawInput, sampleMode) {
  const operatorEvidence = readOperatorEvidence(rawInput)
  const raw = isPlainObject(rawInput?.budget)
    ? rawInput.budget
    : isPlainObject(operatorEvidence?.budget)
      ? operatorEvidence.budget
      : rawInput ?? {}
  const fallback = sampleMode ? SAMPLE_INPUT.budget : {}
  const installBudgetMinutes = finiteNumberOrNull(raw.installBudgetMinutes ?? fallback.installBudgetMinutes)
  const modelSetupBudgetMinutes = finiteNumberOrNull(raw.modelSetupBudgetMinutes ?? fallback.modelSetupBudgetMinutes)
  const firstConversationBudgetMinutes = finiteNumberOrNull(
    raw.firstConversationBudgetMinutes ?? fallback.firstConversationBudgetMinutes,
  )
  const values = [installBudgetMinutes, modelSetupBudgetMinutes, firstConversationBudgetMinutes]
  const totalBudgetMinutes = values.every((value) => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null

  return {
    firstConversationBudgetMinutes,
    installBudgetMinutes,
    modelSetupBudgetMinutes,
    totalBudgetMinutes,
    withinFiveMinutes: totalBudgetMinutes !== null && totalBudgetMinutes <= 5,
  }
}

function readOperatorEvidence(rawInput) {
  if (isPlainObject(rawInput?.operatorEvidence)) return rawInput.operatorEvidence
  if (isPlainObject(rawInput?.firstRunOperatorEvidence)) return rawInput.firstRunOperatorEvidence
  if (rawInput?.gate === M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE) return rawInput
  return null
}

function isOperatorEvidenceOnly(rawInput) {
  return rawInput?.gate === M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE
    && !isPlainObject(rawInput?.companionHealth)
    && !isPlainObject(rawInput?.settings)
}

function readFirstConversation(rawInput, budget, sampleMode) {
  const operatorEvidence = readOperatorEvidence(rawInput)
  const raw = isPlainObject(rawInput?.firstConversation)
    ? rawInput.firstConversation
    : isPlainObject(operatorEvidence?.firstConversation)
      ? operatorEvidence.firstConversation
      : {}
  const fallback = sampleMode ? SAMPLE_INPUT.firstConversation : {}
  const attempted = booleanOrNull(raw.attempted ?? fallback.attempted) === true
  const succeeded = booleanOrNull(raw.succeeded ?? fallback.succeeded) === true
  const latencyMs = finiteNumberOrNull(raw.latencyMs ?? fallback.latencyMs)
  const latencyBudgetMs = budget.firstConversationBudgetMinutes === null
    ? null
    : budget.firstConversationBudgetMinutes * 60 * 1000
  const latencyWithinBudget = latencyMs === null || latencyBudgetMs === null
    ? null
    : latencyMs <= latencyBudgetMs

  return {
    attempted,
    evidencePresent: attempted && succeeded,
    latencyMs,
    latencyWithinBudget,
    succeeded,
  }
}

function readTextConnectionResult(rawInput) {
  if (isPlainObject(rawInput?.textConnectionResult)) return rawInput.textConnectionResult
  if (isPlainObject(rawInput?.connectionResults?.text)) return rawInput.connectionResults.text
  return null
}

function isLocalProvider(providerId) {
  const id = cleanString(providerId).toLowerCase()
  return [
    'ollama',
    'lm-studio',
    'jan',
    'local',
    'kobold',
    'llamacpp',
    'custom-local',
  ].some((token) => id.includes(token))
}

function repairActionForUnavailableProvider(providerId) {
  const id = cleanString(providerId).toLowerCase()
  if (id.includes('ollama')) return 'start-ollama'
  if (isLocalProvider(providerId)) return 'start-local-model-service'
  return 'check-remote-provider-status'
}

function repairActionForMissingModel(providerId) {
  const id = cleanString(providerId).toLowerCase()
  if (id.includes('ollama')) return 'pull-ollama-model'
  if (isLocalProvider(providerId)) return 'install-local-model'
  return 'choose-available-model'
}

function providerHintId(providerId) {
  const id = cleanString(providerId).toLowerCase()
  if (id.includes('ollama')) return 'ollama-start-serve-and-pull-selected-model'
  if (id.includes('deepseek')) return 'deepseek-check-api-key-base-url-and-model'
  if (id.includes('openai')) return 'openai-compatible-check-api-key-base-url-and-model'
  if (isLocalProvider(providerId)) return 'local-provider-start-service-and-select-model'
  return 'provider-check-base-url-key-and-model'
}

function summarizeReadiness(summary) {
  const blockingItemIds = summary.items
    .filter((item) => item.status === 'blocked')
    .map((item) => item.id)
  const warningItemIds = summary.items
    .filter((item) => item.status === 'warning')
    .map((item) => item.id)

  return {
    ok: summary.status === 'ready',
    status: summary.status,
    readyCount: summary.readyCount,
    warningCount: summary.warningCount,
    blockedCount: summary.blockedCount,
    totalCount: summary.totalCount,
    blockingItemIds,
    warningItemIds,
    coveredItemIds: summary.items.map((item) => item.id),
  }
}

function summarizeModelSetup(rawInput, healthInput, summary, firstConversation, sampleMode) {
  const textModelItem = summary.items.find((item) => item.id === 'text_model')
  const textEvidence = isPlainObject(textModelItem?.evidence) ? textModelItem.evidence : {}
  const textConnectionResult = readTextConnectionResult(rawInput)
  const operatorEvidence = readOperatorEvidence(rawInput)
  const raw = isPlainObject(rawInput?.modelSetup)
    ? rawInput.modelSetup
    : (
        textConnectionResult
          ? buildM1FirstRunModelSetupEvidence(healthInput.settings, textConnectionResult)
          : isPlainObject(operatorEvidence?.modelSetup)
            ? operatorEvidence.modelSetup
            : {}
      )
  const fallback = sampleMode ? SAMPLE_INPUT.modelSetup : {}
  const providerId = cleanString(raw.providerId || healthInput.settings.apiProviderId || 'unknown')
  const baseUrlPresent = Boolean(textEvidence.baseUrlReady)
  const modelPresent = Boolean(textEvidence.modelReady)
  const apiKeyRequired = Boolean(textEvidence.providerRequiresKey)
  const apiKeyPresent = hasText(healthInput.settings.apiKey)
  const apiKeySatisfied = !apiKeyRequired || apiKeyPresent
  const localProvider = isLocalProvider(providerId)
  const connectionChecked = booleanOrNull(raw.connectionChecked ?? fallback.connectionChecked) === true
  const providerReachable = booleanOrNull(raw.providerReachable ?? fallback.providerReachable)
  const modelAvailableInput = booleanOrNull(raw.modelAvailable ?? fallback.modelAvailable)
  const modelAvailable = modelAvailableInput ?? (firstConversation.succeeded && modelPresent ? true : null)

  const blockedReasonIds = []
  const repairActionIds = []

  if (!baseUrlPresent) {
    blockedReasonIds.push('missing-base-url')
    repairActionIds.push('set-text-provider-base-url')
  }
  if (!modelPresent) {
    blockedReasonIds.push('missing-model')
    repairActionIds.push('select-text-model')
  }
  if (!apiKeySatisfied) {
    blockedReasonIds.push('missing-api-key')
    repairActionIds.push('add-provider-api-key')
  }
  if (!connectionChecked) {
    blockedReasonIds.push('connection-not-checked')
    repairActionIds.push('check-text-provider-connection')
    if (localProvider) repairActionIds.push(repairActionForUnavailableProvider(providerId))
  }
  if (providerReachable === false) {
    blockedReasonIds.push('provider-unreachable')
    repairActionIds.push(repairActionForUnavailableProvider(providerId))
  }
  if (modelAvailable === false) {
    blockedReasonIds.push('model-unavailable')
    repairActionIds.push(repairActionForMissingModel(providerId))
  }

  return {
    providerId,
    localProvider,
    apiKeyRequired,
    apiKeyPresent,
    apiKeySatisfied,
    baseUrlPresent,
    modelPresent,
    connectionChecked,
    providerReachable,
    modelAvailable,
    providerHintId: providerHintId(providerId),
    repairActionIds: unique(repairActionIds),
    blockedReasonIds: unique(blockedReasonIds),
  }
}

function buildNextActions(readiness, budget, modelSetup, firstConversation, operatorEvidenceOnly = false) {
  const actions = [...modelSetup.repairActionIds]
  if (!readiness.ok) actions.push('rerun-companion-readiness')
  if (!budget.withinFiveMinutes) actions.push('tighten-first-run-five-minute-budget')
  if (operatorEvidenceOnly) actions.push('merge-operator-evidence-with-runtime-m1-report')
  if (!firstConversation.attempted) actions.push('run-first-conversation-smoke')
  if (firstConversation.attempted && !firstConversation.succeeded) {
    actions.push('retry-first-conversation-after-model-repair')
  }
  if (firstConversation.latencyWithinBudget === false) {
    actions.push('reduce-first-conversation-latency')
  }
  return unique(actions)
}

export function buildM1FirstRunAuditReport(
  rawInput,
  generatedAt = new Date().toISOString(),
  evidenceSource = rawInput === undefined ? 'sample-m1-first-run' : 'input-json',
) {
  const sampleMode = rawInput === undefined
  const sourceInput = sampleMode ? SAMPLE_INPUT : rawInput
  if (!isPlainObject(sourceInput)) {
    throw new Error('M1 first-run audit input must be a JSON object')
  }

  const healthInput = normalizeHealthInput(sourceInput)
  const summary = buildCompanionHealthSummary(healthInput)
  const readiness = summarizeReadiness(summary)
  const budget = readBudget(sourceInput, sampleMode)
  const firstConversation = readFirstConversation(sourceInput, budget, sampleMode)
  const modelSetup = summarizeModelSetup(sourceInput, healthInput, summary, firstConversation, sampleMode)
  const operatorEvidenceOnly = isOperatorEvidenceOnly(sourceInput)
  const nextActions = buildNextActions(readiness, budget, modelSetup, firstConversation, operatorEvidenceOnly)
  const ok = (
    !operatorEvidenceOnly
    && readiness.ok
    && budget.withinFiveMinutes
    && modelSetup.blockedReasonIds.length === 0
    && firstConversation.evidencePresent
    && firstConversation.latencyWithinBudget !== false
  )

  return {
    schemaVersion: 1,
    gate: M1_FIRST_RUN_AUDIT_GATE,
    generatedAt: normalizeIso(generatedAt),
    ok,
    overallStatus: ok ? 'ready' : 'needs-first-run-work',
    targetMilestone: 'M1',
    evidenceSource,
    budget,
    readiness,
    modelSetup,
    firstConversation,
    nextActions,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'userName',
        'companionName',
        'systemPrompt',
        'apiKey',
        'apiBaseUrl',
        'selected model name',
        'speech provider endpoint URLs',
        'webhook URL',
        'webhook auth header',
        'voice transcripts',
        'chat prompt and answer text',
      ],
    },
  }
}

export async function runM1FirstRunAuditCli(argv = process.argv.slice(2)) {
  const options = parseM1FirstRunAuditArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const raw = options.sample ? SAMPLE_INPUT : await readJsonInput(options.inputPath)
  const report = buildM1FirstRunAuditReport(
    raw,
    options.generatedAt || new Date().toISOString(),
    options.sample ? 'sample-m1-first-run' : 'input-json',
  )
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runM1FirstRunAuditCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
