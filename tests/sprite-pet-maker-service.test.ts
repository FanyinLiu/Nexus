import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

import { createSpritePetPackageFromImage } from '../electron/services/spritePetMaker.js'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_ROW_CONTRACT,
  extractSpritePetZipArchive,
  readPngDimensions,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-maker-service-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

async function writeCodexStyleSourceImage(targetPath: string) {
  const svg = `<svg width="320" height="320" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
    <rect width="320" height="320" fill="#00ff00"/>
    <path d="M104 118 q56 -72 112 0 q-14 -78 -58 -78 q-42 0 -54 78z" fill="#0f1720"/>
    <circle cx="160" cy="126" r="58" fill="#25323b"/>
    <circle cx="139" cy="126" r="9" fill="#f3fbff"/>
    <circle cx="181" cy="126" r="9" fill="#f3fbff"/>
    <path d="M142 158 q18 14 36 0" fill="none" stroke="#f3fbff" stroke-width="6" stroke-linecap="round"/>
    <rect x="124" y="174" width="72" height="78" rx="20" fill="#172129"/>
    <path d="M118 188 l-30 34" stroke="#172129" stroke-width="16" stroke-linecap="round"/>
    <path d="M202 188 l32 32" stroke="#172129" stroke-width="16" stroke-linecap="round"/>
    <path d="M138 246 l-24 38" stroke="#172129" stroke-width="18" stroke-linecap="round"/>
    <path d="M182 246 l24 38" stroke="#172129" stroke-width="18" stroke-linecap="round"/>
  </svg>`

  await sharp(Buffer.from(svg)).png().toFile(targetPath)
}

