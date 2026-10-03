/**
 * Decode a portrait for layering and split it into hair/head/body.
 *
 * `decodePortraitRaster` rotates by EXIF and shrinks to the working size
 * (long side <= 768, like the spike), and reports whether the image carries
 * its own transparency (>= 5% of pixels with alpha < 26).
 *
 * `splitPortraitLayers` picks the cutout alpha in this order:
 * 1. the image's own alpha when it is transparent (`image`);
 * 2. the isnet-anime cutout mask when one was computed (`cutout`);
 * 3. the plain-background estimate, as a fallback only (`plain_background`).
 * Landmarks are given in original pixels and scaled to the working raster;
 * the returned masks are at working size with `scale` to map back.
 */
import sharp from 'sharp'

import { PORTRAIT_LAYER_PARAMS, plainBackgroundAlpha, segmentPortraitLayers } from './portraitLayers.js'

const OWN_ALPHA_SHARE = 0.05

/** @param {{ filePath?: string, buffer?: Buffer }} source */
export async function decodePortraitRaster(source) {
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
  return { rgb, alpha, width, height, scale, hasOwnAlpha: transparent >= OWN_ALPHA_SHARE * n }
}

/**
 * @param {Awaited<ReturnType<typeof decodePortraitRaster>>} raster
 * @param {number[][]} keypoints 28 landmarks in original image pixels
 * @param {Uint8Array | null} [cutoutAlpha] isnet mask at working size
 */
export function splitPortraitLayers(raster, keypoints, cutoutAlpha = null) {
  const { width, height, scale } = raster
  let alpha
  let alphaSource
  if (raster.hasOwnAlpha) {
    alpha = raster.alpha
    alphaSource = 'image'
  } else if (cutoutAlpha && cutoutAlpha.length === width * height) {
    alpha = cutoutAlpha
    alphaSource = 'cutout'
  } else {
    alpha = plainBackgroundAlpha({ rgb: raster.rgb, width, height })
    alphaSource = 'plain_background'
  }
  const image = { rgb: raster.rgb, alpha, width, height }
  const scaled = keypoints.map((p) => [p[0] * scale, p[1] * scale, p[2] ?? 1])
  return {
    ...segmentPortraitLayers(image, scaled),
    width,
    height,
    scale,
    alphaSource,
    /** Working-size raster + cutout alpha, so callers can cut the layers out. */
    rgb: raster.rgb,
    alpha,
  }
}
