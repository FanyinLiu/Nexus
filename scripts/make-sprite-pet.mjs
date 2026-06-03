#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROW_CONTRACT,
  SPRITE_PET_ROWS,
  assertNotPrivateCodexPetSource,
  formatSpritePetDisplayName,
  readSpritePetPackage,
  writeSpritePetZipArchive,
} from '../electron/services/spritePetPackage.js'
import {
  auditSpritePetPackage,
} from '../electron/services/spritePetVisualAudit.js'

const DEFAULT_OUTPUT_DIR = 'output/pets'
const SUPPORTED_SOURCE_LAYOUTS = new Set(['single', 'atlas'])
const SINGLE_BASE_FRAME_SIZE = {
  width: 156,
  height: 180,
}
const ATLAS_FRAME_SIZE = {
  width: 172,
  height: 188,
}

function printUsage() {
  console.error([
    'Usage: npm run pet:make -- <image> [options]',
    '',
    'Options:',
    '  --id <id>                    Package id. Default: source filename.',
    '  --display-name <name>        Display name. Default: title-cased id.',
    '  --description <text>         Package description.',
    '  --output-dir <dir>           Directory for generated packages. Default: output/pets',
    '  --source-layout <layout>     single or atlas. Default: single.',
    '  --force                      Replace an existing generated package.',
    '',
    'Examples:',
    '  npm run pet:make -- ./my-character.png --id my-pet',
    '  npm run pet:make -- ./ai-8x9-sheet.png --source-layout atlas --id my-pet',
  ].join('\n'))
}

function slugifySpritePetId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\.[^.]+$/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return normalized || 'sprite-pet'
}

