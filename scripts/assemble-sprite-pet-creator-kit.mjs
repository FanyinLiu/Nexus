#!/usr/bin/env node

import path from 'node:path'
import {
  assembleSpritePetCreatorKit,
} from '../electron/services/spritePetAssembler.js'

function printUsage() {
  console.error([
    'Usage: npm run pet:assemble-kit -- <creator-kit-dir> [options]',
    '',
    'Assembles row images from a Codex pet creator kit into a validated sprite pet package.',
    '',
    'Options:',
    '  --output-dir <dir>       Target package directory. Default: <creator-kit-dir>/final-package',
    '  --force                  Replace an existing target package.',
    '',
    'Expected row images:',
    '  <creator-kit-dir>/source-rows/0-idle.png',
    '  <creator-kit-dir>/source-rows/1-running-right.png',
    '  ... through 8-review.png',
  ].join('\n'))
}

function parseArgs(argv) {
  const options = {
    kitDirectory: '',
    outputDir: '',
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

    if (arg === '--output-dir') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      options.outputDir = value
      index += 1
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (options.kitDirectory) {
      throw new Error(`Unexpected extra argument: ${arg}`)
    }

    options.kitDirectory = arg
  }

  return options
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || !options.kitDirectory) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  const result = await assembleSpritePetCreatorKit({
    kitDirectory: path.resolve(process.cwd(), options.kitDirectory),
    outputDirectory: options.outputDir
      ? path.resolve(process.cwd(), options.outputDir)
      : '',
    force: options.force,
  })

  console.log('Codex pet package assembled')
  console.log(`- id: ${result.id}`)
  console.log(`- displayName: ${result.displayName}`)
  console.log(`- target: ${result.packageDirectory}`)
  console.log('- manifest: pet.json')
  console.log('- spritesheet: spritesheet.png')
  console.log('- report: assembly-report.json')
  console.log(`- zip: ${result.archivePath}`)
} catch (error) {
  console.error(`Codex pet package assembly failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
