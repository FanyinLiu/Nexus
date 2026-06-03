import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)

async function runPreviewer(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/preview-sprite-pet.mjs', ...args], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  })
}

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-preview-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('pet:preview writes a standalone labeled contact sheet', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputPath = path.join(directoryPath, 'contact-sheet.svg')

    const { stdout } = await runPreviewer([
      'public/pets/qiyi',
      '--output',
      outputPath,
      '--scale',
      '0.25',
    ])
    const svg = await fs.readFile(outputPath, 'utf8')

    assert.match(stdout, /Sprite pet contact sheet written/)
    assert.match(stdout, /rows: idle, running-right/)
    assert.match(svg, /<svg[^>]+width="576"[^>]+height="548"/)
    assert.match(svg, /data:image\/webp;base64,/)
    assert.match(svg, />3 waving</)
    assert.match(svg, />8 review</)
    assert.match(svg, /1536x1872, scale 0\.25/)
  })
})

test('pet:preview rejects packages with unsafe spritesheet paths', async () => {
  await withTempDirectory(async (directoryPath) => {
    const manifestPath = path.join(directoryPath, 'pet.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        id: 'unsafe',
        spritesheetPath: '../spritesheet.png',
      }),
      'utf8',
    )

    await assert.rejects(
      () => runPreviewer([manifestPath, '--output', path.join(directoryPath, 'unsafe.svg')]),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /Sprite pet preview failed/)
        assert.match(stderr, /spritesheetPath/)
        return true
      },
    )
  })
})
