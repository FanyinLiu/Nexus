import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)

async function runExporter(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/export-sprite-pet-runtime.mjs', ...args], {
    cwd: process.cwd(),
  })
}

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-runtime-export-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('pet:export-runtime writes a standalone clean-room runtime bundle', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'runtime')
    const { stdout } = await runExporter(['--output-dir', outputDir])

    assert.match(stdout, /Sprite pet runtime exported/)
    assert.match(stdout, /manifest: export-manifest\.json/)
    assert.match(stdout, /private Codex code\/assets copied: false/)

    const runtimePath = path.join(outputDir, 'sprite-pet-runtime.mjs')
    const typesPath = path.join(outputDir, 'sprite-pet-runtime.d.ts')
    const contractPath = path.join(outputDir, 'sprite-pet-contract.json')
    const packageJsonPath = path.join(outputDir, 'package.json')
    const readmePath = path.join(outputDir, 'README.md')
    const cssPath = path.join(outputDir, 'sprite-pet.css')
    const demoPath = path.join(outputDir, 'demo.html')
    const electronHostPath = path.join(outputDir, 'electron-host-example.mjs')
    const manifestPath = path.join(outputDir, 'export-manifest.json')

    const [runtimeSource, types, contractRaw, packageJsonRaw, readme, css, demo, electronHost, manifestRaw] =
      await Promise.all([
        fs.readFile(runtimePath, 'utf8'),
        fs.readFile(typesPath, 'utf8'),
        fs.readFile(contractPath, 'utf8'),
        fs.readFile(packageJsonPath, 'utf8'),
        fs.readFile(readmePath, 'utf8'),
        fs.readFile(cssPath, 'utf8'),
        fs.readFile(demoPath, 'utf8'),
        fs.readFile(electronHostPath, 'utf8'),
        fs.readFile(manifestPath, 'utf8'),
      ])

    assert.match(runtimeSource, /no private Codex app code/)
    assert.match(types, /export type SpritePetAnimationState/)
    assert.match(types, /resolveSpritePetRenderFrame/)
    assert.match(readme, /clean-room portable runtime/)
    assert.match(readme, /export-manifest\.json/)
    assert.match(css, /\.sprite-pet-sprite/)
    assert.match(css, /-webkit-app-region: drag/)
    assert.match(css, /app-region: drag/)
    assert.match(css, /\.sprite-pet-no-drag/)
    assert.match(css, /-webkit-app-region: no-drag/)
    assert.match(demo, /sprite-pet-runtime\.mjs/)
    assert.match(demo, /sprite-pet\.css/)
    assert.match(demo, /controls sprite-pet-no-drag/)
    assert.match(electronHost, /frame: false/)
    assert.match(electronHost, /transparent: true/)
    assert.match(electronHost, /alwaysOnTop: true/)
    assert.match(electronHost, /skipTaskbar: true/)
    assert.match(electronHost, /nodeIntegration: false/)
    assert.match(electronHost, /loadFile\(path\.join\(__dirname, 'demo\.html'\)\)/)

    const packageJson = JSON.parse(packageJsonRaw) as {
      name?: string
      type?: string
      private?: boolean
      exports?: {
        '.'?: {
          types?: string
          import?: string
        }
        './style.css'?: string
        './manifest'?: string
        './electron-host-example'?: string
      }
    }

    assert.equal(packageJson.name, '@nexus/sprite-pet-runtime')
    assert.equal(packageJson.private, true)
    assert.equal(packageJson.type, 'module')
    assert.deepEqual(packageJson.exports?.['.'], {
      types: './sprite-pet-runtime.d.ts',
      import: './sprite-pet-runtime.mjs',
    })
    assert.equal(packageJson.exports?.['./manifest'], './export-manifest.json')
    assert.equal(packageJson.exports?.['./style.css'], './sprite-pet.css')
    assert.equal(packageJson.exports?.['./electron-host-example'], './electron-host-example.mjs')

    const manifest = JSON.parse(manifestRaw) as {
      sourcePolicy?: {
        implementation?: string
        privateCodexCodeOrAssetsCopied?: boolean
        privateCodexBuiltInAssetsCopied?: boolean
      }
      contract?: {
        file?: string
        atlas?: {
          width?: number
          height?: number
        }
      }
      includedPetPackage?: unknown
      files?: Array<{
        path?: string
        bytes?: number
        sha256?: string
      }>
    }

    assert.equal(manifest.sourcePolicy?.implementation, 'clean-room runtime and host example')
    assert.equal(manifest.sourcePolicy?.privateCodexCodeOrAssetsCopied, false)
    assert.equal(manifest.sourcePolicy?.privateCodexBuiltInAssetsCopied, false)
    assert.equal(manifest.contract?.file, 'sprite-pet-contract.json')
    assert.equal(manifest.contract?.atlas?.width, 1536)
    assert.equal(manifest.contract?.atlas?.height, 1872)
    assert.equal(manifest.includedPetPackage, null)
    assert.equal(manifest.files?.some((file) => file.path === 'export-manifest.json'), false)
    assert.ok(manifest.files?.some((file) => (
      file.path === 'sprite-pet-runtime.mjs' &&
      typeof file.bytes === 'number' &&
      file.bytes > 0 &&
      /^[a-f0-9]{64}$/.test(file.sha256 ?? '')
    )))

    const contract = JSON.parse(contractRaw) as {
      privateCodexCodeOrAssetsCopied?: boolean
      atlas?: {
        width?: number
        height?: number
        columns?: number
        rows?: number
      }
      rows?: Array<{
        row?: number
        state?: string
        frameCount?: number
      }>
    }

    assert.equal(contract.privateCodexCodeOrAssetsCopied, false)
    assert.deepEqual(contract.atlas, {
      width: 1536,
      height: 1872,
      columns: 8,
      rows: 9,
      cellWidth: 192,
      cellHeight: 208,
    })
    assert.deepEqual(contract.rows?.map(({ row, state, frameCount }) => ({ row, state, frameCount })), [
      { row: 0, state: 'idle', frameCount: 6 },
      { row: 1, state: 'running-right', frameCount: 8 },
      { row: 2, state: 'running-left', frameCount: 8 },
      { row: 3, state: 'waving', frameCount: 4 },
      { row: 4, state: 'jumping', frameCount: 5 },
      { row: 5, state: 'failed', frameCount: 8 },
      { row: 6, state: 'waiting', frameCount: 6 },
      { row: 7, state: 'running', frameCount: 6 },
      { row: 8, state: 'review', frameCount: 6 },
    ])
  })
})

