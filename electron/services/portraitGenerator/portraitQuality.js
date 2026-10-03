/**
 * Post-generation quality judgement (v0.5: generate first, then judge the
 * output). Runs on the finished hair/head/body split at working size, before
 * anything is written. One reason per check, first failure wins:
 *
 * 1. Cutout trust -> `background_not_separable`
 *    - `face_not_covered`: the alpha covers less than `minFaceCovered` of the
 *      face (contour + brow line from the landmarks);
 *    - `fragmented`: the largest connected foreground part is less than
 *      `minLargestComponent` of the foreground (background objects or a
 *      second figure kept by the cutout).
 * 2. Photo -> `photo_not_illustration`: `photoTextureFeatures` (thresholds in
 *    `PORTRAIT_LANDMARK_GATE_LIMITS`) on the face at stage B's resolution with
 *    everything outside the cutout painted white, so a busy illustrated
 *    background around the face no longer reads as camera texture.
 * 3. Mouth landmarks -> `mouth_unreliable` (detail from the face check's
 *    `mouthCheck`: `mouth_landmarks_missing`, `landmark_order`, or
 *    `object_across_mouth`; a hand or object over the mouth lands here).
 * 4. Layer split -> `layers_incomplete`
 *    - `missing_head` / `missing_body` / `missing_hair`: a layer below its
 *      minimum share of the foreground;
 *    - `face_split`: less than `minFaceInHead` of the visible face is in the
 *      head layer.
 * 5. Breathing frame -> `breathing_holes`. The frame at full inhale, as in
 *    the spike (`round4/breath.py`): body stretched vertically by
 *    `breathScale` about the figure's bottom row; head lifted with the neck
 *    (the body's displacement at the split row); hair moves with the head
 *    above the split and blends to the body over `hairBlendFaces` face
 *    heights below it. The body counts as covering what the renderer fills
 *    in behind moving parts: hair between body pixels in the same row
 *    (gaps narrower than `fillBridgeFaces` face widths) and the area under
 *    the chin down to the split. Pixels that were opaque and become
 *    transparent with opaque pixels both above and below them within
 *    2 x lift + 2 rows (a tear, not a moved silhouette edge) are holes; more
 *    than `maxHoleArea` face units (face width x face height) rejects.
 *
 * Pure functions on masks and rasters; no pixels or paths leave this module.
 */
import { connectedComponents, faceGeometry, isPhotoTexture, photoTextureFeatures } from './landmarkGate.js'
import { PORTRAIT_DRAFT_REASONS } from '../../../shared/portraitDraft.js'

export const PORTRAIT_QUALITY_LIMITS = Object.freeze({
  minFaceCovered: 0.9,
  minLargestComponent: 0.8,
  minHeadShare: 0.03,
  minBodyShare: 0.03,
  minHairShare: 0.02,
  minFaceInHead: 0.85,
  breathScale: 0.03,
  hairBlendFaces: 0.5,
  fillBridgeFaces: 0.6,
  maxHoleArea: 0.6,
})

function insidePolygon(points, x, y) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Body plus what the renderer fills in behind moving parts: hair below the
 * split between body pixels of the same row (gap <= `bridge` px), and head
 * or hair under the chin (from chin - 0.25 fh to the split, |x - cx| < 0.32 fw).
 */
export function filledBody(layers, width, height, splitRow, face) {
  const { hair, head, body } = layers
  const out = Uint8Array.from(body)
  const bridge = Math.max(3, Math.round(PORTRAIT_QUALITY_LIMITS.fillBridgeFaces * face.fw))
  for (let y = Math.max(0, Math.ceil(splitRow)); y < height; y += 1) {
    let last = -Infinity
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (!body[i]) continue
      if (x - last > 1 && x - last - 1 <= bridge) {
        for (let k = Math.max(0, last + 1); k < x; k += 1) if (hair[y * width + k]) out[y * width + k] = 1
      }
      last = x
    }
  }
  const top = Math.max(0, Math.floor(face.chin - 0.25 * face.fh))
  const bottom = Math.min(height - 1, Math.floor(splitRow + 2))
  for (let y = top; y <= bottom; y += 1) {
    for (let x = Math.max(0, Math.ceil(face.cx - 0.32 * face.fw)); x < Math.min(width, face.cx + 0.32 * face.fw); x += 1) {
      const i = y * width + x
      if (head[i] || hair[i]) out[i] = 1
    }
  }
  return out
}

