import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_ROW_CONTRACT,
} from '../electron/services/spritePetPackage.js'
import { auditSpritePetPackage } from '../electron/services/spritePetVisualAudit.js'

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-visual-audit-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

async function writeManifest(directoryPath: string, id: string) {
  const manifestPath = path.join(directoryPath, 'pet.json')
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify({
      id,
      displayName: 'Audit Pet',
      description: 'Test sprite pet package.',
      spritesheetPath: 'spritesheet.png',
    }, null, 2)}\n`,
    'utf8',
  )

  return manifestPath
}

async function writeOversizedAtlas(targetPath: string) {
  const composites = []
  const fullCell = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_PET_CELL_WIDTH}" height="${SPRITE_PET_CELL_HEIGHT}" viewBox="0 0 ${SPRITE_PET_CELL_WIDTH} ${SPRITE_PET_CELL_HEIGHT}">
      <rect x="0" y="0" width="${SPRITE_PET_CELL_WIDTH}" height="${SPRITE_PET_CELL_HEIGHT}" fill="#2f343c"/>
      <circle cx="76" cy="82" r="8" fill="#eef8ff"/>
      <circle cx="116" cy="82" r="8" fill="#eef8ff"/>
      <path d="M74 132 q22 18 44 0" fill="none" stroke="#eef8ff" stroke-width="7" stroke-linecap="round"/>
    </svg>`,
  )

  for (const row of SPRITE_PET_ROW_CONTRACT) {
    for (let column = 0; column < row.frameCount; column += 1) {
      composites.push({
        input: fullCell,
        left: column * SPRITE_PET_CELL_WIDTH,
        top: row.row * SPRITE_PET_CELL_HEIGHT,
      })
    }
  }

  await sharp({
    create: {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(targetPath)
}

test('visual audit warns when art is a full-cell illustration instead of a compact Codex pet', async () => {
  await withTempDirectory(async (directoryPath) => {
    const spritePath = path.join(directoryPath, 'spritesheet.png')
    const manifestPath = await writeManifest(directoryPath, 'oversized-pet')
    await writeOversizedAtlas(spritePath)

    const report = await auditSpritePetPackage(manifestPath)
    const warnings = report.visual.warnings.join('\n')

    assert.equal(report.visual.ok, false)
    assert.equal(report.visual.codexStyle.checks.compactSilhouette, false)
    assert.match(warnings, /fills too much/)
    assert.match(warnings, /cell edge/)
  })
})
