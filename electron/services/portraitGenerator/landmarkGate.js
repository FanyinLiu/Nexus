/**
 * Portrait generator stage A, part 2: landmark-based rejection for the
 * narrowed v0.5 scope (plain/transparent background, frontal to 3/4,
 * half-body). Ported from the v0.5 spike (round-4 GATE_RULES.md + the
 * round-5 g11-safe mouth rule). Runs after `rejectImage.js` accepted the
 * image.
 *
 * Rules, first match wins:
 *  1. no face (after one contrast-normalised retry) -> half_body_only
 *  2. more than one face                            -> multiple_characters
 *  3. face smaller than 96 px                       -> half_body_only
 *  4. eye landmarks broken (eye spacing > 1 face width or an eye outside
 *     the face outline)                             -> eyes_unclear
 *     (a landmark failure, never reported as a side view)
 *  5. contour symmetry < 0.33 or eye spacing < 0.38 -> side_view
 *  6. mouth covered (g11-safe, below)               -> mouth_covered
 *  7. own-skin blob beside the face across the chin -> hands_near_face
 *
 * Skin is never judged against absolute colour or lightness. Every colour
 * test compares against the character's own skin, sampled from the face
 * between brows and mouth, by hue/chroma with free lightness (so shading,
 * highlights, and dark or tan skin do not matter). The mouth rule also leans
 * on landmark confidence and geometry.
 *
 * The image never leaves the process. Results carry codes and numbers only.
 */

import {
  PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS,
  PORTRAIT_LANDMARK_GATE_REASONS,
} from '../../../shared/portraitLandmarkGate.js'

export const PORTRAIT_LANDMARK_GATE_LIMITS = Object.freeze({
  faceScore: 0.5,
  /** Faces smaller than this share of the largest face are ignored (background figures, props). */
  faceRelativeSize: 0.4,
  minFacePx: 96,
  maxEyeSpacing: 1.0,
  minEyeSpacing: 0.38,
  /** Loosened from 0.45 in round 4 so strong 3/4 views pass. */
  minContourSymmetry: 0.33,
  minMouthConfidence: 0.3,
  minLandmarkOrder: 0.06,
  /** A contrast-normalised landmark retry is used only if it raises mouth confidence this much. */
  retryConfidenceGain: 0.1,
  occluderMinCover: 0.15,
  occluderMinWidth: 0.6,
  occluderMinOutside: 1.0,
  maxHandBlob: 0.1,
  /**
   * A hand must reach within this distance (face widths) of the face box
   * horizontally; an arm raised out in empty space beside the body is fine.
   */
  handMaxGapFw: 0.25,
  /**
   * Skin joined to the neck/chest skin (fw x fh units inside the neck base)
   * is body skin: an off-centre neck in 3/4 view, bare shoulders.
   */
  handMaxNeckContact: 0.03,
  /** Gaps up to this size (face widths) are bridged so outline strokes do not split body skin. */
  handStrokeBridgeFw: 0.05,
  /** Near-neutral skin (chroma below this) cannot separate hands from white props. */
  handMinSkinChroma: 7,
})

const SKIN = Object.freeze({
  hueTolerance: 28, chromaLow: 0.35, chromaHigh: 2.5, neutralChroma: 8, neutralTolerance: 14, minLightRatio: 0.3,
  darkLineRatio: 0.45, thickLine: 0.06, secondToneMinShare: 0.12, secondToneMaxOutside: 0.35,
  handHue: 10, handChromaLow: 0.75, handChromaHigh: 1.3, handLightLow: 0.8, handLightHigh: 1.12, handNeutralTolerance: 6,
})

// ---------------------------------------------------------------- geometry

/** Face geometry from the 28 landmarks (spike `layers.geom`). */
export function faceGeometry(keypoints) {
  const k = keypoints
  const mean = (from, to, axis) => {
    let sum = 0
    for (let i = from; i < to; i += 1) sum += k[i][axis]
    return sum / (to - from)
  }
  const contour = k.slice(0, 5).map((p) => [p[0], p[1]])
  const brow = mean(5, 11, 1)
  const chin = k[2][1]
  const x0 = Math.min(contour[0][0], contour[4][0])
  const x1 = Math.max(contour[0][0], contour[4][0])
  return {
    contour, brow, chin, x0, x1,
    eye1: [mean(11, 17, 0), mean(11, 17, 1)],
    eye2: [mean(17, 23, 0), mean(17, 23, 1)],
    nose: [k[23][0], k[23][1]],
    mouth: [mean(24, 28, 0), mean(24, 28, 1)],
    fw: Math.max(x1 - x0, 1),
    fh: Math.max(chin - brow, 1),
  }
}

