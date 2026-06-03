#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  assertNotPrivateCodexPetSource,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

function printUsage() {
  console.error([
    'Usage: npm run pet:install-codex -- <pet.json-or-package-folder> [options]',
    '',
    'Options:',
    '  --codex-home <dir>       Codex home. Default: ${CODEX_HOME:-~/.codex}',
    '  --output-dir <dir>       Exact pets root. Default: <codex-home>/pets',
    '  --id <id>                Override package id.',
    '  --display-name <name>    Override display name.',
    '  --description <text>     Override description.',
    '  --force                  Replace an existing target package.',
  ].join('\n'))
}

function expandHomePath(value) {
  const rawPath = String(value ?? '').trim()
  if (!rawPath) return ''
  if (rawPath === '~') return os.homedir()
  if (rawPath.startsWith('~/')) return path.join(os.homedir(), rawPath.slice(2))
  return rawPath
}

function getDefaultCodexHome() {
  return path.resolve(expandHomePath(process.env.CODEX_HOME) || path.join(os.homedir(), '.codex'))
}

function slugifySpritePetId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return normalized || 'sprite-pet'
}

function parseArgs(argv) {
  const options = {
    sourcePath: '',
    codexHome: getDefaultCodexHome(),
    outputDir: '',
    id: '',
    displayName: '',
    description: '',
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
      arg === '--codex-home'
      || arg === '--output-dir'
      || arg === '--id'
      || arg === '--display-name'
      || arg === '--description'
    ) {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      index += 1

      if (arg === '--codex-home') options.codexHome = path.resolve(expandHomePath(value))
      if (arg === '--output-dir') options.outputDir = path.resolve(process.cwd(), value)
      if (arg === '--id') options.id = value
      if (arg === '--display-name') options.displayName = value
      if (arg === '--description') options.description = value
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (options.sourcePath) {
      throw new Error(`Unexpected extra argument: ${arg}`)
    }

    options.sourcePath = arg
  }

  return options
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveManifestPath(inputPath) {
  const targetPath = path.resolve(process.cwd(), inputPath)
  const stats = await fs.stat(targetPath)
  return stats.isDirectory() ? path.join(targetPath, 'pet.json') : targetPath
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || !options.sourcePath) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  const manifestPath = await resolveManifestPath(options.sourcePath)
  assertNotPrivateCodexPetSource(manifestPath)
  const sourcePackage = await readSpritePetPackage(manifestPath)
  assertNotPrivateCodexPetSource(sourcePackage.sourceSpritePath)
  const sourceDirectory = path.dirname(manifestPath)
  const petsRoot = path.resolve(options.outputDir || path.join(options.codexHome, 'pets'))
  const packageId = slugifySpritePetId(
    options.id || sourcePackage.id || sourcePackage.displayName || path.basename(sourceDirectory),
  )
  const targetDirectory = path.join(petsRoot, packageId)

  if (path.resolve(sourceDirectory) === path.resolve(targetDirectory)) {
    throw new Error('Source package is already installed in the target Codex pets directory.')
  }

  if (await pathExists(targetDirectory)) {
    if (!options.force) {
      throw new Error(`Codex pet package already exists: ${targetDirectory}. Re-run with --force to replace it.`)
    }
    await fs.rm(targetDirectory, { recursive: true, force: true })
  }

  await fs.mkdir(targetDirectory, { recursive: true })

  const spriteExtension = path.extname(sourcePackage.sourceSpritePath).toLowerCase()
  const targetSpriteName = `spritesheet${spriteExtension}`
  const targetSpritePath = path.join(targetDirectory, targetSpriteName)
  const targetManifestPath = path.join(targetDirectory, 'pet.json')
  const targetManifest = {
    id: packageId,
    displayName: String(options.displayName || sourcePackage.displayName || packageId).trim(),
    description: String(options.description || sourcePackage.description || '').trim(),
    spritesheetPath: targetSpriteName,
  }

  await fs.copyFile(sourcePackage.sourceSpritePath, targetSpritePath)
  await fs.writeFile(targetManifestPath, `${JSON.stringify(targetManifest, null, 2)}\n`, 'utf8')
  await readSpritePetPackage(targetManifestPath)

  console.log('Sprite pet package installed for Codex')
  console.log(`- id: ${targetManifest.id}`)
  console.log(`- displayName: ${targetManifest.displayName}`)
  if (targetManifest.description) {
    console.log(`- description: ${targetManifest.description}`)
  }
  console.log(`- target: ${targetDirectory}`)
  console.log(`- spritesheet: ${targetSpriteName}`)
} catch (error) {
  console.error(`Sprite pet Codex install failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
