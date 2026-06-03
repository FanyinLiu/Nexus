import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROW_CONTRACT,
  readSpritePetPackage,
} from './spritePetPackage.js'

const CELL_PIXEL_COUNT = SPRITE_PET_CELL_WIDTH * SPRITE_PET_CELL_HEIGHT
const DEFAULT_SPRITE_PET_VISUAL_AUDIT_OPTIONS = {
  chromaRatioLimit: 0.001,
  frameDiffLimit: 4,
  minCoverageLimit: 0.015,
  maxCoverageLimit: 0.68,
  maxBoundsWidthRatio: 0.96,
  maxBoundsHeightRatio: 0.98,
  maxMajorComponentCount: 4,
  maxDetachedComponentAreaRatio: 0.16,
  minMainComponentRatio: 0.72,
  maxEdgePixelRatio: 0.03,
  quantizedColorLimit: 768,
}

function normalizeAuditOptions(options = {}) {
  return {
    ...DEFAULT_SPRITE_PET_VISUAL_AUDIT_OPTIONS,
    ...Object.fromEntries(
      Object.entries(options).filter(([, value]) => Number.isFinite(value)),
    ),
  }
}

async function resolveSpritePetManifestPath(inputPath, cwd = process.cwd()) {
  const targetPath = path.resolve(cwd, inputPath)
  const stats = await fs.stat(targetPath)
  return stats.isDirectory() ? path.join(targetPath, 'pet.json') : targetPath
}

function isNearChromaGreen(r, g, b, a) {
  return (
    a > 0
    && g > 170
    && r < 100
    && b < 150
    && g - r > 80
    && g - b > 50
  )
}

function quantizedColorKey(r, g, b) {
  return `${r >> 4}:${g >> 4}:${b >> 4}`
}

function cellPixelOffset(width, row, column, x, y) {
  const absoluteX = (column * SPRITE_PET_CELL_WIDTH) + x
  const absoluteY = (row * SPRITE_PET_CELL_HEIGHT) + y
  return ((absoluteY * width) + absoluteX) * 4
}

function frameAlphaCoverage({ data, width, row, column }) {
  let covered = 0
  for (let y = 0; y < SPRITE_PET_CELL_HEIGHT; y += 1) {
    for (let x = 0; x < SPRITE_PET_CELL_WIDTH; x += 1) {
      if (data[cellPixelOffset(width, row, column, x, y) + 3] > 0) {
        covered += 1
      }
    }
  }
  return covered / CELL_PIXEL_COUNT
}

function adjacentFrameDiff({ data, width, row, leftColumn, rightColumn }) {
  let total = 0
  let compared = 0

  for (let y = 0; y < SPRITE_PET_CELL_HEIGHT; y += 1) {
    for (let x = 0; x < SPRITE_PET_CELL_WIDTH; x += 1) {
      const leftOffset = cellPixelOffset(width, row, leftColumn, x, y)
      const rightOffset = cellPixelOffset(width, row, rightColumn, x, y)
      const leftAlpha = data[leftOffset + 3]
      const rightAlpha = data[rightOffset + 3]

      if (!leftAlpha && !rightAlpha) {
        continue
      }

      total += Math.abs(data[leftOffset] - data[rightOffset])
        + Math.abs(data[leftOffset + 1] - data[rightOffset + 1])
        + Math.abs(data[leftOffset + 2] - data[rightOffset + 2])
        + (Math.abs(leftAlpha - rightAlpha) * 0.35)
      compared += 1
    }
  }

  return compared ? total / compared : 0
}

function collectFrameComponents(visiblePixels) {
  const visited = new Uint8Array(CELL_PIXEL_COUNT)
  const components = []
  const queue = []

  for (let startIndex = 0; startIndex < CELL_PIXEL_COUNT; startIndex += 1) {
    if (!visiblePixels[startIndex] || visited[startIndex]) {
      continue
    }

    let area = 0
    let minX = SPRITE_PET_CELL_WIDTH
    let minY = SPRITE_PET_CELL_HEIGHT
    let maxX = 0
    let maxY = 0
    queue.length = 0
    queue.push(startIndex)
    visited[startIndex] = 1

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const index = queue[queueIndex]
      const x = index % SPRITE_PET_CELL_WIDTH
      const y = Math.floor(index / SPRITE_PET_CELL_WIDTH)
      area += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue
          }
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= SPRITE_PET_CELL_WIDTH || ny < 0 || ny >= SPRITE_PET_CELL_HEIGHT) {
            continue
          }
          const nextIndex = (ny * SPRITE_PET_CELL_WIDTH) + nx
          if (!visiblePixels[nextIndex] || visited[nextIndex]) {
            continue
          }
          visited[nextIndex] = 1
          queue.push(nextIndex)
        }
      }
    }

    components.push({
      area,
      minX,
      minY,
      maxX,
      maxY,
    })
  }

  return components.sort((left, right) => right.area - left.area)
}

