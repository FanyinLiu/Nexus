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
  validateSpritePetAsset,
  writeSpritePetZipArchive,
} from './spritePetPackage.js'
import {
  auditSpritePetPackage,
} from './spritePetVisualAudit.js'

const SOURCE_FRAME_SIZE = {
  width: 156,
  height: 180,
}
const ATLAS_FRAME_SIZE = {
  width: 172,
  height: 188,
}
const SUPPORTED_SOURCE_LAYOUTS = new Set(['auto', 'single', 'atlas'])

export function slugifySpritePetId(value) {
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

function readPixel(data, width, x, y) {
  const offset = ((y * width) + x) * 4
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    a: data[offset + 3],
  }
}

function colorDistance(left, right) {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b)
}

function collectBorderSamples(data, width, height) {
  return [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)],
    [width - 1, Math.floor(height / 2)],
  ]
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
    if (visited[index] || !isLikelyBackground(readPixel(data, width, x, y), samples)) {
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
        pixel.a > 0
        && pixel.g > 120
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

    if (a > 0 && g > 160 && r < 120 && b < 170 && g - r > 58 && g - b > 36) {
      data[offset + 3] = 0
    }
  }
}

async function rawImageToTrimmedPng(raw) {
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
      width: SOURCE_FRAME_SIZE.width,
      height: SOURCE_FRAME_SIZE.height,
      fit: 'inside',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
}

async function readSourceSprite(sourcePath) {
  const raw = await sharp(sourcePath)
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return rawImageToTrimmedPng(raw)
}

async function detectSpritePetImageSourceLayout(sourcePath) {
  const metadata = await sharp(sourcePath).metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  if (width === SPRITE_PET_ATLAS_WIDTH && height === SPRITE_PET_ATLAS_HEIGHT) {
    return 'atlas'
  }

  if (width >= 560 && height >= 600) {
    const sourceRatio = width / height
    const atlasRatio = SPRITE_PET_ATLAS_WIDTH / SPRITE_PET_ATLAS_HEIGHT
    if (Math.abs(sourceRatio - atlasRatio) <= 0.055) {
      return 'atlas'
    }
  }

  return 'single'
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
      width: ATLAS_FRAME_SIZE.width,
      height: ATLAS_FRAME_SIZE.height,
      fit: 'inside',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
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
      width: Math.round(SOURCE_FRAME_SIZE.width * scale),
      height: Math.round(SOURCE_FRAME_SIZE.height * scale),
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
  }

  const transformed = await image.png().toBuffer()
  const metadata = await sharp(transformed).metadata()

  return {
    input: transformed,
    left: Math.round(((SPRITE_PET_CELL_WIDTH - (metadata.width ?? SOURCE_FRAME_SIZE.width)) / 2) + dx),
    top: Math.round(((SPRITE_PET_CELL_HEIGHT - (metadata.height ?? SOURCE_FRAME_SIZE.height)) / 2) + dy),
  }
}

