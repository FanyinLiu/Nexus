import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import {
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

const execFileAsync = promisify(execFile)

async function runScaffold(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/scaffold-sprite-pet.mjs', ...args], {
    cwd: process.cwd(),
  })
}

async function runCodexInstaller(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/install-codex-pet.mjs', ...args], {
    cwd: process.cwd(),
  })
}

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-codex-install-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('pet:install-codex installs a valid package into a Codex pets root', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourceRoot = path.join(directoryPath, 'source')
    const codexHome = path.join(directoryPath, 'codex-home')
    await runScaffold([
      'desk-duck',
      '--display-name',
      'Desk Duck',
      '--description',
      'A clean-room desk companion.',
      '--output-dir',
      sourceRoot,
    ])

    const { stdout } = await runCodexInstaller([
      path.join(sourceRoot, 'desk-duck'),
      '--codex-home',
      codexHome,
    ])
    const targetManifestPath = path.join(codexHome, 'pets', 'desk-duck', 'pet.json')
    const targetManifest = JSON.parse(await fs.readFile(targetManifestPath, 'utf8')) as {
      id?: string
      displayName?: string
      description?: string
      spritesheetPath?: string
    }
    const packageInfo = await readSpritePetPackage(targetManifestPath)

    assert.match(stdout, /Sprite pet package installed for Codex/)
    assert.equal(targetManifest.id, 'desk-duck')
    assert.equal(targetManifest.displayName, 'Desk Duck')
    assert.equal(targetManifest.description, 'A clean-room desk companion.')
    assert.equal(targetManifest.spritesheetPath, 'spritesheet.png')
    assert.equal(packageInfo.sourceSpritePath, path.join(codexHome, 'pets', 'desk-duck', 'spritesheet.png'))
  })
})

test('pet:install-codex refuses to overwrite unless forced', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourceRoot = path.join(directoryPath, 'source')
    const codexHome = path.join(directoryPath, 'codex-home')
    await runScaffold([
      'copy-cat',
      '--display-name',
      'Copy Cat',
      '--output-dir',
      sourceRoot,
    ])
    const args = [path.join(sourceRoot, 'copy-cat'), '--codex-home', codexHome]

    await runCodexInstaller(args)

    await assert.rejects(
      () => runCodexInstaller(args),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /already exists/)
        assert.match(stderr, /--force/)
        return true
      },
    )

    await runCodexInstaller([...args, '--force'])
  })
})
