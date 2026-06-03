import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_ROW_CONTRACT,
  formatSpritePetDisplayName,
  readJsonFile,
  readSpritePetPackage,
  writeSpritePetZipArchive,
} from './spritePetPackage.js'
import {
  slugifySpritePetId,
} from './spritePetCreatorKit.js'
import {
  auditSpritePetPackage,
} from './spritePetVisualAudit.js'

const DEFAULT_PACKAGE_DIRNAME = 'final-package'
const DEFAULT_CREATOR_KIT_QA_DIRNAME = 'qa'
const DEFAULT_CREATOR_KIT_CONTACT_SHEET_FILENAME = 'source-rows-contact-sheet.svg'
const DEFAULT_CREATOR_KIT_MOTION_PREVIEW_FILENAME = 'source-rows-motion-preview.html'
const ROW_SOURCE_DIRECTORIES = [
  'source-rows',
  'rows',
  path.join('art', 'rows'),
]
const ROW_SOURCE_EXTENSIONS = [
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
]
const IMAGE_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function getImageMimeType(sourcePath) {
  return IMAGE_MIME_TYPES[path.extname(sourcePath).toLowerCase()] || 'application/octet-stream'
}

function candidateNamesForRow(row) {
  return [
    `${row.row}-${row.state}`,
    `${row.state}`,
    `row-${row.row}`,
    `row-${row.row}-${row.state}`,
  ]
}

async function findRowSourcePath(kitDirectory, row) {
  for (const directory of ROW_SOURCE_DIRECTORIES) {
    for (const name of candidateNamesForRow(row)) {
      for (const extension of ROW_SOURCE_EXTENSIONS) {
        const candidatePath = path.join(kitDirectory, directory, `${name}${extension}`)
        if (await pathExists(candidatePath)) {
          return candidatePath
        }
      }
    }
  }

  return ''
}

async function readCreatorBrief(kitDirectory) {
  const briefPath = path.join(kitDirectory, 'creator-brief.json')
  if (await pathExists(briefPath)) {
    return readJsonFile(briefPath)
  }

  return {}
}

async function readManifestTemplate(kitDirectory) {
  const manifestPath = path.join(kitDirectory, 'package-template', 'pet.json')
  if (await pathExists(manifestPath)) {
    return readJsonFile(manifestPath)
  }

  return {}
}

function normalizePackageMetadata(brief, manifestTemplate, outputDirectory) {
  const id = slugifySpritePetId(manifestTemplate.id || brief.id || path.basename(outputDirectory))
  const displayName = normalizeText(manifestTemplate.displayName || brief.displayName || formatSpritePetDisplayName(id))
  const description = normalizeText(
    manifestTemplate.description
    || brief.description
    || `Assembled Codex-compatible sprite pet package for ${displayName}.`,
  )

  return {
    id,
    displayName,
    description,
  }
}