/** Contour symmetry, eye spacing, and whether both eyes sit inside the face outline (spike `sidefeat`). */
export function sideFeatures(keypoints) {
  const g = faceGeometry(keypoints)
  const c0 = g.contour[0][0]
  const c4 = g.contour[4][0]
  const midX = (g.eye1[0] + g.eye2[0]) / 2
  const fw = Math.max(Math.abs(c4 - c0), 1e-6)
  const dl = Math.abs(midX - c0)
  const dr = Math.abs(c4 - midX)
  const lo = Math.min(c0, c4)
  const hi = Math.max(c0, c4)
  return {
    contourSymmetry: Math.min(dl, dr) / Math.max(dl, dr, 1e-6),
    eyeSpacing: Math.abs(g.eye2[0] - g.eye1[0]) / fw,
    eyesInside: lo - 0.05 * fw <= Math.min(g.eye1[0], g.eye2[0]) && Math.max(g.eye1[0], g.eye2[0]) <= hi + 0.05 * fw,
  }
}

/** Mean heatmap confidence of the mouth points and the nose < mouth < chin ordering. */
export function mouthLandmarkEvidence(keypoints) {
  const g = faceGeometry(keypoints)
  let confidence = 0
  for (let i = 24; i < 28; i += 1) confidence += keypoints[i][2] ?? 0
  const eyeY = (g.eye1[1] + g.eye2[1]) / 2
  const span = Math.max(g.chin - eyeY, 1)
  const order = Math.min((g.nose[1] - eyeY) / span, (g.mouth[1] - g.nose[1]) / span, (g.chin - g.mouth[1]) / span)
  return { mouthConfidence: confidence / 4, landmarkOrder: order }
}

/** Faces above the score threshold and at least 40% of the largest face's size, largest first. */
export function pickFaces(faces) {
  const limits = PORTRAIT_LANDMARK_GATE_LIMITS
  const size = (face) => Math.min(face.bbox[2] - face.bbox[0], face.bbox[3] - face.bbox[1])
  const confident = faces.filter((face) => face.bbox[4] > limits.faceScore)
  if (confident.length === 0) return []
  const largest = Math.max(...confident.map(size))
  return confident.filter((face) => size(face) >= limits.faceRelativeSize * largest).sort((a, b) => size(b) - size(a))
}

// ------------------------------------------------------- raster utilities

/** A rectangular analysis window (integer, clamped to the image). */
function makeWindow(image, x0, y0, x1, y1) {
  const left = Math.max(0, Math.floor(x0))
  const top = Math.max(0, Math.floor(y0))
  const right = Math.min(image.width, Math.ceil(x1))
  const bottom = Math.min(image.height, Math.ceil(y1))
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

const srgbToLinear = (value) => {
  const v = value / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i))
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)

/**
 * CIE L*a*b* (D65) of the window, three Float32Arrays, quantised like 8-bit
 * Lab (L in 255 steps, a/b in integer steps). The spike thresholds were
 * calibrated on OpenCV's 8-bit Lab, and the tight hand-skin hue band is
 * sensitive to that quantisation.
 */
export function windowLab(image, win) {
  const n = win.width * win.height
  const L = new Float32Array(n)
  const A = new Float32Array(n)
  const B = new Float32Array(n)
  for (let y = 0; y < win.height; y += 1) {
    for (let x = 0; x < win.width; x += 1) {
      const src = ((win.top + y) * image.width + win.left + x) * 3
      const r = LINEAR[image.rgb[src]]
      const g = LINEAR[image.rgb[src + 1]]
      const b = LINEAR[image.rgb[src + 2]]
      const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
      const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b)
      const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
      const i = y * win.width + x
      L[i] = (Math.round(((116 * fy - 16) * 255) / 100) * 100) / 255
      A[i] = Math.round(500 * (fx - fy))
      B[i] = Math.round(200 * (fy - fz))
    }
  }
  return { L, A, B }
}