test('pet:export-runtime can include a validated user pet package in the demo', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'runtime')
    const { stdout } = await runExporter([
      '--output-dir',
      outputDir,
      '--package',
      'public/pets/qiyi',
    ])

    assert.match(stdout, /demo package: pets\/qiyi/)

    const includedManifest = JSON.parse(
      await fs.readFile(path.join(outputDir, 'pets', 'qiyi', 'pet.json'), 'utf8'),
    ) as {
      id?: string
      displayName?: string
      spritesheetPath?: string
    }
    const demo = await fs.readFile(path.join(outputDir, 'demo.html'), 'utf8')
    const manifest = JSON.parse(
      await fs.readFile(path.join(outputDir, 'export-manifest.json'), 'utf8'),
    ) as {
      includedPetPackage?: {
        id?: string
        source?: string
        sourceManifestPath?: string
        sourceSpritePath?: string
        targetDirectory?: string
        demoSpritePath?: string
      } | null
      files?: Array<{
        path?: string
      }>
    }
    const sprite = await fs.readFile(path.join(outputDir, 'pets', 'qiyi', 'spritesheet.webp'))

    assert.equal(includedManifest.id, 'qiyi')
    assert.equal(includedManifest.displayName, '七一')
    assert.equal(includedManifest.spritesheetPath, 'spritesheet.webp')
    assert.match(demo, /\.\/pets\/qiyi\/spritesheet\.webp/)
    assert.equal(manifest.includedPetPackage?.id, 'qiyi')
    assert.equal(manifest.includedPetPackage?.source, 'user-provided --package input')
    assert.equal(manifest.includedPetPackage?.targetDirectory, 'pets/qiyi')
    assert.equal(manifest.includedPetPackage?.demoSpritePath, './pets/qiyi/spritesheet.webp')
    assert.equal(path.basename(manifest.includedPetPackage?.sourceManifestPath ?? ''), 'pet.json')
    assert.equal(path.basename(manifest.includedPetPackage?.sourceSpritePath ?? ''), 'spritesheet.webp')
    assert.ok(manifest.files?.some((file) => file.path === 'pets/qiyi/pet.json'))
    assert.ok(manifest.files?.some((file) => file.path === 'pets/qiyi/spritesheet.webp'))
    assert.equal(sprite.toString('ascii', 0, 4), 'RIFF')
    assert.equal(sprite.toString('ascii', 8, 12), 'WEBP')
  })
})