/**
 * Breathing-frame tears (see the module comment).
 * @param {{ hair: Uint8Array, head: Uint8Array, body: Uint8Array, fg: Uint8Array }} layers
 * @param {{ fw: number, fh: number, cx: number, chin: number }} face working-size face geometry
 * @returns {{ holes: number, lift: number }}
 */
export function breathingHoles(layers, width, height, splitRow, face) {
  const limits = PORTRAIT_QUALITY_LIMITS
  const { hair, head, fg } = layers
  const sy = 1 + limits.breathScale
  let bottom = 0
  for (let i = fg.length - 1; i >= 0; i -= 1) if (fg[i]) { bottom = Math.floor(i / width); break }
  const lift = (bottom - splitRow) * (sy - 1)
  const body = filledBody(layers, width, height, splitRow, face)
  const blend = Math.max(1, limits.hairBlendFaces * face.fh)
  const covered = new Uint8Array(width * height)
  const rowAt = (v) => Math.round(v)
  for (let y = 0; y < height; y += 1) {
    const bodyRow = rowAt(bottom - (bottom - y) / sy)
    const headRow = rowAt(y + lift)
    const w = Math.min(1, Math.max(0, (y - splitRow) / blend))
    const hairRow = rowAt((1 - w) * (y + lift) + w * (bottom - (bottom - y) / sy))
    for (let x = 0; x < width; x += 1) {
      const on = (bodyRow >= 0 && bodyRow < height && body[bodyRow * width + x])
        || (headRow >= 0 && headRow < height && head[headRow * width + x])
        || (hairRow >= 0 && hairRow < height && hair[hairRow * width + x])
      covered[y * width + x] = on ? 1 : 0
    }
  }
  const reach = 2 * Math.round(lift) + 2
  let holes = 0
  const above = new Int32Array(height)
  for (let x = 0; x < width; x += 1) {
    let lastCovered = -1
    for (let y = 0; y < height; y += 1) {
      if (covered[y * width + x]) lastCovered = y
      above[y] = lastCovered < 0 ? 1 << 30 : y - lastCovered
    }
    let nextCovered = Infinity
    for (let y = height - 1; y >= 0; y -= 1) {
      const i = y * width + x
      if (covered[i]) { nextCovered = y; continue }
      if (!fg[i]) continue
      if (above[y] <= reach && nextCovered - y <= reach) holes += 1
    }
  }
  return { holes, lift: Math.round(lift) }
}

/**
 * Photo texture of the cut-out face: `image` is stage B's raster
 * (`decodeLandmarkRaster`), background outside the working-size cutout
 * alpha painted white, measured on a face box derived from the landmarks.
 * @param {{ rgb: Uint8Array, width: number, height: number, pixelScale: number }} image
 * @param {{ alpha: Uint8Array, width: number, height: number, scale: number }} split
 * @param {number[][]} keypoints source pixels
 */
export function cutoutPhotoFeatures(image, split, keypoints) {
  const k = 1 / image.pixelScale
  const kp = keypoints.map((p) => [p[0] * k, p[1] * k, p[2] ?? 1])
  const g = faceGeometry(kp)
  const rgb = Uint8Array.from(image.rgb)
  const toWork = split.scale * image.pixelScale
  const x0 = Math.max(0, Math.floor(g.x0 - 0.8 * g.fw)), x1 = Math.min(image.width, Math.ceil(g.x1 + 0.8 * g.fw))
  const y0 = Math.max(0, Math.floor(g.brow - 0.7 * g.fh)), y1 = Math.min(image.height, Math.ceil(g.chin + 0.9 * g.fh))
  for (let y = y0; y < y1; y += 1) {
    const wy = Math.min(split.height - 1, Math.floor(y * toWork))
    for (let x = x0; x < x1; x += 1) {
      const wx = Math.min(split.width - 1, Math.floor(x * toWork))
      if (split.alpha[wy * split.width + wx] < 128) rgb.fill(255, (y * image.width + x) * 3, (y * image.width + x) * 3 + 3)
    }
  }
  const bbox = [g.x0 - 0.1 * g.fw, g.brow - 0.3 * g.fh, g.x1 + 0.1 * g.fw, g.chin + 0.1 * g.fh]
  return photoTextureFeatures({ rgb, alpha: null, width: image.width, height: image.height }, { bbox, keypoints: kp })
}

/**
 * @param {{ hair: Uint8Array, head: Uint8Array, body: Uint8Array, alpha: Uint8Array, width: number, height: number, scale: number, split: number }} split
 * @param {number[][]} keypoints 28 landmarks in source pixels (`split.scale` maps them to the masks)
 * @param {{ rgb: Uint8Array, width: number, height: number, pixelScale: number } | null} [landmarkRaster] stage B's raster for the photo check
 */
