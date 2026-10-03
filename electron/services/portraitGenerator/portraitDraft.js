/**
 * v0.5 portrait generation entry (main process, no UI yet): image -> gate ->
 * cutout -> landmarks -> hair/head/body layers -> a draft on disk.
 *
 * v0.5 rule: when unsure, reject. There is no plain-background fallback.
 *
 * 1. Stage A (`preparePortraitImage`) must accept the file; later stages read
 *    its working copy (downscaled when the original was large). Generation needs
 *    the face models: if they are missing or damaged it stops with
 *    `portrait_models_not_downloaded` (download them first), checked before
 *    any model runs.
 * 2. Cutout: unless the image is already transparent, isnet-anime runs in
 *    the model worker (`cutoutStage.js`). A missing or damaged cutout model
 *    stops with `portrait_models_not_downloaded`; any other failure, or a
 *    mask that is not trusted (nearly all background or all foreground),
 *    rejects with `background_not_separable`. `detail` says which. Busy
 *    backgrounds are not refused up front: the output is judged in step 5.
 * 3. Stage B runs in the model worker with `keepKeypoints`, on the original
 *    pixels (the gate's thresholds were tuned on uncut images).
 * 4. `splitPortraitLayers` segments the working-size raster (long side 768)
 *    with the image's own alpha, else the isnet mask.
 * 5. Post-generation quality (`portraitQuality.js`, stage 'quality'): cutout
 *    trust, photo texture on the cut-out face, mouth landmarks, layer
 *    completeness and breathing-frame holes,
 *    each with its own reason code. The user still sees a preview and has to
 *    accept it; this step only refuses drafts that are clearly unusable.
 * 6. The layers are written as RGBA PNGs (`hair.png`, `head.png`, `body.png`,
 *    same canvas) plus `draft.json` under
 *    `<userData>/portrait-drafts/<draftId>/`. Only the newest
 *    `PORTRAIT_DRAFT_KEEP` drafts are kept.
 *
 * Results carry stable reason codes and layer shares, never paths or pixels.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { PORTRAIT_DRAFT_MESSAGE_KEYS, PORTRAIT_DRAFT_REASONS } from '../../../shared/portraitDraft.js'
import { runPortraitCutout } from './cutoutStage.js'
import { landmarkStageUnavailable } from './landmarkGate.js'
import { decodeLandmarkRaster, runPortraitLandmarkStage } from './landmarkStage.js'
import { decodePortraitRaster, splitPortraitLayers } from './portraitLayerStage.js'
import { judgePortraitQuality, measurePortraitQuality } from './portraitQuality.js'
import { preparePortraitImage } from './rejectImage.js'

export const PORTRAIT_DRAFT_DIRECTORY_NAME = 'portrait-drafts'
export const PORTRAIT_DRAFT_KEEP = 3
export const PORTRAIT_DRAFT_VERSION = 1
const LAYER_NAMES = Object.freeze(['hair', 'head', 'body'])
const DRAFT_ID = /^draft-\d{13}-[0-9a-f]{8}$/

/** `<userData>/portrait-drafts` */
export function resolvePortraitDraftRoot(userDataDir) {
  return path.join(userDataDir, PORTRAIT_DRAFT_DIRECTORY_NAME)
}

const MODEL_FILE_PROBLEMS = new Set(['missing', 'invalid'])

/** A generation-level rejection (`shared/portraitDraft.js`). */
function draftRejection(stage, reasonCode, detail) {
  return { accepted: false, stage, reasonCode, detail, messageKey: PORTRAIT_DRAFT_MESSAGE_KEYS[reasonCode], messageParams: {} }
}

function rejection(stage, verdict) {
  return {
    accepted: false,
    stage,
    reasonCode: verdict.reasonCode,
    detail: verdict.detail ?? null,
    messageKey: verdict.messageKey,
    messageParams: verdict.messageParams ?? {},
  }
}

/** RGBA of one layer: the working raster where the layer mask and the cutout alpha are set. */
export function layerRgba(split, mask) {
  const n = split.width * split.height
  const rgba = new Uint8Array(n * 4)
  for (let i = 0; i < n; i += 1) {
    if (!mask[i]) continue
    rgba[i * 4] = split.rgb[i * 3]
    rgba[i * 4 + 1] = split.rgb[i * 3 + 1]
    rgba[i * 4 + 2] = split.rgb[i * 3 + 2]
    rgba[i * 4 + 3] = split.alpha[i]
  }
  return rgba
}

async function pruneDrafts(root, keep) {
  let entries
  try {
    entries = (await fs.readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && DRAFT_ID.test(entry.name))
  } catch {
    return
  }
  const stale = entries.map((entry) => entry.name).sort().reverse().slice(keep)
  await Promise.all(stale.map((name) => fs.rm(path.join(root, name), { recursive: true, force: true })))
}

