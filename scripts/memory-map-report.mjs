#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildMemoryMapViewModel,
} from '../src/features/memory/memoryMap.ts'

export const MEMORY_MAP_EVIDENCE_GATE = 'memory-map-observability'

const SAMPLE_INPUT = {
  memories: [
    {
      id: 'sample-preference',
      category: 'preference',
      content: 'The user prefers quiet companionship during work blocks.',
      createdAt: '2026-06-16T10:00:00Z',
      importance: 'pinned',
      kind: 'relationship',
      relatedIds: ['sample-habit'],
      source: 'chat',
      sourceRef: 'chat:sample-turn-1',
    },
    {
      id: 'sample-habit',
      category: 'habit',
      content: 'The user likes short follow-ups after long sessions.',
      createdAt: '2026-06-16T11:00:00Z',
      enabled: false,
      kind: 'preference',
      source: 'voice',
      sourceRef: 'voice:sample-turn-2',
    },
  ],
  dailyMemories: {
    '2026-06-16': [
      {
        id: 'sample-daily-1',
        content: 'We adjusted the companion tone together and remembered a calmer rhythm.',
        createdAt: '2026-06-16T12:00:00Z',
        day: '2026-06-16',
        role: 'assistant',
        source: 'chat',
        sourceRef: 'chat:sample-turn-3',
      },
    ],
  },
  relationshipSamples: [
    {
      daysInteracted: 7,
      level: 'close_friend',
      score: 56,
      streak: 3,
      ts: '2026-06-16T13:00:00Z',
    },
  ],
}

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/memory-map-report.mjs [options]',
    '',
    'Options:',
    '  --input <path>            Memory-map input JSON file, or - for stdin',
    '  --json <path>             Alias for --input',
    '  --sample                  Use the built-in private-safe memory-map sample',
    '  --generated-at <iso>      Override report timestamp',
    '  --output <path>           Write the private-safe report JSON to a file',
    '  --require-ready           Exit non-zero unless every memory-map check passes',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  npm run memory:map:report -- --sample',
    '  npm run memory:map:report -- --sample --output artifacts/v0.3.4/memory-map.json --require-ready',
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

export function parseMemoryMapReportArgs(argv) {
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

function countBy(items, readKey) {
  const counts = {}
  for (const item of items) {
    const key = cleanString(readKey(item)) || 'unknown'
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Memory map input must be a JSON object')
  }
  return {
    dailyMemories: raw.dailyMemories ?? raw.daily ?? [],
    memories: Array.isArray(raw.memories) ? raw.memories : [],
    relationshipSamples: Array.isArray(raw.relationshipSamples)
      ? raw.relationshipSamples
      : Array.isArray(raw.relationship)
        ? raw.relationship
        : [],
  }
}

function buildChecks(view) {
  const nodeKindCounts = countBy(view.nodes, (node) => node.kind)
  const edgeKindCounts = countBy(view.edges, (edge) => edge.kind)
  const timelineKindCounts = countBy(view.relationshipTimeline, (item) => item.kind)

  const checks = [
    {
      id: 'has-long-term-memories',
      pass: view.summary.longTermCount > 0,
      detail: `${view.summary.longTermCount} long-term memory item(s)`,
    },
    {
      id: 'has-daily-entries',
      pass: view.summary.dailyEntryCount > 0,
      detail: `${view.summary.dailyEntryCount} daily memory entr${view.summary.dailyEntryCount === 1 ? 'y' : 'ies'}`,
    },
    {
      id: 'has-graph-nodes',
      pass: view.nodes.length > 0,
      detail: `${view.nodes.length} derived graph node(s)`,
    },
    {
      id: 'has-graph-edges',
      pass: view.edges.length > 0,
      detail: `${view.edges.length} derived graph edge(s)`,
    },
    {
      id: 'has-source-ref-edges',
      pass: (edgeKindCounts.source_ref ?? 0) > 0 && view.summary.sourceRefCount > 0,
      detail: `${edgeKindCounts.source_ref ?? 0} source-ref edge(s); ${view.summary.sourceRefCount} source ref(s)`,
    },
    {
      id: 'has-openable-source-refs',
      pass: view.summary.openableSourceRefCount > 0,
      detail: `${view.summary.openableSourceRefCount} source ref(s) can jump to source surfaces`,
    },
    {
      id: 'has-relationship-timeline',
      pass: view.relationshipTimeline.length > 0,
      detail: `${view.relationshipTimeline.length} relationship timeline item(s)`,
    },
    {
      id: 'has-relationship-state-summary',
      pass: (timelineKindCounts.relationship_state ?? 0) > 0 && view.summary.relationshipSampleCount > 0,
      detail: `${timelineKindCounts.relationship_state ?? 0} relationship state timeline item(s)`,
    },
    {
      id: 'has-recall-governance',
      pass: view.summary.pinnedCount > 0 || view.summary.recallPausedCount > 0,
      detail: `${view.summary.pinnedCount} pinned; ${view.summary.recallPausedCount} recall-paused`,
    },
    {
      id: 'has-core-node-kinds',
      pass: ['category', 'daily', 'day', 'long_term', 'relationship', 'relationship_state', 'source']
        .every((kind) => (nodeKindCounts[kind] ?? 0) > 0),
      detail: `node kinds=${Object.keys(nodeKindCounts).sort().join(', ')}`,
    },
  ]

  return { checks, edgeKindCounts, nodeKindCounts, timelineKindCounts }
}

export function buildMemoryMapEvidenceReport(
  rawInput = SAMPLE_INPUT,
  generatedAt = new Date().toISOString(),
  evidenceSource = 'sample-memory-map',
) {
  const input = normalizeInput(rawInput)
  const reportGeneratedAt = normalizeIso(generatedAt)
  const view = buildMemoryMapViewModel(
    input.memories,
    input.dailyMemories,
    input.relationshipSamples,
    reportGeneratedAt,
  )
  const { checks, edgeKindCounts, nodeKindCounts, timelineKindCounts } = buildChecks(view)
  const failedCheckIds = checks.filter((check) => !check.pass).map((check) => check.id)

  return {
    schemaVersion: 1,
    gate: MEMORY_MAP_EVIDENCE_GATE,
    generatedAt: reportGeneratedAt,
    ok: failedCheckIds.length === 0,
    evidenceSource,
    viewSchema: view.schema,
    summary: view.summary,
    nodeCount: view.nodes.length,
    edgeCount: view.edges.length,
    relationshipTimelineCount: view.relationshipTimeline.length,
    nodeKindCounts,
    edgeKindCounts,
    timelineKindCounts,
    checks,
    failedCheckIds,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'memory bodies',
        'daily diary bodies',
        'memory ids',
        'daily entry ids',
        'source ids',
        'timeline titles and details',
        'graph labels and details',
      ],
    },
  }
}

export async function runMemoryMapReportCli(argv = process.argv.slice(2)) {
  const options = parseMemoryMapReportArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const raw = options.sample ? SAMPLE_INPUT : await readJsonInput(options.inputPath)
  const report = buildMemoryMapEvidenceReport(
    raw,
    options.generatedAt || new Date().toISOString(),
    options.sample ? 'sample-memory-map' : 'input-json',
  )
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMemoryMapReportCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