function analyzeFrame({ data, width, row, column }) {
  let visiblePixelCount = 0
  let minX = SPRITE_PET_CELL_WIDTH
  let minY = SPRITE_PET_CELL_HEIGHT
  let maxX = -1
  let maxY = -1
  let edgeVisiblePixels = 0
  const visiblePixels = new Uint8Array(CELL_PIXEL_COUNT)
  const colors = new Set()

  for (let y = 0; y < SPRITE_PET_CELL_HEIGHT; y += 1) {
    for (let x = 0; x < SPRITE_PET_CELL_WIDTH; x += 1) {
      const offset = cellPixelOffset(width, row, column, x, y)
      const alpha = data[offset + 3]
      if (!alpha) {
        continue
      }

      visiblePixelCount += 1
      visiblePixels[(y * SPRITE_PET_CELL_WIDTH) + x] = 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      colors.add(quantizedColorKey(data[offset], data[offset + 1], data[offset + 2]))
      if (x <= 1 || y <= 1 || x >= SPRITE_PET_CELL_WIDTH - 2 || y >= SPRITE_PET_CELL_HEIGHT - 2) {
        edgeVisiblePixels += 1
      }
    }
  }

  const coverage = visiblePixelCount / CELL_PIXEL_COUNT
  const components = collectFrameComponents(visiblePixels)
  const majorComponents = components.filter((component) => component.area >= 24)
  const mainComponent = majorComponents[0] ?? components[0] ?? null
  const majorArea = majorComponents.reduce((total, component) => total + component.area, 0)
  const detachedArea = Math.max(0, majorArea - (mainComponent?.area ?? 0))
  const boundsWidth = visiblePixelCount ? maxX - minX + 1 : 0
  const boundsHeight = visiblePixelCount ? maxY - minY + 1 : 0

  return {
    row,
    column,
    coverage,
    visiblePixels: visiblePixelCount,
    bounds: visiblePixelCount
      ? { minX, minY, maxX, maxY, width: boundsWidth, height: boundsHeight }
      : null,
    boundsWidthRatio: boundsWidth / SPRITE_PET_CELL_WIDTH,
    boundsHeightRatio: boundsHeight / SPRITE_PET_CELL_HEIGHT,
    centerX: visiblePixelCount ? minX + (boundsWidth / 2) : null,
    centerY: visiblePixelCount ? minY + (boundsHeight / 2) : null,
    edgeVisiblePixels,
    edgePixelRatio: visiblePixelCount ? edgeVisiblePixels / visiblePixelCount : 0,
    quantizedColorCount: colors.size,
    majorComponentCount: majorComponents.length,
    mainComponentRatio: visiblePixelCount ? (mainComponent?.area ?? 0) / visiblePixelCount : 0,
    detachedComponentAreaRatio: visiblePixelCount ? detachedArea / visiblePixelCount : 0,
  }
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
}

function max(values) {
  return values.length ? Math.max(...values) : 0
}

