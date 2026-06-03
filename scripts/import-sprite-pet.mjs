#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  assertNotPrivateCodexPetSource,
  extractSpritePetZipArchive,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

function printUsage() {
  console.error([
    'Usage: npm run pet:import -- <pet.json-package-folder-or-zip> [options]',
    '',
    'Options:',
    '  --output-dir <dir>       Directory for bundled pets. Default: public/pets',
    '  --id <id>                Override package id.',
    '  --display-name <name>    Override display name.',
    '  --description <text>     Override description.',
    '  --force                  Replace an existing target package.',
  ].join('\n'))
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
    outputDir: 'public/pets',
    id: '',
    displayName: '',
    description: '',
    force: false,
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

    if (arg === '--output-dir' || arg === '--id' || arg === '--display-name' || arg === '--description') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      index += 1

      if (arg === '--output-dir') options.outputDir = value
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

async function resolveSourcePackage(inputPath) {
  const sourcePath = path.resolve(process.cwd(), inputPath)
  assertNotPrivateCodexPetSource(sourcePath)

  if (path.extname(sourcePath).toLowerCase() === '.zip') {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-zip-import-'))
    try {
      const { manifest, manifestPath } = await extractSpritePetZipArchive(sourcePath, temporaryDirectory)
      return {
        cleanup: () => fs.rm(temporaryDirectory, { recursive: true, force: true }),
        manifestPath,
        sourcePackage: manifest,
      }
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true })
      throw error
    }
  }

  const manifestPath = await resolveManifestPath(inputPath)

  return {
    cleanup: async () => {},
    manifestPath,
    sourcePackage: await readSpritePetPackage(manifestPath),
  }
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || !options.sourcePath) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  const source = await resolveSourcePackage(options.sourcePath)
  try {
    const { manifestPath, sourcePackage } = source
    assertNotPrivateCodexPetSource(manifestPath)
    assertNotPrivateCodexPetSource(sourcePackage.sourceSpritePath)
    const sourceDirectory = path.dirname(manifestPath)
    const outputRoot = path.resolve(process.cwd(), options.outputDir)
    const packageId = slugifySpritePetId(
      options.id || sourcePackage.id || sourcePackage.displayName || path.basename(sourceDirectory),
    )
    const targetDirectory = path.join(outputRoot, packageId)

    if (path.resolve(sourceDirectory) === path.resolve(targetDirectory)) {
      throw new Error('Source package is already in the target bundled pet directory.')
    }

    if (await pathExists(targetDirectory)) {
      if (!options.force) {
        throw new Error(`Target package already exists: ${targetDirectory}. Re-run with --force to replace it.`)
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

    console.log('Sprite pet package imported')
    console.log(`- id: ${targetManifest.id}`)
    console.log(`- displayName: ${targetManifest.displayName}`)
    if (targetManifest.description) {
      console.log(`- description: ${targetManifest.description}`)
    }
    console.log(`- target: ${targetDirectory}`)
    console.log(`- spritesheet: ${targetSpriteName}`)
  } finally {
    await source.cleanup()
  }
} catch (error) {
  console.error(`Sprite pet import failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
