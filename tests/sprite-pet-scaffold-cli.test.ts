import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  readPngDimensions,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

const execFileAsync = promisify(execFile)

async function runScaffolder(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/scaffold-sprite-pet.mjs', ...args], {
    cwd: process.cwd(),
  })
}

async function runPreviewer(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/preview-sprite-pet.mjs', ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  })
}

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-scaffold-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('pet:scaffold creates a valid clean-room package and guide', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'pets')

    const { stdout } = await runScaffolder([
      'clean-room-pet',
      '--output-dir',
      outputDir,
      '--display-name',
      'Clean Room Pet',
    ])
    const packagePath = path.join(outputDir, 'clean-room-pet')
    const manifestPath = path.join(packagePath, 'pet.json')
    const spritePath = path.join(packagePath, 'spritesheet.png')
    const guidePath = path.join(packagePath, 'layout-guide.svg')
    const readmePath = path.join(packagePath, 'README.md')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      id?: string
      displayName?: string
      spritesheetPath?: string
    }
    const sprite = await fs.readFile(spritePath)
    const guide = await fs.readFile(guidePath, 'utf8')
    const readme = await fs.readFile(readmePath, 'utf8')
    const packageInfo = await readSpritePetPackage(manifestPath)

    assert.match(stdout, /Sprite pet package scaffolded/)
    assert.equal(manifest.id, 'clean-room-pet')
    assert.equal(manifest.displayName, 'Clean Room Pet')
    assert.equal(manifest.spritesheetPath, 'spritesheet.png')
    assert.deepEqual(readPngDimensions(sprite), {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
    })
    assert.equal(packageInfo.displayName, 'Clean Room Pet')
    assert.match(guide, /row 8 review/)
    assert.match(guide, /1536x1872/)
    assert.match(readme, /Clean Room Pet/)
  })
})

test('pet:scaffold output can be previewed without hand edits', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'pets')
    const previewPath = path.join(directoryPath, 'preview.svg')

    await runScaffolder(['preview-pet', '--output-dir', outputDir])
    const { stdout } = await runPreviewer([
      path.join(outputDir, 'preview-pet'),
      '--output',
      previewPath,
      '--scale',
      '0.1',
    ])
    const preview = await fs.readFile(previewPath, 'utf8')

    assert.match(stdout, /Sprite pet contact sheet written/)
    assert.match(preview, /data:image\/png;base64,/)
    assert.match(preview, />8 review</)
  })
})

test('pet:scaffold refuses to overwrite unless forced', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'pets')
    const args = ['overwrite-pet', '--output-dir', outputDir]

    await runScaffolder(args)

    await assert.rejects(
      () => runScaffolder(args),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /already exists/)
        assert.match(stderr, /--force/)
        return true
      },
    )

    await runScaffolder([...args, '--force'])
  })
})
