import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import {
  ANIME_FACE_MODEL_SPEC,
  boxToCenterScale,
  decodeDetections,
  decodeHeatmaps,
  detectAnimeFaces,
  enlargeBox,
  nonMaxSuppression,
  prepareDetectorInput,
  resizeRgbBilinear,
} from '../electron/services/portraitGenerator/animeFaceModel.js'
import {
  LANDMARK_MODEL_FILES,
  inspectLandmarkModels,
  resolveLandmarkModelDirectory,
} from '../electron/services/portraitGenerator/landmarkModels.js'
import {
  PORTRAIT_LANDMARK_GATE_LIMITS,
  evaluatePortraitLandmarks,
  mouthCoveredDecision,
  sideFeatures,
} from '../electron/services/portraitGenerator/landmarkGate.js'
import {
  combinePortraitGateStages,
  createPortraitLandmarkStage,
  runPortraitLandmarkStage,
} from '../electron/services/portraitGenerator/landmarkStage.js'
import { contrastNormalizeRgb, evaluateLandmarksWithSessions } from '../electron/services/portraitGenerator/landmarkEngine.js'
import { checkPortraitImageFromPayload } from '../electron/services/portraitGenerator/rejectImage.js'
import {
  PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS,
  PORTRAIT_LANDMARK_GATE_REASONS,
  isPortraitLandmarkGateReason,
} from '../shared/portraitLandmarkGate.js'
import { PORTRAIT_IMAGE_GATE_MESSAGE_KEYS } from '../shared/portraitImageGate.js'
import { enSettingsWindow } from '../src/i18n/locales/en/settings-window.ts'
import { jaSettingsWindow } from '../src/i18n/locales/ja/settings-window.ts'
import { koSettingsWindow } from '../src/i18n/locales/ko/settings-window.ts'
import { zhCNSettingsWindow } from '../src/i18n/locales/zh-CN/settings-window.ts'
import { zhTWSettingsWindow } from '../src/i18n/locales/zh-TW/settings-window.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const R = PORTRAIT_LANDMARK_GATE_REASONS
let workDir = ''

before(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-landmark-gate-'))
})

after(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true })
})

type Point = [number, number, number]
type Face = { bbox: number[], keypoints: Point[] }

/** 28 frontal landmarks for a face centred at (cx, cy) with face width fw (contour 0-4, brows, eyes, nose, mouth). */
function frontalKeypoints(cx = 300, cy = 300, fw = 200, confidence = 0.9): Point[] {
  const s = fw / 200
  const p = (dx: number, dy: number, c = confidence): Point => [cx + dx * s, cy + dy * s, c]
  const eye = (ex: number) => [p(ex - 15, -35), p(ex - 8, -42), p(ex + 8, -42), p(ex + 15, -35), p(ex + 8, -28), p(ex - 8, -28)]
  return [
    p(-100, -50), p(-85, 50), p(0, 100), p(85, 50), p(100, -50),
    p(-70, -85), p(-50, -88), p(-30, -85), p(30, -85), p(50, -88), p(70, -85),
    ...eye(-50), ...eye(50),
    p(0, 20),
    p(-15, 60), p(0, 55), p(15, 60), p(0, 65),
  ]
}

function faceAt(cx = 300, cy = 300, fw = 200, score = 0.95, confidence = 0.9): Face {
  return { bbox: [cx - fw * 0.6, cy - fw * 0.7, cx + fw * 0.6, cy + fw * 0.6, score], keypoints: frontalKeypoints(cx, cy, fw, confidence) }
}

const detectorReturning = (byVariant: Partial<Record<'original' | 'normalized', Face[]>>) => {
  const calls: string[] = []
  return {
    calls,
    detect: async (variant: 'original' | 'normalized') => {
      calls.push(variant)
      return byVariant[variant] ?? []
    },
  }
}

const blankImage = (width = 600, height = 700) => ({ rgb: new Uint8Array(width * height * 3).fill(255), alpha: null, width, height })

// ------------------------------------------------------------ synthetic painted faces

type RGB = [number, number, number]
const SKIN_TONES: Record<string, RGB> = { light: [250, 226, 208], tan: [196, 140, 96], dark: [92, 58, 40] }
const scale = (c: RGB, k: number): RGB => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))) as RGB

function insidePolygon(points: number[][], x: number, y: number) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * A flat-shaded half-body "illustration" matching frontalKeypoints(): face in
 * the given skin tone with a cel-shadow band, a highlight, painted lips, dark
 * eyes, a shadowed neck and a shirt, on white. Options add a fan across the
 * mouth or a raised hand beside the face.
 */
