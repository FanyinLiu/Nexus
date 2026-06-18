#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildCompanionHealthSummary,
} from '../src/features/onboarding/companionHealth.ts'
import {
  DEFAULT_PET_MODEL_ID,
  getPetModelPreset,
} from '../src/features/pet/models.ts'

export const COMPANION_READINESS_EVIDENCE_GATE = 'companion-readiness-health'

const SAMPLE_INPUT = {
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
    updatedAt: '2026-06-17T12:00:00.000Z',
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

const REQUIRED_ITEM_IDS = [
  'standard_companion',
  'presence_state',
  'text_model',
  'microphone',
  'tts',
  'live2d',
  'notification_permission',
  'local_webhook',
  'privacy_boundary',
]

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/companion-readiness-report.mjs [options]',
    '',
    'Options:',
    '  --input <path>            Companion health input JSON file, or - for stdin',
    '  --json <path>             Alias for --input',
    '  --sample                  Use the built-in private-safe standard companion sample',
    '  --generated-at <iso>      Override report timestamp',
    '  --output <path>           Write the private-safe report JSON to a file',
    '  --require-ready           Exit non-zero unless every readiness check passes',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  npm run companion:readiness:report -- --sample',
    '  npm run companion:readiness:report -- --sample --output artifacts/v0.3.4/companion-readiness.json --require-ready',
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

export function parseCompanionReadinessReportArgs(argv) {
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

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function safeEvidenceForItem(item) {
  const evidence = item.evidence && typeof item.evidence === 'object' ? item.evidence : {}
  const safe = {}
  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === 'boolean' || typeof value === 'number' || value == null) {
      safe[key] = value
      continue
    }
    if ([
      'petModelId',
      'focusState',
      'platformSupported',
      'presenceState',
      'quietReason',
      'voicePipelineStep',
      'voiceState',
      'watcherStatus',
    ].includes(key)) {
      safe[key] = value
    }
  }
  if ('url' in evidence) safe.webhookUrlPresent = Boolean(evidence.url)
  if ('authHeader' in evidence) safe.webhookAuthHeaderPresent = Boolean(evidence.authHeader)
  return safe
}

function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Companion readiness input must be a JSON object')
  }
  const merged = {
    ...SAMPLE_INPUT,
    ...raw,
    platformProfile: {
      ...SAMPLE_INPUT.platformProfile,
      ...(raw.platformProfile ?? {}),
      voice: {
        ...SAMPLE_INPUT.platformProfile.voice,
        ...(raw.platformProfile?.voice ?? {}),
      },
    },
    settings: {
      ...SAMPLE_INPUT.settings,
      ...(raw.settings ?? {}),
    },
    voicePipeline: {
      ...SAMPLE_INPUT.voicePipeline,
      ...(raw.voicePipeline ?? {}),
    },
    watcherStatus: raw.watcherStatus === null
      ? null
      : {
          ...SAMPLE_INPUT.watcherStatus,
          ...(raw.watcherStatus ?? {}),
        },
    webhookInfo: raw.webhookInfo === null
      ? null
      : {
          ...SAMPLE_INPUT.webhookInfo,
          ...(raw.webhookInfo ?? {}),
        },
  }

  if (!merged.petModel && merged.settings?.petModelId) {
    merged.petModel = getPetModelPreset(merged.settings.petModelId)
  }
  return merged
}

export function buildCompanionReadinessEvidenceReport(
  rawInput = SAMPLE_INPUT,
  generatedAt = new Date().toISOString(),
  evidenceSource = 'sample-standard-companion',
) {
  const input = normalizeInput(rawInput)
  const summary = buildCompanionHealthSummary(input)
  const checks = summary.items.map((item) => ({
    id: item.id,
    pass: item.status === 'ready',
    status: item.status,
    evidence: safeEvidenceForItem(item),
  }))
  const coveredItemIds = checks.map((check) => check.id)
  const missingRequiredItemIds = REQUIRED_ITEM_IDS.filter((id) => !coveredItemIds.includes(id))
  const failedCheckIds = checks
    .filter((check) => !check.pass)
    .map((check) => check.id)
  const ok = missingRequiredItemIds.length === 0 && failedCheckIds.length === 0

  return {
    schemaVersion: 1,
    gate: COMPANION_READINESS_EVIDENCE_GATE,
    generatedAt: normalizeIso(generatedAt),
    ok,
    evidenceSource,
    status: summary.status,
    readyCount: summary.readyCount,
    warningCount: summary.warningCount,
    blockedCount: summary.blockedCount,
    totalCount: summary.totalCount,
    requiredItemIds: REQUIRED_ITEM_IDS,
    coveredItemIds,
    missingRequiredItemIds,
    failedCheckIds,
    checks,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'userName',
        'companionName',
        'systemPrompt',
        'apiKey',
        'apiBaseUrl',
        'speech provider endpoint URLs',
        'webhook URL',
        'webhook auth header',
        'voice transcripts',
      ],
    },
  }
}

export async function runCompanionReadinessReportCli(argv = process.argv.slice(2)) {
  const options = parseCompanionReadinessReportArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const raw = options.sample ? SAMPLE_INPUT : await readJsonInput(options.inputPath)
  const report = buildCompanionReadinessEvidenceReport(
    raw,
    options.generatedAt || new Date().toISOString(),
    options.sample ? 'sample-standard-companion' : 'input-json',
  )
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCompanionReadinessReportCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
