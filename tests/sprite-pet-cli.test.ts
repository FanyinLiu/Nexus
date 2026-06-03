import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)

async function runValidator(targetPath: string, args: string[] = []) {
  return execFileAsync(process.execPath, ['scripts/validate-sprite-pet.mjs', targetPath, ...args], {
    cwd: process.cwd(),
  })
}

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-cli-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('pet:validate accepts the bundled nexus-mini package folder', async () => {
  const { stdout } = await runValidator('public/pets/qiyi')

  assert.match(stdout, /Sprite pet package OK/)
  assert.match(stdout, /displayName: 七一/)
  assert.match(stdout, /atlas: 1536x1872 \(8x9, 192x208 per frame\)/)
  assert.match(stdout, /compatibility: Codex\/Nexus 8x9 sprite atlas contract/)
  assert.match(stdout, /row 0: idle, 6 frames, 2 transparent unused cells, durations 280\/110\/110\/140\/140\/320 ms/)
  assert.match(stdout, /row 8: review, 6 frames, 2 transparent unused cells, durations 150\/150\/150\/150\/150\/280 ms/)
  assert.match(stdout, /source policy: clean-room implementation; use original, licensed, or user-provided art/)
  assert.match(stdout, /private Codex code\/assets copied: false/)
  assert.match(stdout, /alpha: PNG unused cells must be transparent; WebP must expose alpha/)
})

test('pet:validate --json emits a stable machine-readable compatibility report', async () => {
  const { stdout } = await runValidator('public/pets/qiyi', ['--json'])
  const report = JSON.parse(stdout) as {
    ok?: boolean
    package?: {
      id?: string
      displayName?: string
      spritesheetPath?: string
    }
    atlas?: {
      width?: number
      height?: number
      columns?: number
      rows?: number
      cellWidth?: number
      cellHeight?: number
    }
    compatibility?: {
      name?: string
      privateCodexCodeOrAssetsCopied?: boolean
      rows?: Array<{
        row?: number
        state?: string
        frameCount?: number
        transparentUnusedCells?: number
        durationsMs?: number[]
      }>
    }
  }

  assert.equal(report.ok, true)
  assert.equal(report.package?.id, 'qiyi')
  assert.equal(report.package?.displayName, '七一')
  assert.equal(report.package?.spritesheetPath, 'spritesheet.webp')
  assert.deepEqual(report.atlas, {
    width: 1536,
    height: 1872,
    columns: 8,
    rows: 9,
    cellWidth: 192,
    cellHeight: 208,
  })
  assert.equal(report.compatibility?.name, 'Codex/Nexus 8x9 sprite atlas contract')
  assert.equal(report.compatibility?.privateCodexCodeOrAssetsCopied, false)
  assert.deepEqual(report.compatibility?.rows?.map(({ row, state, frameCount, transparentUnusedCells }) => ({
    row,
    state,
    frameCount,
    transparentUnusedCells,
  })), [
    { row: 0, state: 'idle', frameCount: 6, transparentUnusedCells: 2 },
    { row: 1, state: 'running-right', frameCount: 8, transparentUnusedCells: 0 },
    { row: 2, state: 'running-left', frameCount: 8, transparentUnusedCells: 0 },
    { row: 3, state: 'waving', frameCount: 4, transparentUnusedCells: 4 },
    { row: 4, state: 'jumping', frameCount: 5, transparentUnusedCells: 3 },
    { row: 5, state: 'failed', frameCount: 8, transparentUnusedCells: 0 },
    { row: 6, state: 'waiting', frameCount: 6, transparentUnusedCells: 2 },
    { row: 7, state: 'running', frameCount: 6, transparentUnusedCells: 2 },
    { row: 8, state: 'review', frameCount: 6, transparentUnusedCells: 2 },
  ])
  assert.deepEqual(report.compatibility?.rows?.[8]?.durationsMs, [150, 150, 150, 150, 150, 280])
})

test('pet:validate accepts an explicit pet.json path', async () => {
  const { stdout } = await runValidator('public/pets/qiyi/pet.json')

  assert.match(stdout, /Sprite pet package OK/)
  assert.match(stdout, /spritesheet: spritesheet\.webp/)
})

test('pet:validate rejects packages with unsafe spritesheet paths', async () => {
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
      () => runValidator(manifestPath),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /Sprite pet package invalid/)
        assert.match(stderr, /spritesheetPath/)
        return true
      },
    )
  })
})