/** Window mask from a predicate on image coordinates (pixel centres). */
function maskFrom(win, predicate) {
  const mask = new Uint8Array(win.width * win.height)
  for (let y = 0; y < win.height; y += 1) {
    for (let x = 0; x < win.width; x += 1) {
      if (predicate(win.left + x, win.top + y)) mask[y * win.width + x] = 1
    }
  }
  return mask
}

function insidePolygon(points, x, y) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function morph(mask, width, height, size, erode) {
  const half = Math.floor(size / 2)
  const pass = (source, horizontal) => {
    const out = new Uint8Array(source.length)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let value = erode ? 1 : 0
        for (let k = -half; k <= size - 1 - half; k += 1) {
          const xx = horizontal ? x + k : x
          const yy = horizontal ? y : y + k
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          const v = source[yy * width + xx]
          if (erode && !v) { value = 0; break }
          if (!erode && v) { value = 1; break }
        }
        out[y * width + x] = value
      }
    }
    return out
  }
  return pass(pass(mask, true), false)
}

/** Morphological opening / dilation with a square kernel. */
export const openMask = (mask, width, height, size) => morph(morph(mask, width, height, size, true), width, height, size, false)
const dilateMask = (mask, width, height, size) => morph(mask, width, height, size, false)

/** 8-connected components: `labels` (0 = background) and per-label bbox/area stats. */
export function connectedComponents(mask, width, height) {
  const labels = new Int32Array(mask.length)
  const stats = [null]
  const stack = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue
    const label = stats.length
    const stat = { area: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    labels[start] = label
    stack.push(start)
    while (stack.length) {
      const index = stack.pop()
      const x = index % width
      const y = (index - x) / width
      stat.area += 1
      if (x < stat.minX) stat.minX = x
      if (x > stat.maxX) stat.maxX = x
      if (y < stat.minY) stat.minY = y
      if (y > stat.maxY) stat.maxY = y
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (mask[next] && !labels[next]) {
            labels[next] = label
            stack.push(next)
          }
        }
      }
    }
    stats.push(stat)
  }
  return { labels, stats }
}

// ------------------------------------------------------------ own skin

function median(values) {
  if (values.length === 0) return 0
  const sorted = Float32Array.from(values).sort()
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The dominant colour of `mask` (mode of coarse Lab bins, refined by a
 * local median): eyes, brows, glasses, and blush are minorities of the face.
 */
export function dominantSkinTone(lab, mask) {
  const bins = new Map()
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue
    const key = `${Math.floor(lab.L[i] / 8)},${Math.floor(lab.A[i] / 6)},${Math.floor(lab.B[i] / 6)}`
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }
  if (bins.size === 0) return null
  let modeKey = ''
  let modeCount = -1
  for (const [key, count] of bins) if (count > modeCount) { modeKey = key; modeCount = count }
  const sum = [0, 0, 0]
  let n = 0
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue
    if (`${Math.floor(lab.L[i] / 8)},${Math.floor(lab.A[i] / 6)},${Math.floor(lab.B[i] / 6)}` !== modeKey) continue
    sum[0] += lab.L[i]; sum[1] += lab.A[i]; sum[2] += lab.B[i]; n += 1
  }
  const centre = sum.map((value) => value / n)
  const near = [[], [], []]
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue
    if (Math.hypot(lab.L[i] - centre[0], lab.A[i] - centre[1], lab.B[i] - centre[2]) >= 10) continue
    near[0].push(lab.L[i]); near[1].push(lab.A[i]); near[2].push(lab.B[i])
  }
  const tone = near.map(median)
  return { L: tone[0], a: tone[1], b: tone[2], hue: (Math.atan2(tone[2], tone[1]) * 180) / Math.PI, chroma: Math.hypot(tone[1], tone[2]) }
}

