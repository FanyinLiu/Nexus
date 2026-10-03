/**
 * Runs the landmark gate on an image that stage A (`rejectImage.js`) has
 * accepted. Decodes with sharp in the main process (EXIF-oriented, flattened
 * on white like the spike, alpha kept for the foreground mask, long side
 * shrunk to at most 2048 px, never enlarged) and hands the raster to an
 * engine: in the app, `landmarkRuntime.js` runs the models in a worker
 * thread; tests pass an in-process engine with mocked sessions.
 *
 * Never throws. Without models or a runtime it returns
 * `landmark_models_unavailable`, so callers keep the stage-A verdict.
 */

import sharp from 'sharp'

import { landmarkStageUnavailable } from './landmarkGate.js'
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
  const orientedHeight = (metadata.orientation ?? 1) >= 5 ? metadata.width : metadata.height
  const { rgb, alpha } = flattenOnWhite(data, info.width, info.height)
  // Integer raster dimensions can make the two resize factors differ slightly.
  const pixelScaleX = (orientedWidth ?? info.width) / info.width
  const pixelScaleY = (orientedHeight ?? info.height) / info.height
  return { rgb, alpha, width: info.width, height: info.height, pixelScale: pixelScaleX, pixelScaleX, pixelScaleY,
    sourceSize: { width: orientedWidth ?? info.width, height: orientedHeight ?? info.height } }
}

/**
 * @param {{ filePath?: string, buffer?: Buffer }} source
 * @param {{ prepare: () => Promise<{ status: string }>, evaluate: (image: object, options?: object) => Promise<object> }} engine
 * @param {{ keepKeypoints?: boolean }} [options] accepted verdicts then carry
 *   `keypoints` in original-image pixels (generation path only)
 */
export async function runPortraitLandmarkStage(source, engine, options = {}) {
  const prepared = await engine.prepare()
  if (prepared.status !== 'ready') return landmarkStageUnavailable(prepared.status)
  let image
  try {
    image = await decode(source)
  } catch {
    return landmarkStageUnavailable('analysis_failed')
  }
  try {
    const verdict = await engine.evaluate(image, options)
    if (Array.isArray(verdict?.keypoints)) {
      verdict.keypoints = verdict.keypoints.map(([x, y, confidence]) => [x * image.pixelScaleX, y * image.pixelScaleY, confidence])
      if (options.keepKeypoints) {
        // Only the private generation path retains input-derived geometry.
        verdict.geometry = { source: image.sourceSize, analysis: { width: image.width, height: image.height } }
      }
    }
    return verdict
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
 * The stage-B hook for `checkPortraitImageFromPayload`. `getEngine` is called
 * on first use only, so nothing is read from disk until an image is checked.
 *
 * @param {() => { prepare: () => Promise<{ status: string }>, evaluate: (image: object) => Promise<object> }} getEngine
 */
export function createPortraitLandmarkStage(getEngine) {
  return async (source, stageA) => combinePortraitGateStages(stageA, await runPortraitLandmarkStage(source, getEngine()))
}