function paintFace(skin: RGB, options: { fan?: boolean, hand?: boolean | 'far' | 'shoulder' } = {}) {
  const width = 600
  const height = 700
  const rgb = new Uint8Array(width * height * 3).fill(255)
  const set = (x: number, y: number, c: RGB) => rgb.set(c, (y * width + x) * 3)
  const kp = frontalKeypoints()
  const facePoly = [...kp.slice(0, 5).map((p) => [p[0], p[1]]), [400, 150], [200, 150]]
  const lips = scale([skin[0], skin[1] * 0.55, skin[2] * 0.6] as RGB, 0.75)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (y >= 480 && x >= 150 && x < 450) set(x, y, [40, 70, 160])
      else if (y >= 380 && y < 480 && x >= 262 && x < 338) set(x, y, scale(skin, 0.8))
      if (insidePolygon(facePoly, x + 0.5, y + 0.5)) {
        let c = skin
        if (x < 235 && y > 250) c = scale(skin, 0.78)
        if ((x - 320) ** 2 / 30 ** 2 + (y - 385) ** 2 / 10 ** 2 < 1) c = scale(skin, 1.12)
        set(x, y, c)
      }
      for (const ex of [250, 350]) {
        if ((x - ex) ** 2 / 17 ** 2 + (y - 265) ** 2 / 11 ** 2 < 1) set(x, y, [45, 30, 25])
      }
      if (y >= 213 && y < 218 && ((x > 228 && x < 272) || (x > 328 && x < 372))) set(x, y, [40, 30, 25])
      if ((x - 300) ** 2 / 17 ** 2 + (y - 360) ** 2 / 6 ** 2 < 1) set(x, y, lips)
      if (options.fan && x >= 170 && x < 430 && y >= 345 && y < 470) {
        const edge = x < 173 || x >= 427 || y < 348 || y >= 467
        set(x, y, edge ? [30, 20, 40] : [120, 70, 170])
      }
      if (options.hand === true && x >= 425 && x < 475 && y >= 300 && y < 470) set(x, y, skin)
      // an arm raised out beside the body: same blob, 0.35 face widths clear of the face box
      if (options.hand === 'far' && x >= 470 && x < 520 && y >= 300 && y < 470) set(x, y, skin)
      // bare shoulder rising beside the jaw, joined to the neck skin across a thin outline stroke
      if (options.hand === 'shoulder' && ((x >= 425 && x < 475 && y >= 300 && y < 470) || (x >= 300 && x < 475 && y >= 430 && y < 470))) {
        set(x, y, x >= 380 && x < 383 ? [30, 20, 25] : skin)
      }
    }
  }
  return { rgb, alpha: null, width, height }
}

// ------------------------------------------------------------ model pre/post-processing

test('bilinear resize keeps flat images flat and averages a 2x2 block', () => {
  const flat = new Uint8Array(4 * 4 * 3).fill(77)
  assert.ok(resizeRgbBilinear(flat, 4, 4, 3, 5).every((v) => v === 77))
  const block = Uint8Array.from([0, 0, 0, 100, 100, 100, 100, 100, 100, 200, 200, 200])
  assert.deepEqual([...resizeRgbBilinear(block, 2, 2, 1, 1)], [100, 100, 100])
})

test('detector input: long side 608, zero padding to a multiple of 32, CHW in [0, 1]', () => {
  const rgb = new Uint8Array(1000 * 700 * 3).fill(255)
  const input = prepareDetectorInput(rgb, 1000, 700)
  assert.deepEqual(input.tensor.dims, [1, 3, 448, 608])
  assert.ok(Math.abs(input.scaleX - 0.608) < 1e-9)
  assert.equal(input.tensor.data[0], 1)
  assert.equal(input.tensor.data[447 * 608 + 5], 0, 'rows past the resized height are zero padding')
})

