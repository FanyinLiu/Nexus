#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const TTS_ADAPTER_SMOKE_GATE = 'nexus-tts-adapter-smoke'

export const TTS_ADAPTER_SMOKE_TARGETS = {
  'voxtral-local': {
    baseUrl: 'http://127.0.0.1:7860/v1',
    model: 'voxtral-tts',
    voice: 'default',
  },
  'kyutai-local': {
    baseUrl: 'http://127.0.0.1:8010/v1',
    model: 'pocket-tts',
    voice: 'default',
  },
}

const TARGET_PROVIDER_IDS = new Set(Object.keys(TTS_ADAPTER_SMOKE_TARGETS))
const DEFAULT_PROVIDER_ID = 'voxtral-local'
const DEFAULT_TEXT = 'Nexus TTS smoke sample.'
const DEFAULT_RESPONSE_FORMAT = 'wav'
const DEFAULT_FIRST_AUDIO_BUDGET_MS = 700
const DEFAULT_TIMEOUT_MS = 3_000

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/tts-adapter-smoke.mjs [options]',
    '',
    'Options:',
    '  --provider <id>           voxtral-local or kyutai-local (default: voxtral-local)',
    '  --base-url <url>          OpenAI-compatible base URL ending in /v1',
    '  --model <id>              TTS model id sent to /audio/speech',
    '  --voice <id>              TTS voice id sent to /audio/speech',
    '  --text <text>             Short smoke text; only length is reported',
    '  --budget-ms <ms>          First-byte budget (default: 700)',
    '  --timeout-ms <ms>         Request timeout (default: 3000)',
    '  --output <path>           Write the private-safe report JSON to a file',
    '  --require-ready           Keep the default non-zero exit when smoke checks fail',
    '  --list                    Print built-in local adapter targets',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  npm run tts:adapter:smoke -- --provider voxtral-local',
    '  npm run tts:adapter:smoke -- --provider kyutai-local --base-url http://127.0.0.1:8010/v1',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').trim()
}

function parsePositiveInteger(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.floor(numeric))
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
    case '--provider':
      options.providerId = value
      return
    case '--base-url':
    case '--url':
      options.baseUrl = value
      return
    case '--model':
      options.model = value
      return
    case '--voice':
      options.voice = value
      return
    case '--text':
    case '--input':
      options.text = value
      return
    case '--budget-ms':
      options.budgetMs = parsePositiveInteger(value, DEFAULT_FIRST_AUDIO_BUDGET_MS)
      return
    case '--timeout-ms':
      options.timeoutMs = parsePositiveInteger(value, DEFAULT_TIMEOUT_MS)
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

