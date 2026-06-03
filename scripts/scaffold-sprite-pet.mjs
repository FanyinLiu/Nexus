#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROWS,
  formatSpritePetDisplayName,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

const DEFAULT_OUTPUT_DIR = 'output/pets'
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
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CRC32_TABLE = makeCrc32Table()

function printUsage() {
  console.error([
    'Usage: npm run pet:scaffold -- <id> [options]',
    '',
    'Options:',
    '  --id <id>                Package id. Alternative to positional <id>.',
    '  --display-name <name>    Display name. Default: title-cased id.',
    '  --description <text>     Package description.',
    '  --output-dir <dir>       Directory for generated packages. Default: output/pets',
    '  --force                  Replace an existing scaffold directory.',
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
    positionalId: '',
    id: '',
    displayName: '',
    description: '',
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

    if (arg === '--id' || arg === '--display-name' || arg === '--description' || arg === '--output-dir') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      index += 1

      if (arg === '--id') options.id = value
      if (arg === '--display-name') options.displayName = value
      if (arg === '--description') options.description = value
      if (arg === '--output-dir') options.outputDir = value
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (options.positionalId) {
      throw new Error(`Unexpected extra argument: ${arg}`)
    }

    options.positionalId = arg
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

function makeCrc32Table() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    return value >>> 0
  })
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function makeTransparentPng(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const scanlineLength = 1 + (width * 4)
  const rawPixels = Buffer.alloc(scanlineLength * height)
  const idat = deflateSync(rawPixels, { level: 9 })

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND'),
  ])
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildLayoutGuideSvg(displayName) {
  const leftMargin = 176
  const topMargin = 64
  const rightMargin = 24
  const bottomMargin = 24
  const width = leftMargin + SPRITE_PET_ATLAS_WIDTH + rightMargin
  const height = topMargin + SPRITE_PET_ATLAS_HEIGHT + bottomMargin
  const columnLabels = Array.from({ length: SPRITE_PET_COLUMNS }, (_, column) => {
    const x = leftMargin + (column * SPRITE_PET_CELL_WIDTH) + (SPRITE_PET_CELL_WIDTH / 2)
    return `<text x="${x}" y="48" text-anchor="middle">${column}</text>`
  }).join('\n    ')
  const rowLabels = ROW_LABELS.map((label, row) => {
    const y = topMargin + (row * SPRITE_PET_CELL_HEIGHT) + (SPRITE_PET_CELL_HEIGHT / 2) + 5
    return `<text x="${leftMargin - 14}" y="${y}" text-anchor="end">row ${row} ${escapeXml(label)}</text>`
  }).join('\n    ')
  const verticalLines = Array.from({ length: SPRITE_PET_COLUMNS + 1 }, (_, column) => {
    const x = leftMargin + (column * SPRITE_PET_CELL_WIDTH)
    return `<line x1="${x}" y1="${topMargin}" x2="${x}" y2="${topMargin + SPRITE_PET_ATLAS_HEIGHT}" />`
  }).join('\n    ')
  const horizontalLines = Array.from({ length: SPRITE_PET_ROWS + 1 }, (_, row) => {
    const y = topMargin + (row * SPRITE_PET_CELL_HEIGHT)
    return `<line x1="${leftMargin}" y1="${y}" x2="${leftMargin + SPRITE_PET_ATLAS_WIDTH}" y2="${y}" />`
  }).join('\n    ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(displayName)} sprite pet layout guide">
  <title>${escapeXml(displayName)} sprite pet layout guide</title>
  <desc>Use this as an artist guide for a ${SPRITE_PET_COLUMNS} by ${SPRITE_PET_ROWS} atlas. The runtime spritesheet must remain ${SPRITE_PET_ATLAS_WIDTH} by ${SPRITE_PET_ATLAS_HEIGHT} pixels.</desc>
  <style>
    text {
      fill: #24312f;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 20px;
      font-weight: 700;
    }
    .meta {
      fill: #5b6965;
      font-size: 14px;
      font-weight: 500;
    }
    .grid {
      stroke: #18433a;
      stroke-opacity: 0.58;
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
  </style>
  <rect width="100%" height="100%" fill="#f6f2e8"/>
  <text x="18" y="28">${escapeXml(displayName)}</text>
  <text class="meta" x="18" y="50">${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT}; ${SPRITE_PET_COLUMNS}x${SPRITE_PET_ROWS}; ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT} per frame</text>
  <g>
    ${columnLabels}
  </g>
  <g>
    ${rowLabels}
  </g>
  <rect x="${leftMargin}" y="${topMargin}" width="${SPRITE_PET_ATLAS_WIDTH}" height="${SPRITE_PET_ATLAS_HEIGHT}" fill="#fffef8"/>
  <g class="grid">
    ${verticalLines}
    ${horizontalLines}
  </g>
</svg>
`
}

function buildReadme({ packageId, displayName }) {
  return `# ${displayName}

This is a clean-room Nexus sprite pet package scaffold.

Edit spritesheet.png with original or licensed art. Keep the file exactly ${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT} pixels:

- ${SPRITE_PET_COLUMNS} columns
- ${SPRITE_PET_ROWS} rows
- ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT} pixels per frame

Rows:

0. idle
1. running-right
2. running-left
3. waving
4. jumping
5. failed
6. waiting
7. running
8. review

Validation:

\`\`\`bash
npm run pet:validate -- ${packageId}
npm run pet:preview -- ${packageId}
\`\`\`
`
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || (!options.id && !options.positionalId)) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  const packageId = slugifySpritePetId(options.id || options.positionalId)
  const displayName = String(options.displayName || formatSpritePetDisplayName(packageId)).trim()
  const description = String(options.description || 'Clean-room Nexus sprite pet scaffold.').trim()
  const outputRoot = path.resolve(process.cwd(), options.outputDir)
  const targetDirectory = path.join(outputRoot, packageId)

  if (await pathExists(targetDirectory)) {
    if (!options.force) {
      throw new Error(`Target scaffold already exists: ${targetDirectory}. Re-run with --force to replace it.`)
    }
    await fs.rm(targetDirectory, { recursive: true, force: true })
  }

  await fs.mkdir(targetDirectory, { recursive: true })

  const targetManifest = {
    id: packageId,
    displayName,
    description,
    spritesheetPath: 'spritesheet.png',
  }
  const manifestPath = path.join(targetDirectory, 'pet.json')
  const spritesheetPath = path.join(targetDirectory, 'spritesheet.png')
  const guidePath = path.join(targetDirectory, 'layout-guide.svg')
  const readmePath = path.join(targetDirectory, 'README.md')

  await fs.writeFile(manifestPath, `${JSON.stringify(targetManifest, null, 2)}\n`, 'utf8')
  await fs.writeFile(spritesheetPath, makeTransparentPng(SPRITE_PET_ATLAS_WIDTH, SPRITE_PET_ATLAS_HEIGHT))
  await fs.writeFile(guidePath, buildLayoutGuideSvg(displayName), 'utf8')
  await fs.writeFile(readmePath, buildReadme({ packageId, displayName }), 'utf8')
  await readSpritePetPackage(manifestPath)

  console.log('Sprite pet package scaffolded')
  console.log(`- id: ${packageId}`)
  console.log(`- displayName: ${displayName}`)
  console.log(`- target: ${targetDirectory}`)
  console.log('- spritesheet: spritesheet.png')
  console.log('- guide: layout-guide.svg')
} catch (error) {
  console.error(`Sprite pet scaffold failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
