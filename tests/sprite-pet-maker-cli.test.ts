import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import sharp from 'sharp'

import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  extractSpritePetZipArchive,
  readPngDimensions,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

const execFileAsync = promisify(execFile)

async function runMaker(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/make-sprite-pet.mjs', ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  })
}

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-maker-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

async function writeSingleSourceImage(targetPath: string) {
  const svg = `<svg width="320" height="320" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
    <rect width="320" height="320" fill="#00ff00"/>
    <ellipse cx="160" cy="238" rx="58" ry="16" fill="#000" opacity="0.18"/>
    <circle cx="160" cy="118" r="54" fill="#26323a"/>
    <path d="M105 108 q55 -56 110 0 q-14 -72 -61 -72 q-39 0 -49 72z" fill="#111820"/>
    <circle cx="141" cy="121" r="8" fill="#e8fbff"/>
    <circle cx="181" cy="121" r="8" fill="#e8fbff"/>
    <path d="M142 154 q18 16 38 0" fill="none" stroke="#e8fbff" stroke-width="6" stroke-linecap="round"/>
    <rect x="124" y="172" width="72" height="78" rx="20" fill="#182127"/>
    <path d="M195 176 l68 -72" stroke="#67f6ff" stroke-width="12" stroke-linecap="round"/>
    <path d="M198 176 l64 -68" stroke="#e8ffff" stroke-width="4" stroke-linecap="round"/>
    <path d="M118 184 l-30 36" stroke="#182127" stroke-width="16" stroke-linecap="round"/>
    <path d="M202 184 l32 34" stroke="#182127" stroke-width="16" stroke-linecap="round"/>
    <path d="M138 246 l-26 42" stroke="#182127" stroke-width="18" stroke-linecap="round"/>
    <path d="M182 246 l25 42" stroke="#182127" stroke-width="18" stroke-linecap="round"/>
  </svg>`

  await sharp(Buffer.from(svg)).png().toFile(targetPath)
}

async function writeAtlasSourceImage(targetPath: string) {
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
        <path d="M${cx + 18} ${cy + 2} l22 -20" stroke="#67f6ff" stroke-width="5" stroke-linecap="round"/>
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

test('pet:make creates a valid animated starter package from one image', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourcePath = path.join(directoryPath, 'swordsman.png')
    const outputDir = path.join(directoryPath, 'pets')
    await writeSingleSourceImage(sourcePath)

    const { stdout } = await runMaker([
      sourcePath,
      '--id',
      'easy-swordsman',
      '--display-name',
      'Easy Swordsman',
      '--output-dir',
      outputDir,
    ])
    const manifestPath = path.join(outputDir, 'easy-swordsman', 'pet.json')
    const spritePath = path.join(outputDir, 'easy-swordsman', 'spritesheet.png')
    const readmePath = path.join(outputDir, 'easy-swordsman', 'README.md')
    const sprite = await fs.readFile(spritePath)
    const readme = await fs.readFile(readmePath, 'utf8')
    const packageInfo = await readSpritePetPackage(manifestPath)
    const extracted = await extractSpritePetZipArchive(
      path.join(outputDir, 'easy-swordsman', 'easy-swordsman.codex-pet.zip'),
      path.join(directoryPath, 'extract-easy-swordsman'),
    )
    const extractedInfo = await readSpritePetPackage(extracted.manifestPath)

    assert.match(stdout, /Sprite pet package created/)
    assert.match(stdout, /source layout: single/)
    assert.match(stdout, /easy-swordsman\.codex-pet\.zip/)
    assert.match(stdout, /visual audit: OK/)
    assert.equal(packageInfo.id, 'easy-swordsman')
    assert.equal(extractedInfo.id, 'easy-swordsman')
    assert.equal(packageInfo.displayName, 'Easy Swordsman')
    assert.deepEqual(readPngDimensions(sprite), {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
    })
    assert.match(readme, /Source mode: `single`/)
    assert.match(readme, /does not add speed lines/)
    await fs.access(path.join(outputDir, 'easy-swordsman', 'visual-audit.json'))
  })
})

test('pet:make can package an AI-style 8x9 atlas source', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourcePath = path.join(directoryPath, 'sheet.png')
    const outputDir = path.join(directoryPath, 'pets')
    await writeAtlasSourceImage(sourcePath)

    const { stdout } = await runMaker([
      sourcePath,
      '--id',
      'atlas-swordsman',
      '--source-layout',
      'atlas',
      '--output-dir',
      outputDir,
    ])
    const manifestPath = path.join(outputDir, 'atlas-swordsman', 'pet.json')
    const sprite = await fs.readFile(path.join(outputDir, 'atlas-swordsman', 'spritesheet.png'))
    const packageInfo = await readSpritePetPackage(manifestPath)
    const extracted = await extractSpritePetZipArchive(
      path.join(outputDir, 'atlas-swordsman', 'atlas-swordsman.codex-pet.zip'),
      path.join(directoryPath, 'extract-atlas-swordsman'),
    )
    const extractedInfo = await readSpritePetPackage(extracted.manifestPath)

    assert.match(stdout, /source layout: atlas/)
    assert.match(stdout, /atlas-swordsman\.codex-pet\.zip/)
    assert.equal(packageInfo.id, 'atlas-swordsman')
    assert.equal(extractedInfo.id, 'atlas-swordsman')
    assert.deepEqual(readPngDimensions(sprite), {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
    })
  })
})

test('pet:make refuses to overwrite unless forced', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourcePath = path.join(directoryPath, 'pet.png')
    const outputDir = path.join(directoryPath, 'pets')
    const args = [sourcePath, '--id', 'overwrite-pet', '--output-dir', outputDir]
    await writeSingleSourceImage(sourcePath)

    await runMaker(args)

    await assert.rejects(
      () => runMaker(args),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /already exists/)
        assert.match(stderr, /--force/)
        return true
      },
    )

    await runMaker([...args, '--force'])
  })
})
