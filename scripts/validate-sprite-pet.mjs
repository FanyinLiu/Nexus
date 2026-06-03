#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROW_CONTRACT,
  SPRITE_PET_ROWS,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

function printUsage() {
  console.error('Usage: npm run pet:validate -- <pet.json-or-package-folder> [--json]')
}

async function resolveManifestPath(inputPath) {
  const targetPath = path.resolve(process.cwd(), inputPath)
  const stats = await fs.stat(targetPath)
  return stats.isDirectory() ? path.join(targetPath, 'pet.json') : targetPath
}

function parseArgs(argv) {
  const options = {
    inputPath: '',
    json: false,
    help: false,
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--json') {
      options.json = true
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (options.inputPath) {
      throw new Error(`Unexpected extra argument: ${arg}`)
    }

    options.inputPath = arg
  }

  return options
}

function buildCompatibilityContract() {
  return {
    name: 'Codex/Nexus 8x9 sprite atlas contract',
    sourcePolicy: 'clean-room implementation; use original, licensed, or user-provided art',
    privateCodexCodeOrAssetsCopied: false,
    alphaPolicy: 'PNG unused cells must be transparent; WebP must expose alpha',
    rows: SPRITE_PET_ROW_CONTRACT.map((rowContract) => ({
      row: rowContract.row,
      state: rowContract.state,
      frameCount: rowContract.frameCount,
      transparentUnusedCells: SPRITE_PET_COLUMNS - rowContract.frameCount,
      durationsMs: rowContract.durationsMs,
    })),
  }
}

function buildJsonReport({ manifestPath, petPackage, relativeSpritePath }) {
  return {
    ok: true,
    package: {
      manifestPath,
      id: petPackage.id || null,
      displayName: petPackage.displayName,
      description: petPackage.description || '',
      spritesheetPath: relativeSpritePath,
    },
    atlas: {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
      columns: SPRITE_PET_COLUMNS,
      rows: SPRITE_PET_ROWS,
      cellWidth: SPRITE_PET_CELL_WIDTH,
      cellHeight: SPRITE_PET_CELL_HEIGHT,
    },
    compatibility: buildCompatibilityContract(),
  }
}

function printCompatibilityReport() {
  const compatibility = buildCompatibilityContract()

  console.log(`- compatibility: ${compatibility.name}`)
  console.log('- rows:')
  for (const rowContract of compatibility.rows) {
    console.log(
      `  - row ${rowContract.row}: ${rowContract.state}, `
        + `${rowContract.frameCount} frames, `
        + `${rowContract.transparentUnusedCells} transparent unused cells, `
        + `durations ${rowContract.durationsMs.join('/')} ms`,
    )
  }
  console.log(`- source policy: ${compatibility.sourcePolicy}`)
  console.log(`- private Codex code/assets copied: ${compatibility.privateCodexCodeOrAssetsCopied}`)
  console.log(`- alpha: ${compatibility.alphaPolicy}`)
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (!options.inputPath || options.help) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  const manifestPath = await resolveManifestPath(options.inputPath)
  const petPackage = await readSpritePetPackage(manifestPath)
  const packageDirectory = path.dirname(manifestPath)
  const relativeSpritePath = path.relative(packageDirectory, petPackage.sourceSpritePath).split(path.sep).join('/')

  if (options.json) {
    console.log(JSON.stringify(buildJsonReport({ manifestPath, petPackage, relativeSpritePath }), null, 2))
    process.exit(0)
  }

  console.log('Sprite pet package OK')
  console.log(`- manifest: ${manifestPath}`)
  console.log(`- id: ${petPackage.id || '(derived)'}`)
  console.log(`- displayName: ${petPackage.displayName}`)
  if (petPackage.description) {
    console.log(`- description: ${petPackage.description}`)
  }
  console.log(`- spritesheet: ${relativeSpritePath}`)
  console.log(
    `- atlas: ${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT} `
      + `(${SPRITE_PET_COLUMNS}x${SPRITE_PET_ROWS}, ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT} per frame)`,
  )
  printCompatibilityReport()
} catch (error) {
  console.error(`Sprite pet package invalid: ${error?.message ?? String(error)}`)
  process.exit(1)
}
