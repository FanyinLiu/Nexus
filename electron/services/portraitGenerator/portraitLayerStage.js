/**
 * Decode a portrait for layering: rotate by EXIF, shrink to the working size
 * (long side <= 768, like the spike), and take the cutout alpha from the image
 * when it is transparent, otherwise from verified local ISNet inference. Landmarks are
 * given in original pixels and scaled to the working raster; the returned
 * masks are at working size. The legacy `scale` metadata is the nominal
 * resize factor; coordinates use each axis's actual integer dimensions.
 */
import sharp from 'sharp'

import { cutoutUnavailable } from '../../../shared/portraitCutoutGate.js'
import { PORTRAIT_IMAGE_GATE_MESSAGE_KEYS, PORTRAIT_IMAGE_GATE_REASONS } from '../../../shared/portraitImageGate.js'
import { backgroundResidualFeatures, isBusyBackgroundResidual } from './backgroundResidual.js'
import { validateCutoutAlpha } from './cutoutModel.js'
import { PORTRAIT_LAYER_PARAMS, segmentPortraitLayers } from './portraitLayers.js'

/**
 * @param {{ filePath?: string, buffer?: Buffer }} source
 * @param {number[][]} keypoints 28 landmarks in original image pixels
 * @param {{ getCutoutEngine?: () => { prepare: () => Promise<{ status: string }>, evaluate: (image: object) => Promise<object> } }} [options]
 */
export async function splitPortraitLayers(source, keypoints, options = {}) {
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
  // Preserve the existing meaningful-transparency gate; a stray alpha=254
  // pixel is not evidence that the opaque background has already been cut out.
  const usesOwnAlpha = transparent >= 0.05 * n
  if (!usesOwnAlpha) {
    try {
      const engine = options.getCutoutEngine?.()
      if (!engine) return cutoutUnavailable('missing')
      const prepared = await engine.prepare()
      if (prepared.status !== 'ready') return cutoutUnavailable(prepared.status)
      // The worker transfers its RGB buffer; layering still needs the original.
      const result = await engine.evaluate({ rgb: rgb.slice(), width, height })
      if (!result?.accepted) return cutoutUnavailable(result?.detail)
      if (!validateCutoutAlpha(result.alpha, width, height)) return cutoutUnavailable('invalid_mask')
      // Inspect the original model alpha before any layer partition can alter it.
      if (isBusyBackgroundResidual(backgroundResidualFeatures({ rgb, width, height }, result.alpha))) {
        const reasonCode = PORTRAIT_IMAGE_GATE_REASONS.BUSY_BACKGROUND
        return {
          accepted: false,
          reasonCode,
          detail: 'background_residual',
          messageKey: PORTRAIT_IMAGE_GATE_MESSAGE_KEYS[reasonCode],
          messageParams: {},
        }
      }
      image.alpha = result.alpha
    } catch {
      return cutoutUnavailable('analysis_failed')
    }
  }
  const scaleX = width / width0
  const scaleY = height / height0
  const scaled = keypoints.map((p) => [p[0] * scaleX, p[1] * scaleY, p[2] ?? 1])
  return {
    ...segmentPortraitLayers(image, scaled),
    accepted: true,
    width,
    height,
    scale,
    alphaSource: usesOwnAlpha ? 'image' : 'isnet',
    // Keep the exact points used above, including the integer raster's two
    // different scale factors; the draft writer must not reconstruct them.
    geometry: { source: { width: width0, height: height0 }, sourceToWork: { x: scaleX, y: scaleY }, workPoints: scaled },
    /** Working-size raster + cutout alpha, so callers can cut the layers out. */
    rgb: image.rgb,
    alpha: image.alpha,
  }
}
