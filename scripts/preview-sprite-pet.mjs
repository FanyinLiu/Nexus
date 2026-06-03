#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROWS,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

const DEFAULT_SCALE = 0.5
const LEFT_MARGIN = 168
const TOP_MARGIN = 56
const RIGHT_MARGIN = 24
const BOTTOM_MARGIN = 24
const ROW_LABELS = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
]

function printUsage() {
  console.error([
    'Usage: npm run pet:preview -- <pet.json-or-package-folder> [options]',
    '',
    'Options:',
    '  --output <file.svg>  Contact sheet path. Default: output/pets/<id>-contact-sheet.svg',
    '  --scale <number>     Render scale from 0.1 to 2. Default: 0.5',
  ].join('\n'))
}

function parseScale(value) {
  const scale = Number.parseFloat(String(value))
  if (!Number.isFinite(scale) || scale < 0.1 || scale > 2) {
    throw new Error('--scale must be a number from 0.1 to 2.')
  }
  return scale
}

function parseArgs(argv) {
  const options = {
    sourcePath: '',
    outputPath: '',
    scale: DEFAULT_SCALE,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--output' || arg === '-o') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      options.outputPath = value
      index += 1
      continue
    }

    if (arg === '--scale') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('--scale requires a value.')
      }
      options.scale = parseScale(value)
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

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function formatNumber(value) {
  return Number.parseFloat(value.toFixed(3)).toString()
}

function getImageMimeType(spritePath) {
  const extension = path.extname(spritePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  throw new Error('Sprite pet contact sheets only support PNG or WebP spritesheets.')
}

async function resolveManifestPath(inputPath) {
  const targetPath = path.resolve(process.cwd(), inputPath)
  const stats = await fs.stat(targetPath)
  return stats.isDirectory() ? path.join(targetPath, 'pet.json') : targetPath
}

async function resolveOutputPath(options, spritePetPackage, manifestPath) {
  const sourceDirectory = path.dirname(manifestPath)
  const packageId = slugifySpritePetId(
    spritePetPackage.id || spritePetPackage.displayName || path.basename(sourceDirectory),
  )
  const outputPath = options.outputPath
    ? path.resolve(process.cwd(), options.outputPath)
    : path.resolve(process.cwd(), 'output/pets', `${packageId}-contact-sheet.svg`)

  if (path.extname(outputPath).toLowerCase() !== '.svg') {
    throw new Error('Contact sheet output must be an .svg file.')
  }

  return outputPath
}

function buildGridLines(left, top, cellWidth, cellHeight, contentWidth, contentHeight) {
  const lines = []

  for (let column = 0; column <= SPRITE_PET_COLUMNS; column += 1) {
    const x = left + (column * cellWidth)
    lines.push(
      `<line x1="${formatNumber(x)}" y1="${formatNumber(top)}" x2="${formatNumber(x)}" y2="${formatNumber(top + contentHeight)}" />`,
    )
  }

  for (let row = 0; row <= SPRITE_PET_ROWS; row += 1) {
    const y = top + (row * cellHeight)
    lines.push(
      `<line x1="${formatNumber(left)}" y1="${formatNumber(y)}" x2="${formatNumber(left + contentWidth)}" y2="${formatNumber(y)}" />`,
    )
  }

  return lines.join('\n      ')
}

function buildColumnLabels(left, cellWidth) {
  return Array.from({ length: SPRITE_PET_COLUMNS }, (_, column) => {
    const x = left + (column * cellWidth) + (cellWidth / 2)
    return `<text x="${formatNumber(x)}" y="40" text-anchor="middle">${column}</text>`
  }).join('\n      ')
}

function buildRowLabels(top, cellHeight) {
  return ROW_LABELS.map((label, row) => {
    const y = top + (row * cellHeight) + (cellHeight / 2) + 5
    return `<text x="${LEFT_MARGIN - 12}" y="${formatNumber(y)}" text-anchor="end">${escapeXml(row)} ${escapeXml(label)}</text>`
  }).join('\n      ')
}

function buildContactSheetSvg({ dataUri, displayName, scale, sourceSpriteName }) {
  const contentWidth = SPRITE_PET_ATLAS_WIDTH * scale
  const contentHeight = SPRITE_PET_ATLAS_HEIGHT * scale
  const cellWidth = SPRITE_PET_CELL_WIDTH * scale
  const cellHeight = SPRITE_PET_CELL_HEIGHT * scale
  const width = Math.ceil(LEFT_MARGIN + contentWidth + RIGHT_MARGIN)
  const height = Math.ceil(TOP_MARGIN + contentHeight + BOTTOM_MARGIN)
  const escapedDisplayName = escapeXml(displayName)
  const escapedSpriteName = escapeXml(sourceSpriteName)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapedDisplayName} sprite pet contact sheet">
  <title>${escapedDisplayName} sprite pet contact sheet</title>
  <desc>${SPRITE_PET_COLUMNS} by ${SPRITE_PET_ROWS} atlas preview for ${escapedSpriteName}; each frame is ${SPRITE_PET_CELL_WIDTH} by ${SPRITE_PET_CELL_HEIGHT} pixels.</desc>
  <style>
    text {
      fill: #24312f;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      font-weight: 600;
    }
    .meta {
      fill: #5b6965;
      font-size: 11px;
      font-weight: 500;
    }
    .grid {
      stroke: #18433a;
      stroke-opacity: 0.42;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
  </style>
  <rect width="100%" height="100%" fill="#f6f2e8"/>
  <rect x="${LEFT_MARGIN}" y="${TOP_MARGIN}" width="${formatNumber(contentWidth)}" height="${formatNumber(contentHeight)}" fill="#ffffff"/>
  <text x="18" y="24">${escapedDisplayName}</text>
  <text class="meta" x="18" y="42">${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT}, scale ${formatNumber(scale)}</text>
  <g>
    ${buildColumnLabels(LEFT_MARGIN, cellWidth)}
  </g>
  <g>
    ${buildRowLabels(TOP_MARGIN, cellHeight)}
  </g>
  <image x="${LEFT_MARGIN}" y="${TOP_MARGIN}" width="${formatNumber(contentWidth)}" height="${formatNumber(contentHeight)}" href="${dataUri}" preserveAspectRatio="none" style="image-rendering: pixelated"/>
  <g class="grid">
    ${buildGridLines(LEFT_MARGIN, TOP_MARGIN, cellWidth, cellHeight, contentWidth, contentHeight)}
  </g>
</svg>
`
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || !options.sourcePath) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  const manifestPath = await resolveManifestPath(options.sourcePath)
  const spritePetPackage = await readSpritePetPackage(manifestPath)
  const outputPath = await resolveOutputPath(options, spritePetPackage, manifestPath)
  const spriteBuffer = await fs.readFile(spritePetPackage.sourceSpritePath)
  const spriteName = path.basename(spritePetPackage.sourceSpritePath)
  const mimeType = getImageMimeType(spritePetPackage.sourceSpritePath)
  const dataUri = `data:${mimeType};base64,${spriteBuffer.toString('base64')}`
  const svg = buildContactSheetSvg({
    dataUri,
    displayName: spritePetPackage.displayName,
    scale: options.scale,
    sourceSpriteName: spriteName,
  })

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, svg, 'utf8')

  console.log('Sprite pet contact sheet written')
  console.log(`- source: ${manifestPath}`)
  console.log(`- output: ${outputPath}`)
  console.log(`- scale: ${formatNumber(options.scale)}`)
  console.log(`- rows: ${ROW_LABELS.join(', ')}`)
} catch (error) {
  console.error(`Sprite pet preview failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
