/**
 * Portrait generator stage A: file-level checks on a user-picked image before
 * any model runs.
 *
 * v0.5 now generates first and judges the output (see the portrait draft
 * stages), so stage A only refuses what cannot be processed at all: an
 * unreadable or corrupt file, a format other than PNG/JPEG/WebP, an animated
 * image, or a file/pixel count beyond the hard safety caps. Everything about
 * the picture itself (background, blur, size of the character, framing) is
 * left to the face check and to the post-generation quality checks.
 *
 * Large inputs are not rejected. Files up to `inMemoryFileBytes` are read into
 * memory as before; bigger files (up to the `maxFileBytes` hard cap) are never
 * read into a Node buffer: libvips decodes them straight from disk. Any image
 * over `inMemoryFileBytes` or `normalizeAbovePixels` is downscaled once here
 * (long side `normalizedLongSidePx`, lossless PNG, alpha kept) and every later
 * stage reads that in-memory copy (`preparePortraitImage().source`), so the
 * 64 MP decode limits downstream never see the original. Only the IPC result
 * (`rejectPortraitImage`) crosses to the renderer; the pixels never do.
 *
 * Results carry a stable reason code and a renderer messageKey only: no
 * prose, no paths, no pixels, so they are safe to audit. The image is read
 * locally and never forwarded to chat, desktop context, or any model prompt.
 */

import fs from 'node:fs/promises'
import sharp from 'sharp'

import {
  PORTRAIT_IMAGE_GATE_MESSAGE_KEYS,
  PORTRAIT_IMAGE_GATE_REASONS,
} from '../../../shared/portraitImageGate.js'

const MEBIBYTE = 1024 * 1024

/**
 * Stage-A limits. Values are product decisions, not tuning knobs, so they
 * live in one frozen object that tests and copy params both read.
 */