async function writeScaledAtlasSourceImage(targetPath: string) {
  const columns = 8
  const rows = 9
  const cellWidth = 80
  const cellHeight = 88
  const width = columns * cellWidth
  const height = rows * cellHeight
  const cells = Array.from({ length: rows }, (_, row) => {
    return Array.from({ length: columns }, (_, column) => {
      const cx = (column * cellWidth) + 40
      const cy = (row * cellHeight) + 44
      const dx = (column % 3) * 4 - 4
      const dy = (row % 4) * 3 - 4
      return `<g>
        <circle cx="${cx + dx}" cy="${cy - 16 + dy}" r="18" fill="#202c34"/>
        <rect x="${cx - 15 - dx}" y="${cy + dy}" width="30" height="34" rx="10" fill="#162128"/>
        <circle cx="${cx - 7 + dx}" cy="${cy - 18 + dy}" r="3" fill="#e8fbff"/>
        <circle cx="${cx + 7 + dx}" cy="${cy - 18 + dy}" r="3" fill="#e8fbff"/>
      </g>`
    }).join('')
  }).join('')
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#00ff00"/>
    ${cells}
  </svg>`

  await sharp(Buffer.from(svg)).png().toFile(targetPath)
}

async function writeValidNativeAtlasSourceImage(targetPath: string) {
  const cells = SPRITE_PET_ROW_CONTRACT.map((rowContract) => {
    return Array.from({ length: rowContract.frameCount }, (_, column) => {
      const cx = (column * SPRITE_PET_CELL_WIDTH) + 96
      const cy = (rowContract.row * SPRITE_PET_CELL_HEIGHT) + 104
      const dy = ((column + rowContract.row) % 3) * 4 - 4
      return `<g>
        <circle cx="${cx}" cy="${cy - 36 + dy}" r="34" fill="#202c34"/>
        <rect x="${cx - 30}" y="${cy + dy}" width="60" height="68" rx="18" fill="#162128"/>
        <circle cx="${cx - 12}" cy="${cy - 40 + dy}" r="5" fill="#e8fbff"/>
        <circle cx="${cx + 12}" cy="${cy - 40 + dy}" r="5" fill="#e8fbff"/>
      </g>`
    }).join('')
  }).join('')
  const svg = `<svg width="${SPRITE_PET_ATLAS_WIDTH}" height="${SPRITE_PET_ATLAS_HEIGHT}" viewBox="0 0 ${SPRITE_PET_ATLAS_WIDTH} ${SPRITE_PET_ATLAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${cells}
  </svg>`

  await sharp(Buffer.from(svg)).png().toFile(targetPath)
}

async function assertArchiveRoundTrips(archivePath: string, directoryPath: string, expectedId: string) {
  const extracted = await extractSpritePetZipArchive(archivePath, path.join(directoryPath, `extract-${expectedId}`))
  const packageInfo = await readSpritePetPackage(extracted.manifestPath)
  assert.equal(packageInfo.id, expectedId)
}

test('sprite pet maker service creates a valid local package from one image', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourcePath = path.join(directoryPath, 'mini-pet.png')
    const targetDirectory = path.join(directoryPath, 'generated-pet')
    await writeCodexStyleSourceImage(sourcePath)

    const result = await createSpritePetPackageFromImage({
      sourcePath,
      targetDirectory,
      id: 'mini-pet',
      displayName: 'Mini Pet',
    })
    const packageInfo = await readSpritePetPackage(result.manifestPath)
    const readme = await fs.readFile(path.join(targetDirectory, 'README.md'), 'utf8')
    const visualAudit = JSON.parse(await fs.readFile(result.visualAuditPath, 'utf8')) as {
      visual?: { ok?: boolean }
    }
    const sprite = await fs.readFile(result.spritePath)

    assert.equal(packageInfo.id, 'mini-pet')
    assert.equal(packageInfo.displayName, 'Mini Pet')
    assert.deepEqual(readPngDimensions(sprite), {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
    })
    assert.match(readme, /does not add speed lines/)
    assert.equal(visualAudit.visual?.ok, true)
    assert.ok(result.archivePath.endsWith('mini-pet.codex-pet.zip'))
    await assertArchiveRoundTrips(result.archivePath, directoryPath, 'mini-pet')
  })
})

test('sprite pet maker service auto-detects and packages a generated 8x9 atlas image', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourcePath = path.join(directoryPath, 'atlas-source.png')
    const targetDirectory = path.join(directoryPath, 'generated-atlas-pet')
    await writeScaledAtlasSourceImage(sourcePath)

    const result = await createSpritePetPackageFromImage({
      sourcePath,
      targetDirectory,
      id: 'atlas-pet',
      displayName: 'Atlas Pet',
    })
    const packageInfo = await readSpritePetPackage(result.manifestPath)
    const readme = await fs.readFile(path.join(targetDirectory, 'README.md'), 'utf8')
    const sprite = await fs.readFile(result.spritePath)

    assert.equal(result.sourceLayout, 'atlas')
    assert.equal(result.nativeAtlasPreserved, false)
    assert.equal(packageInfo.id, 'atlas-pet')
    assert.deepEqual(readPngDimensions(sprite), {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
    })
    assert.match(readme, /Source mode: `atlas`/)
    assert.ok(result.archivePath.endsWith('atlas-pet.codex-pet.zip'))
    await assertArchiveRoundTrips(result.archivePath, directoryPath, 'atlas-pet')
  })
})

test('sprite pet maker service preserves a valid native Codex 8x9 atlas', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourcePath = path.join(directoryPath, 'native-atlas.png')
    const targetDirectory = path.join(directoryPath, 'native-atlas-pet')
    await writeValidNativeAtlasSourceImage(sourcePath)
    const original = await fs.readFile(sourcePath)

    const result = await createSpritePetPackageFromImage({
      sourcePath,
      targetDirectory,
      id: 'native-atlas-pet',
      displayName: 'Native Atlas Pet',
    })
    const sprite = await fs.readFile(result.spritePath)
    const readme = await fs.readFile(path.join(targetDirectory, 'README.md'), 'utf8')

    assert.equal(result.sourceLayout, 'atlas')
    assert.equal(result.nativeAtlasPreserved, true)
    assert.deepEqual(readPngDimensions(sprite), readPngDimensions(original))
    assert.match(readme, /preserved the frames/)
    assert.ok(result.archivePath.endsWith('native-atlas-pet.codex-pet.zip'))
    await assertArchiveRoundTrips(result.archivePath, directoryPath, 'native-atlas-pet')
  })
})