export function parseTtsAdapterSmokeArgs(argv) {
  const options = {
    providerId: DEFAULT_PROVIDER_ID,
    baseUrl: '',
    model: '',
    voice: '',
    text: DEFAULT_TEXT,
    budgetMs: DEFAULT_FIRST_AUDIO_BUDGET_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputPath: '',
    requireReady: false,
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

  if (positional.length > 0 && options.text === DEFAULT_TEXT) {
    options.text = positional.join(' ')
  }

  return options
}

function normalizeBaseUrl(baseUrl) {
  return cleanString(baseUrl).replace(/\/+$/, '')
}

function normalizeProviderOptions(rawOptions) {
  const providerId = cleanString(rawOptions.providerId) || DEFAULT_PROVIDER_ID
  const target = TTS_ADAPTER_SMOKE_TARGETS[providerId] ?? null
  return {
    providerId,
    baseUrl: normalizeBaseUrl(rawOptions.baseUrl || target?.baseUrl || ''),
    model: cleanString(rawOptions.model || target?.model || ''),
    voice: cleanString(rawOptions.voice || target?.voice || ''),
    text: cleanString(rawOptions.text || DEFAULT_TEXT),
    budgetMs: parsePositiveInteger(rawOptions.budgetMs, DEFAULT_FIRST_AUDIO_BUDGET_MS),
    timeoutMs: parsePositiveInteger(rawOptions.timeoutMs, DEFAULT_TIMEOUT_MS),
  }
}

function buildSpeechUrl(baseUrl) {
  if (!baseUrl) return null
  return new URL(`${baseUrl}/audio/speech`)
}

function isLocalhostUrl(url) {
  return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
}

function normalizeIso(value) {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function buildChecks({ adapter, timing, response, ok }) {
  return [
    {
      id: 'target-local-provider',
      pass: adapter.targetLocalEngine,
      detail: adapter.targetLocalEngine
        ? 'provider is a registered target local TTS engine'
        : 'provider is not a registered target local TTS engine',
    },
    {
      id: 'localhost-endpoint',
      pass: adapter.baseUrlLocalhost,
      detail: adapter.baseUrlLocalhost
        ? 'base URL points at localhost'
        : 'base URL is not a localhost endpoint',
    },
    {
      id: 'model-configured',
      pass: adapter.modelConfigured,
      detail: `model configured=${adapter.modelConfigured}`,
    },
    {
      id: 'voice-configured',
      pass: adapter.voiceConfigured,
      detail: `voice configured=${adapter.voiceConfigured}`,
    },
    {
      id: 'http-ok',
      pass: response.httpStatus >= 200 && response.httpStatus < 300,
      detail: response.httpStatus ? `http status=${response.httpStatus}` : 'no HTTP response',
    },
    {
      id: 'received-audio-bytes',
      pass: response.bytes > 0,
      detail: `${response.bytes} byte(s) received`,
    },
    {
      id: 'first-byte-sample',
      pass: timing.firstByteLatencyMs !== null,
      detail: timing.firstByteLatencyMs === null
        ? 'no first-byte latency sample'
        : `first byte=${timing.firstByteLatencyMs}ms`,
    },
    {
      id: 'passes-first-audio-budget',
      pass: ok && timing.withinBudget,
      detail: `first byte budget=${timing.budgetMs}ms`,
    },
  ]
}

function buildNextActions(report) {
  const actions = []
  if (!report.adapter.targetLocalEngine) {
    actions.push('Run the smoke against voxtral-local or kyutai-local before using it as v0.3.4 P2 evidence.')
  }
  if (!report.adapter.baseUrlLocalhost) {
    actions.push('Point --base-url at the localhost OpenAI-compatible adapter endpoint.')
  }
  if (!report.adapter.modelConfigured) {
    actions.push('Pass --model or select a built-in target provider with a default model.')
  }
  if (!report.adapter.voiceConfigured) {
    actions.push('Pass --voice or select a built-in target provider with a default voice.')
  }
  if (!report.response.httpStatus) {
    actions.push('Start the local TTS adapter and confirm its /audio/speech endpoint is reachable.')
  } else if (report.response.httpStatus < 200 || report.response.httpStatus >= 300) {
    actions.push('Check the local adapter logs; the smoke request returned a non-2xx status.')
  } else if (report.response.bytes === 0) {
    actions.push('The local adapter returned no audio bytes; inspect model/voice compatibility.')
  }
  if (report.timing.firstByteLatencyMs !== null && !report.timing.withinBudget) {
    actions.push('First-byte latency exceeded the low-latency budget; inspect adapter startup, model loading, or streaming behavior.')
  }
  return actions
}

function createBaseReport(options, generatedAt = new Date()) {
  const providerOptions = normalizeProviderOptions(options)
  const speechUrl = buildSpeechUrl(providerOptions.baseUrl)
  const adapter = {
    providerId: providerOptions.providerId,
    targetLocalEngine: TARGET_PROVIDER_IDS.has(providerOptions.providerId),
    baseUrlConfigured: Boolean(providerOptions.baseUrl),
    baseUrlLocalhost: speechUrl ? isLocalhostUrl(speechUrl) : false,
    baseUrlProtocol: speechUrl?.protocol.replace(':', '') ?? null,
    modelConfigured: Boolean(providerOptions.model),
    voiceConfigured: Boolean(providerOptions.voice),
  }

  return {
    schemaVersion: 1,
    gate: TTS_ADAPTER_SMOKE_GATE,
    generatedAt: normalizeIso(generatedAt),
    ok: false,
    adapter,
    request: {
      inputChars: providerOptions.text.length,
      responseFormat: DEFAULT_RESPONSE_FORMAT,
    },
    timing: {
      firstByteLatencyMs: null,
      totalLatencyMs: null,
      budgetMs: providerOptions.budgetMs,
      timeoutMs: providerOptions.timeoutMs,
      withinBudget: false,
    },
    response: {
      httpStatus: 0,
      contentType: null,
      bytes: 0,
      receivedAudio: false,
    },
    error: null,
    checks: [],
    nextActions: [],
    _providerOptions: providerOptions,
    _speechUrl: speechUrl,
  }
}

function publicReport(report) {
  const { _providerOptions, _speechUrl, ...safeReport } = report
  return safeReport
}

async function writeReportFile(report, outputPath) {
  const cleanPath = cleanString(outputPath)
  if (!cleanPath) return
  const resolvedPath = path.resolve(process.cwd(), cleanPath)
  await mkdir(path.dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

function roundMs(value) {
  return Math.round(value)
}

async function readResponseBytes(response, markFirstByte) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > 0) markFirstByte()
    return buffer.length
  }

  const reader = response.body.getReader()
  let firstChunkSeen = false
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value?.length) {
      if (!firstChunkSeen) {
        firstChunkSeen = true
        markFirstByte()
      }
      bytes += value.length
    }
  }
  return bytes
}