/** Pixels matching a skin tone by hue/chroma at any (non-black) lightness. */
function skinLikeMask(lab, tone, options) {
  const mask = new Uint8Array(lab.L.length)
  const lightBase = Math.max(tone.L, 1)
  for (let i = 0; i < mask.length; i += 1) {
    const ratio = lab.L[i] / lightBase
    if (ratio <= options.lightLow || ratio >= options.lightHigh) continue
    if (tone.chroma >= SKIN.neutralChroma) {
      const chroma = Math.hypot(lab.A[i], lab.B[i])
      const hue = (Math.atan2(lab.B[i], lab.A[i]) * 180) / Math.PI
      const dh = Math.abs(((hue - tone.hue + 540) % 360) - 180)
      if (dh < options.hue && chroma > options.chromaLow * tone.chroma && chroma < options.chromaHigh * tone.chroma) mask[i] = 1
    } else if (Math.hypot(lab.A[i] - tone.a, lab.B[i] - tone.b) < options.neutral) {
      mask[i] = 1
    }
  }
  return mask
}

const WIDE_SKIN = { lightLow: SKIN.minLightRatio, lightHigh: Infinity, hue: SKIN.hueTolerance, chromaLow: SKIN.chromaLow, chromaHigh: SKIN.chromaHigh, neutral: SKIN.neutralTolerance }
const TIGHT_SKIN = { lightLow: SKIN.handLightLow, lightHigh: SKIN.handLightHigh, hue: SKIN.handHue, chromaLow: SKIN.handChromaLow, chromaHigh: SKIN.handChromaHigh, neutral: SKIN.handNeutralTolerance }

const count = (mask) => mask.reduce((sum, value) => sum + value, 0)

// ------------------------------------------------------- face analysis

/**
 * Shared per-face analysis: a window around the face, its Lab raster, the
 * own-skin reference mask, base tone, and the wide (shading-tolerant) skin
 * mask including an accepted second (cel-shadow) tone.
 */
export function analyseFace(image, keypoints) {
  const g = faceGeometry(keypoints)
  const win = makeWindow(image, g.x0 - 0.7 * g.fw, g.brow - 0.6 * g.fh, g.x1 + 0.7 * g.fw, g.chin + 0.8 * g.fh)
  if (win.width < 4 || win.height < 4) return null
  const lab = windowLab(image, win)
  const facePolygon = g.contour
  const faceMask = maskFrom(win, (x, y) => insidePolygon(facePolygon, x + 0.5, y + 0.5))
  const ref = maskFrom(win, (x, y) => y > g.brow && y < g.mouth[1] - 0.04 * g.fh).map((v, i) => v & faceMask[i])
  if (count(ref) < 20) return null
  const tone = dominantSkinTone(lab, ref)
  let skin = skinLikeMask(lab, tone, WIDE_SKIN)
  const darkLimit = SKIN.darkLineRatio * tone.L
  const rest = ref.map((v, i) => (v && !skin[i] && lab.L[i] >= darkLimit ? 1 : 0))
  const refCount = count(ref)
  let secondTone = null
  if (count(rest) > SKIN.secondToneMinShare * refCount) {
    const tone2 = dominantSkinTone(lab, rest)
    const skin2 = skinLikeMask(lab, tone2, WIDE_SKIN)
    const cx = (g.x0 + g.x1) / 2
    const near = maskFrom(win, (x, y) => x > g.x0 - 0.6 * g.fw && x < g.x1 + 0.6 * g.fw && y > g.brow - 0.3 * g.fh && y < g.chin + 0.4 * g.fh)
    const neck = maskFrom(win, (x, y) => Math.abs(x - cx) < 0.35 * g.fw && y > g.chin - 0.05 * g.fh)
    const faceDilated = dilateMask(faceMask, win.width, win.height, 5)
    let total = 0
    let outside = 0
    let inRest = 0
    for (let i = 0; i < skin2.length; i += 1) {
      if (skin2[i] && rest[i]) inRest += 1
      if (!(skin2[i] && near[i])) continue
      total += 1
      if (!faceDilated[i] && !neck[i]) outside += 1
    }
    const outsideShare = outside / Math.max(total, 1)
    if (inRest > SKIN.secondToneMinShare * refCount && outsideShare < SKIN.secondToneMaxOutside) {
      skin = skin.map((v, i) => v | skin2[i])
      secondTone = tone2
    }
  }
  return { g, win, lab, faceMask, ref, tone, secondTone, skin }
}

/**
 * Foreign object across the mouth: the not-own-skin, not-line-art region
 * touching the mouth location with the largest cover, measured by cover,
 * width (face widths) and how far it spills past the jaw outline.
 */