test('YOLO decode places a confident cell at its anchor box and NMS drops the duplicate', () => {
  const head = (grid: number) => ({ data: new Float32Array(18 * grid * grid).fill(-20), dims: [1, 18, grid, grid] })
  const p32 = head(2)
  const p16 = head(4)
  const p8 = head(8)
  const plane = 4 * 4
  // stride 16, cell (gx=1, gy=2), anchor 1 = 62x45; zero offsets -> centre (24, 40)
  for (const channel of [0, 1, 2, 3]) p16.data[(1 * 6 + channel) * plane + 2 * 4 + 1] = 0
  p16.data[(1 * 6 + 4) * plane + 2 * 4 + 1] = 6
  p16.data[(1 * 6 + 5) * plane + 2 * 4 + 1] = 6
  // a weaker, overlapping duplicate: same anchor, neighbouring cell (gx=2)
  for (const channel of [0, 1, 2, 3]) p16.data[(1 * 6 + channel) * plane + 2 * 4 + 2] = 0
  p16.data[(1 * 6 + 4) * plane + 2 * 4 + 2] = 1
  p16.data[(1 * 6 + 5) * plane + 2 * 4 + 2] = 1
  const boxes = decodeDetections([p32, p16, p8], 0.5, 0.5)
  assert.equal(boxes.length, 1)
  const [x0, y0, x1, y1, score] = boxes[0]
  assert.ok(Math.abs(x0 - (24 - 31) / 0.5) < 1e-6 && Math.abs(x1 - (24 + 31) / 0.5) < 1e-6)
  assert.ok(Math.abs(y0 - (40 - 22.5) / 0.5) < 1e-6 && Math.abs(y1 - (40 + 22.5) / 0.5) < 1e-6)
  assert.ok(score > 0.99)
  assert.equal(nonMaxSuppression([[0, 0, 10, 10, 0.9], [1, 1, 11, 11, 0.8], [50, 50, 60, 60, 0.7]], 0.45, 100).length, 2)
})

test('box enlargement and square crop centre/scale follow the landmark stage', () => {
  const box = enlargeBox([100, 100, 199, 149, 0.9])
  assert.ok(Math.abs(box[2] - box[0] - 110) < 1e-9 && Math.abs(box[3] - box[1] - 55) < 1e-9)
  assert.equal(box[4], 0.9)
  const { center, scale } = boxToCenterScale([0, 0, 200, 100])
  assert.deepEqual(center, [100, 50])
  assert.deepEqual(scale, [1.25, 1.25])
})

test('DARK heatmap decoding recovers a sub-pixel peak and maps it back to the image', () => {
  const W = 64
  const heat = new Float32Array(2 * W * W)
  const peaks = [[20.3, 30.7], [40.6, 12.2]]
  peaks.forEach(([px, py], k) => {
    for (let y = 0; y < W; y += 1) for (let x = 0; x < W; x += 1) heat[k * W * W + y * W + x] = 0.8 * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / 8)
  })
  // crop centre (128, 128), scale 1.28 -> 256 px crop -> 4 image px per heatmap px
  const keypoints = decodeHeatmaps(heat, W, W, [128, 128], [1.28, 1.28])
  peaks.forEach(([px, py], k) => {
    assert.ok(Math.abs(keypoints[k][0] - px * 4) < 0.4, `x ${keypoints[k][0]} vs ${px * 4}`)
    assert.ok(Math.abs(keypoints[k][1] - py * 4) < 0.4, `y ${keypoints[k][1]} vs ${py * 4}`)
    assert.ok(keypoints[k][2] > 0.75 && keypoints[k][2] <= 0.8)
  })
})

test('detectAnimeFaces wires both sessions with the exported input/output names', async () => {
  const seen: Record<string, number[]> = {}
  const head = (grid: number) => ({ data: new Float32Array(18 * grid * grid).fill(-20), dims: [1, 18, grid, grid] })
  const sessions = {
    detector: {
      run: async (feeds: Record<string, { dims: number[] }>) => {
        seen.detector = feeds[ANIME_FACE_MODEL_SPEC.detectorInputName].dims
        const [, , h, w] = seen.detector
        const p32 = head(h / 32)
        const cell = 0
        p32.data[4 * (h / 32) * (w / 32) + cell] = 8
        p32.data[5 * (h / 32) * (w / 32) + cell] = 8
        return { p32: { data: p32.data, dims: [1, 18, h / 32, w / 32] }, p16: { ...head(1), dims: [1, 18, h / 16, w / 16], data: new Float32Array(18 * (h / 16) * (w / 16)).fill(-20) }, p8: { dims: [1, 18, h / 8, w / 8], data: new Float32Array(18 * (h / 8) * (w / 8)).fill(-20) } }
      },
    },
    landmarks: {
      run: async (feeds: Record<string, { dims: number[] }>) => {
        seen.landmarks = feeds[ANIME_FACE_MODEL_SPEC.landmarkInputName].dims
        const n = seen.landmarks[0]
        const data = new Float32Array(n * 28 * 64 * 64)
        for (let i = 0; i < n * 28; i += 1) data[i * 4096 + 32 * 64 + 32] = 0.9
        return { heatmaps: { data, dims: [n, 28, 64, 64] } }
      },
    },
  }
  const faces = await detectAnimeFaces({ rgb: new Uint8Array(640 * 640 * 3).fill(200), width: 640, height: 640 }, sessions)
  assert.deepEqual(seen.detector, [1, 3, 608, 608])
  assert.deepEqual(seen.landmarks, [1, 3, 256, 256])
  assert.equal(faces.length, 1)
  assert.equal(faces[0].keypoints.length, 28)
  assert.ok(faces[0].keypoints.every((k) => Math.abs(k[2] - 0.9) < 1e-6))
})

