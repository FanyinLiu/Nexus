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
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_ROW_CONTRACT,
  extractSpritePetZipArchive,
  readPngDimensions,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'
import { createSpritePetCreatorKit } from '../electron/services/spritePetCreatorKit.js'
import { assembleSpritePetCreatorKit, inspectSpritePetCreatorKit } from '../electron/services/spritePetAssembler.js'
import { buildCodexPetCreatorPrompt } from '../src/features/pet/spritePetCreatorKit.ts'

const execFileAsync = promisify(execFile)

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-creator-kit-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

async function runCreatorKit(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/create-sprite-pet-creator-kit.mjs', ...args], {
    cwd: process.cwd(),
  })
}

async function runAssembler(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/assemble-sprite-pet-creator-kit.mjs', ...args], {
    cwd: process.cwd(),
  })
}

async function makeRowSource(row: (typeof SPRITE_PET_ROW_CONTRACT)[number], targetPath: string) {
  const width = row.frameCount * SPRITE_PET_CELL_WIDTH
  const height = SPRITE_PET_CELL_HEIGHT
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...Array.from({ length: row.frameCount }, (_, frame) => {
      const x = (frame * SPRITE_PET_CELL_WIDTH) + 44
      const y = 48 + ((frame + row.row) % 3) * 8
      const hue = (row.row * 34 + frame * 11) % 360
      return `<rect x="${x}" y="${y}" width="104" height="118" rx="20" fill="hsl(${hue} 70% 55%)" stroke="#1e2430" stroke-width="6"/>`
    }),
    '</svg>',
  ].join('')

  await sharp(Buffer.from(svg)).png().toFile(targetPath)
}

async function writeAllRowSources(kitDirectory: string) {
  const sourceRowsDirectory = path.join(kitDirectory, 'source-rows')
  await fs.mkdir(sourceRowsDirectory, { recursive: true })

  for (const row of SPRITE_PET_ROW_CONTRACT) {
    await makeRowSource(row, path.join(sourceRowsDirectory, `${row.row}-${row.state}.png`))
  }
}

test('Codex pet creator prompt gives users the full atlas and row contract', () => {
  const prompt = buildCodexPetCreatorPrompt({
    displayName: 'Tiny Copper',
    concept: 'a tiny bronze guardian with a square terminal face',
  })

  assert.match(prompt, /Tiny Copper/)
  assert.match(prompt, /1536x1872/)
  assert.match(prompt, /8 columns x 9 rows/)
  assert.match(prompt, /192x208/)
  assert.match(prompt, /not Live2D/)
  assert.match(prompt, /source-rows\/0-idle\.png/)
  assert.match(prompt, /source-rows\/8-review\.png/)
  assert.match(prompt, /unused cells must be fully transparent/)
})