async function renderRowStrip(row, sourcePath) {
  const targetWidth = row.frameCount * SPRITE_PET_CELL_WIDTH
  const source = sharp(sourcePath, { animated: false }).ensureAlpha()
  const metadata = await source.metadata()

  if (!metadata.width || !metadata.height) {
    throw new Error(`无法读取行图片尺寸：${sourcePath}`)
  }

  return source
    .resize({
      width: targetWidth,
      height: SPRITE_PET_CELL_HEIGHT,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
}

async function collectRowSources(kitDirectory) {
  const rows = []
  const missing = []

  for (const row of SPRITE_PET_ROW_CONTRACT) {
    const sourcePath = await findRowSourcePath(kitDirectory, row)
    if (!sourcePath) {
      missing.push(`${row.row}-${row.state}`)
      continue
    }

    rows.push({
      ...row,
      sourcePath,
    })
  }

  if (missing.length) {
    throw new Error(`制作包缺少动作行图片：${missing.join(', ')}。请放到 source-rows/ 后再组装。`)
  }

  return rows
}

async function inspectRowSource(kitDirectory, row) {
  const sourcePath = await findRowSourcePath(kitDirectory, row)
  const expectedWidth = row.frameCount * SPRITE_PET_CELL_WIDTH
  const base = {
    row: row.row,
    state: row.state,
    frameCount: row.frameCount,
    expectedWidth,
    expectedHeight: SPRITE_PET_CELL_HEIGHT,
    sourcePath,
    ready: Boolean(sourcePath),
    warnings: [],
  }

  if (!sourcePath) {
    return base
  }

  try {
    const metadata = await sharp(sourcePath, { animated: false }).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    const warnings = []
    if (width !== expectedWidth || height !== SPRITE_PET_CELL_HEIGHT) {
      warnings.push(`尺寸应为 ${expectedWidth}x${SPRITE_PET_CELL_HEIGHT}，当前为 ${width || '?'}x${height || '?'}，组装时会被缩放。`)
    }
    if (!metadata.hasAlpha) {
      warnings.push('图片没有透明通道，背景可能需要先清理成透明。')
    }
    if (metadata.format === 'jpeg') {
      warnings.push('JPEG 不支持透明背景，建议改用 PNG 或 WebP。')
    }

    return {
      ...base,
      width,
      height,
      format: metadata.format ?? '',
      warnings,
    }
  } catch (error) {
    return {
      ...base,
      ready: false,
      error: error?.message ?? String(error),
    }
  }
}

async function inspectSpritePetCreatorKit({ kitDirectory } = {}) {
  const rawKitDirectory = String(kitDirectory ?? '').trim()
  if (!rawKitDirectory) {
    throw new Error('请选择存在的 Codex 宠物制作包目录。')
  }

  const resolvedKitDirectory = path.resolve(rawKitDirectory)
  if (!(await pathExists(resolvedKitDirectory))) {
    throw new Error('请选择存在的 Codex 宠物制作包目录。')
  }

  const [brief, manifestTemplate, rows] = await Promise.all([
    readCreatorBrief(resolvedKitDirectory),
    readManifestTemplate(resolvedKitDirectory),
    Promise.all(SPRITE_PET_ROW_CONTRACT.map((row) => inspectRowSource(resolvedKitDirectory, row))),
  ])
  const metadata = normalizePackageMetadata(brief, manifestTemplate, resolvedKitDirectory)
  const readyRows = rows.filter((row) => row.ready)
  const missingRows = rows.filter((row) => !row.ready)
  const warningCount = rows.reduce((total, row) => total + (row.warnings?.length ?? 0), 0)

  const inspection = {
    id: metadata.id,
    displayName: metadata.displayName,
    kitDirectory: resolvedKitDirectory,
    sourceRowsDirectory: path.join(resolvedKitDirectory, 'source-rows'),
    ready: missingRows.length === 0,
    readyCount: readyRows.length,
    missingCount: missingRows.length,
    warningCount,
    rows,
    message: missingRows.length === 0
      ? warningCount
        ? `制作包 ${metadata.displayName} 已补齐 9 行动作图，但有 ${warningCount} 条尺寸或透明度提醒。`
        : `制作包 ${metadata.displayName} 已补齐 9 行动作图，可以组装。`
      : `制作包 ${metadata.displayName} 已补齐 ${readyRows.length}/9 行，还缺：${missingRows.map((row) => `${row.row}-${row.state}`).join(', ')}`,
  }

  if (readyRows.length > 0) {
    inspection.contactSheetPath = await writeCreatorKitContactSheet(inspection)
    inspection.motionPreviewPath = await writeCreatorKitMotionPreview(inspection)
  }

  return inspection
}

async function rowSourceToDataUri(row) {
  const buffer = await fs.readFile(row.sourcePath)
  return `data:${getImageMimeType(row.sourcePath)};base64,${buffer.toString('base64')}`
}

async function buildCreatorKitContactSheetSvg(inspection) {
  const scale = 0.36
  const labelWidth = 150
  const top = 72
  const right = 28
  const bottom = 36
  const frameWidth = SPRITE_PET_CELL_WIDTH * scale
  const frameHeight = SPRITE_PET_CELL_HEIGHT * scale
  const atlasWidth = SPRITE_PET_ATLAS_WIDTH * scale
  const atlasHeight = SPRITE_PET_ATLAS_HEIGHT * scale
  const width = Math.ceil(labelWidth + atlasWidth + right)
  const height = Math.ceil(top + atlasHeight + bottom)
  const escapedName = escapeXml(inspection.displayName)
  const title = `${escapedName} source-rows contact sheet`
  const rowImages = new Map()

  await Promise.all(inspection.rows.map(async (row) => {
    if (!row.ready || !row.sourcePath) {
      return
    }

    try {
      rowImages.set(row.row, await rowSourceToDataUri(row))
    } catch {
      rowImages.set(row.row, '')
    }
  }))

  const rowMarkup = inspection.rows.map((row) => {
    const y = top + (row.row * frameHeight)
    const sourceUri = rowImages.get(row.row) || ''
    const stripWidth = row.expectedWidth * scale
    const warnings = row.warnings?.length ? `WARN ${row.warnings.length}: ${row.warnings.join(' ')}` : ''
    const label = `${row.row} ${row.state} (${row.frameCount}f)`
    const status = row.ready ? warnings || 'ready' : 'missing'

    return [
      `<text class="row-label" x="16" y="${(y + 27).toFixed(2)}">${escapeXml(label)}</text>`,
      `<text class="${row.ready ? warnings ? 'row-warning' : 'row-ok' : 'row-missing'}" x="16" y="${(y + 47).toFixed(2)}">${escapeXml(status)}</text>`,
      sourceUri
        ? `<image x="${labelWidth}" y="${y.toFixed(2)}" width="${stripWidth.toFixed(2)}" height="${frameHeight.toFixed(2)}" preserveAspectRatio="none" href="${sourceUri}"/>`
        : `<rect class="missing-fill" x="${labelWidth}" y="${y.toFixed(2)}" width="${atlasWidth.toFixed(2)}" height="${frameHeight.toFixed(2)}"/>`,
    ].join('\n')
  }).join('\n')

  const gridMarkup = [
    ...Array.from({ length: 9 }, (_, rowIndex) => {
      const y = top + (rowIndex * frameHeight)
      return `<line class="grid-row" x1="${labelWidth}" y1="${y.toFixed(2)}" x2="${(labelWidth + atlasWidth).toFixed(2)}" y2="${y.toFixed(2)}"/>`
    }),
    `<line class="grid-row" x1="${labelWidth}" y1="${(top + atlasHeight).toFixed(2)}" x2="${(labelWidth + atlasWidth).toFixed(2)}" y2="${(top + atlasHeight).toFixed(2)}"/>`,
    ...Array.from({ length: 8 }, (_, columnIndex) => {
      const x = labelWidth + (columnIndex * frameWidth)
      return `<line class="grid-column" x1="${x.toFixed(2)}" y1="${top}" x2="${x.toFixed(2)}" y2="${(top + atlasHeight).toFixed(2)}"/>`
    }),
    `<line class="grid-column" x1="${(labelWidth + atlasWidth).toFixed(2)}" y1="${top}" x2="${(labelWidth + atlasWidth).toFixed(2)}" y2="${(top + atlasHeight).toFixed(2)}"/>`,
  ].join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
  <desc>Clean-room Codex-compatible source row QA contact sheet for ${escapedName}. Expected atlas ${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT}; cell ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT}.</desc>
  <style>
    svg { background: #12151c; color: #edf2ff; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; }
    .heading { fill: #edf2ff; font-size: 20px; font-weight: 700; }
    .subhead { fill: #9ca8bd; font-size: 12px; }
    .row-label { fill: #d8deeb; font-size: 11px; font-weight: 700; }
    .row-ok { fill: #8ee6aa; font-size: 10px; }
    .row-warning { fill: #ffdc7d; font-size: 10px; }
    .row-missing { fill: #ffab8f; font-size: 10px; }
    .missing-fill { fill: rgba(255, 255, 255, 0.045); }
    .grid-row, .grid-column { stroke: rgba(255, 255, 255, 0.18); stroke-width: 1; shape-rendering: crispEdges; }
  </style>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#12151c"/>
  <text class="heading" x="16" y="28">${escapedName}</text>
  <text class="subhead" x="16" y="50">source-rows contact sheet · ${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT} · ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT} cells · 8x9 Codex pet contract</text>
  ${rowMarkup}
  ${gridMarkup}
</svg>
`
}

async function writeCreatorKitContactSheet(inspection) {
  const qaDirectory = path.join(inspection.kitDirectory, DEFAULT_CREATOR_KIT_QA_DIRNAME)
  const contactSheetPath = path.join(qaDirectory, DEFAULT_CREATOR_KIT_CONTACT_SHEET_FILENAME)

  await fs.mkdir(qaDirectory, { recursive: true })
  await fs.writeFile(contactSheetPath, await buildCreatorKitContactSheetSvg(inspection), 'utf8')

  return contactSheetPath
}

async function buildCreatorKitMotionPreviewHtml(inspection) {
  const escapedName = escapeXml(inspection.displayName)
  const rowImages = new Map()

  await Promise.all(inspection.rows.map(async (row) => {
    if (!row.ready || !row.sourcePath) {
      return
    }

    try {
      rowImages.set(row.row, await rowSourceToDataUri(row))
    } catch {
      rowImages.set(row.row, '')
    }
  }))

  const rowsMarkup = inspection.rows.map((row) => {
    const sourceUri = rowImages.get(row.row) || ''
    const warnings = row.warnings?.length ? row.warnings.join(' ') : ''
    const expectedSize = `${row.expectedWidth}x${row.expectedHeight}`
    const actualSize = row.width && row.height ? `${row.width}x${row.height}` : ''
    const durations = SPRITE_PET_ROW_CONTRACT.find((contractRow) => contractRow.row === row.row)?.durationsMs ?? []
    const backgroundSize = `${row.frameCount * 100}% 100%`

    return `<article class="row-card ${row.ready ? warnings ? 'is-warning' : 'is-ready' : 'is-missing'}">
      <div class="row-meta">
        <strong>${row.row} ${escapeXml(row.state)}</strong>
        <span>${row.frameCount} frames · expected ${escapeXml(expectedSize)}${actualSize ? ` · current ${escapeXml(actualSize)}` : ''}</span>
        ${warnings ? `<p>${escapeXml(warnings)}</p>` : ''}
      </div>
      ${sourceUri
        ? `<div class="motion-frame" data-row-preview data-frame-count="${row.frameCount}" data-durations="${escapeXml(JSON.stringify(durations))}" style="background-image: url('${sourceUri}'); background-size: ${backgroundSize};"></div>`
        : '<div class="motion-frame is-empty">missing</div>'}
    </article>`
  }).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedName} source rows motion preview</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      background: #12151c;
      color: #edf2ff;
    }
    body {
      margin: 0;
      padding: 24px;
      background: #12151c;
    }
    header {
      display: grid;
      gap: 6px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
    }
    header p {
      margin: 0;
      color: #9ca8bd;
      font-size: 13px;
    }
    main {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .row-card {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.04);
    }
    .row-card.is-warning {
      border-color: rgba(255, 220, 125, 0.28);
      background: rgba(255, 220, 125, 0.08);
    }
    .row-card.is-missing {
      opacity: 0.68;
    }
    .motion-frame {
      width: 96px;
      height: 104px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      background-repeat: no-repeat;
      background-position: 0% 0%;
      image-rendering: pixelated;
      background-color: rgba(0, 0, 0, 0.16);
    }
    .motion-frame.is-empty {
      display: grid;
      place-items: center;
      color: #ffab8f;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .row-meta {
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    .row-meta strong {
      font-size: 14px;
    }
    .row-meta span,
    .row-meta p {
      margin: 0;
      color: #9ca8bd;
      font-size: 12px;
      line-height: 1.35;
    }
    .row-meta p {
      color: #ffdc7d;
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapedName}</h1>
    <p>source-rows motion preview · each panel plays the row with Codex-compatible frame timing</p>
  </header>
  <main>
    ${rowsMarkup}
  </main>
  <script>
    const previews = Array.from(document.querySelectorAll('[data-row-preview]'));
    const rows = previews.map((element) => {
      const durations = JSON.parse(element.dataset.durations || '[]');
      const frameCount = Number(element.dataset.frameCount || durations.length || 1);
      const total = durations.reduce((sum, duration) => sum + Number(duration || 0), 0) || 1000;
      return { element, durations, frameCount, total };
    });
    function frameAt(row, elapsed) {
      let cursor = elapsed % row.total;
      for (let index = 0; index < row.frameCount; index += 1) {
        cursor -= Number(row.durations[index] || 120);
        if (cursor <= 0) return index;
      }
      return Math.max(0, row.frameCount - 1);
    }
    function tick(timestamp) {
      for (const row of rows) {
        const frame = frameAt(row, timestamp);
        const position = row.frameCount > 1 ? (frame / (row.frameCount - 1)) * 100 : 0;
        row.element.style.backgroundPosition = position + '% 0%';
      }
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  </script>
</body>
</html>
`
}

async function writeCreatorKitMotionPreview(inspection) {
  const qaDirectory = path.join(inspection.kitDirectory, DEFAULT_CREATOR_KIT_QA_DIRNAME)
  const motionPreviewPath = path.join(qaDirectory, DEFAULT_CREATOR_KIT_MOTION_PREVIEW_FILENAME)

  await fs.mkdir(qaDirectory, { recursive: true })
  await fs.writeFile(motionPreviewPath, await buildCreatorKitMotionPreviewHtml(inspection), 'utf8')

  return motionPreviewPath
}

async function buildAtlas(rows) {
  const composites = []

  for (const row of rows) {
    composites.push({
      input: await renderRowStrip(row, row.sourcePath),
      left: 0,
      top: row.row * SPRITE_PET_CELL_HEIGHT,
    })
  }

  return sharp({
    create: {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()
}

async function assembleSpritePetCreatorKit({
  kitDirectory,
  outputDirectory = '',
  force = false,
} = {}) {
  const rawKitDirectory = String(kitDirectory ?? '').trim()
  if (!rawKitDirectory) {
    throw new Error('请选择存在的 Codex 宠物制作包目录。')
  }

  const resolvedKitDirectory = path.resolve(rawKitDirectory)
  if (!(await pathExists(resolvedKitDirectory))) {
    throw new Error('请选择存在的 Codex 宠物制作包目录。')
  }

  const resolvedOutputDirectory = path.resolve(
    outputDirectory
    || path.join(resolvedKitDirectory, DEFAULT_PACKAGE_DIRNAME),
  )

  if (await pathExists(resolvedOutputDirectory)) {
    if (!force) {
      throw new Error(`目标宠物包已存在：${resolvedOutputDirectory}。请使用 --force 覆盖。`)
    }
    await fs.rm(resolvedOutputDirectory, { recursive: true, force: true })
  }

  const [brief, manifestTemplate, rows] = await Promise.all([
    readCreatorBrief(resolvedKitDirectory),
    readManifestTemplate(resolvedKitDirectory),
    collectRowSources(resolvedKitDirectory),
  ])
  const metadata = normalizePackageMetadata(brief, manifestTemplate, resolvedOutputDirectory)
  const spritesheetPath = path.join(resolvedOutputDirectory, 'spritesheet.png')
  const manifestPath = path.join(resolvedOutputDirectory, 'pet.json')
  const reportPath = path.join(resolvedOutputDirectory, 'assembly-report.json')
  const visualAuditPath = path.join(resolvedOutputDirectory, 'visual-audit.json')
  const archivePath = path.join(resolvedKitDirectory, `${metadata.id}.codex-pet.zip`)
  const manifest = {
    id: metadata.id,
    displayName: metadata.displayName,
    description: metadata.description,
    spritesheetPath: 'spritesheet.png',
  }
  const report = {
    kitDirectory: resolvedKitDirectory,
    outputDirectory: resolvedOutputDirectory,
    privateCodexCodeOrAssetsCopied: false,
    privateCodexBuiltInAssetsCopied: false,
    atlas: {
      width: SPRITE_PET_ATLAS_WIDTH,
      height: SPRITE_PET_ATLAS_HEIGHT,
      cellWidth: SPRITE_PET_CELL_WIDTH,
      cellHeight: SPRITE_PET_CELL_HEIGHT,
    },
    rows: rows.map((row) => ({
      row: row.row,
      state: row.state,
      frameCount: row.frameCount,
      sourcePath: row.sourcePath,
    })),
    outputs: {
      archivePath,
      visualAuditPath,
    },
  }

  await fs.mkdir(resolvedOutputDirectory, { recursive: true })
  await fs.writeFile(spritesheetPath, await buildAtlas(rows))
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await readSpritePetPackage(manifestPath)
  const visualAudit = await auditSpritePetPackage(manifestPath)
  await fs.writeFile(visualAuditPath, `${JSON.stringify(visualAudit, null, 2)}\n`, 'utf8')
  await writeSpritePetZipArchive({
    archivePath,
    files: [
      { path: manifestPath, name: 'pet.json' },
      { path: spritesheetPath, name: 'spritesheet.png' },
      { path: reportPath, name: 'assembly-report.json' },
      { path: visualAuditPath, name: 'visual-audit.json' },
    ],
  })

  return {
    id: metadata.id,
    displayName: metadata.displayName,
    packageDirectory: resolvedOutputDirectory,
    manifestPath,
    spritesheetPath,
    reportPath,
    visualAuditPath,
    archivePath,
    visualWarnings: visualAudit.visual.warnings,
    message: visualAudit.visual.warnings.length
      ? `已组装 ${metadata.displayName} 的 Codex 宠物包：${resolvedOutputDirectory}。视觉审计有 ${visualAudit.visual.warnings.length} 条提醒。`
      : `已组装 ${metadata.displayName} 的 Codex 宠物包：${resolvedOutputDirectory}。视觉审计通过。`,
  }
}

export {
  DEFAULT_PACKAGE_DIRNAME,
  inspectSpritePetCreatorKit,
  assembleSpritePetCreatorKit,
}