export function measurePortraitQuality(split, keypoints, landmarkRaster = null) {
  const { width, height, scale } = split
  const n = width * height
  const kp = keypoints.map((p) => [p[0] * scale, p[1] * scale, p[2] ?? 1])
  const g = faceGeometry(kp)
  const poly = [...g.contour, [g.contour[4][0], g.brow], [g.contour[0][0], g.brow]]
  const fg = new Uint8Array(n)
  let fgCount = 0
  for (let i = 0; i < n; i += 1) if (split.alpha[i] > 127) { fg[i] = 1; fgCount += 1 }
  let face = 0, faceFg = 0, faceHead = 0
  const ys = poly.map((p) => p[1])
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(height, Math.ceil(Math.max(...ys)))
  const x0 = Math.max(0, Math.floor(g.x0)), x1 = Math.min(width, Math.ceil(g.x1))
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!insidePolygon(poly, x + 0.5, y + 0.5)) continue
      const i = y * width + x
      face += 1
      if (!fg[i]) continue
      faceFg += 1
      if (split.head[i]) faceHead += 1
    }
  }
  const { stats } = connectedComponents(fg, width, height)
  let largest = 0
  for (let l = 1; l < stats.length; l += 1) largest = Math.max(largest, stats[l].area)
  const share = (mask) => { let c = 0; for (let i = 0; i < n; i += 1) if (mask[i] && fg[i]) c += 1; return c / Math.max(fgCount, 1) }
  const faceBox = { fw: g.fw, fh: g.fh, cx: (g.x0 + g.x1) / 2, chin: g.chin }
  const { holes, lift } = breathingHoles({ hair: split.hair, head: split.head, body: split.body, fg }, width, height, split.split, faceBox)
  const photo = landmarkRaster ? cutoutPhotoFeatures(landmarkRaster, split, keypoints) : null
  const r3 = (v) => Math.round(v * 1000) / 1000
  return {
    foreground: r3(fgCount / n),
    faceCovered: r3(faceFg / Math.max(face, 1)),
    largestComponent: r3(largest / Math.max(fgCount, 1)),
    photoFlat: photo ? r3(photo.flat) : null,
    photoSkinGrain: photo && photo.skinGrain !== null ? r3(photo.skinGrain) : null,
    photo: isPhotoTexture(photo),
    hairShare: r3(share(split.hair)),
    headShare: r3(share(split.head)),
    bodyShare: r3(share(split.body)),
    faceInHead: r3(faceHead / Math.max(faceFg, 1)),
    holeArea: r3(holes / Math.max(g.fw * g.fh, 1)),
    breathLift: lift,
  }
}

/**
 * First failing check, or null when the draft is usable.
 * @param {ReturnType<typeof measurePortraitQuality>} q
 * @param {string | null | undefined} mouthCheck the face check's mouth decision
 * @returns {{ reasonCode: string, detail: string | null } | null}
 */
export function judgePortraitQuality(q, mouthCheck) {
  const limits = PORTRAIT_QUALITY_LIMITS
  const D = PORTRAIT_DRAFT_REASONS
  if (q.faceCovered < limits.minFaceCovered) return { reasonCode: D.BACKGROUND_NOT_SEPARABLE, detail: 'face_not_covered' }
  if (q.largestComponent < limits.minLargestComponent) return { reasonCode: D.BACKGROUND_NOT_SEPARABLE, detail: 'fragmented' }
  if (q.photo) return { reasonCode: D.PHOTO_NOT_ILLUSTRATION, detail: null }
  if (mouthCheck) return { reasonCode: D.MOUTH_UNRELIABLE, detail: mouthCheck }
  if (q.headShare < limits.minHeadShare) return { reasonCode: D.LAYERS_INCOMPLETE, detail: 'missing_head' }
  if (q.bodyShare < limits.minBodyShare) return { reasonCode: D.LAYERS_INCOMPLETE, detail: 'missing_body' }
  if (q.hairShare < limits.minHairShare) return { reasonCode: D.LAYERS_INCOMPLETE, detail: 'missing_hair' }
  if (q.faceInHead < limits.minFaceInHead) return { reasonCode: D.LAYERS_INCOMPLETE, detail: 'face_split' }
  if (q.holeArea > limits.maxHoleArea) return { reasonCode: D.BREATHING_HOLES, detail: null }
  return null
}