test('exported sprite runtime can be imported outside Nexus source', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'runtime')
    await runExporter(['--output-dir', outputDir])

    const runtime = await import(pathToFileURL(path.join(outputDir, 'sprite-pet-runtime.mjs')).href) as {
      SPRITE_PET_INITIAL_CURSOR: unknown
      applySpritePetStateRequest: (input: {
        current: unknown
        requestedState: string
        requestKey: string
        prefersReducedMotion?: boolean
      }) => unknown
      advanceSpritePetAnimationCursor: (
        current: unknown,
        requestedState: string,
        requestKey: string,
        options?: { loopRequestedState?: boolean },
      ) => unknown
      mapSpritePetSignalsToState: (input: Record<string, unknown>) => string
      resolveSpritePetRenderFrame: (atlas: Record<string, unknown>, cursor: unknown) => {
        frame: {
          row: number
          column: number
          durationMs: number
        }
        backgroundPosition: string
        backgroundSize: string
      }
    }

    assert.deepEqual(runtime.SPRITE_PET_INITIAL_CURSOR, {
      state: 'waving',
      frameIndex: 0,
      loopsRemaining: 3,
      requestKey: 'initial',
    })
    assert.equal(runtime.mapSpritePetSignalsToState({ isListening: true }), 'waiting')
    assert.equal(runtime.mapSpritePetSignalsToState({ isSpeaking: true }), 'review')
    assert.equal(runtime.mapSpritePetSignalsToState({ isBusy: true }), 'running')

    const cursor = runtime.applySpritePetStateRequest({
      current: runtime.SPRITE_PET_INITIAL_CURSOR,
      requestedState: 'review',
      requestKey: 'review',
    })
    const frame = runtime.resolveSpritePetRenderFrame({}, cursor)

    assert.deepEqual(frame.frame, {
      row: 8,
      column: 0,
      durationMs: 150,
    })
    assert.equal(frame.backgroundPosition, '0% 100%')
    assert.equal(frame.backgroundSize, '800% 900%')

    assert.deepEqual(
      runtime.advanceSpritePetAnimationCursor(
        { state: 'review', frameIndex: 5, loopsRemaining: 1, requestKey: 'review' },
        'review',
        'review',
      ),
      {
        state: 'idle',
        frameIndex: 0,
        loopsRemaining: 0,
        requestKey: 'review',
        idleDurationMultiplier: 6,
      },
    )

    assert.deepEqual(
      runtime.advanceSpritePetAnimationCursor(
        { state: 'review', frameIndex: 5, loopsRemaining: 1, requestKey: 'review' },
        'review',
        'review',
        { loopRequestedState: true },
      ),
      { state: 'review', frameIndex: 0, loopsRemaining: 3, requestKey: 'review' },
    )
  })
})

test('exported sprite runtime can be consumed as a local package', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'node_modules', '@nexus', 'sprite-pet-runtime')
    await runExporter(['--output-dir', outputDir])

    const consumerPath = path.join(directoryPath, 'consumer.mjs')
    await fs.writeFile(
      consumerPath,
      [
        "import { SPRITE_PET_INITIAL_CURSOR, resolveSpritePetRenderFrame } from '@nexus/sprite-pet-runtime'",
        "const frame = resolveSpritePetRenderFrame({}, SPRITE_PET_INITIAL_CURSOR)",
        "console.log(JSON.stringify({ state: SPRITE_PET_INITIAL_CURSOR.state, row: frame.frame.row, size: frame.backgroundSize }))",
      ].join('\n'),
      'utf8',
    )

    const { stdout } = await execFileAsync(process.execPath, [consumerPath], {
      cwd: directoryPath,
    })

    assert.deepEqual(JSON.parse(stdout), {
      state: 'waving',
      row: 3,
      size: '800% 900%',
    })
  })
})

test('pet:export-runtime refuses to overwrite without --force', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'runtime')
    await runExporter(['--output-dir', outputDir])

    await assert.rejects(
      () => runExporter(['--output-dir', outputDir]),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /already exists/)
        assert.match(stderr, /--force/)
        return true
      },
    )

    const { stdout } = await runExporter(['--output-dir', outputDir, '--force'])
    assert.match(stdout, /Sprite pet runtime exported/)
  })
})
