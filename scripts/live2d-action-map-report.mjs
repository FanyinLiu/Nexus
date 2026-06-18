#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  applyPetActionMapOverride,
  buildPublicPetActionMapEvidenceReport,
  normalizePetActionMapDraftPatch,
} from '../src/features/pet/actionMap.ts'
import {
  getPetModelPreset,
  getPetModelPresets,
} from '../src/features/pet/models.ts'

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node --experimental-strip-types scripts/live2d-action-map-report.mjs [options]',
    '',
    'Options:',
    '  --model <id>              Built-in pet model id (default: mao)',
    '  --patch-file <path>       Optional action-map patch JSON, or - for stdin',
    '  --input <path>            Alias for --patch-file',
    '  --generated-at <iso>      Override report timestamp',
    '  --output <path>           Write the private-safe report JSON to a file',
    '  --require-ready           Exit non-zero unless every coverage check passes',
    '  --list                    Print built-in model ids',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  npm run live2d:action-map:report -- --model mao',
    '  npm run live2d:action-map:report -- --model mao --patch-file ./action-map.patch.json --output artifacts/v0.3.4/live2d-action-map.json',
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
    case '--model':
    case '--model-id':
      options.modelId = value
      return
    case '--patch-file':
    case '--input':
    case '--json':
      options.patchFile = value
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

export function parseLive2dActionMapReportArgs(argv) {
  const options = {
    modelId: 'mao',
    patchFile: '',
    generatedAt: '',
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

  if (positional.length > 0 && options.modelId === 'mao') {
    options.modelId = positional[0]
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
  const cleanPath = cleanString(inputPath)
  if (!cleanPath) return null
  const text = cleanPath === '-'
    ? await readStdinText()
    : await fs.readFile(path.resolve(process.cwd(), cleanPath), 'utf8')
  return JSON.parse(text)
}

async function writeReportFile(report, outputPath) {
  const cleanPath = cleanString(outputPath)
  if (!cleanPath) return
  const resolvedPath = path.resolve(process.cwd(), cleanPath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

function resolveModel(modelId) {
  const cleanModelId = cleanString(modelId) || 'mao'
  const model = getPetModelPreset(cleanModelId)
  if (!model || model.id !== cleanModelId) {
    throw new Error(`Unknown pet model id: ${cleanModelId}`)
  }
  return model
}

export async function buildLive2dActionMapReport(options) {
  const patch = normalizePetActionMapDraftPatch(await readJsonInput(options.patchFile))
  const model = applyPetActionMapOverride(resolveModel(options.modelId), patch)
  return buildPublicPetActionMapEvidenceReport(
    model,
    options.generatedAt || new Date().toISOString(),
  )
}

export async function runLive2dActionMapReportCli(argv = process.argv.slice(2)) {
  const options = parseLive2dActionMapReportArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  if (options.list) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      gate: 'live2d-action-map-coverage',
      models: getPetModelPresets().map((model) => ({
        id: model.id,
        kind: model.spriteAtlas ? 'sprite' : 'live2d',
      })),
    }, null, 2)}\n`)
    return 0
  }

  const report = await buildLive2dActionMapReport(options)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLive2dActionMapReportCli().then((code) => {
    process.exitCode = code
  }).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
}