function sourceMotion(row, column) {
  const motions = {
    0: [{ dy: 0 }, { dy: -1, scale: 1.01 }, { dy: -2, scale: 1.02 }, { dy: -1, scale: 1.01 }, { dy: 0 }, { dy: 1, scale: 0.995 }],
    1: [{ dx: -8, dy: 1 }, { dx: -2, dy: -3, rotate: -2 }, { dx: 5, dy: -1, rotate: 2 }, { dx: 8, dy: 1 }, { dx: 2, dy: -2, rotate: -1 }, { dx: -5, dy: 0, rotate: 2 }, { dx: 3, dy: -3, rotate: -2 }, { dx: 0, dy: 1 }],
    2: [{ dx: 8, dy: 1, flip: true }, { dx: 2, dy: -3, rotate: 2, flip: true }, { dx: -5, dy: -1, rotate: -2, flip: true }, { dx: -8, dy: 1, flip: true }, { dx: -2, dy: -2, rotate: 1, flip: true }, { dx: 5, dy: 0, rotate: -2, flip: true }, { dx: -3, dy: -3, rotate: 2, flip: true }, { dx: 0, dy: 1, flip: true }],
    3: [{ dy: 0 }, { dx: 2, dy: -2, rotate: -3, scale: 1.03 }, { dx: -2, dy: -1, rotate: 3, scale: 1.02 }, { dy: 0 }],
    4: [{ dy: 6, scale: 0.97 }, { dy: -8, scale: 1.02 }, { dy: -22, scale: 1.06 }, { dy: -10, scale: 1.02 }, { dy: 4, scale: 0.98 }],
    5: [{ dy: 4, rotate: -3 }, { dy: 6, rotate: -2 }, { dy: 8, rotate: -1 }, { dy: 5, rotate: 2 }, { dy: 7, rotate: 3 }, { dy: 8, rotate: 1 }, { dy: 5, rotate: -2 }, { dy: 6, rotate: 0 }],
    6: [{ dy: 0 }, { dy: 1, scale: 0.995 }, { dy: 0 }, { dy: 1, scale: 0.995 }, { dy: 0 }, { dy: -1, scale: 1.005 }],
    7: [{ dx: -3, dy: 0 }, { dx: 3, dy: -3 }, { dx: -2, dy: -1 }, { dx: 2, dy: 1 }, { dx: -1, dy: -2 }, { dx: 0, dy: 0 }],
    8: [{ dy: 0, scale: 1 }, { dy: -2, scale: 1.03 }, { dy: -1, scale: 1.05 }, { dy: 0, scale: 1.03 }, { dy: -1, scale: 1.02 }, { dy: 0, scale: 1 }],
  }

  return motions[row]?.[column] ?? {}
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

async function centerAtlasFrameInCell(framePng) {
  const metadata = await sharp(framePng).metadata()

  return {
    input: framePng,
    left: Math.round((SPRITE_PET_CELL_WIDTH - (metadata.width ?? ATLAS_FRAME_SIZE.width)) / 2),
    top: Math.round((SPRITE_PET_CELL_HEIGHT - (metadata.height ?? ATLAS_FRAME_SIZE.height)) / 2),
  }
}

async function buildAtlasCells(sourcePath) {
  const baseSprite = await readSourceSprite(sourcePath)
  const cells = []

  for (const rowContract of SPRITE_PET_ROW_CONTRACT) {
    for (let column = 0; column < rowContract.frameCount; column += 1) {
      const frameLayer = await frameTransform(baseSprite, sourceMotion(rowContract.row, column))
      cells.push({
        input: await makeCellPng(frameLayer),
        left: column * SPRITE_PET_CELL_WIDTH,
        top: rowContract.row * SPRITE_PET_CELL_HEIGHT,
      })
    }
  }

  return cells
}

async function buildAtlasCellsFromAtlasSource(sourcePath) {
  const metadata = await sharp(sourcePath).metadata()
  const sourceWidth = metadata.width ?? 0
  const sourceHeight = metadata.height ?? 0

  if (!sourceWidth || !sourceHeight) {
    throw new Error('来源图片尺寸没读出来。')
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
      const frameLayer = await centerAtlasFrameInCell(framePng)
      cells.push({
        input: await makeCellPng(frameLayer),
        left: column * SPRITE_PET_CELL_WIDTH,
        top: rowContract.row * SPRITE_PET_CELL_HEIGHT,
      })
    }
  }

  return cells
}

async function tryWriteNativeAtlas(sourcePath, targetSpritePath) {
  const metadata = await sharp(sourcePath).metadata()
  if (metadata.width !== SPRITE_PET_ATLAS_WIDTH || metadata.height !== SPRITE_PET_ATLAS_HEIGHT) {
    return false
  }

  await sharp(sourcePath)
    .rotate()
    .ensureAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false, progressive: false })
    .toFile(targetSpritePath)

  try {
    await validateSpritePetAsset(targetSpritePath)
    return true
  } catch {
    await fs.rm(targetSpritePath, { force: true })
    return false
  }
}

