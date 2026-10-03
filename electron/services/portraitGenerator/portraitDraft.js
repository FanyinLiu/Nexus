/**
 * v0.5 portrait generation entry (main process): image -> gate ->
 * landmarks -> hair/head/body layers -> a draft on disk.
 *
 * 1. Stage A (`rejectPortraitImage`) must accept the image.
 * 2. Stage B runs in the landmark worker with `keepKeypoints`. Unlike the
 *    image check, generation needs the landmarks, so missing models are a
 *    stop (`landmark_models_unavailable`), not a pass.
 * 3. `splitPortraitLayers` preserves meaningful original alpha or requires
 *    verified local ISNet cutout, then segments the working raster (long side 768).
 * 4. The layers are written as RGBA PNGs (`hair.png`, `head.png`, `body.png`,
 *    same canvas), a transparent `preview.png`, and `draft.json` under
 *    `<userData>/portrait-drafts/<draftId>/`. Only the newest
 *    `PORTRAIT_DRAFT_KEEP` drafts are kept.
 *
 * Results carry stable reason codes and layer shares, never paths. Only the
 * trusted panel opts into the bounded PNG preview; CLI callers stay pixel-free.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { normalizePortraitPreview } from '../../../shared/portraitPreview.js'
import { isPortraitDraftId } from '../../../shared/portraitDraftExport.js'
import { atomicWriteJson } from '../localDataStoreCore.js'
import { runPortraitLandmarkStage } from './landmarkStage.js'
import { splitPortraitLayers } from './portraitLayerStage.js'
import { buildPortraitDraftMetadata } from './portraitDraftMetadata.js'
import { rejectPortraitImage } from './rejectImage.js'

export const PORTRAIT_DRAFT_DIRECTORY_NAME = 'portrait-drafts'
export const PORTRAIT_DRAFT_KEEP = 3
export const PORTRAIT_DRAFT_VERSION = 1
const LAYER_NAMES = Object.freeze(['hair', 'head', 'body'])

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
    entries = (await fs.readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && isPortraitDraftId(entry.name))
  } catch {
    return
  }
  const stale = entries.map((entry) => entry.name).sort().reverse().slice(keep)
  const removed = await Promise.allSettled(stale.map((name) => fs.rm(path.join(root, name), { recursive: true, force: true })))
  // Old-draft cleanup cannot turn a newly committed draft into a failure or
  // expose filesystem errors. A later successful generation retries pruning.
  if (removed.some((result) => result.status === 'rejected')) console.warn('portrait_draft_prune_failed')
}

/**
 * @param {{ imagePath?: string }} payload
 * @param {{
 *   pickImagePath: () => Promise<string | null | undefined>,
 *   getEngine: () => { prepare: () => Promise<{ status: string }>, evaluate: (image: object, options?: object) => Promise<object> },
 *   getCutoutEngine?: () => { prepare: () => Promise<{ status: string }>, evaluate: (image: object) => Promise<object> },
 *   draftRoot: string,
 *   includePreview?: boolean,
 *   now?: () => number,
 * }} deps
 * @returns {Promise<null | { accepted: false, stage: 'image' | 'landmarks' | 'cutout', reasonCode: string, detail: string | null, messageKey: string, messageParams: object }
 *   | { accepted: true, draftId: string, width: number, height: number, alphaSource: string, layers: Record<string, { share: number }>, preview?: import('../../../shared/portraitPreview.js').PortraitPreview }>}
 */
export async function generatePortraitDraftFromPayload(payload, deps) {
  const imagePath = payload?.imagePath || await deps.pickImagePath()
  if (!imagePath) return null
  const source = { filePath: imagePath }
  const stageA = await rejectPortraitImage(source)
  if (!stageA.accepted) return rejection('image', stageA)
  const stageB = await runPortraitLandmarkStage(source, deps.getEngine(), { keepKeypoints: true })
  if (!stageB.accepted || !Array.isArray(stageB.keypoints)) return rejection('landmarks', stageB)

  const split = await splitPortraitLayers(source, stageB.keypoints, { getCutoutEngine: deps.getCutoutEngine })
  if (!split.accepted) return rejection('cutout', split)
  const now = deps.now ?? Date.now
  const draftId = `draft-${String(now()).padStart(13, '0')}-${randomUUID().slice(0, 8)}`
  const dir = path.join(deps.draftRoot, draftId)
  const foreground = split.alpha.reduce((sum, value) => sum + (value > 127 ? 1 : 0), 0) || 1
  const layers = {}
  const previewMask = new Uint8Array(split.width * split.height)
  let preview = null
  let created = false
  try {
    await fs.mkdir(deps.draftRoot, { recursive: true })
    // A collision must not let failure cleanup remove an existing directory.
    await fs.mkdir(dir)
    created = true
    for (const name of LAYER_NAMES) {
      const mask = split[name]
      let pixels = 0
      for (let i = 0; i < mask.length; i += 1) {
        if (mask[i]) { pixels += 1; previewMask[i] = 1 }
      }
      layers[name] = { share: Math.round((pixels / foreground) * 1000) / 1000 }
      await sharp(Buffer.from(layerRgba(split, mask)), { raw: { width: split.width, height: split.height, channels: 4 } })
        .png()
        .toFile(path.join(dir, `${name}.png`))
    }
    // All layers share the source colour and alpha. Their union keeps soft
    // edges unchanged instead of repeatedly compositing overlapping alpha.
    await sharp(Buffer.from(layerRgba(split, previewMask)), { raw: { width: split.width, height: split.height, channels: 4 } })
      .png()
      .toFile(path.join(dir, 'preview.png'))
    const manifest = {
      version: PORTRAIT_DRAFT_VERSION,
      draftId,
      width: split.width,
      height: split.height,
      scale: split.scale,
      alphaSource: split.alphaSource,
      split: split.split,
      preview: 'preview.png',
      layers: Object.fromEntries(LAYER_NAMES.map((name) => [name, { file: `${name}.png`, ...layers[name] }])),
      gate: stageB.metrics,
      metadata: buildPortraitDraftMetadata(stageB, split),
    }
    if (deps.includePreview === true) {
      const png = await fs.readFile(path.join(dir, 'preview.png'))
      preview = normalizePortraitPreview({ dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: split.width, height: split.height })
      if (!preview) throw new Error('portrait_draft_write_failed')
    }
    await atomicWriteJson(path.join(dir, 'draft.json'), manifest)
  } catch {
    if (created) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    // Never expose the filesystem exception or its private paths through IPC.
    throw new Error('portrait_draft_write_failed')
  }
  await pruneDrafts(deps.draftRoot, PORTRAIT_DRAFT_KEEP)
  return { accepted: true, draftId, width: split.width, height: split.height, alphaSource: split.alphaSource, layers, ...(preview ? { preview } : {}) }
}