// ------------------------------------------------------------ model files + lazy loading

test('model spec pins both files by size and SHA-256 and lives under userData/models', () => {
  assert.equal(LANDMARK_MODEL_FILES.detector.sizeBytes, 246_035_424)
  assert.equal(LANDMARK_MODEL_FILES.landmarks.sizeBytes, 39_046_070)
  for (const spec of Object.values(LANDMARK_MODEL_FILES)) assert.match(spec.sha256, /^[a-f0-9]{64}$/)
  assert.equal(resolveLandmarkModelDirectory('/u'), path.join('/u', 'models', 'portrait-landmarks'))
})

test('model inspection reports missing, size, and hash problems and remembers a verified file', async () => {
  const dir = path.join(workDir, 'models')
  await fs.mkdir(dir, { recursive: true })
  const bytes = { detector: Buffer.from('detector-bytes'), landmarks: Buffer.from('landmark-bytes!') }
  const files = {
    detector: { fileName: 'd.onnx', sizeBytes: bytes.detector.length, sha256: createHash('sha256').update(bytes.detector).digest('hex') },
    landmarks: { fileName: 'l.onnx', sizeBytes: bytes.landmarks.length, sha256: createHash('sha256').update(bytes.landmarks).digest('hex') },
  }
  assert.equal((await inspectLandmarkModels(dir, { files })).files.detector.status, 'missing')
  await fs.writeFile(path.join(dir, 'd.onnx'), bytes.detector)
  await fs.writeFile(path.join(dir, 'l.onnx'), Buffer.from('landmark-bytes?'))
  const wrongHash = await inspectLandmarkModels(dir, { files })
  assert.equal(wrongHash.files.detector.status, 'ok')
  assert.equal(wrongHash.files.landmarks.status, 'hash_mismatch')
  await fs.writeFile(path.join(dir, 'l.onnx'), Buffer.from('short'))
  assert.equal((await inspectLandmarkModels(dir, { files })).files.landmarks.status, 'size_mismatch')


  await fs.writeFile(path.join(dir, 'l.onnx'), bytes.landmarks)
  let hashed = 0
  const hashFile = async (filePath: string) => { hashed += 1; return createHash('sha256').update(await fs.readFile(filePath)).digest('hex') }
  assert.equal((await inspectLandmarkModels(dir, { files, hashFile })).ready, true)
  const first = hashed
  assert.equal((await inspectLandmarkModels(dir, { files, hashFile })).ready, true)
  assert.equal(hashed, first, 'an unchanged verified file is not re-hashed')
  await fs.writeFile(path.join(dir, 'l.onnx'), Buffer.from('landmark-bytes?'))
  await fs.utimes(path.join(dir, 'l.onnx'), new Date(), new Date(Date.now() + 5000))
  assert.equal((await inspectLandmarkModels(dir, { files, hashFile })).files.landmarks.status, 'hash_mismatch', 'a rewritten file is hashed again')
})

// ------------------------------------------------------------ rules

test('no face (even after the contrast retry) answers half_body_only, not "no face found"', async () => {
  const detector = detectorReturning({})
  const result = await evaluatePortraitLandmarks(blankImage(), detector)
  assert.equal(result.reasonCode, R.HALF_BODY_ONLY)
  assert.equal(result.detail, 'no_face')
  assert.equal(result.messageKey, PORTRAIT_IMAGE_GATE_MESSAGE_KEYS.half_body_only, 'shares the stage-A half-body copy')
  assert.deepEqual(detector.calls, ['original', 'normalized'])
})

test('the contrast-normalised retry can find a face the first pass missed (very dark skin)', async () => {
  const result = await evaluatePortraitLandmarks(paintFace(SKIN_TONES.dark), detectorReturning({ normalized: [faceAt()] }))
  assert.equal(result.accepted, true, JSON.stringify(result))
  assert.equal(result.metrics.normalizedRetry, true)
})