/**
 * @param {{ imagePath?: string }} payload
 * @param {{
 *   pickImagePath: () => Promise<string | null | undefined>,
 *   getEngine: () => {
 *     prepare: () => Promise<{ status: string }>,
 *     evaluate: (image: object, options?: object) => Promise<object>,
 *     prepareCutout?: () => Promise<{ status: string }>,
 *     cutout?: (image: { rgb: Uint8Array, width: number, height: number }, output: { width: number, height: number }) => Promise<{ ok: boolean, mask?: Uint8Array, code?: string }>,
 *   },
 *   draftRoot: string,
 *   now?: () => number,
 *   clock?: () => number,
 * }} deps
 * @returns {Promise<null | { accepted: false, stage: 'image' | 'models' | 'cutout' | 'landmarks' | 'quality', reasonCode: string, detail: string | null, messageKey: string, messageParams: object, quality?: object }
 *   | { accepted: true, draftId: string, width: number, height: number, alphaSource: 'image' | 'cutout', cutout: { status: string, foreground?: number }, layers: Record<string, { share: number }>, quality: object }>}
 */
export async function generatePortraitDraftFromPayload(payload, deps) {
  const imagePath = payload?.imagePath || await deps.pickImagePath()
  if (!imagePath) return null
  const prepared = await preparePortraitImage({ filePath: imagePath })
  if (!prepared.result.accepted || !prepared.source) return rejection('image', prepared.result)
  // Every later stage reads stage A's working copy (downscaled when large).
  const source = prepared.source
  const engine = deps.getEngine()
  const clock = deps.clock ?? (() => performance.now())
  const timingsMs = {}
  const timed = async (name, run) => {
    const start = clock()
    try {
      return await run()
    } finally {
      timingsMs[name] = Math.round(clock() - start)
    }
  }
  const landmarkModels = await engine.prepare()
  if (MODEL_FILE_PROBLEMS.has(landmarkModels.status)) return draftRejection('models', PORTRAIT_DRAFT_REASONS.MODELS_NOT_DOWNLOADED, `face_models_${landmarkModels.status}`)
  if (landmarkModels.status !== 'ready') return rejection('landmarks', landmarkStageUnavailable(landmarkModels.status))

  const raster = await decodePortraitRaster(source)
  let cutout = { status: 'skipped_transparent' }
  if (!raster.hasOwnAlpha) {
    cutout = await timed('cutout', () => runPortraitCutout(source, engine, { width: raster.width, height: raster.height }))
    if (MODEL_FILE_PROBLEMS.has(cutout.status)) return draftRejection('models', PORTRAIT_DRAFT_REASONS.MODELS_NOT_DOWNLOADED, `cutout_model_${cutout.status}`)
    if (cutout.status !== 'ok') return draftRejection('cutout', PORTRAIT_DRAFT_REASONS.BACKGROUND_NOT_SEPARABLE, cutout.status)
  }
  const stageB = await timed('landmarks', () => runPortraitLandmarkStage(source, engine, { keepKeypoints: true }))
  if (!stageB.accepted || !Array.isArray(stageB.keypoints)) return rejection('landmarks', stageB)

  const split = await timed('layers', () => splitPortraitLayers(raster, stageB.keypoints, cutout.status === 'ok' ? cutout.alpha : null))
  const quality = await timed('quality', async () => measurePortraitQuality(split, stageB.keypoints, await decodeLandmarkRaster(source)))
  const problem = judgePortraitQuality(quality, stageB.mouthCheck)
  if (problem) return { ...draftRejection('quality', problem.reasonCode, problem.detail), quality }
  const cutoutSummary = cutout.status === 'ok' ? { status: 'ok', foreground: cutout.foreground } : { status: cutout.status }
  const now = deps.now ?? Date.now
  const draftId = `draft-${String(now()).padStart(13, '0')}-${randomUUID().slice(0, 8)}`
  const dir = path.join(deps.draftRoot, draftId)
  await fs.mkdir(dir, { recursive: true })
  const foreground = split.alpha.reduce((sum, value) => sum + (value > 127 ? 1 : 0), 0) || 1
  const layers = {}
  for (const name of LAYER_NAMES) {
    const mask = split[name]
    let pixels = 0
    for (let i = 0; i < mask.length; i += 1) pixels += mask[i] ? 1 : 0
    layers[name] = { share: Math.round((pixels / foreground) * 1000) / 1000 }
    await sharp(Buffer.from(layerRgba(split, mask)), { raw: { width: split.width, height: split.height, channels: 4 } })
      .png()
      .toFile(path.join(dir, `${name}.png`))
  }
  const manifest = {
    version: PORTRAIT_DRAFT_VERSION,
    draftId,
    width: split.width,
    height: split.height,
    scale: split.scale,
    alphaSource: split.alphaSource,
    cutout: cutoutSummary,
    timingsMs,
    split: split.split,
    layers: Object.fromEntries(LAYER_NAMES.map((name) => [name, { file: `${name}.png`, ...layers[name] }])),
    gate: stageB.metrics,
    quality,
  }
  await fs.writeFile(path.join(dir, 'draft.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await pruneDrafts(deps.draftRoot, PORTRAIT_DRAFT_KEEP)
  return { accepted: true, draftId, width: split.width, height: split.height, alphaSource: split.alphaSource, cutout: cutoutSummary, layers, quality }
}