async function writeCreatorReadme({ targetDirectory, packageId, displayName, sourcePath, sourceLayout, nativeAtlasPreserved }) {
  await fs.writeFile(
    path.join(targetDirectory, 'README.md'),
    `# ${displayName}

This package was created from one image by Nexus.

Source image: \`${sourcePath}\`

Source mode: \`${sourceLayout}\`${nativeAtlasPreserved ? '\n\nThe source was already a valid Codex 8x9 atlas, so Nexus preserved the frames instead of synthesizing starter motion.' : ''}

The maker preserves the selected source art and only applies Codex-style row motion when the source is a single character image. It does not add speed lines, glow, stars, floor shadows, checkmarks, detached props, or other decorative effects.

Files:

- \`pet.json\`
- \`spritesheet.png\`

Next steps:

1. Preview all 9 state rows in Nexus before sharing.
2. Validate that the source art already has a compact Codex digital-pet style.
3. Replace the source art or use hatch-pet if the identity drifts or the motion is not expressive enough.

Package id: \`${packageId}\`
`,
    'utf8',
  )
}

export async function createSpritePetPackageFromImage({
  sourcePath,
  targetDirectory,
  id = '',
  displayName = '',
  description = '',
  sourceLayout = 'auto',
  force = false,
}) {
  const resolvedSourcePath = path.resolve(sourcePath)
  assertNotPrivateCodexPetSource(resolvedSourcePath)
  const sourceStats = await fs.stat(resolvedSourcePath)
  if (!sourceStats.isFile()) {
    throw new Error(`Source image is not a file: ${resolvedSourcePath}`)
  }

  const packageId = slugifySpritePetId(id || path.basename(resolvedSourcePath))
  const packageDisplayName = String(displayName || formatSpritePetDisplayName(packageId)).trim()
  const packageDescription = String(
    description || 'Created from one image with the Nexus Codex-style sprite pet maker.',
  ).trim()
  const requestedSourceLayout = String(sourceLayout || 'auto').trim()
  if (!SUPPORTED_SOURCE_LAYOUTS.has(requestedSourceLayout)) {
    throw new Error(`不支持的来源布局：${requestedSourceLayout}。`)
  }
  const resolvedSourceLayout = requestedSourceLayout === 'auto'
    ? await detectSpritePetImageSourceLayout(resolvedSourcePath)
    : requestedSourceLayout

  try {
    await fs.access(targetDirectory)
    if (!force) {
      throw new Error(`Target package already exists: ${targetDirectory}.`)
    }
    await fs.rm(targetDirectory, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  await fs.mkdir(targetDirectory, { recursive: true })

  const targetSpritePath = path.join(targetDirectory, 'spritesheet.png')
  const targetManifestPath = path.join(targetDirectory, 'pet.json')
  const visualAuditPath = path.join(targetDirectory, 'visual-audit.json')
  const archivePath = path.join(targetDirectory, `${packageId}.codex-pet.zip`)
  const nativeAtlasPreserved = resolvedSourceLayout === 'atlas'
    ? await tryWriteNativeAtlas(resolvedSourcePath, targetSpritePath)
    : false

  if (!nativeAtlasPreserved) {
    const atlasBuffer = await sharp({
      create: {
        width: SPRITE_PET_ATLAS_WIDTH,
        height: SPRITE_PET_ATLAS_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(resolvedSourceLayout === 'atlas'
        ? await buildAtlasCellsFromAtlasSource(resolvedSourcePath)
        : await buildAtlasCells(resolvedSourcePath))
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
  }

  await fs.writeFile(
    targetManifestPath,
    `${JSON.stringify({
      id: packageId,
      displayName: packageDisplayName,
      description: packageDescription,
      spritesheetPath: 'spritesheet.png',
    }, null, 2)}\n`,
    'utf8',
  )
  await writeCreatorReadme({
    targetDirectory,
    packageId,
    displayName: packageDisplayName,
    sourcePath: resolvedSourcePath,
    sourceLayout: resolvedSourceLayout,
    nativeAtlasPreserved,
  })

  const manifest = await readSpritePetPackage(targetManifestPath)
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

  return {
    manifest,
    manifestPath: targetManifestPath,
    spritePath: targetSpritePath,
    visualAuditPath,
    archivePath,
    visualWarnings: visualAudit.visual.warnings,
    sourceLayout: resolvedSourceLayout,
    nativeAtlasPreserved,
    targetDirectory,
  }
}