test('two characters, small faces, and weak or tiny detections', async () => {
  const two = await evaluatePortraitLandmarks(blankImage(), detectorReturning({ original: [faceAt(150, 300, 150), faceAt(450, 300, 140)] }))
  assert.equal(two.reasonCode, R.MULTIPLE_CHARACTERS)
  assert.deepEqual(two.messageParams, { count: 2 })

  const background = faceAt(500, 100, 40)
  const single = await evaluatePortraitLandmarks(paintFace(SKIN_TONES.light), detectorReturning({ original: [faceAt(), background, { ...faceAt(), bbox: [0, 0, 300, 300, 0.3] }] }))
  assert.equal(single.metrics.faces, 1, 'faces under 40% of the largest or below score 0.5 are ignored')

  const small = await evaluatePortraitLandmarks(blankImage(), detectorReturning({ original: [faceAt(300, 300, 60)] }))
  assert.equal(small.reasonCode, R.HALF_BODY_ONLY)
  assert.equal(small.detail, 'face_small')
  const scaled = await evaluatePortraitLandmarks({ ...blankImage(), pixelScale: 3 }, detectorReturning({ original: [faceAt(300, 300, 60)] }))
  assert.notEqual(scaled.detail, 'face_small', 'face size is judged in original pixels')
})

test('face size measures both original-image axes at the unchanged 96-pixel boundary', async () => {
  const face = { ...faceAt(), bbox: [200, 200, 400, 248, 0.95] }
  for (const [pixelScaleX, pixelScaleY, expectedSize, small] of [
    [1, 1.99, 96, true], [1, 2, 96, false], [0.47, 3, 94, true], [0.48, 3, 96, false],
  ] as const) {
    const result = await evaluatePortraitLandmarks(
      { ...blankImage(), pixelScale: 3, pixelScaleX, pixelScaleY },
      detectorReturning({ original: [face] }),
    )
    assert.equal(result.metrics.facePx, expectedSize)
    assert.equal(result.detail === 'face_small', small, `${pixelScaleX}, ${pixelScaleY}`)
  }
})

test('each absent original-image axis keeps the legacy pixelScale fallback', async () => {
  const face = { ...faceAt(), bbox: [200, 200, 400, 248, 0.95] }
  for (const [scales, expectedSize] of [
    [{ pixelScale: 2 }, 96],
    [{ pixelScale: 2, pixelScaleX: 3 }, 96],
    [{ pixelScale: 2, pixelScaleY: 4 }, 192],
    [{ pixelScaleY: 3 }, 144],
  ] as const) {
    const result = await evaluatePortraitLandmarks({ ...blankImage(), ...scales }, detectorReturning({ original: [face] }))
    assert.equal(result.metrics.facePx, expectedSize)
    assert.notEqual(result.detail, 'face_small')
  }
})

test('broken eye landmarks say eyes_unclear, never side_view; only real profiles get side_view', async () => {
  const broken = faceAt()
  broken.keypoints = broken.keypoints.map((k, i) => (i >= 17 && i < 23 ? [k[0] + 800, k[1], 0.1] : k)) as Point[]
  assert.ok(sideFeatures(broken.keypoints).eyeSpacing > PORTRAIT_LANDMARK_GATE_LIMITS.maxEyeSpacing)
  const brokenResult = await evaluatePortraitLandmarks(blankImage(), detectorReturning({ original: [broken] }))
  assert.equal(brokenResult.reasonCode, R.EYES_UNCLEAR)
  assert.equal(brokenResult.detail, 'eye_landmarks_broken')

  const outside = faceAt()
  outside.keypoints = outside.keypoints.map((k, i) => (i >= 11 && i < 17 ? [k[0] - 120, k[1], k[2]] : k)) as Point[]
  assert.equal((await evaluatePortraitLandmarks(blankImage(), detectorReturning({ original: [outside] }))).reasonCode, R.EYES_UNCLEAR)

  const profile = faceAt()
  profile.keypoints = profile.keypoints.map((k, i) => (i >= 11 && i < 23 ? [k[0] * 0.15 + 340 * 0.85 + (i < 17 ? -6 : 6), k[1], k[2]] : k)) as Point[]
  const side = await evaluatePortraitLandmarks(blankImage(), detectorReturning({ original: [profile] }))
  assert.equal(side.reasonCode, R.SIDE_VIEW)

  const threeQuarter = faceAt()
  threeQuarter.keypoints = threeQuarter.keypoints.map((k, i) => (i >= 11 && i < 23 ? [k[0] + 45, k[1], k[2]] : k)) as Point[]
  const tq = sideFeatures(threeQuarter.keypoints)
  assert.ok(tq.contourSymmetry > PORTRAIT_LANDMARK_GATE_LIMITS.minContourSymmetry && tq.contourSymmetry < 0.45, 'a strong 3/4 view passes the loosened 0.33 limit')
})

