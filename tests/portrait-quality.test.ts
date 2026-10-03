import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PORTRAIT_QUALITY_LIMITS as L,
  breathingHoles,
  cutoutPhotoFeatures,
  judgePortraitQuality,
  measurePortraitQuality,
} from '../electron/services/portraitGenerator/portraitQuality.js'
import { PORTRAIT_DRAFT_REASONS as D } from '../shared/portraitDraft.js'

type Point = [number, number, number]

/** 28 frontal landmarks, face width 2 * 50 * s around (cx, cy). */
function frontalKeypoints(cx: number, cy: number, s: number): Point[] {
  const p = (dx: number, dy: number): Point => [cx + dx * s, cy + dy * s, 0.9]
  const eye = (ex: number) => [p(ex - 15, -35), p(ex - 8, -42), p(ex + 8, -42), p(ex + 15, -35), p(ex + 8, -28), p(ex - 8, -28)]
  return [
    p(-100, -50), p(-85, 50), p(0, 100), p(85, 50), p(100, -50),
    p(-70, -85), p(-50, -88), p(-30, -85), p(30, -85), p(50, -88), p(70, -85),
    ...eye(-50), ...eye(50), p(0, 20), p(-15, 60), p(0, 55), p(15, 60), p(0, 65),
  ]
}

const W = 200
const H = 240
/** A clean split: hair cap, head (face) rectangle, body below; alpha = union. */
function cleanSplit() {
  const n = W * H
  const hair = new Uint8Array(n)
  const head = new Uint8Array(n)
  const body = new Uint8Array(n)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x
      if (y >= 10 && y < 40 && x >= 40 && x < 160) hair[i] = 1
      else if (y >= 40 && y < 140 && x >= 45 && x < 155) head[i] = 1
      else if (y >= 140 && x >= 30 && x < 170) body[i] = 1
    }
  }
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) alpha[i] = hair[i] || head[i] || body[i] ? 255 : 0
  return { hair, head, body, alpha, width: W, height: H, scale: 1, split: 140 }
}
const keypoints = frontalKeypoints(100, 85, 0.5)

test('a clean split measures as whole and passes every check', () => {
  const q = measurePortraitQuality(cleanSplit(), keypoints)
  assert.equal(q.faceCovered, 1)
  assert.equal(q.largestComponent, 1)
  assert.equal(q.faceInHead, 1)
  assert.equal(q.holeArea, 0)
  assert.equal(judgePortraitQuality(q, null), null, JSON.stringify(q))
})

test('keypoints are scaled to the working masks by split.scale', () => {
  const q = measurePortraitQuality({ ...cleanSplit(), scale: 0.5 }, frontalKeypoints(200, 170, 1))
  assert.equal(q.faceCovered, 1)
})

test('cutout trust: a hole over the face or a detached background block is background_not_separable', () => {
  const holed = cleanSplit()
  for (let y = 60; y < 110; y += 1) for (let x = 60; x < 140; x += 1) holed.alpha[y * W + x] = 0
  const q = measurePortraitQuality(holed, keypoints)
  assert.ok(q.faceCovered < L.minFaceCovered, JSON.stringify(q))
  assert.deepEqual(judgePortraitQuality(q, null), { reasonCode: D.BACKGROUND_NOT_SEPARABLE, detail: 'face_not_covered' })

  const card = cleanSplit()
  // background panels kept on both sides, not touching the character
  for (let y = 0; y < H; y += 1) for (const x0 of [0, 175]) for (let x = x0; x < x0 + 25; x += 1) { card.alpha[y * W + x] = 255; card.body[y * W + x] = 1 }
  const c = measurePortraitQuality(card, keypoints)
  assert.ok(c.largestComponent < L.minLargestComponent, JSON.stringify(c))
  assert.deepEqual(judgePortraitQuality(c, null), { reasonCode: D.BACKGROUND_NOT_SEPARABLE, detail: 'fragmented' })
})

test('mouth: the face check\'s mouth decision becomes mouth_unreliable after a clean cutout', () => {
  const q = measurePortraitQuality(cleanSplit(), keypoints)
  for (const detail of ['mouth_landmarks_missing', 'landmark_order', 'object_across_mouth']) {
    assert.deepEqual(judgePortraitQuality(q, detail), { reasonCode: D.MOUTH_UNRELIABLE, detail })
  }
})