function auditPixels({ data, width, options = {} }) {
  const thresholds = normalizeAuditOptions(options)
  let visiblePixels = 0
  let chromaPixels = 0
  let unusedCellVisiblePixels = 0
  const atlasColors = new Set()
  const rowResults = []
  const warnings = []

  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]
    if (!alpha) {
      continue
    }
    visiblePixels += 1
    atlasColors.add(quantizedColorKey(data[offset], data[offset + 1], data[offset + 2]))
    if (isNearChromaGreen(data[offset], data[offset + 1], data[offset + 2], alpha)) {
      chromaPixels += 1
    }
  }

  const chromaRatio = visiblePixels ? chromaPixels / visiblePixels : 0
  if (chromaRatio > thresholds.chromaRatioLimit) {
    warnings.push(
      `near chroma-key green pixels ${chromaRatio.toFixed(4)} exceed limit ${thresholds.chromaRatioLimit}`,
    )
  }

  if (atlasColors.size > thresholds.quantizedColorLimit) {
    warnings.push(
      `quantized color count ${atlasColors.size} exceeds Codex-style limit ${thresholds.quantizedColorLimit}`,
    )
  }

  for (const rowContract of SPRITE_PET_ROW_CONTRACT) {
    const frameResults = []
    const coverages = []
    const adjacentDiffs = []

    for (let column = 0; column < rowContract.frameCount; column += 1) {
      const frame = analyzeFrame({ data, width, row: rowContract.row, column })
      frameResults.push(frame)
      coverages.push(frame.coverage)
      if (column > 0) {
        adjacentDiffs.push(adjacentFrameDiff({
          data,
          width,
          row: rowContract.row,
          leftColumn: column - 1,
          rightColumn: column,
        }))
      }
    }

    for (let column = rowContract.frameCount; column < SPRITE_PET_COLUMNS; column += 1) {
      unusedCellVisiblePixels += Math.round(
        frameAlphaCoverage({ data, width, row: rowContract.row, column }) * CELL_PIXEL_COUNT,
      )
    }

    const minCoverage = Math.min(...coverages)
    const maxCoverage = Math.max(...coverages)
    const averageAdjacentDiff = average(adjacentDiffs)
    const maxBoundsWidthRatio = max(frameResults.map((frame) => frame.boundsWidthRatio))
    const maxBoundsHeightRatio = max(frameResults.map((frame) => frame.boundsHeightRatio))
    const maxEdgePixelRatio = max(frameResults.map((frame) => frame.edgePixelRatio))
    const maxMajorComponentCount = max(frameResults.map((frame) => frame.majorComponentCount))
    const maxDetachedComponentAreaRatio = max(frameResults.map((frame) => frame.detachedComponentAreaRatio))
    const averageMainComponentRatio = average(frameResults.map((frame) => frame.mainComponentRatio))
    const maxQuantizedColorCount = max(frameResults.map((frame) => frame.quantizedColorCount))

    if (minCoverage < thresholds.minCoverageLimit) {
      warnings.push(`row ${rowContract.row} ${rowContract.state} has an almost empty frame`)
    }
    if (maxCoverage > thresholds.maxCoverageLimit) {
      warnings.push(
        `row ${rowContract.row} ${rowContract.state} fills too much of a 192x208 cell (${(maxCoverage * 100).toFixed(1)}%)`,
      )
    }
    if (rowContract.frameCount > 1 && averageAdjacentDiff < thresholds.frameDiffLimit) {
      warnings.push(
        `row ${rowContract.row} ${rowContract.state} frame motion is weak (${averageAdjacentDiff.toFixed(2)})`,
      )
    }
    if (maxBoundsWidthRatio > thresholds.maxBoundsWidthRatio || maxBoundsHeightRatio > thresholds.maxBoundsHeightRatio) {
      warnings.push(
        `row ${rowContract.row} ${rowContract.state} sprite nearly fills the cell bounds (${(maxBoundsWidthRatio * 100).toFixed(0)}% x ${(maxBoundsHeightRatio * 100).toFixed(0)}%)`,
      )
    }
    if (maxEdgePixelRatio > thresholds.maxEdgePixelRatio) {
      warnings.push(
        `row ${rowContract.row} ${rowContract.state} has visible pixels stuck to the cell edge (${(maxEdgePixelRatio * 100).toFixed(1)}%)`,
      )
    }
    if (
      maxMajorComponentCount > thresholds.maxMajorComponentCount
      || maxDetachedComponentAreaRatio > thresholds.maxDetachedComponentAreaRatio
    ) {
      warnings.push(
        `row ${rowContract.row} ${rowContract.state} may contain detached effects or separate sprite parts`,
      )
    }
    if (averageMainComponentRatio > 0 && averageMainComponentRatio < thresholds.minMainComponentRatio) {
      warnings.push(
        `row ${rowContract.row} ${rowContract.state} main silhouette is fragmented (${(averageMainComponentRatio * 100).toFixed(0)}% in main component)`,
      )
    }

    rowResults.push({
      row: rowContract.row,
      state: rowContract.state,
      frameCount: rowContract.frameCount,
      minCoverage,
      maxCoverage,
      averageAdjacentDiff,
      maxBoundsWidthRatio,
      maxBoundsHeightRatio,
      maxEdgePixelRatio,
      maxMajorComponentCount,
      maxDetachedComponentAreaRatio,
      averageMainComponentRatio,
      maxQuantizedColorCount,
    })
  }

  if (unusedCellVisiblePixels > 0) {
    warnings.push(`unused atlas cells contain ${unusedCellVisiblePixels} visible pixel(s)`)
  }

  const warningText = warnings.join('\n')
  const codexStyle = {
    score: Math.max(0, 100 - (warnings.length * 8)),
    checks: {
      transparentBackground: chromaRatio <= thresholds.chromaRatioLimit && unusedCellVisiblePixels === 0,
      readableMotion: !/frame motion is weak/u.test(warningText),
      compactSilhouette: !/fills too much|nearly fills|touching the cell edge/u.test(warningText),
      connectedSprite: !/detached effects|fragmented/u.test(warningText),
      limitedPalette: atlasColors.size <= thresholds.quantizedColorLimit,
    },
  }

  return {
    visiblePixels,
    chromaPixels,
    chromaRatio,
    quantizedColorCount: atlasColors.size,
    unusedCellVisiblePixels,
    rows: rowResults,
    warnings,
    codexStyle,
    ok: warnings.length === 0,
  }
}

async function auditSpritePetPackage(manifestPath, options = {}) {
  const spritePetPackage = await readSpritePetPackage(manifestPath)
  const raw = await sharp(spritePetPackage.sourceSpritePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const visual = auditPixels({
    data: raw.data,
    width: raw.info.width,
    options,
  })

  return {
    package: {
      id: spritePetPackage.id,
      displayName: spritePetPackage.displayName,
      manifestPath,
      spritesheetPath: spritePetPackage.sourceSpritePath,
    },
    visual,
    thresholds: normalizeAuditOptions(options),
  }
}

export {
  DEFAULT_SPRITE_PET_VISUAL_AUDIT_OPTIONS,
  normalizeAuditOptions,
  resolveSpritePetManifestPath,
  auditPixels,
  auditSpritePetPackage,
}