test('mouth decision: missing landmarks, broken order, and an object across the mouth', () => {
  const visible = { mouthConfidence: 0.9, landmarkOrder: 0.25 }
  assert.equal(mouthCoveredDecision({ ...visible, mouthConfidence: 0.1 }, null), 'mouth_landmarks_missing')
  assert.equal(mouthCoveredDecision({ ...visible, landmarkOrder: 0.02 }, null), 'landmark_order')
  assert.equal(mouthCoveredDecision(visible, { occluderCover: 0.3, occluderWidth: 1.2, occluderOutside: 5 }), 'object_across_mouth')
  assert.equal(mouthCoveredDecision(visible, { occluderCover: 0.9, occluderWidth: 0.2, occluderOutside: 0 }), null, 'painted lips are narrow and stay inside the jaw')
  assert.equal(mouthCoveredDecision(visible, null), null)
})

test('skin tone never decides mouth_covered: light, tan and dark painted faces pass; a fan is caught on all three', async () => {
  for (const [name, skin] of Object.entries(SKIN_TONES)) {
    const clear = await evaluatePortraitLandmarks(paintFace(skin), detectorReturning({ original: [faceAt()] }))
    assert.equal(clear.accepted, true, `${name}: ${JSON.stringify(clear)}`)
    assert.ok((clear.metrics.occluderWidth as number) < PORTRAIT_LANDMARK_GATE_LIMITS.occluderMinWidth)

    const fan = await evaluatePortraitLandmarks(paintFace(skin, { fan: true }), detectorReturning({ original: [faceAt()] }))
    assert.equal(fan.reasonCode, R.MOUTH_COVERED, `${name}: ${JSON.stringify(fan)}`)
    assert.equal(fan.detail, 'object_across_mouth')
  }
})

test('a low-confidence mouth is retried on the contrast-normalised image, and only a real gain counts', async () => {
  const unsure = faceAt()
  unsure.keypoints = unsure.keypoints.map((k, i) => (i >= 24 ? [k[0], k[1], 0.12] : k)) as Point[]
  const rescued = await evaluatePortraitLandmarks(paintFace(SKIN_TONES.dark), detectorReturning({ original: [unsure], normalized: [faceAt(300, 300, 200, 0.95, 0.8)] }))
  assert.equal(rescued.accepted, true, JSON.stringify(rescued))
  assert.equal(rescued.metrics.normalizedRetry, true)

  const covered = faceAt()
  covered.keypoints = covered.keypoints.map((k, i) => (i >= 24 ? [k[0], k[1], 0.12] : k)) as Point[]
  const stillCovered = await evaluatePortraitLandmarks(paintFace(SKIN_TONES.light), detectorReturning({ original: [covered], normalized: [covered] }))
  assert.equal(stillCovered.reasonCode, R.MOUTH_COVERED)
  assert.equal(stillCovered.detail, 'mouth_landmarks_missing')
})

test('a raised hand beside the face is caught for every skin tone', async () => {
  for (const [name, skin] of Object.entries(SKIN_TONES)) {
    const result = await evaluatePortraitLandmarks(paintFace(skin, { hand: true }), detectorReturning({ original: [faceAt()] }))
    assert.equal(result.reasonCode, R.HANDS_NEAR_FACE, `${name}: ${JSON.stringify(result)}`)
  }
})

test('an arm raised out beside the body and bare shoulders joined to the neck are not hands, for every skin tone', async () => {
  for (const [name, skin] of Object.entries(SKIN_TONES)) {
    const far = await evaluatePortraitLandmarks(paintFace(skin, { hand: 'far' }), detectorReturning({ original: [faceAt()] }))
    assert.equal(far.reasonCode, null, `far ${name}: ${JSON.stringify(far)}`)
    const shoulder = await evaluatePortraitLandmarks(paintFace(skin, { hand: 'shoulder' }), detectorReturning({ original: [faceAt()] }))
    assert.equal(shoulder.reasonCode, null, `shoulder ${name}: ${JSON.stringify(shoulder)}`)
  }
})

