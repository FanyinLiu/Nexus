/**
 * Decode a portrait for layering: rotate by EXIF, shrink to the working size
 * (long side <= 768, like the spike), and take the cutout alpha from the image
 * when it is transparent, otherwise from the plain background. Landmarks are
 * given in original pixels and scaled to the working raster; the returned
 * masks are at working size with `scale` to map back.
 */
import sharp from 'sharp'

import { PORTRAIT_LAYER_PARAMS, plainBackgroundAlpha, segmentPortraitLayers } from './portraitLayers.js'

/**
 * @param {{ filePath?: string, buffer?: Buffer }} source
 * @param {number[][]} keypoints 28 landmarks in original image pixels
 */
export async function splitPortraitLayers(source, keypoints) {
  const input = source.buffer ?? source.filePath
  const base = sharp(input, { failOn: 'error' }).rotate()
  const meta = await base.clone().metadata()
  const portrait = (meta.orientation ?? 1) >= 5
  const width0 = portrait ? meta.height : meta.width
  const height0 = portrait ? meta.width : meta.height
  const scale = Math.min(1, PORTRAIT_LAYER_PARAMS.workSize / Math.max(width0, height0))
  const width = Math.max(1, Math.trunc(width0 * scale))
  const height = Math.max(1, Math.trunc(height0 * scale))
  const { data } = await base.resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = width * height
  const rgb = new Uint8Array(n * 3)
  const alpha = new Uint8Array(n)
  let transparent = 0
  for (let i = 0; i < n; i += 1) {
    rgb[i * 3] = data[i * 4]
    rgb[i * 3 + 1] = data[i * 4 + 1]
    rgb[i * 3 + 2] = data[i * 4 + 2]
    alpha[i] = data[i * 4 + 3]
    if (alpha[i] < 26) transparent += 1
  }
  const image = { rgb, alpha, width, height }
  const usesOwnAlpha = transparent >= 0.05 * n
  if (!usesOwnAlpha) image.alpha = plainBackgroundAlpha(image)
  const scaled = keypoints.map((p) => [p[0] * scale, p[1] * scale, p[2] ?? 1])
  return {
    ...segmentPortraitLayers(image, scaled),
    width,
    height,
    scale,
    alphaSource: usesOwnAlpha ? 'image' : 'plain_background',
    /** Working-size raster + cutout alpha, so callers can cut the layers out. */
    rgb: image.rgb,
    alpha: image.alpha,
  }
}
