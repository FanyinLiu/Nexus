#!/usr/bin/env node

import path from 'node:path'
import {
  DEFAULT_OUTPUT_DIR,
  createSpritePetCreatorKit,
  slugifySpritePetId,
} from '../electron/services/spritePetCreatorKit.js'

function printUsage() {
  console.error([
    'Usage: npm run pet:create-kit -- [options]',
    '',
    'Creates a Codex-style pet creator kit with style samples, base and row prompts, 8x9 atlas contract, QA checklist, and pet.json template.',
    '',
    'Options:',
    '  --id <id>                Package id. Default: derived from display name or concept.',
    '  --display-name <name>    Display name. Default: title-cased id.',
    '  --description <text>     Package description.',
    '  --concept <text>         Short pet concept or reference notes.',
    '  --style-notes <text>     Extra visual constraints.',
    '  --output-dir <dir>       Directory for creator kits. Default: output/pet-creator-kits',
    '  --force                  Replace an existing creator kit directory.',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    id: '',
    displayName: '',
    description: '',
    concept: '',
    styleNotes: '',
    outputDir: DEFAULT_OUTPUT_DIR,
    force: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--force') {
      options.force = true
      continue
    }

    if (
      arg === '--id'
      || arg === '--display-name'
      || arg === '--description'
      || arg === '--concept'
      || arg === '--style-notes'
      || arg === '--output-dir'
    ) {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      index += 1

      if (arg === '--id') options.id = value
      if (arg === '--display-name') options.displayName = value
      if (arg === '--description') options.description = value
      if (arg === '--concept') options.concept = value
      if (arg === '--style-notes') options.styleNotes = value
      if (arg === '--output-dir') options.outputDir = value
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    throw new Error(`Unexpected argument: ${arg}`)
  }

  return options
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    printUsage()
    process.exit(0)
  }

  const idOrName = options.id || options.displayName || options.concept || 'sprite-pet'
  const targetDirectory = path.join(path.resolve(process.cwd(), options.outputDir), slugifySpritePetId(idOrName))
  const result = await createSpritePetCreatorKit({
    targetDirectory,
    id: options.id,
    displayName: options.displayName,
    description: options.description,
    concept: options.concept,
    styleNotes: options.styleNotes,
    force: options.force,
  })

  console.log('Codex pet creator kit created')
  console.log(`- id: ${result.id}`)
  console.log(`- displayName: ${result.displayName}`)
  console.log(`- target: ${result.directoryPath}`)
  console.log('- prompts: prompts/base.md and prompts/rows/*.md')
  console.log('- contract: references/animation-rows.md')
  console.log('- style samples: references/style-samples.md')
  console.log('- layout guides: references/layout-guides/*.svg')
  console.log('- QA: references/quality-checklist.md')
} catch (error) {
  console.error(`Codex pet creator kit failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
