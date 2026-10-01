/**
 * Portrait generator stage A: cheap heuristic rejection of a user-picked image
 * before any expensive cutout / landmark work runs.
 *
 * Checks run cheapest-first: file size, header decode, format allowlist,
 * animation, oriented dimensions, aspect ratio, then one full decode feeding
 * the sharpness and plain-background metrics. Results carry a stable reason
 * code and a renderer messageKey only — no prose, no paths, no pixels — so
 * they are safe to audit. The image is read locally and never forwarded to
 * chat, desktop context, or any model prompt. Small images are never
 * upscaled. Thresholds start from the round-1/2 spikes and are provisional
 * until the round-3 spike recalibrates them.
 */

import fs from 'node:fs/promises'
import sharp from 'sharp'

import {
  PORTRAIT_IMAGE_GATE_MESSAGE_KEYS,
  PORTRAIT_IMAGE_GATE_REASONS,
} from '../../../shared/portraitImageGate.js'

const MEBIBYTE = 1024 * 1024

/**
 * Stage-A thresholds. Values are product decisions, not tuning knobs, so they
 * live in one frozen object that tests and copy params both read.
 */
export const PORTRAIT_IMAGE_GATE_LIMITS = Object.freeze({
  /** Refuse to load larger files into memory at all. */
  maxFileBytes: 32 * MEBIBYTE,
  /** Decompression-bomb guard, checked from the header before decoding. */
  maxInputPixels: 64_000_000,
  /** Narrower images cannot carry face / eye detail for layering. */
  minWidthPx: 512,
  /** Long side / short side above this is a strip or banner, not a portrait. */
  maxAspectRatio: 2.5,
  /** Analysis raster long side; larger images shrink, smaller never grow. */
  analysisLongSidePx: 1024,
  /** Laplacian variance below this reads as a blurry, soft-edged image. */
  minLaplacianVariance: 50,
  /** Fraction of strong-gradient pixels below this means no clean outlines. */
  minEdgeDensity: 0.005,
  /** L1 Sobel magnitude counted as a strong edge (Canny's upper threshold). */
  edgeGradientThreshold: 200,
  /** Border band thickness, as a fraction of the analysis raster's short side. */
  borderBandFraction: 0.02,
  /** Minimum border band thickness in analysis-raster pixels. */
  minBorderBandPx: 4,
  /** Alpha below this counts as a transparent background pixel. */
  transparentAlphaMax: 16,
  /** Max per-channel distance from the dominant border colour to count as plain. */
  borderColorTolerance: 20,
  /** Share of border pixels that must be transparent or the dominant colour. */
  minPlainBorderRatio: 0.8,
})

/** Formats the generator accepts; matches the existing pet image picker. */
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp'])

/** File-dialog extensions for the accepted formats. */
export const PORTRAIT_IMAGE_GATE_FILE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp'])

function buildResult(reasonCode, metrics, messageParams = {}) {
  return {
    accepted: reasonCode === null,
    reasonCode,
    messageKey: PORTRAIT_IMAGE_GATE_MESSAGE_KEYS[reasonCode ?? 'accepted'],
    messageParams,
    metrics,
  }
}

async function readSourceBytes(source) {
  if (Buffer.isBuffer(source?.buffer)) {
    return { bytes: source.buffer, byteLength: source.buffer.length }
  }
  const filePath = typeof source?.filePath === 'string' ? source.filePath : ''
  if (!filePath) return { reasonCode: PORTRAIT_IMAGE_GATE_REASONS.UNREADABLE }

  let stats
  try {
    stats = await fs.stat(filePath)
  } catch {
    return { reasonCode: PORTRAIT_IMAGE_GATE_REASONS.UNREADABLE }
  }
  if (!stats.isFile()) return { reasonCode: PORTRAIT_IMAGE_GATE_REASONS.UNREADABLE }
  // Size is checked before reading so an oversized file never enters memory.
  if (stats.size > PORTRAIT_IMAGE_GATE_LIMITS.maxFileBytes) {
    return { reasonCode: PORTRAIT_IMAGE_GATE_REASONS.FILE_TOO_LARGE, byteLength: stats.size }
  }
  try {
    const bytes = await fs.readFile(filePath)
    return { bytes, byteLength: bytes.length }
  } catch {
    return { reasonCode: PORTRAIT_IMAGE_GATE_REASONS.UNREADABLE }
  }
}