function parseArgs(argv) {
  const options = {
    sourcePath: '',
    id: '',
    displayName: '',
    description: '',
    outputDir: DEFAULT_OUTPUT_DIR,
    sourceLayout: 'single',
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
      || arg === '--output-dir'
      || arg === '--source-layout'
    ) {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value.`)
      }
      index += 1

      if (arg === '--id') options.id = value
      if (arg === '--display-name') options.displayName = value
      if (arg === '--description') options.description = value
      if (arg === '--output-dir') options.outputDir = value
      if (arg === '--source-layout') options.sourceLayout = value
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

function colorDistance(left, right) {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b)
}

function readPixel(data, width, x, y) {
  const offset = ((y * width) + x) * 4
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    a: data[offset + 3],
  }
}

function collectBorderSamples(data, width, height) {
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)],
    [width - 1, Math.floor(height / 2)],
  ]

  return points
    .map(([x, y]) => readPixel(data, width, x, y))
    .filter((pixel) => pixel.a > 0)
}

function isLikelyBackground(pixel, samples) {
  if (pixel.a <= 8) {
    return true
  }

  const max = Math.max(pixel.r, pixel.g, pixel.b)
  const min = Math.min(pixel.r, pixel.g, pixel.b)
  const isGreenScreen = pixel.g > 180 && pixel.g - pixel.r > 70 && pixel.g - pixel.b > 50
  const isNearWhite = pixel.r > 220 && pixel.g > 220 && pixel.b > 220 && max - min < 64
  const matchesBorder = samples.some((sample) => colorDistance(pixel, sample) <= 58)

  return isGreenScreen || isNearWhite || matchesBorder
}

function removeConnectedBackground(raw) {
  const { data, info } = raw
  const width = info.width
  const height = info.height
  const samples = collectBorderSamples(data, width, height)
  const visited = new Uint8Array(width * height)
  const queue = []

  const indexOf = (x, y) => (y * width) + x
  const enqueue = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return
    }
    const index = indexOf(x, y)
    if (visited[index]) {
      return
    }
    if (!isLikelyBackground(readPixel(data, width, x, y), samples)) {
      return
    }
    visited[index] = 1
    queue.push([x, y])
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0)
    enqueue(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y)
    enqueue(width - 1, y)
  }
  for (let index = 0; index < queue.length; index += 1) {
    const [x, y] = queue[index]
    enqueue(x + 1, y)
    enqueue(x - 1, y)
    enqueue(x, y + 1)
    enqueue(x, y - 1)
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = indexOf(x, y) * 4
      const pixel = {
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
        a: data[offset + 3],
      }
      const isGreenFringe = (
        pixel.g > 120
        && pixel.r < 150
        && pixel.b < 170
        && pixel.g - pixel.r > 42
        && pixel.g - pixel.b > 26
      )

      if (visited[indexOf(x, y)] || isGreenFringe) {
        data[offset + 3] = 0
      }
    }
  }
}

function removeChromaKeyResidue(raw) {
  const { data } = raw

  for (let offset = 0; offset < data.length; offset += 4) {
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    const a = data[offset + 3]
    const isChromaGreen = (
      a > 0
      && g > 160
      && r < 120
      && b < 170
      && g - r > 58
      && g - b > 36
    )

    if (isChromaGreen) {
      data[offset + 3] = 0
    }
  }
}

async function rawImageToTrimmedPng(raw, frameSize) {
  removeConnectedBackground(raw)

  return sharp(raw.data, {
    raw: {
      width: raw.info.width,
      height: raw.info.height,
      channels: 4,
    },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .resize({
      width: frameSize.width,
      height: frameSize.height,
      fit: 'inside',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
}

async function readSingleSourceSprite(sourcePath) {
  const raw = await sharp(sourcePath)
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return rawImageToTrimmedPng(raw, SINGLE_BASE_FRAME_SIZE)
}

async function readAtlasSourceFrame({ sourcePath, row, column, sourceWidth, sourceHeight }) {
  const sourceCellWidth = sourceWidth / SPRITE_PET_COLUMNS
  const sourceCellHeight = sourceHeight / SPRITE_PET_ROWS
  const insetX = Math.max(2, Math.round(sourceCellWidth * 0.025))
  const insetY = Math.max(2, Math.round(sourceCellHeight * 0.025))
  const left = Math.max(0, Math.round((column * sourceCellWidth) + insetX))
  const top = Math.max(0, Math.round((row * sourceCellHeight) + insetY))
  const width = Math.min(sourceWidth - left, Math.round(sourceCellWidth - (insetX * 2)))
  const height = Math.min(sourceHeight - top, Math.round(sourceCellHeight - (insetY * 2)))
  const raw = await sharp(sourcePath)
    .rotate()
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return rawImageToTrimmedPng(raw, ATLAS_FRAME_SIZE)
}

async function frameTransform(basePng, {
  dx = 0,
  dy = 0,
  scale = 1,
  rotate = 0,
  flip = false,
} = {}) {
  let image = sharp(basePng).ensureAlpha()

  if (flip) {
    image = image.flop()
  }
  if (rotate) {
    image = image.rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  }
  if (scale !== 1) {
    image = image.resize({
      width: Math.round(SINGLE_BASE_FRAME_SIZE.width * scale),
      height: Math.round(SINGLE_BASE_FRAME_SIZE.height * scale),
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
  }

  const transformed = await image.png().toBuffer()
  const metadata = await sharp(transformed).metadata()

  return {
    input: transformed,
    left: Math.round(((SPRITE_PET_CELL_WIDTH - (metadata.width ?? SINGLE_BASE_FRAME_SIZE.width)) / 2) + dx),
    top: Math.round(((SPRITE_PET_CELL_HEIGHT - (metadata.height ?? SINGLE_BASE_FRAME_SIZE.height)) / 2) + dy),
  }
}

function singleSourceMotion(row, column) {
  const motions = {
    0: [
      { dy: 0 },
      { dy: -1, scale: 1.01 },
      { dy: -2, scale: 1.02 },
      { dy: -1, scale: 1.01 },
      { dy: 0 },
      { dy: 1, scale: 0.995 },
    ],
    1: [
      { dx: -8, dy: 1 },
      { dx: -2, dy: -3, rotate: -2 },
      { dx: 5, dy: -1, rotate: 2 },
      { dx: 8, dy: 1 },
      { dx: 2, dy: -2, rotate: -1 },
      { dx: -5, dy: 0, rotate: 2 },
      { dx: 3, dy: -3, rotate: -2 },
      { dx: 0, dy: 1 },
    ],
    2: [
      { dx: 8, dy: 1, flip: true },
      { dx: 2, dy: -3, rotate: 2, flip: true },
      { dx: -5, dy: -1, rotate: -2, flip: true },
      { dx: -8, dy: 1, flip: true },
      { dx: -2, dy: -2, rotate: 1, flip: true },
      { dx: 5, dy: 0, rotate: -2, flip: true },
      { dx: -3, dy: -3, rotate: 2, flip: true },
      { dx: 0, dy: 1, flip: true },
    ],
    3: [
      { dy: 0 },
      { dx: 2, dy: -2, rotate: -3, scale: 1.03 },
      { dx: -2, dy: -1, rotate: 3, scale: 1.02 },
      { dy: 0 },
    ],
    4: [
      { dy: 6, scale: 0.97 },
      { dy: -8, scale: 1.02 },
      { dy: -22, scale: 1.06 },
      { dy: -10, scale: 1.02 },
      { dy: 4, scale: 0.98 },
    ],
    5: [
      { dy: 4, rotate: -3 },
      { dy: 6, rotate: -2 },
      { dy: 8, rotate: -1 },
      { dy: 5, rotate: 2 },
      { dy: 7, rotate: 3 },
      { dy: 8, rotate: 1 },
      { dy: 5, rotate: -2 },
      { dy: 6, rotate: 0 },
    ],
    6: [
      { dy: 0 },
      { dy: 1, scale: 0.995 },
      { dy: 0 },
      { dy: 1, scale: 0.995 },
      { dy: 0 },
      { dy: -1, scale: 1.005 },
    ],
    7: [
      { dx: -3, dy: 0 },
      { dx: 3, dy: -3 },
      { dx: -2, dy: -1 },
      { dx: 2, dy: 1 },
      { dx: -1, dy: -2 },
      { dx: 0, dy: 0 },
    ],
    8: [
      { dy: 0, scale: 1 },
      { dy: -2, scale: 1.03 },
      { dy: -1, scale: 1.05 },
      { dy: 0, scale: 1.03 },
      { dy: -1, scale: 1.02 },
      { dy: 0, scale: 1 },
    ],
  }

  return motions[row]?.[column] ?? {}
}

async function centerFrameInCell(framePng, { dx = 0, dy = 0 } = {}) {
  const metadata = await sharp(framePng).metadata()
  const input = framePng
  return {
    input,
    left: Math.round(((SPRITE_PET_CELL_WIDTH - (metadata.width ?? ATLAS_FRAME_SIZE.width)) / 2) + dx),
    top: Math.round(((SPRITE_PET_CELL_HEIGHT - (metadata.height ?? ATLAS_FRAME_SIZE.height)) / 2) + dy),
  }
}

async function makeCellPng(frameLayer) {
  return sharp({
    create: {
      width: SPRITE_PET_CELL_WIDTH,
      height: SPRITE_PET_CELL_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([frameLayer])
    .png()
    .toBuffer()
}

async function buildAtlasFromSingleSource(sourcePath) {
  const baseSprite = await readSingleSourceSprite(sourcePath)
  const cells = []

  for (const rowContract of SPRITE_PET_ROW_CONTRACT) {
    for (let column = 0; column < rowContract.frameCount; column += 1) {
      const frameLayer = await frameTransform(baseSprite, singleSourceMotion(rowContract.row, column))
      cells.push({
        input: await makeCellPng(frameLayer),
        left: column * SPRITE_PET_CELL_WIDTH,
        top: rowContract.row * SPRITE_PET_CELL_HEIGHT,
      })
    }
  }

  return cells
}

async function buildAtlasFromAtlasSource(sourcePath) {
  const metadata = await sharp(sourcePath).metadata()
  const sourceWidth = metadata.width
  const sourceHeight = metadata.height

  if (!sourceWidth || !sourceHeight) {
    throw new Error('Could not read source image dimensions.')
  }

  const cells = []

  for (const rowContract of SPRITE_PET_ROW_CONTRACT) {
    for (let column = 0; column < rowContract.frameCount; column += 1) {
      const framePng = await readAtlasSourceFrame({
        sourcePath,
        row: rowContract.row,
        column,
        sourceWidth,
        sourceHeight,
      })
      const frameLayer = await centerFrameInCell(framePng)
      cells.push({
        input: await makeCellPng(frameLayer),
        left: column * SPRITE_PET_CELL_WIDTH,
        top: rowContract.row * SPRITE_PET_CELL_HEIGHT,
      })
    }
  }

  return cells
}

async function writeCreatorReadme({ targetDirectory, packageId, displayName, sourceLayout }) {
  await fs.writeFile(
    path.join(targetDirectory, 'README.md'),
    `# ${displayName}

This package was created with \`npm run pet:make\`.

Source mode: \`${sourceLayout}\`

This maker preserves the selected source art and only applies Codex-style row motion. It does not add speed lines, glow, stars, floor shadows, checkmarks, detached props, or other decorative effects. For best results, start with a compact Codex-style source image: chunky silhouette, thick dark outline, limited palette, flat shading, and transparent or clean chroma-key background.

Files:

- \`pet.json\`
- \`spritesheet.png\`

Next steps:

1. Run \`npm run pet:preview -- ${targetDirectory}\` to inspect every row.
2. Run \`npm run pet:validate -- ${targetDirectory}\` before sharing.
3. Import it in Nexus Settings -> Companion -> Avatar.

Package id: \`${packageId}\`
`,
    'utf8',
  )
}