// ------------------------------------------------------------ stage runner

for (const [width, height, orientation] of [[1705, 2375, 1], [2375, 1705, 1], [1705, 2375, 6], [675, 900, 1]]) {
  test(`stage runner returns the source-image centre after integer resize: ${width}x${height}, EXIF ${orientation}`, async () => {
    const buffer = await sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
      .withMetadata({ orientation }).png().toBuffer()
    const result = await runPortraitLandmarkStage({ buffer }, {
      prepare: async () => ({ status: 'ready' }),
      evaluate: async (image) => ({ accepted: true, keypoints: [[image.width / 2, image.height / 2, 0.75]] }),
    }, { keepKeypoints: true })
    const expected = orientation >= 5 ? [height / 2, width / 2, 0.75] : [width / 2, height / 2, 0.75]
    assert.ok(Math.abs(result.keypoints[0][0] - expected[0]) < 1e-9)
    assert.ok(Math.abs(result.keypoints[0][1] - expected[1]) < 1e-9)
    assert.equal(result.keypoints[0][2], expected[2], 'confidence is not a coordinate')
    assert.deepEqual(result.geometry.source, { width: expected[0] * 2, height: expected[1] * 2 })
    const decoded = await sharp(buffer).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true })
    assert.deepEqual(result.geometry.analysis, { width: decoded.info.width, height: decoded.info.height })
  })
}