test('layers: a missing layer or a face cut out of the head layer is layers_incomplete', () => {
  const noHair = cleanSplit()
  for (let i = 0; i < noHair.hair.length; i += 1) if (noHair.hair[i]) { noHair.hair[i] = 0; noHair.head[i] = 1 }
  assert.deepEqual(judgePortraitQuality(measurePortraitQuality(noHair, keypoints), null), { reasonCode: D.LAYERS_INCOMPLETE, detail: 'missing_hair' })

  const faceInBody = cleanSplit()
  for (let y = 70; y < 140; y += 1) for (let x = 45; x < 155; x += 1) { faceInBody.head[y * W + x] = 0; faceInBody.body[y * W + x] = 1 }
  const q = measurePortraitQuality(faceInBody, keypoints)
  assert.ok(q.faceInHead < L.minFaceInHead, JSON.stringify(q))
  assert.deepEqual(judgePortraitQuality(q, null), { reasonCode: D.LAYERS_INCOMPLETE, detail: 'face_split' })

  const base = measurePortraitQuality(cleanSplit(), keypoints)
  assert.deepEqual(judgePortraitQuality({ ...base, headShare: L.minHeadShare / 2 }, null)?.detail, 'missing_head')
  assert.deepEqual(judgePortraitQuality({ ...base, bodyShare: L.minBodyShare / 2 }, null)?.detail, 'missing_body')
})

test('breathing: a head-layer piece hanging below the split tears a hole when lifted; hair over the body follows the body', () => {
  const width = 60
  const height = 200
  const n = width * height
  const make = (role: (x: number, y: number) => string | null) => {
    const layers = { hair: new Uint8Array(n), head: new Uint8Array(n), body: new Uint8Array(n), fg: new Uint8Array(n) }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const r = role(x, y)
        if (r === 'hair' || r === 'head' || r === 'body') { layers[r][y * width + x] = 1; layers.fg[y * width + x] = 1 }
      }
    }
    return layers
  }
  const face = { fw: 30, fh: 30, cx: 30, chin: 95 }
  const base = (x: number, y: number) => (y >= 30 && y < 40 && x >= 15 && x < 45 ? 'hair' : y >= 40 && y < 100 && x >= 15 && x < 45 ? 'head' : y >= 100 ? 'body' : null)
  const clean = breathingHoles(make(base), width, height, 100, face)
  assert.deepEqual(clean, { holes: 0, lift: 3 })
  const hand = breathingHoles(make((x, y) => (y >= 100 && y <= 140 && x < 6 ? 'head' : base(x, y))), width, height, 100, face)
  assert.equal(hand.holes, 6, 'the row under the lifted piece opens between it and the stretched body')
  const strand = breathingHoles(make((x, y) => (x >= 10 && x < 15 && y >= 30 && y < 170 ? 'hair' : base(x, y))), width, height, 100, face)
  assert.equal(strand.holes, 0, 'long hair over the body blends to the body motion and is filled behind')

  const q = measurePortraitQuality(cleanSplit(), keypoints)
  assert.deepEqual(judgePortraitQuality({ ...q, holeArea: L.maxHoleArea + 0.01 }, null), { reasonCode: D.BREATHING_HOLES, detail: null })
})

test('photo: the cut-out face is measured with the background painted white; a grainy photo face is photo_not_illustration', () => {
  // flat painted face on a busy (noisy) background: the background must not count
  const width = 240
  const height = 280
  const rgb = new Uint8Array(width * height * 3)
  let state = 7
  const noise = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % 255 }
  for (let i = 0; i < rgb.length; i += 1) rgb[i] = noise()
  const split = cleanSplit()
  const kp = frontalKeypoints(100, 85, 0.5)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wx = Math.min(W - 1, Math.floor(x * 200 / 240)), wy = Math.min(H - 1, Math.floor(y * 240 / 280))
      if (split.alpha[wy * W + wx] > 127) rgb.set([240, 210, 190], (y * width + x) * 3)
    }
  }
  const image = { rgb, width, height, pixelScale: 1 }
  const painted = cutoutPhotoFeatures(image, { ...split, scale: 200 / 240 }, kp.map(([x, y, c]) => [x * 240 / 200, y * 240 / 200, c]))
  assert.ok(painted && painted.flat > 0.5, JSON.stringify(painted))
  const q = measurePortraitQuality(split, keypoints)
  assert.equal(q.photo, false, 'no raster, no photo verdict')
  assert.deepEqual(judgePortraitQuality({ ...q, photo: true }, null), { reasonCode: D.PHOTO_NOT_ILLUSTRATION, detail: null })
  assert.deepEqual(judgePortraitQuality({ ...q, photo: true }, 'object_across_mouth')?.reasonCode, D.PHOTO_NOT_ILLUSTRATION, 'photo is reported before the mouth')
})
