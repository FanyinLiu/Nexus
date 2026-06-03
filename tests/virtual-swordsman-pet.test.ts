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

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-virtual-swordsman-pet-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('Codex-style mascot generator creates a valid animated sprite pet package', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'original-virtual-swordsman')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/generate-virtual-swordsman-pet.mjs',
      '--output-dir',
      outputDir,
    ], {
      cwd: process.cwd(),
    })

    assert.match(stdout, /Codex-style mascot pet generated/)

    const manifestPath = path.join(outputDir, 'pet.json')
    const spritePath = path.join(outputDir, 'spritesheet.png')
    const readmePath = path.join(outputDir, 'README.md')
    const packageInfo = await readSpritePetPackage(manifestPath)
    const sprite = await fs.readFile(spritePath)
    const readme = await fs.readFile(readmePath, 'utf8')

    assert.equal(packageInfo.id, 'original-virtual-swordsman')
    assert.equal(packageInfo.displayName, 'Original Code Mascot')
    assert.match(packageInfo.description, /Codex-style mascot sprite pet/)
    assert.deepEqual(readPngDimensions(sprite), {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
    })
    assert.match(readme, /terminal-style face/)
  })
})

test('Codex-style mascot generated package passes visual audit', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'original-virtual-swordsman')

    await execFileAsync(process.execPath, [
      'scripts/generate-virtual-swordsman-pet.mjs',
      '--output-dir',
      outputDir,
    ], {
      cwd: process.cwd(),
    })

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/audit-sprite-pet-visual.mjs',
      outputDir,
      '--strict',
    ], {
      cwd: process.cwd(),
    })

    assert.match(stdout, /visual audit: OK/)
  })
})

test('Codex-style mascot generator supports creator options and refuses to overwrite without --force', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'original-virtual-swordsman')
    const args = [
      'scripts/generate-virtual-swordsman-pet.mjs',
      '--output-dir',
      outputDir,
    ]

    await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
    })

    await assert.rejects(
      () => execFileAsync(process.execPath, args, { cwd: process.cwd() }),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /already exists/)
        assert.match(stderr, /--force/)
        return true
      },
    )

    await execFileAsync(process.execPath, [
      ...args,
      '--id',
      'my-code-pet',
      '--display-name',
      'My Code Pet',
      '--body-color',
      '#62a6ff',
      '--accessory',
      'sprout',
      '--force',
    ], {
      cwd: process.cwd(),
    })

    const packageInfo = await readSpritePetPackage(path.join(outputDir, 'pet.json'))
    assert.equal(packageInfo.id, 'my-code-pet')
    assert.equal(packageInfo.displayName, 'My Code Pet')
  })
})