/**
 * Laplacian variance and strong-edge density of an 8-bit grayscale buffer.
 * The Laplacian is the 4-neighbour kernel OpenCV uses for ksize=1; edge
 * density thresholds the L1 Sobel magnitude without non-maximum suppression,
 * which is slightly more lenient than the spike's Canny ratio.
 * @param {Uint8Array} gray
 * @param {number} width
 * @param {number} height
 * @returns {{ laplacianVariance: number, edgeDensity: number }}
 */
export function measurePortraitImageSharpness(gray, width, height) {
  if (width < 3 || height < 3) return { laplacianVariance: 0, edgeDensity: 0 }
  const threshold = PORTRAIT_IMAGE_GATE_LIMITS.edgeGradientThreshold
  let count = 0
  let sum = 0
  let sumSquares = 0
  let strongEdges = 0
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x
      const up = gray[index - width]
      const down = gray[index + width]
      const left = gray[index - 1]
      const right = gray[index + 1]
      const laplacian = up + down + left + right - 4 * gray[index]
      sum += laplacian
      sumSquares += laplacian * laplacian
      count += 1

      const upLeft = gray[index - width - 1]
      const upRight = gray[index - width + 1]
      const downLeft = gray[index + width - 1]
      const downRight = gray[index + width + 1]
      const gx = (upRight + 2 * right + downRight) - (upLeft + 2 * left + downLeft)
      const gy = (downLeft + 2 * down + downRight) - (upLeft + 2 * up + upRight)
      if (Math.abs(gx) + Math.abs(gy) >= threshold) strongEdges += 1
    }
  }
  const mean = sum / count
  return {
    laplacianVariance: Math.max(0, sumSquares / count - mean * mean),
    edgeDensity: strongEdges / count,
  }
}

/**
 * Share of the image border that is transparent or one dominant colour.
 * A plain or transparent background dominates the border band even where the
 * character touches an edge; photos, patterns, speed lines, and scenery split
 * it across many colours. The dominant colour is the mode of 5-bit-per-channel
 * bins over opaque border pixels.
 * @param {Uint8Array} rgba RGBA raster
 * @param {number} width
 * @param {number} height
 * @returns {{ plainBorderRatio: number, transparentBorderRatio: number }}
 */
export function measurePortraitImageBackground(rgba, width, height) {
  const limits = PORTRAIT_IMAGE_GATE_LIMITS
  const band = Math.max(
    limits.minBorderBandPx,
    Math.round(Math.min(width, height) * limits.borderBandFraction),
  )
  const isBorder = (x, y) => x < band || y < band || x >= width - band || y >= height - band
  const bins = new Map()
  let total = 0
  let transparent = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isBorder(x, y)) continue
      const offset = (y * width + x) * 4
      total += 1
      if (rgba[offset + 3] < limits.transparentAlphaMax) {
        transparent += 1
        continue
      }
      const bin = ((rgba[offset] >> 3) << 10) | ((rgba[offset + 1] >> 3) << 5) | (rgba[offset + 2] >> 3)
      bins.set(bin, (bins.get(bin) ?? 0) + 1)
    }
  }
  if (total === 0) return { plainBorderRatio: 0, transparentBorderRatio: 0 }

  let dominantBin = -1
  let dominantCount = 0
  for (const [bin, count] of bins) {
    if (count > dominantCount) {
      dominantBin = bin
      dominantCount = count
    }
  }
  let nearDominant = 0
  if (dominantBin >= 0) {
    const center = [
      ((dominantBin >> 10) & 31) * 8 + 4,
      ((dominantBin >> 5) & 31) * 8 + 4,
      (dominantBin & 31) * 8 + 4,
    ]
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isBorder(x, y)) continue
        const offset = (y * width + x) * 4
        if (rgba[offset + 3] < limits.transparentAlphaMax) continue
        const distance = Math.max(
          Math.abs(rgba[offset] - center[0]),
          Math.abs(rgba[offset + 1] - center[1]),
          Math.abs(rgba[offset + 2] - center[2]),
        )
        if (distance <= limits.borderColorTolerance) nearDominant += 1
      }
    }
  }
  return {
    plainBorderRatio: (transparent + nearDominant) / total,
    transparentBorderRatio: transparent / total,
  }
}

async function analyzeRaster(bytes) {
  const longSide = PORTRAIT_IMAGE_GATE_LIMITS.analysisLongSidePx
  const { data, info } = await sharp(bytes, {
    limitInputPixels: PORTRAIT_IMAGE_GATE_LIMITS.maxInputPixels,
  })
    .rotate()
    .ensureAlpha()
    .resize({ width: longSide, height: longSide, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixelCount = info.width * info.height
  // Transparent regions often hide arbitrary RGB; a white matte keeps the
  // silhouette edge measurable instead of inventing noise behind it.
  const gray = new Uint8Array(pixelCount)
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * info.channels
    const alpha = data[offset + 3] / 255
    const luminance = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]
    gray[index] = Math.round(luminance * alpha + 255 * (1 - alpha))
  }
  return {
    sharpness: measurePortraitImageSharpness(gray, info.width, info.height),
    background: measurePortraitImageBackground(data, info.width, info.height),
  }
}