test('sprite pet creator kit writes Codex-style prompts and contract files', async () => {
  await withTempDirectory(async (directoryPath) => {
    const result = await createSpritePetCreatorKit({
      targetDirectory: path.join(directoryPath, 'kits', 'tiny-copper'),
      id: 'tiny-copper',
      displayName: 'Tiny Copper',
      concept: 'a tiny bronze guardian mascot with a square terminal face',
    })
    assert.equal(result.sourceRowsDirectory, path.join(result.directoryPath, 'source-rows'))
    assert.equal(result.layoutGuidesDirectory, path.join(result.directoryPath, 'references', 'layout-guides'))

    const brief = JSON.parse(await fs.readFile(path.join(result.directoryPath, 'creator-brief.json'), 'utf8')) as {
      contract?: {
        atlas?: {
          width?: number
          height?: number
          cellWidth?: number
          cellHeight?: number
        }
        rowContract?: unknown[]
      }
      provenance?: {
        privateCodexCodeOrAssetsCopied?: boolean
        thirdPartyArtBundled?: boolean
        sampleLinksOnly?: boolean
      }
      styleSamples?: {
        sampleLinksOnly?: boolean
        thirdPartyArtBundled?: boolean
        files?: string[]
      }
    }
    const readme = await fs.readFile(path.join(result.directoryPath, 'README.md'), 'utf8')
    const basePrompt = await fs.readFile(path.join(result.directoryPath, 'prompts', 'base.md'), 'utf8')
    const wavingPrompt = await fs.readFile(path.join(result.directoryPath, 'prompts', 'rows', '3-waving.md'), 'utf8')
    const runningPrompt = await fs.readFile(path.join(result.directoryPath, 'prompts', 'rows', '7-running.md'), 'utf8')
    const styleSamplesMarkdown = await fs.readFile(path.join(result.directoryPath, 'references', 'style-samples.md'), 'utf8')
    const styleSamplesJson = JSON.parse(
      await fs.readFile(path.join(result.directoryPath, 'references', 'style-samples.json'), 'utf8'),
    ) as {
      sampleLinksOnly?: boolean
      thirdPartyArtBundled?: boolean
      samples?: Array<{ url?: string }>
    }
    const checklist = await fs.readFile(path.join(result.directoryPath, 'references', 'quality-checklist.md'), 'utf8')
    const sourceRowsReadme = await fs.readFile(path.join(result.directoryPath, 'source-rows', 'README.md'), 'utf8')
    const layoutGuideFiles = await fs.readdir(path.join(result.directoryPath, 'references', 'layout-guides'))
    const idleLayoutGuide = await fs.readFile(
      path.join(result.directoryPath, 'references', 'layout-guides', '0-idle-layout.svg'),
      'utf8',
    )
    const reviewLayoutGuide = await fs.readFile(
      path.join(result.directoryPath, 'references', 'layout-guides', '8-review-layout.svg'),
      'utf8',
    )
    const manifest = JSON.parse(await fs.readFile(path.join(result.directoryPath, 'package-template', 'pet.json'), 'utf8')) as {
      spritesheetPath?: string
    }

    assert.equal(brief.contract?.atlas?.width, SPRITE_PET_ATLAS_WIDTH)
    assert.equal(brief.contract?.atlas?.height, SPRITE_PET_ATLAS_HEIGHT)
    assert.equal(brief.contract?.atlas?.cellWidth, SPRITE_PET_CELL_WIDTH)
    assert.equal(brief.contract?.atlas?.cellHeight, SPRITE_PET_CELL_HEIGHT)
    assert.equal(brief.contract?.rowContract?.length, SPRITE_PET_ROW_CONTRACT.length)
    assert.equal(brief.provenance?.privateCodexCodeOrAssetsCopied, false)
    assert.equal(brief.provenance?.thirdPartyArtBundled, false)
    assert.equal(brief.provenance?.sampleLinksOnly, true)
    assert.equal(brief.styleSamples?.sampleLinksOnly, true)
    assert.equal(brief.styleSamples?.thirdPartyArtBundled, false)
    assert.ok(brief.styleSamples?.files?.includes('references/style-samples.md'))
    assert.equal(styleSamplesJson.sampleLinksOnly, true)
    assert.equal(styleSamplesJson.thirdPartyArtBundled, false)
    assert.ok(styleSamplesJson.samples?.some((sample) => sample.url === 'https://codex-pet.org/pets/solid-box/'))
    assert.equal(manifest.spritesheetPath, 'spritesheet.webp')
    assert.match(readme, /Codex desktop pet model/)
    assert.match(readme, /references\/style-samples\.md/)
    assert.match(basePrompt, /not Live2D/)
    assert.match(basePrompt, /192x208/)
    assert.match(wavingPrompt, /no wave marks/)
    assert.match(wavingPrompt, /references\/layout-guides\/3-waving-layout\.svg/)
    assert.match(runningPrompt, /not literal foot-running/)
    assert.match(styleSamplesMarkdown, /Codex Pet Style Samples/)
    assert.match(styleSamplesMarkdown, /https:\/\/codex-pet\.org\/pets\/solid-box\//)
    assert.match(styleSamplesMarkdown, /reference links only/i)
    assert.match(styleSamplesMarkdown, /192x208/)
    assert.match(checklist, /1536x1872/)
    assert.match(checklist, /speed lines/)
    assert.match(sourceRowsReadme, /0-idle\.png/)
    assert.match(sourceRowsReadme, /8-review\.webp/)
    assert.match(sourceRowsReadme, /layout-guides/)
    assert.equal(layoutGuideFiles.length, SPRITE_PET_ROW_CONTRACT.length)
    assert.match(idleLayoutGuide, /width="1152"/)
    assert.match(idleLayoutGuide, /height="208"/)
    assert.match(idleLayoutGuide, /192x208/)
    assert.match(idleLayoutGuide, /construction guide/)
    assert.match(reviewLayoutGuide, /row 8 - review/)
  })
})

test('pet:create-kit CLI creates a user-facing creator folder and refuses overwrite', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'kits')
    const args = [
      '--id',
      'kit-pet',
      '--display-name',
      'Kit Pet',
      '--concept',
      'small green terminal seed mascot',
      '--output-dir',
      outputDir,
    ]

    const { stdout } = await runCreatorKit(args)
    const targetDirectory = path.join(outputDir, 'kit-pet')
    const rowFiles = await fs.readdir(path.join(targetDirectory, 'prompts', 'rows'))
    const layoutGuideFiles = await fs.readdir(path.join(targetDirectory, 'references', 'layout-guides'))

    assert.match(stdout, /Codex pet creator kit created/)
    assert.match(stdout, /style samples: references\/style-samples\.md/)
    assert.equal(rowFiles.length, SPRITE_PET_ROW_CONTRACT.length)
    assert.ok(rowFiles.includes('8-review.md'))
    assert.equal(layoutGuideFiles.length, SPRITE_PET_ROW_CONTRACT.length)
    assert.ok(layoutGuideFiles.includes('8-review-layout.svg'))

    await assert.rejects(
      () => runCreatorKit(args),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /already exists/)
        assert.match(stderr, /--force/)
        return true
      },
    )

    await runCreatorKit([...args, '--force'])
  })
})