export async function buildTtsAdapterSmokeReport(rawOptions = {}, {
  fetchImpl = globalThis.fetch,
  generatedAt = new Date(),
  now = () => performance.now(),
} = {}) {
  const report = createBaseReport(rawOptions, generatedAt)
  const providerOptions = report._providerOptions
  const speechUrl = report._speechUrl
  let firstByteAt = null
  const startedAt = now()

  const finish = () => {
    const firstByteLatencyMs = firstByteAt === null ? null : roundMs(firstByteAt - startedAt)
    report.timing.firstByteLatencyMs = firstByteLatencyMs
    report.timing.totalLatencyMs = roundMs(now() - startedAt)
    report.timing.withinBudget = firstByteLatencyMs !== null && firstByteLatencyMs <= report.timing.budgetMs
    report.response.receivedAudio = report.response.bytes > 0
    report.ok = report.adapter.targetLocalEngine
      && report.adapter.baseUrlLocalhost
      && report.adapter.modelConfigured
      && report.adapter.voiceConfigured
      && report.response.httpStatus >= 200
      && report.response.httpStatus < 300
      && report.response.bytes > 0
      && report.timing.withinBudget
    report.checks = buildChecks(report)
    report.nextActions = buildNextActions(report)
    return publicReport(report)
  }

  if (!fetchImpl) {
    report.error = { kind: 'runtime-error', detail: 'global fetch is unavailable in this Node runtime' }
    return finish()
  }

  if (!speechUrl || !providerOptions.model || !providerOptions.voice) {
    report.error = { kind: 'configuration-error', detail: 'baseUrl, model, and voice are required' }
    return finish()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), providerOptions.timeoutMs)
  try {
    const response = await fetchImpl(speechUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        input: providerOptions.text,
        model: providerOptions.model,
        response_format: DEFAULT_RESPONSE_FORMAT,
        voice: providerOptions.voice,
      }),
      signal: controller.signal,
    })
    report.response.httpStatus = response.status
    report.response.contentType = response.headers?.get?.('content-type') ?? null
    report.response.bytes = await readResponseBytes(response, () => {
      if (firstByteAt === null) firstByteAt = now()
    })
  } catch (error) {
    const kind = error?.name === 'AbortError' ? 'timeout' : 'network-error'
    report.error = {
      kind,
      detail: kind === 'timeout'
        ? `Request exceeded ${providerOptions.timeoutMs}ms`
        : 'Local TTS adapter request failed before an HTTP response.',
    }
  } finally {
    clearTimeout(timeout)
  }

  return finish()
}

export async function runTtsAdapterSmokeCli(argv = process.argv.slice(2)) {
  const options = parseTtsAdapterSmokeArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  if (options.list) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      gate: TTS_ADAPTER_SMOKE_GATE,
      targets: TTS_ADAPTER_SMOKE_TARGETS,
    }, null, 2)}\n`)
    return 0
  }

  const report = await buildTtsAdapterSmokeReport(options)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return report.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runTtsAdapterSmokeCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
