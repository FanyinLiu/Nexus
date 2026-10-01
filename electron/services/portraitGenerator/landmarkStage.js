/**
 * Runs the landmark gate on an image that stage A (`rejectImage.js`) has
 * accepted. Decodes with sharp (EXIF-oriented, flattened on white like the
 * spike, alpha kept for the foreground mask), shrinks the analysis raster to
 * at most 2048 px on the long side (never enlarges), and builds a CLAHE
 * (OpenCV-style, on Lab lightness) contrast-normalised copy only when the gate asks for a retry. Model
 * sessions come from the lazy loader in `landmarkModels.js`.
 *
 * Never throws. Without models or a runtime it returns
 * `landmark_models_unavailable`, so callers keep the stage-A verdict.
 */

import sharp from 'sharp'

import { detectAnimeFaces } from './animeFaceModel.js'
import { evaluatePortraitLandmarks, landmarkStageUnavailable } from './landmarkGate.js'
import { PORTRAIT_LANDMARK_GATE_REASONS } from '../../../shared/portraitLandmarkGate.js'

export const LANDMARK_ANALYSIS_LONG_SIDE_PX = 2048

/** RGBA -> RGB flattened on white, plus the alpha plane. */
export function flattenOnWhite(rgba, width, height) {
  const rgb = new Uint8Array(width * height * 3)
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i += 1) {
    const a = rgba[i * 4 + 3]
    alpha[i] = a
    for (let c = 0; c < 3; c += 1) rgb[i * 3 + c] = Math.round((rgba[i * 4 + c] * a + 255 * (255 - a)) / 255)
  }
  return { rgb, alpha }
}

async function decode(source) {
  const input = source.buffer ?? source.filePath
  const image = sharp(input, { failOn: 'error', limitInputPixels: 64_000_000 }).rotate()
  const { data, info } = await image
    .resize({ width: LANDMARK_ANALYSIS_LONG_SIDE_PX, height: LANDMARK_ANALYSIS_LONG_SIDE_PX, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const metadata = await sharp(input, { limitInputPixels: 64_000_000 }).rotate().metadata()
  const orientedWidth = (metadata.orientation ?? 1) >= 5 ? metadata.height : metadata.width
  const { rgb, alpha } = flattenOnWhite(data, info.width, info.height)
  return { rgb, alpha, width: info.width, height: info.height, pixelScale: (orientedWidth ?? info.width) / info.width }
}

const toLinear = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
const labFInverse = (f) => (f ** 3 > 216 / 24389 ? f ** 3 : (116 * f - 16) / (24389 / 27))
const toSrgb = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)))

/** One tile's clipped-histogram equalisation LUT (OpenCV CLAHE: clip, redistribute evenly, then the residual). */
function tileLut(values, clipLimit) {
  const hist = new Uint32Array(256)
  for (const v of values) hist[v] += 1
  const clip = Math.max(1, Math.floor((clipLimit * values.length) / 256))
  let excess = 0
  for (let i = 0; i < 256; i += 1) if (hist[i] > clip) { excess += hist[i] - clip; hist[i] = clip }
  const batch = Math.floor(excess / 256)
  let residual = excess - batch * 256
  for (let i = 0; i < 256; i += 1) hist[i] += batch
  if (residual > 0) {
    const step = Math.max(Math.floor(256 / residual), 1)
    for (let i = 0; i < 256 && residual > 0; i += step, residual -= 1) hist[i] += 1
  }
  const lut = new Uint8Array(256)
  const scale = 255 / values.length
  let sum = 0
  for (let i = 0; i < 256; i += 1) { sum += hist[i]; lut[i] = Math.min(255, Math.round(sum * scale)) }
  return lut
}

/**
 * Contrast-limited adaptive histogram equalisation of the Lab lightness
 * (8x8 tiles, clip limit 3, bilinear between tile LUTs), as OpenCV does it.
 * Used only as a retry when the face models are unsure (e.g. very dark skin).
 */
