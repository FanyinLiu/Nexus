#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildCharacterCardImportReport,
  mapCardToPersona,
} from '../electron/services/characterCardMapper.js'

export const SAMPLE_CHARACTER_CARD = {
  spec: 'chara_card_v2',
  data: {
    name: 'Mira',
    description: 'A focused desktop companion who keeps the user grounded.',
    personality: 'Calm, observant, concise, and gently playful.',
    scenario: 'Mira helps during long work sessions without taking over.',
    creator_notes: 'Sample card for private-safe Nexus import evidence.',
    first_mes: 'I am here. What should we line up first?',
    mes_example: '<START>\n{{user}}: I am scattered.\n{{char}}: Then we make one clean next step.',
    character_book: {
      entries: [{
        keys: ['focus', 'desktop'],
        content: 'Mira watches for long-running work sessions and keeps responses short.',
        enabled: true,
        priority: 10,
      }],
    },
    extensions: {
      nexus: {
        petModelId: 'mao',
        style: {
          toneTags: ['focused', 'warm'],
          signaturePhrases: ['Let me line that up.'],
          forbiddenPhrases: ['As an AI'],
        },
        voice: {
          providerId: 'local-tts',
          voice: 'default',
          model: 'sample-local-tts',
          instructions: 'Speak softly and keep pauses short.',
        },
        tools: {
          allowlist: ['weather', 'calendar'],
          blocklist: ['shell'],
        },
      },
    },
  },
}

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/character-card-import-report.mjs [options]',
    '',
    'Options:',
    '  --card-file <path>        Character Card JSON file, or - for stdin',
    '  --input <path>            Alias for --card-file',
    '  --sample                  Use the built-in private-safe sample Character Card',
    '  --generated-at <iso>      Override report timestamp',
    '  --output <path>           Write the private-safe report JSON to a file',
    '  --require-ready           Exit non-zero unless every import check passes',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  npm run character:card:report -- --card-file ./aria.card.json',
    '  npm run character:card:report -- --sample --output artifacts/v0.3.4/character-card-import.json',
    '  npm run character:card:report -- --card-file ./aria.card.json --output artifacts/v0.3.4/character-card-import.json',
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
    case '--card-file':
    case '--input':
    case '--json':
      options.cardFile = value
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

export function parseCharacterCardImportReportArgs(argv) {
  const options = {
    cardFile: '',
    generatedAt: '',
    outputPath: '',
    requireReady: false,
    sample: false,
    help: false,
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

  if (!options.cardFile && positional.length > 0) {
    options.cardFile = positional[0]
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
  if (!cleanPath) {
    throw new Error('--card-file is required')
  }
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

export function buildCharacterCardReport(card, generatedAt = new Date().toISOString()) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new Error('Expected a Character Card JSON object')
  }
  const mapped = mapCardToPersona(card)
  const report = buildCharacterCardImportReport(card, mapped, generatedAt)
  return {
    ...report,
    ok: report.checks.every((check) => check.pass),
    privacy: {
      privateFieldsOmitted: [
        'description',
        'personality',
        'scenario',
        'system_prompt',
        'post_history_instructions',
        'creator_notes',
        'first_mes',
        'mes_example',
        'character_book.entries.content',
        'rolePackagePreset.voice.apiBaseUrl',
        'rolePackagePreset.voice.apiKey',
      ],
    },
  }
}

export async function runCharacterCardImportReportCli(argv = process.argv.slice(2)) {
  const options = parseCharacterCardImportReportArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const card = options.sample ? SAMPLE_CHARACTER_CARD : await readJsonInput(options.cardFile)
  const report = buildCharacterCardReport(card, options.generatedAt || new Date().toISOString())
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return options.requireReady && !report.ok ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCharacterCardImportReportCli().then((code) => {
    process.exitCode = code
  }).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
}
