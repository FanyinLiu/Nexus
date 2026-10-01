/**
 * v0.5 portrait generation entry (main process, no UI yet): image -> gate ->
 * landmarks -> hair/head/body layers -> a draft on disk.
 *
 * 1. Stage A (`rejectPortraitImage`) must accept the image.
 * 2. Stage B runs in the landmark worker with `keepKeypoints`. Unlike the
 *    image check, generation needs the landmarks, so missing models are a
 *    stop (`landmark_models_unavailable`), not a pass.
 * 3. `splitPortraitLayers` segments the working-size raster (long side 768).
 * 4. The layers are written as RGBA PNGs (`hair.png`, `head.png`, `body.png`,
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

import { runPortraitLandmarkStage } from './landmarkStage.js'
import { splitPortraitLayers } from './portraitLayerStage.js'
import { rejectPortraitImage } from './rejectImage.js'

export const PORTRAIT_DRAFT_DIRECTORY_NAME = 'portrait-drafts'
export const PORTRAIT_DRAFT_KEEP = 3
export const PORTRAIT_DRAFT_VERSION = 1
const LAYER_NAMES = Object.freeze(['hair', 'head', 'body'])
const DRAFT_ID = /^draft-\d{13}-[0-9a-f]{8}$/

/** `<userData>/portrait-drafts` */
export function resolvePortraitDraftRoot(userDataDir) {
  return path.join(userDataDir, PORTRAIT_DRAFT_DIRECTORY_NAME)
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
 *   getEngine: () => { prepare: () => Promise<{ status: string }>, evaluate: (image: object, options?: object) => Promise<object> },
 *   draftRoot: string,
 *   now?: () => number,
 * }} deps
 * @returns {Promise<null | { accepted: false, stage: 'image' | 'landmarks', reasonCode: string, detail: string | null, messageKey: string, messageParams: object }
 *   | { accepted: true, draftId: string, width: number, height: number, alphaSource: string, layers: Record<string, { share: number }> }>}
 */
export async function generatePortraitDraftFromPayload(payload, deps) {
  const imagePath = payload?.imagePath || await deps.pickImagePath()
  if (!imagePath) return null
  const source = { filePath: imagePath }
  const stageA = await rejectPortraitImage(source)
  if (!stageA.accepted) return rejection('image', stageA)
  const stageB = await runPortraitLandmarkStage(source, deps.getEngine(), { keepKeypoints: true })
  if (!stageB.accepted || !Array.isArray(stageB.keypoints)) return rejection('landmarks', stageB)

  const split = await splitPortraitLayers(source, stageB.keypoints)
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
    split: split.split,
    layers: Object.fromEntries(LAYER_NAMES.map((name) => [name, { file: `${name}.png`, ...layers[name] }])),
    gate: stageB.metrics,
  }
  await fs.writeFile(path.join(dir, 'draft.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await pruneDrafts(deps.draftRoot, PORTRAIT_DRAFT_KEEP)
  return { accepted: true, draftId, width: split.width, height: split.height, alphaSource: split.alphaSource, layers }
}