export function mouthOcclusionFeatures(analysis) {
  const { g, win, lab, tone, skin } = analysis
  const { width, height } = win
  const dark = lab.L.map((value) => (value < SKIN.darkLineRatio * tone.L ? 1 : 0))
  const thick = openMask(Uint8Array.from(dark), width, height, Math.max(3, Math.floor(SKIN.thickLine * g.fw)))
  let foreign = new Uint8Array(skin.length)
  for (let i = 0; i < foreign.length; i += 1) foreign[i] = !skin[i] && !(dark[i] && !thick[i]) ? 1 : 0
  foreign = openMask(foreign, width, height, 3)
  const c = g.contour
  const jawPolygon = [...c, [c[4][0], g.nose[1]], [c[0][0], g.nose[1]]]
  const jaw = maskFrom(win, (x, y) => insidePolygon(jawPolygon, x + 0.5, y + 0.5))
  const radius = 0.12 * g.fw
  const disk = maskFrom(win, (x, y) => (x - g.mouth[0]) ** 2 + (y - g.mouth[1]) ** 2 < radius ** 2)
  const searchArea = maskFrom(win, (x, y) => x > g.x0 - 0.6 * g.fw && x < g.x1 + 0.6 * g.fw && y > g.nose[1] && y < g.chin + 0.4 * g.fh)
  const candidates = foreign.map((v, i) => v & searchArea[i])
  const { labels, stats } = connectedComponents(candidates, width, height)
  const diskArea = Math.max(Math.PI * radius * radius, 1)
  const perLabel = new Map()
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i]
    if (!label) continue
    const entry = perLabel.get(label) ?? { inDisk: 0, inJaw: 0, outJaw: 0 }
    if (disk[i]) entry.inDisk += 1
    if (jaw[i]) entry.inJaw += 1
    else entry.outJaw += 1
    perLabel.set(label, entry)
  }
  const best = { occluderCover: 0, occluderWidth: 0, occluderOutside: 0 }
  for (const [label, entry] of perLabel) {
    if (!entry.inDisk) continue
    const cover = entry.inDisk / diskArea
    if (cover <= best.occluderCover) continue
    best.occluderCover = cover
    best.occluderWidth = (stats[label].maxX - stats[label].minX + 1) / g.fw
    best.occluderOutside = entry.outJaw / Math.max(entry.inJaw, 1)
  }
  return best
}

/** Mouth decision from landmark evidence + occluder features (no absolute skin colour). */
export function mouthCoveredDecision(evidence, occluder) {
  const limits = PORTRAIT_LANDMARK_GATE_LIMITS
  if (evidence.mouthConfidence < limits.minMouthConfidence) return 'mouth_landmarks_missing'
  if (evidence.landmarkOrder < limits.minLandmarkOrder) return 'landmark_order'
  if (
    occluder
    && occluder.occluderCover >= limits.occluderMinCover
    && occluder.occluderWidth >= limits.occluderMinWidth
    && occluder.occluderOutside >= limits.occluderMinOutside
  ) return 'object_across_mouth'
  return null
}

/** Foreground mask in the window: alpha where the image is transparent, else "not the border colour". */
function foregroundMask(image, win) {
  const { width, height } = image
  if (image.alpha) {
    let clear = 0
    for (const value of image.alpha) if (value < 26) clear += 1
    if (clear / image.alpha.length >= 0.05) return maskFrom(win, (x, y) => image.alpha[y * width + x] > 127)
  }
  const band = Math.max(4, Math.floor(0.02 * Math.min(width, height)))
  const bins = new Map()
  const visit = (x, y) => {
    const i = (y * width + x) * 3
    const key = (image.rgb[i] >> 3) * 1024 + (image.rgb[i + 1] >> 3) * 32 + (image.rgb[i + 2] >> 3)
    const entry = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    entry.n += 1; entry.r += image.rgb[i]; entry.g += image.rgb[i + 1]; entry.b += image.rgb[i + 2]
    bins.set(key, entry)
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (y < band || x < band || x >= width - band) visit(x, y)
  }
  let dominant = { n: 0, r: 0, g: 0, b: 0 }
  for (const entry of bins.values()) if (entry.n > dominant.n) dominant = entry
  const bg = [dominant.r / dominant.n, dominant.g / dominant.n, dominant.b / dominant.n]
  return maskFrom(win, (x, y) => {
    const i = (y * width + x) * 3
    return Math.max(Math.abs(image.rgb[i] - bg[0]), Math.abs(image.rgb[i + 1] - bg[1]), Math.abs(image.rgb[i + 2] - bg[2])) > 24
  })
}