test('creator kit assembler builds a valid Codex-compatible sprite pet package', async () => {
  await withTempDirectory(async (directoryPath) => {
    const kitDirectory = path.join(directoryPath, 'kits', 'assemble-pet')
    const result = await createSpritePetCreatorKit({
      targetDirectory: kitDirectory,
      id: 'assemble-pet',
      displayName: 'Assemble Pet',
    })
    await writeAllRowSources(result.directoryPath)

    const inspection = await inspectSpritePetCreatorKit({ kitDirectory: result.directoryPath })
    const contactSheetPath = inspection.contactSheetPath ?? ''
    const contactSheetSvg = await fs.readFile(contactSheetPath, 'utf8')
    const motionPreviewPath = inspection.motionPreviewPath ?? ''
    const motionPreviewHtml = await fs.readFile(motionPreviewPath, 'utf8')

    assert.equal(inspection.ready, true)
    assert.equal(inspection.sourceRowsDirectory, path.join(result.directoryPath, 'source-rows'))
    assert.ok(contactSheetPath.endsWith(path.join('qa', 'source-rows-contact-sheet.svg')))
    assert.ok(motionPreviewPath.endsWith(path.join('qa', 'source-rows-motion-preview.html')))
    assert.match(contactSheetSvg, /source-rows contact sheet/)
    assert.match(contactSheetSvg, /0 idle/)
    assert.match(contactSheetSvg, /8 review/)
    assert.match(contactSheetSvg, /data:image\/png;base64/)
    assert.match(motionPreviewHtml, /source-rows motion preview/)
    assert.match(motionPreviewHtml, /data-row-preview/)
    assert.match(motionPreviewHtml, /requestAnimationFrame/)
    assert.match(motionPreviewHtml, /0 idle/)
    assert.match(motionPreviewHtml, /8 review/)

    const assembled = await assembleSpritePetCreatorKit({
      kitDirectory: result.directoryPath,
      force: true,
    })
    const packageInfo = await readSpritePetPackage(assembled.manifestPath)
    const spritesheet = await fs.readFile(assembled.spritesheetPath)
    const report = JSON.parse(await fs.readFile(assembled.reportPath, 'utf8')) as {
      privateCodexCodeOrAssetsCopied?: boolean
      rows?: unknown[]
    }
    const visualAudit = JSON.parse(await fs.readFile(assembled.visualAuditPath, 'utf8')) as {
      visual?: { codexStyle?: { score?: number } }
    }
    const extractedDirectory = path.join(directoryPath, 'extracted')
    const extractedPackage = await extractSpritePetZipArchive(assembled.archivePath, extractedDirectory)
    const extractedManifest = await readSpritePetPackage(extractedPackage.manifestPath)

    assert.equal(packageInfo.id, 'assemble-pet')
    assert.equal(packageInfo.displayName, 'Assemble Pet')
    assert.ok(assembled.archivePath.endsWith('assemble-pet.codex-pet.zip'))
    assert.equal(extractedManifest.id, 'assemble-pet')
    assert.equal(extractedManifest.displayName, 'Assemble Pet')
    assert.deepEqual(readPngDimensions(spritesheet), {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
    })
    assert.equal(report.privateCodexCodeOrAssetsCopied, false)
    assert.equal(report.rows?.length, SPRITE_PET_ROW_CONTRACT.length)
    assert.equal(typeof visualAudit.visual?.codexStyle?.score, 'number')
  })
})

