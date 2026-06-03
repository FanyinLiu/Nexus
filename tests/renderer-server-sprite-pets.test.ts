import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import {
  closeRendererServer,
  ensureRendererServer,
  initRendererServer,
} from '../electron/rendererServer.js'

afterEach(() => {
  closeRendererServer()
})

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-renderer-server-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('renderer server serves Codex custom sprite pet assets from their own read-only route', async () => {
  await withTempDirectory(async (directoryPath) => {
    const importedLive2dRoot = path.join(directoryPath, 'live2d')
    const importedSpriteRoot = path.join(directoryPath, 'imported-sprites')
    const codexSpriteRoot = path.join(directoryPath, 'codex-pets')
    const spritePath = path.join(codexSpriteRoot, 'custom-pet', 'spritesheet.png')

    await fs.mkdir(path.dirname(spritePath), { recursive: true })
    await fs.writeFile(spritePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    initRendererServer({
      isDev: false,
      useDevServer: false,
      devServerUrl: 'http://127.0.0.1:47821',
      getPanelSection: () => 'chat',
      getImportedPetModelsRoot: () => importedLive2dRoot,
      getImportedSpritePetModelsRoot: () => importedSpriteRoot,
      getCodexCustomSpritePetModelsRoot: () => codexSpriteRoot,
      isPathInsideRoot: (rootPath: string, candidatePath: string) => {
        const relativePath = path.relative(rootPath, candidatePath)
        return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
      },
      importedPetModelsRoute: '/__imported_live2d__',
      importedSpritePetModelsRoute: '/__imported_sprite_pets__',
      codexCustomSpritePetModelsRoute: '/__codex_sprite_pets__',
    })

    const serverUrl = await ensureRendererServer()
    const response = await fetch(`${serverUrl}/__codex_sprite_pets__/custom-pet/spritesheet.png`)
    const body = Buffer.from(await response.arrayBuffer())

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.deepEqual([...body], [0x89, 0x50, 0x4e, 0x47])
  })
})