try {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || !options.sourcePath) {
    printUsage()
    process.exit(options.help ? 0 : 1)
  }

  if (!SUPPORTED_SOURCE_LAYOUTS.has(options.sourceLayout)) {
    throw new Error(`Unsupported --source-layout: ${options.sourceLayout}. Use single or atlas.`)
  }

  const sourcePath = path.resolve(process.cwd(), options.sourcePath)
  assertNotPrivateCodexPetSource(sourcePath)
  const sourceStats = await fs.stat(sourcePath)
  if (!sourceStats.isFile()) {
    throw new Error(`Source image is not a file: ${sourcePath}`)
  }

  const packageId = slugifySpritePetId(options.id || path.basename(sourcePath))
  const displayName = String(options.displayName || formatSpritePetDisplayName(packageId)).trim()
  const description = String(options.description || 'Created with the Nexus simple pet maker.').trim()
  const outputRoot = path.resolve(process.cwd(), options.outputDir)
  const targetDirectory = path.join(outputRoot, packageId)
  const targetSpritePath = path.join(targetDirectory, 'spritesheet.png')
  const targetManifestPath = path.join(targetDirectory, 'pet.json')
  const visualAuditPath = path.join(targetDirectory, 'visual-audit.json')
  const archivePath = path.join(targetDirectory, `${packageId}.codex-pet.zip`)

  if (await pathExists(targetDirectory)) {
    if (!options.force) {
      throw new Error(`Target package already exists: ${targetDirectory}. Re-run with --force to replace it.`)
    }
    await fs.rm(targetDirectory, { recursive: true, force: true })
  }

  await fs.mkdir(targetDirectory, { recursive: true })

  const cells = options.sourceLayout === 'atlas'
    ? await buildAtlasFromAtlasSource(sourcePath)
    : await buildAtlasFromSingleSource(sourcePath)

  const atlasBuffer = await sharp({
    create: {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(cells)
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toBuffer()
  const atlasRaw = await sharp(atlasBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  removeChromaKeyResidue(atlasRaw)
  await sharp(atlasRaw.data, {
    raw: {
      width: atlasRaw.info.width,
      height: atlasRaw.info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toFile(targetSpritePath)

  await fs.writeFile(
    targetManifestPath,
    `${JSON.stringify({
      id: packageId,
      displayName,
      description,
      spritesheetPath: 'spritesheet.png',
    }, null, 2)}\n`,
    'utf8',
  )
  await writeCreatorReadme({ targetDirectory, packageId, displayName, sourceLayout: options.sourceLayout })
  await readSpritePetPackage(targetManifestPath)
  const visualAudit = await auditSpritePetPackage(targetManifestPath)
  await fs.writeFile(visualAuditPath, `${JSON.stringify(visualAudit, null, 2)}\n`, 'utf8')
  await writeSpritePetZipArchive({
    archivePath,
    files: [
      { path: targetManifestPath, name: 'pet.json' },
      { path: targetSpritePath, name: 'spritesheet.png' },
      { path: path.join(targetDirectory, 'README.md'), name: 'README.md' },
      { path: visualAuditPath, name: 'visual-audit.json' },
    ],
  })

  console.log('Sprite pet package created')
  console.log(`- id: ${packageId}`)
  console.log(`- displayName: ${displayName}`)
  console.log(`- source layout: ${options.sourceLayout}`)
  console.log(`- source: ${sourcePath}`)
  console.log(`- target: ${targetDirectory}`)
  console.log(`- zip: ${archivePath}`)
  console.log('- atlas: 1536x1872 (8x9, 192x208 per frame)')
  console.log(`- visual audit: ${visualAudit.visual.warnings.length ? `${visualAudit.visual.warnings.length} warning(s)` : 'OK'}`)
  console.log('- private Codex code/assets copied: false')
} catch (error) {
  console.error(`Sprite pet creation failed: ${error?.message ?? String(error)}`)
  process.exit(1)
}