test('creator kit inspector warns about row strips that need resizing or transparent cleanup', async () => {
  await withTempDirectory(async (directoryPath) => {
    const result = await createSpritePetCreatorKit({
      targetDirectory: path.join(directoryPath, 'kits', 'warning-pet'),
      id: 'warning-pet',
      displayName: 'Warning Pet',
    })
    await writeAllRowSources(result.directoryPath)

    await sharp({
      create: {
        width: 240,
        height: 180,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .toFile(path.join(result.directoryPath, 'source-rows', '0-idle.jpg'))
    await fs.rm(path.join(result.directoryPath, 'source-rows', '0-idle.png'))

    const inspection = await inspectSpritePetCreatorKit({ kitDirectory: result.directoryPath })
    const idle = inspection.rows.find((row) => row.row === 0)

    assert.equal(inspection.ready, true)
    assert.ok(inspection.contactSheetPath)
    assert.ok(inspection.motionPreviewPath)
    assert.ok((inspection.warningCount ?? 0) >= 2)
    assert.match(idle?.warnings?.join('\n') ?? '', /尺寸应为/)
    assert.match(idle?.warnings?.join('\n') ?? '', /透明通道/)

    const contactSheetSvg = await fs.readFile(inspection.contactSheetPath ?? '', 'utf8')
    assert.match(contactSheetSvg, /WARN/)
    assert.match(contactSheetSvg, /JPEG/)
    const motionPreviewHtml = await fs.readFile(inspection.motionPreviewPath ?? '', 'utf8')
    assert.match(motionPreviewHtml, /JPEG/)
    assert.match(motionPreviewHtml, /data-row-preview/)
  })
})

test('pet:assemble-kit CLI reports missing row art and assembles once rows exist', async () => {
  await withTempDirectory(async (directoryPath) => {
    const outputDir = path.join(directoryPath, 'kits')
    await runCreatorKit([
      '--id',
      'cli-assemble',
      '--display-name',
      'CLI Assemble',
      '--output-dir',
      outputDir,
    ])
    const kitDirectory = path.join(outputDir, 'cli-assemble')

    await assert.rejects(
      () => runAssembler([kitDirectory]),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /缺少动作行图片/)
        assert.match(stderr, /0-idle/)
        return true
      },
    )

    await writeAllRowSources(kitDirectory)
    const { stdout } = await runAssembler([kitDirectory])
    assert.match(stdout, /Codex pet package assembled/)
    assert.match(stdout, /cli-assemble\.codex-pet\.zip/)
    await readSpritePetPackage(path.join(kitDirectory, 'final-package', 'pet.json'))
  })
})