/**
 * Hand next to the face: a tight own-skin blob outside the (dilated) face and
 * the neck column that starts above the chin and continues below it. Ears
 * (entirely above) do not qualify. Two geometric (skin-tone independent)
 * exclusions keep body skin out:
 * - the blob must come within `handMaxGapFw` of the face box horizontally
 *   (a hand raised out beside the body is not "near the face");
 * - the blob must not be joined to the skin of the neck base once thin
 *   outline strokes are bridged (off-centre neck in 3/4 view, bare shoulders).
 * Returns the largest qualifying area in face units (fw x fh).
 */
export function handBlobFeature(image, analysis) {
  const limits = PORTRAIT_LANDMARK_GATE_LIMITS
  const { g, win, lab, tone } = analysis
  if (tone.chroma < limits.handMinSkinChroma) return 0
  const { width, height } = win
  const fg = foregroundMask(image, win)
  const tight = skinLikeMask(lab, tone, TIGHT_SKIN)
  const top = g.brow - 0.35 * g.fh
  const c = g.contour
  const headPolygon = [...c, [c[4][0], top], [c[0][0], top]]
  const head = maskFrom(win, (x, y) => insidePolygon(headPolygon, x + 0.5, y + 0.5))
  const headDilated = dilateMask(head, width, height, Math.max(3, Math.floor(0.04 * g.fw)))
  const cx = (g.x0 + g.x1) / 2
  const split = g.chin + 0.15 * g.fh
  const inZone = (x, y, bottom) => x > g.x0 - 0.7 * g.fw && x < g.x1 + 0.7 * g.fw && y > g.brow - 0.3 * g.fh && y < bottom
  const inNeck = (x, y) => Math.abs(x - cx) < 0.3 * g.fw && y > g.chin - 0.05 * g.fh
  const skin = (mask) => openMask(mask.map((v, i) => v & fg[i] & tight[i] & (headDilated[i] ? 0 : 1)), width, height, 3)

  const candidates = skin(maskFrom(win, (x, y) => inZone(x, y, split + 0.5 * g.fh) && !inNeck(x, y)))
  const { labels, stats } = connectedComponents(candidates, width, height)

  // Body skin: same skin incl. the neck column, strokes bridged, reaching the neck base.
  const body = skin(maskFrom(win, (x, y) => inZone(x, y, split + g.fh)))
  const bridge = Math.max(3, Math.round(limits.handStrokeBridgeFw * g.fw)) | 1
  const bodyLabels = connectedComponents(dilateMask(body, width, height, bridge), width, height).labels
  const neckPixels = new Map()
  for (let y = 0; y < height; y += 1) {
    const wy = win.top + y
    if (wy <= g.chin + 0.05 * g.fh || wy >= split + 0.3 * g.fh) continue
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (body[i] && bodyLabels[i] && Math.abs(win.left + x - cx) < 0.3 * g.fw) neckPixels.set(bodyLabels[i], (neckPixels.get(bodyLabels[i]) ?? 0) + 1)
    }
  }
  const unit = g.fw * g.fh
  const qualifying = []
  for (let label = 1; label < stats.length; label += 1) {
    const s = stats[label]
    const area = s.area / unit
    if (area <= 0.04 || win.top + s.minY >= g.chin - 0.1 * g.fh || win.top + s.maxY + 1 <= g.chin + 0.05 * g.fh) continue
    const gap = Math.max(0, (win.left + s.minX - g.x1) / g.fw, (g.x0 - (win.left + s.maxX + 1)) / g.fw)
    if (gap > limits.handMaxGapFw) continue
    qualifying[label] = area
  }
  if (qualifying.length === 0) return 0
  const joined = new Set()
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i]
    if (qualifying[label] === undefined || joined.has(label)) continue
    if ((neckPixels.get(bodyLabels[i]) ?? 0) / unit >= limits.handMaxNeckContact) joined.add(label)
  }
  let best = 0
  qualifying.forEach((area, label) => { if (!joined.has(label)) best = Math.max(best, area) })
  return best
}

