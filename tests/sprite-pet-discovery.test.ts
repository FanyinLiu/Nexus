import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import {
  listSpritePetModelsFromRoot,
} from '../electron/services/spritePetModelDiscovery.js'

const execFileAsync = promisify(execFile)

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-discovery-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

async function scaffoldPackage(rootPath: string, id: string, displayName: string, description = '') {
  const args = [
    'scripts/scaffold-sprite-pet.mjs',
    id,
    '--display-name',
    displayName,
  ]

  if (description) {
    args.push('--description', description)
  }

  args.push('--output-dir', rootPath)

  await execFileAsync(process.execPath, args, {
    cwd: process.cwd(),
  })
}

test('sprite pet discovery keeps unprefixed bundled ids stable', async () => {
  await withTempDirectory(async (directoryPath) => {
    await scaffoldPackage(directoryPath, 'nexus-mini', 'Nexus Mini', 'Bundled package.')

    const models = await listSpritePetModelsFromRoot({
      rootPath: directoryPath,
      description: 'Bundled sprite pet.',
      idPrefix: '',
      imagePathBuilder: (relativeSpritePath: string) => `./pets/${relativeSpritePath}`,
    })

    assert.equal(models.length, 1)
    assert.equal(models[0]?.id, 'nexus-mini')
    assert.equal(models[0]?.spriteAtlas?.imagePath, './pets/nexus-mini/spritesheet.png')
    assert.equal(models[0]?.spriteAtlas?.imageRendering, 'pixelated')
  })
})

test('sprite pet discovery prefixes Codex custom pets and serves nested relative sprite paths', async () => {
  await withTempDirectory(async (directoryPath) => {
    await scaffoldPackage(directoryPath, 'desk-duck', 'Desk Duck', '')
    const manifestPath = path.join(directoryPath, 'desk-duck', 'pet.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { description?: string }
    manifest.description = ''
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    const models = await listSpritePetModelsFromRoot({
      rootPath: directoryPath,
      description: 'Codex custom sprite pet.',
      idPrefix: 'codex',
      imagePathBuilder: (relativeSpritePath: string) => `/__codex_sprite_pets__/${relativeSpritePath}`,
    })

    assert.equal(models.length, 1)
    assert.equal(models[0]?.id, 'codex-desk-duck')
    assert.equal(models[0]?.description, 'Codex custom sprite pet.')
    assert.equal(models[0]?.spriteAtlas?.imagePath, '/__codex_sprite_pets__/desk-duck/spritesheet.png')
  })
})
