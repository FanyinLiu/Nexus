#!/usr/bin/env node

import {
  DEFAULT_SPRITE_PET_VISUAL_AUDIT_OPTIONS,
  auditSpritePetPackage,
  resolveSpritePetManifestPath,
} from '../electron/services/spritePetVisualAudit.js'

function printUsage() {
  console.error([
    'Usage: npm run pet:audit -- <pet.json-or-package-folder> [options]',
    '',
    'Options:',
    '  --json                      Emit machine-readable JSON.',
    '  --strict                    Exit non-zero on visual warnings.',
    '  --chroma-ratio-limit <n>    Max near-green-screen pixel ratio. Default: 0.001.',
    '  --frame-diff-limit <n>      Min average adjacent-frame RGB difference. Default: 4.',
    '  --quantized-color-limit <n> Max 4-bit palette buckets before high-detail warning. Default: 768.',
  ].join('\n'))
}

function parseNumericOption(argv, index, arg) {
  const value = argv[index + 1]
  if (!value || !Number.isFinite(Number(value))) {
    throw new Error(`${arg} requires a numeric value.`)
  }

  return Number(value)
}

function parseArgs(argv) {
  const options = {
    sourcePath: '',
    json: false,
    strict: false,
    chromaRatioLimit: DEFAULT_SPRITE_PET_VISUAL_AUDIT_OPTIONS.chromaRatioLimit,
    frameDiffLimit: DEFAULT_SPRITE_PET_VISUAL_AUDIT_OPTIONS.frameDiffLimit,
    quantizedColorLimit: DEFAULT_SPRITE_PET_VISUAL_AUDIT_OPTIONS.quantizedColorLimit,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--strict') {
      options.strict = true
      continue
    }
    if (arg === '--chroma-ratio-limit') {
      options.chromaRatioLimit = parseNumericOption(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--frame-diff-limit') {
      options.frameDiffLimit = parseNumericOption(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--quantized-color-limit') {
      options.quantizedColorLimit = parseNumericOption(argv, index, arg)
      index += 1
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

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.sourcePath) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  const manifestPath = await resolveSpritePetManifestPath(options.sourcePath)
  const report = await auditSpritePetPackage(manifestPath, options)
  const audit = report.visual

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('Sprite pet visual audit')
    console.log(`- id: ${report.package.id}`)
    console.log(`- spritesheet: ${report.package.spritesheetPath}`)
    console.log(`- Codex-style score: ${audit.codexStyle.score}/100`)
    console.log(`- near chroma-key green: ${audit.chromaPixels}/${audit.visiblePixels} (${audit.chromaRatio.toFixed(4)})`)
    console.log(`- quantized colors: ${audit.quantizedColorCount}/${report.thresholds.quantizedColorLimit}`)
    for (const row of audit.rows) {
      console.log(
        `- row ${row.row} ${row.state}: coverage ${(row.minCoverage * 100).toFixed(1)}-${(row.maxCoverage * 100).toFixed(1)}%, frame diff ${row.averageAdjacentDiff.toFixed(2)}, components ${row.maxMajorComponentCount}`,
      )
    }
    if (audit.warnings.length) {
      console.log('- warnings:')
      for (const warning of audit.warnings) {
        console.log(`  - ${warning}`)
      }
    } else {
      console.log('- visual audit: OK')
    }
  }

  if (options.strict && !audit.ok) {
    process.exit(1)
  }
} catch (error) {
  console.error(`Sprite pet visual audit failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