// ------------------------------------------------------------- decision

function verdict(reasonCode, detail, metrics, messageParams = {}) {
  return {
    accepted: reasonCode === null,
    reasonCode,
    detail,
    messageKey: PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS[reasonCode ?? 'accepted'],
    messageParams,
    metrics,
  }
}

const round = (value) => Math.round(value * 1000) / 1000

/**
 * Decide on an RGB raster (flattened on white) plus optional alpha.
 * @param {{ rgb: Uint8Array, alpha?: Uint8Array | null, width: number, height: number, pixelScale?: number }} image
 *   `pixelScale` = original px per raster px (when the raster was downsized).
 * @param {{ detect: (variant: 'original' | 'normalized') => Promise<Array<{ bbox: number[], keypoints: number[][] }>> }} detector
 */
export async function evaluatePortraitLandmarks(image, detector) {
  const limits = PORTRAIT_LANDMARK_GATE_LIMITS
  const R = PORTRAIT_LANDMARK_GATE_REASONS
  const metrics = {}
  let faces = pickFaces(await detector.detect('original'))
  if (faces.length === 0) {
    faces = pickFaces(await detector.detect('normalized'))
    metrics.normalizedRetry = true
  }
  metrics.faces = faces.length
  if (faces.length === 0) return verdict(R.HALF_BODY_ONLY, 'no_face', metrics)
  if (faces.length > 1) return verdict(R.MULTIPLE_CHARACTERS, null, metrics, { count: faces.length })
  const face = faces[0]
  const facePx = Math.min(face.bbox[2] - face.bbox[0], face.bbox[3] - face.bbox[1]) * (image.pixelScale ?? 1)
  metrics.facePx = Math.round(facePx)
  if (facePx < limits.minFacePx) return verdict(R.HALF_BODY_ONLY, 'face_small', metrics)

  const side = sideFeatures(face.keypoints)
  metrics.eyeSpacing = round(side.eyeSpacing)
  metrics.contourSymmetry = round(side.contourSymmetry)
  if (side.eyeSpacing > limits.maxEyeSpacing || !side.eyesInside) return verdict(R.EYES_UNCLEAR, 'eye_landmarks_broken', metrics)
  if (side.contourSymmetry < limits.minContourSymmetry || side.eyeSpacing < limits.minEyeSpacing) return verdict(R.SIDE_VIEW, null, metrics)

  let keypoints = face.keypoints
  let evidence = mouthLandmarkEvidence(keypoints)
  if (evidence.mouthConfidence < limits.minMouthConfidence || evidence.landmarkOrder < limits.minLandmarkOrder) {
    const retry = pickFaces(await detector.detect('normalized'))[0]
    if (retry) {
      const retryEvidence = mouthLandmarkEvidence(retry.keypoints)
      if (retryEvidence.mouthConfidence >= evidence.mouthConfidence + limits.retryConfidenceGain) {
        keypoints = retry.keypoints
        evidence = retryEvidence
        metrics.normalizedRetry = true
      }
    }
  }
  metrics.mouthConfidence = round(evidence.mouthConfidence)
  metrics.landmarkOrder = round(evidence.landmarkOrder)
  const analysis = analyseFace(image, keypoints)
  const occluder = analysis ? mouthOcclusionFeatures(analysis) : null
  if (occluder) {
    metrics.occluderCover = round(occluder.occluderCover)
    metrics.occluderWidth = round(occluder.occluderWidth)
    metrics.occluderOutside = round(occluder.occluderOutside)
  }
  const mouth = mouthCoveredDecision(evidence, occluder)
  if (mouth) return verdict(R.MOUTH_COVERED, mouth, metrics)

  const handBlob = analysis ? handBlobFeature(image, analysis) : 0
  metrics.handBlob = round(handBlob)
  if (handBlob > limits.maxHandBlob) return verdict(R.HANDS_NEAR_FACE, null, metrics)
  return verdict(null, null, metrics)
}

/** Result when the landmark models/runtime are not available: the caller keeps the stage-A verdict. */
export function landmarkStageUnavailable(status) {
  return verdict(PORTRAIT_LANDMARK_GATE_REASONS.MODELS_UNAVAILABLE, status, {})
}