export function contrastNormalizeRgb(rgb, width, height, tiles = 8, clipLimit = 3) {
  const n = width * height
  const L8 = new Uint8Array(n)
  const A = new Float32Array(n)
  const B = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const r = toLinear[rgb[i * 3]]
    const g = toLinear[rgb[i * 3 + 1]]
    const b = toLinear[rgb[i * 3 + 2]]
    const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
    const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b)
    const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
    L8[i] = Math.round(((116 * fy - 16) * 255) / 100)
    A[i] = 500 * (fx - fy)
    B[i] = 200 * (fy - fz)
  }
  const tileW = Math.ceil(width / tiles)
  const tileH = Math.ceil(height / tiles)
  const luts = []
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      const values = []
      for (let y = ty * tileH; y < Math.min((ty + 1) * tileH, height); y += 1) {
        for (let x = tx * tileW; x < Math.min((tx + 1) * tileW, width); x += 1) values.push(L8[y * width + x])
      }
      luts.push(values.length ? tileLut(values, clipLimit) : Uint8Array.from({ length: 256 }, (_, i) => i))
    }
  }
  const out = new Uint8Array(n * 3)
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(Math.max(y / tileH - 0.5, 0), tiles - 1)
    const y0 = Math.floor(gy)
    const y1 = Math.min(y0 + 1, tiles - 1)
    const fy = gy - y0
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(Math.max(x / tileW - 0.5, 0), tiles - 1)
      const x0 = Math.floor(gx)
      const x1 = Math.min(x0 + 1, tiles - 1)
      const fx = gx - x0
      const i = y * width + x
      const v = L8[i]
      const top = luts[y0 * tiles + x0][v] * (1 - fx) + luts[y0 * tiles + x1][v] * fx
      const bottom = luts[y1 * tiles + x0][v] * (1 - fx) + luts[y1 * tiles + x1][v] * fx
      const lightness = (Math.round(top * (1 - fy) + bottom * fy) * 100) / 255
      const fyy = (lightness + 16) / 116
      const X = labFInverse(fyy + A[i] / 500) * 0.95047
      const Y = labFInverse(fyy)
      const Z = labFInverse(fyy - B[i] / 200) * 1.08883
      out[i * 3] = toSrgb(3.2406 * X - 1.5372 * Y - 0.4986 * Z)
      out[i * 3 + 1] = toSrgb(-0.9689 * X + 1.8758 * Y + 0.0415 * Z)
      out[i * 3 + 2] = toSrgb(0.0557 * X - 0.204 * Y + 1.057 * Z)
    }
  }
  return out
}

/**
 * @param {{ filePath?: string, buffer?: Buffer }} source
 * @param {{ load: () => Promise<{ status: string, sessions?: object }> }} loader
 */
export async function runPortraitLandmarkStage(source, loader) {
  const loaded = await loader.load()
  if (loaded.status !== 'ready') return landmarkStageUnavailable(loaded.status)
  try {
    const image = await decode(source)
    const cache = new Map()
    const detect = (variant) => {
      if (!cache.has(variant)) {
        const raster = variant === 'normalized'
          ? { ...image, rgb: contrastNormalizeRgb(image.rgb, image.width, image.height) }
          : image
        cache.set(variant, detectAnimeFaces(raster, loaded.sessions))
      }
      return cache.get(variant)
    }
    return await evaluatePortraitLandmarks(image, { detect })
  } catch {
    return landmarkStageUnavailable('analysis_failed')
  }
}

/**
 * Merge a stage-B verdict into an accepted stage-A result. Unavailable models
 * never reject: the stage-A verdict stands and `landmarkStatus` records why.
 *
 * @param {object} stageA accepted `rejectPortraitImage` result
 * @param {object} stageB `runPortraitLandmarkStage` result
 */
export function combinePortraitGateStages(stageA, stageB) {
  if (stageB.reasonCode === PORTRAIT_LANDMARK_GATE_REASONS.MODELS_UNAVAILABLE) {
    return { ...stageA, landmarkStatus: stageB.detail ?? 'unavailable' }
  }
  const metrics = { ...stageA.metrics, landmarks: stageB.metrics }
  if (stageB.accepted) return { ...stageA, metrics, landmarkStatus: 'ok' }
  return {
    accepted: false,
    reasonCode: stageB.reasonCode,
    messageKey: stageB.messageKey,
    messageParams: stageB.messageParams,
    metrics,
    landmarkStatus: stageB.detail ?? 'rejected',
  }
}

/**
 * The stage-B hook for `checkPortraitImageFromPayload`. `getLoader` is called
 * on first use only, so nothing is read from disk until an image is checked.
 *
 * @param {() => { load: () => Promise<{ status: string, sessions?: object }> }} getLoader
 */
export function createPortraitLandmarkStage(getLoader) {
  return async (source, stageA) => combinePortraitGateStages(stageA, await runPortraitLandmarkStage(source, getLoader()))
}