test('stage runner: missing models keep the stage-A verdict; a no-face image runs both passes', async () => {
  const filePath = path.join(workDir, 'plain.png')
  await sharp({ create: { width: 640, height: 800, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toFile(filePath)

  const engineOver = (sessions: object) => ({ prepare: async () => ({ status: 'ready' }), evaluate: (image: object) => evaluateLandmarksWithSessions(image as never, sessions as never) })
  const missing = await runPortraitLandmarkStage({ filePath }, { prepare: async () => ({ status: 'missing' }), evaluate: async () => { throw new Error('not reached') } })
  assert.equal(missing.reasonCode, R.MODELS_UNAVAILABLE)
  assert.equal(missing.detail, 'missing')

  let detectorRuns = 0
  const empty = (h: number, w: number, stride: number) => ({ data: new Float32Array(18 * (h / stride) * (w / stride)).fill(-20), dims: [1, 18, h / stride, w / stride] })
  const sessions = {
    detector: { run: async (feeds: Record<string, { dims: number[] }>) => {
      detectorRuns += 1
      const [, , h, w] = feeds.image.dims
      return { p32: empty(h, w, 32), p16: empty(h, w, 16), p8: empty(h, w, 8) }
    } },
    landmarks: { run: async () => { throw new Error('not reached') } },
  }
  const result = await runPortraitLandmarkStage({ filePath }, engineOver(sessions))
  assert.equal(result.reasonCode, R.HALF_BODY_ONLY)
  assert.equal(detectorRuns, 2)

  const broken = await runPortraitLandmarkStage({ buffer: Buffer.from('nope') }, engineOver(sessions))
  assert.equal(broken.reasonCode, R.MODELS_UNAVAILABLE)
  assert.equal(broken.detail, 'analysis_failed')
  const throwing = await runPortraitLandmarkStage({ filePath }, { prepare: async () => ({ status: 'ready' }), evaluate: async () => { throw new Error('worker died') } })
  assert.equal(throwing.detail, 'analysis_failed', 'an engine failure never rejects the image')
})

test('contrast normalisation stretches a dim, low-contrast image and keeps a flat image flat', () => {
  const width = 256
  const height = 256
  const dim = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) dim.fill(10 + Math.floor((30 * ((x * 7 + y * 3) % width)) / width), (y * width + x) * 3, (y * width + x) * 3 + 3)
  const out = contrastNormalizeRgb(dim, width, height)
  const range = (a: Uint8Array) => a.reduce((m, v) => Math.max(m, v), 0) - a.reduce((m, v) => Math.min(m, v), 255)
  assert.ok(range(out) > range(dim) * 2, `range ${range(dim)} -> ${range(out)}`)
  const flat = contrastNormalizeRgb(new Uint8Array(width * height * 3).fill(128), width, height)
  assert.equal(range(flat), 0)
})

test('stage B is lazy, only runs after stage A accepts, and unavailable models never reject', async () => {
  const stageA = { accepted: true, reasonCode: null, messageKey: 'settings.pet.portrait_gate.accepted', messageParams: {}, metrics: { width: 800 } }
  const unavailable = combinePortraitGateStages(stageA, { accepted: false, reasonCode: R.MODELS_UNAVAILABLE, detail: 'runtime_unavailable', messageKey: '', messageParams: {}, metrics: {} })
  assert.equal(unavailable.accepted, true)
  assert.equal(unavailable.landmarkStatus, 'runtime_unavailable')
  const rejected = combinePortraitGateStages(stageA, { accepted: false, reasonCode: R.SIDE_VIEW, detail: null, messageKey: PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS.side_view, messageParams: {}, metrics: { eyeSpacing: 0.02 } })
  assert.equal(rejected.reasonCode, R.SIDE_VIEW)
  assert.deepEqual(rejected.metrics, { width: 800, landmarks: { eyeSpacing: 0.02 } })

  let loaderBuilt = 0
  const stage = createPortraitLandmarkStage(() => { loaderBuilt += 1; return { prepare: async () => ({ status: 'runtime_unavailable' }), evaluate: async () => ({}) } })
  assert.equal(loaderBuilt, 0, 'nothing is built until an image is checked')

  const good = path.join(workDir, 'stage-a-good.png')
  const tiny = path.join(workDir, 'stage-a-tiny.png')
  const painted = paintFace(SKIN_TONES.tan)
  await sharp(Buffer.from(painted.rgb), { raw: { width: painted.width, height: painted.height, channels: 3 } }).png().toFile(good)
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toFile(tiny)
  const pickImagePath = async () => null
  const small = await checkPortraitImageFromPayload({ imagePath: tiny }, { pickImagePath, landmarkStage: stage })
  assert.equal(small?.reasonCode, 'too_small')
  assert.equal(loaderBuilt, 0, 'stage B is skipped when stage A rejects')
  const passed = await checkPortraitImageFromPayload({ imagePath: good }, { pickImagePath, landmarkStage: stage })
  assert.equal(passed?.accepted, true, JSON.stringify(passed))
  assert.equal(passed?.landmarkStatus, 'runtime_unavailable')
  assert.ok(!JSON.stringify(passed).includes(workDir), 'results never echo the image path')
})

// ------------------------------------------------------------ contract + boundaries

test('every landmark reason has a message key with copy in all five locales', () => {
  const tables = { enSettingsWindow, zhCNSettingsWindow, zhTWSettingsWindow, jaSettingsWindow, koSettingsWindow }
  for (const code of Object.values(R)) {
    assert.equal(isPortraitLandmarkGateReason(code), true)
    const key = PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS[code]
    for (const [locale, table] of Object.entries(tables)) assert.ok((table as Record<string, string>)[key], `${key} needs ${locale} copy`)
  }
  assert.match((zhCNSettingsWindow as Record<string, string>)[PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS.half_body_only], /0\.5 暂时只支持半身立绘/)
  assert.match((enSettingsWindow as Record<string, string>)[PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS.multiple_characters], /\{count\}/)
  assert.equal(isPortraitLandmarkGateReason('/Users/me/private.png'), false)
})

test('privacy boundary: landmark modules import only the shared contracts, sharp, onnxruntime-web, and node built-ins', async () => {
  const importsOf = async (file: string) => {
    const source = await fs.readFile(path.join(ROOT, 'electron/services/portraitGenerator', file), 'utf8')
    return [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort()
  }
  assert.deepEqual(await importsOf('animeFaceModel.js'), [])
  assert.deepEqual(await importsOf('landmarkGate.js'), ['../../../shared/portraitLandmarkGate.js'])
  assert.deepEqual(await importsOf('landmarkModels.js'), ['../../../shared/portraitModels.js', 'node:crypto', 'node:fs', 'node:fs/promises', 'node:path'])
  assert.deepEqual(await importsOf('landmarkStage.js'), ['../../../shared/portraitLandmarkGate.js', './landmarkGate.js', 'sharp'])
  assert.deepEqual(await importsOf('landmarkEngine.js'), ['./animeFaceModel.js', './landmarkGate.js'])
  assert.deepEqual(await importsOf('landmarkWorker.js'), ['./landmarkEngine.js', 'node:fs/promises', 'node:worker_threads'])
  assert.deepEqual(await importsOf('landmarkRuntime.js'), ['../asyncLock.js', './landmarkGate.js', './landmarkModels.js', 'node:module', 'node:os', 'node:url', 'node:worker_threads'])
})