function roundMetric(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Decide whether an image may enter the portrait generator.
 * Accepts a local file path or an in-memory buffer; never throws for bad
 * input — every failure maps to a stable reason code.
 * @param {{ filePath?: string, buffer?: Buffer }} source
 * @returns {Promise<import('../../../shared/portraitImageGate.js').PortraitImageGateResult>}
 */
export async function rejectPortraitImage(source) {
  const limits = PORTRAIT_IMAGE_GATE_LIMITS
  const read = await readSourceBytes(source)
  const metrics = {}
  if (typeof read.byteLength === 'number') metrics.byteLength = read.byteLength

  if (read.reasonCode === PORTRAIT_IMAGE_GATE_REASONS.FILE_TOO_LARGE) {
    return buildResult(read.reasonCode, metrics, { maxMegabytes: limits.maxFileBytes / MEBIBYTE })
  }
  if (read.reasonCode) return buildResult(read.reasonCode, metrics)
  if (read.byteLength > limits.maxFileBytes) {
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.FILE_TOO_LARGE, metrics, {
      maxMegabytes: limits.maxFileBytes / MEBIBYTE,
    })
  }
  if (read.byteLength === 0) return buildResult(PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED, metrics)

  let metadata
  try {
    metadata = await sharp(read.bytes, { limitInputPixels: false }).metadata()
  } catch {
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED, metrics)
  }
  if (typeof metadata.format === 'string') metrics.format = metadata.format
  if (!ACCEPTED_FORMATS.has(metadata.format)) {
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.UNSUPPORTED_FORMAT, metrics)
  }
  if ((metadata.pages ?? 1) > 1) return buildResult(PORTRAIT_IMAGE_GATE_REASONS.ANIMATED, metrics)

  // EXIF orientation can swap the axes; judge the image the user actually sees.
  const width = metadata.autoOrient?.width ?? metadata.width ?? 0
  const height = metadata.autoOrient?.height ?? metadata.height ?? 0
  metrics.width = width
  metrics.height = height
  if (width <= 0 || height <= 0) return buildResult(PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED, metrics)
  if (width * height > limits.maxInputPixels) {
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.DIMENSIONS_TOO_LARGE, metrics, {
      maxMegapixels: Math.floor(limits.maxInputPixels / 1_000_000),
    })
  }
  if (width < limits.minWidthPx) {
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.TOO_SMALL, metrics, { minWidth: limits.minWidthPx })
  }
  const shortSide = Math.min(width, height)
  if (Math.max(width, height) / shortSide > limits.maxAspectRatio) {
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.EXTREME_ASPECT_RATIO, metrics, { maxRatio: limits.maxAspectRatio })
  }

  let analysis
  try {
    analysis = await analyzeRaster(read.bytes)
  } catch {
    // Headers can parse while the pixel data is truncated or corrupt.
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED, metrics)
  }
  const { sharpness, background } = analysis
  metrics.laplacianVariance = roundMetric(sharpness.laplacianVariance, 1)
  metrics.edgeDensity = roundMetric(sharpness.edgeDensity, 4)
  metrics.plainBorderRatio = roundMetric(background.plainBorderRatio, 3)
  metrics.transparentBorderRatio = roundMetric(background.transparentBorderRatio, 3)
  if (
    sharpness.laplacianVariance < limits.minLaplacianVariance
    || sharpness.edgeDensity < limits.minEdgeDensity
  ) {
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.TOO_BLURRY, metrics)
  }
  if (background.plainBorderRatio < limits.minPlainBorderRatio) {
    return buildResult(PORTRAIT_IMAGE_GATE_REASONS.BUSY_BACKGROUND, metrics)
  }

  return buildResult(null, metrics)
}

/**
 * IPC entry: gate a renderer-supplied path, or one picked through the
 * injected dialog when the payload carries none. Returns null on cancel.
 * The result never echoes the path back.
 * @param {{ imagePath?: string }} payload
 * @param {{ pickImagePath: () => Promise<string | null | undefined> }} deps
 */
export async function checkPortraitImageFromPayload(payload, { pickImagePath }) {
  const imagePath = payload?.imagePath || await pickImagePath()
  if (!imagePath) return null
  return rejectPortraitImage({ filePath: imagePath })
}