export const PORTRAIT_IMAGE_GATE_LIMITS = Object.freeze({
  /** Files up to this size are read into memory; bigger ones are decoded from disk and downscaled. */
  inMemoryFileBytes: 32 * MEBIBYTE,
  /** Hard cap: larger files are refused from their size alone, never opened. */
  maxFileBytes: 256 * MEBIBYTE,
  /** Images with more pixels than this are downscaled before any stage decodes them. */
  normalizeAbovePixels: 64_000_000,
  /** Long side of the downscaled working copy (the cutout input size). */
  normalizedLongSidePx: 4096,
  /**
   * Decompression-bomb hard cap, checked from the header before decoding:
   * sharp's own default (16383 x 16383).
   */
  maxInputPixels: 268_402_689,
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

/**
 * Small files come back as bytes; files over `inMemoryFileBytes` come back as
 * the path only, so libvips decodes them from disk without a Node copy.
 */
async function readSource(source) {
  const limits = PORTRAIT_IMAGE_GATE_LIMITS
  if (Buffer.isBuffer(source?.buffer)) {
    return { input: source.buffer, byteLength: source.buffer.length }
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
  // Size is checked before reading so a file over the hard cap is never opened.
  if (stats.size > limits.maxFileBytes) {
    return { reasonCode: PORTRAIT_IMAGE_GATE_REASONS.FILE_TOO_LARGE, byteLength: stats.size }
  }
  if (stats.size > limits.inMemoryFileBytes) return { input: filePath, byteLength: stats.size, onDisk: true }
  try {
    const bytes = await fs.readFile(filePath)
    return { input: bytes, byteLength: bytes.length }
  } catch {
    return { reasonCode: PORTRAIT_IMAGE_GATE_REASONS.UNREADABLE }
  }
}

/** Full decode of a small raster: headers can parse while the pixel data is truncated or corrupt. */
async function verifyPixels(input) {
  const longSide = 256
  await sharp(input, { failOn: 'error', limitInputPixels: PORTRAIT_IMAGE_GATE_LIMITS.maxInputPixels, sequentialRead: true })
    .rotate()
    .resize({ width: longSide, height: longSide, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer()
}

/** One downscale of an oversized image to an in-memory lossless PNG (EXIF orientation applied, alpha kept). */
async function downscale(input) {
  const longSide = PORTRAIT_IMAGE_GATE_LIMITS.normalizedLongSidePx
  return sharp(input, { failOn: 'error', limitInputPixels: PORTRAIT_IMAGE_GATE_LIMITS.maxInputPixels, sequentialRead: true })
    .rotate()
    .resize({ width: longSide, height: longSide, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 1 })
    .toBuffer()
}

/**
 * Stage A plus the working source every later stage should read.
 * Never throws for bad input: every failure maps to a stable reason code.
 * @param {{ filePath?: string, buffer?: Buffer }} source
 * @returns {Promise<{
 *   result: import('../../../shared/portraitImageGate.js').PortraitImageGateResult,
 *   source: { filePath?: string, buffer?: Buffer } | null,
 * }>} `source` is null when rejected; a `{ buffer }` copy when the image was downscaled.
 */
export async function preparePortraitImage(source) {
  const limits = PORTRAIT_IMAGE_GATE_LIMITS
  const reject = (reasonCode, metrics, messageParams) => ({ result: buildResult(reasonCode, metrics, messageParams), source: null })
  const read = await readSource(source)
  const metrics = {}
  if (typeof read.byteLength === 'number') metrics.byteLength = read.byteLength

  if (read.reasonCode === PORTRAIT_IMAGE_GATE_REASONS.FILE_TOO_LARGE) {
    return reject(read.reasonCode, metrics, { maxMegabytes: limits.maxFileBytes / MEBIBYTE })
  }
  if (read.reasonCode) return reject(read.reasonCode, metrics)
  if (read.byteLength > limits.maxFileBytes) {
    return reject(PORTRAIT_IMAGE_GATE_REASONS.FILE_TOO_LARGE, metrics, { maxMegabytes: limits.maxFileBytes / MEBIBYTE })
  }
  if (read.byteLength === 0) return reject(PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED, metrics)

  let metadata
  try {
    metadata = await sharp(read.input, { limitInputPixels: false }).metadata()
  } catch {
    return reject(PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED, metrics)
  }
  if (typeof metadata.format === 'string') metrics.format = metadata.format
  if (!ACCEPTED_FORMATS.has(metadata.format)) return reject(PORTRAIT_IMAGE_GATE_REASONS.UNSUPPORTED_FORMAT, metrics)
  if ((metadata.pages ?? 1) > 1) return reject(PORTRAIT_IMAGE_GATE_REASONS.ANIMATED, metrics)

  // EXIF orientation can swap the axes; judge the image the user actually sees.
  const width = metadata.autoOrient?.width ?? metadata.width ?? 0
  const height = metadata.autoOrient?.height ?? metadata.height ?? 0
  metrics.width = width
  metrics.height = height
  if (width <= 0 || height <= 0) return reject(PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED, metrics)
  if (width * height > limits.maxInputPixels) {
    return reject(PORTRAIT_IMAGE_GATE_REASONS.DIMENSIONS_TOO_LARGE, metrics, {
      maxMegapixels: Math.floor(limits.maxInputPixels / 1_000_000),
    })
  }

  const oversized = read.onDisk || read.byteLength > limits.inMemoryFileBytes || width * height > limits.normalizeAbovePixels
  try {
    if (!oversized) {
      await verifyPixels(read.input)
      return { result: buildResult(null, metrics), source: Buffer.isBuffer(source?.buffer) ? { buffer: source.buffer } : { buffer: read.input } }
    }
    const buffer = await downscale(read.input)
    const scaled = await sharp(buffer).metadata()
    metrics.downscaled = true
    metrics.workingWidth = scaled.width ?? 0
    metrics.workingHeight = scaled.height ?? 0
    return { result: buildResult(null, metrics), source: { buffer } }
  } catch {
    return reject(PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED, metrics)
  }
}

/**
 * Decide whether an image may enter the portrait generator (the IPC verdict:
 * reason code and metrics, never pixels or paths).
 * @param {{ filePath?: string, buffer?: Buffer }} source
 * @returns {Promise<import('../../../shared/portraitImageGate.js').PortraitImageGateResult>}
 */
export async function rejectPortraitImage(source) {
  return (await preparePortraitImage(source)).result
}

/**
 * IPC entry: gate a renderer-supplied path, or one picked through the
 * injected dialog when the payload carries none. Returns null on cancel.
 * The result never echoes the path back.
 * @param {{ imagePath?: string }} payload
 * @param {{ pickImagePath: () => Promise<string | null | undefined>, landmarkStage?: ((source: { filePath?: string, buffer?: Buffer }, stageA: object) => Promise<object>) | null }} deps
 */
export async function checkPortraitImageFromPayload(payload, { pickImagePath, landmarkStage = null }) {
  const imagePath = payload?.imagePath || await pickImagePath()
  if (!imagePath) return null
  const { result, source } = await preparePortraitImage({ filePath: imagePath })
  // Stage B (landmarks) only runs on images stage A accepted, on stage A's
  // working copy (downscaled when the original was over the limits); it
  // keeps stage A's verdict whenever its models or runtime are unavailable.
  if (!result.accepted || !landmarkStage || !source) return result
  return landmarkStage(source, result)
}
