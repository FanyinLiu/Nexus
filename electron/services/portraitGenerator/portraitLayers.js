/**
 * Hair / head / body layering from a cutout and the 28 anime-face landmarks,
 * no extra model. Port of the v0.5 spike's round-4 `layers.py`.
 *
 * - Hair: a Lab palette learned (k-means) from seed pixels above the brows
 *   and beside the face, grown by colour similarity and kept only where it is
 *   connected to the seeds. The face polygon below the brows is never hair.
 *   Below the neck line, hair must hang down.
 * - Head: non-hair components above the neck line that touch the face core
 *   (or accessories that end above the chin).
 * - Body: everything else in the foreground.
 *
 * It also returns the round-4 gate measures `armBody` (body pixels next to
 * the face, i.e. raised arms or props) and `handSkin`.
 *
 * Pure functions on raw rasters; `portraitLayerStage.js` handles decoding.
 */
import { connectedComponents, faceGeometry, windowLab } from './landmarkGate.js'

export const PORTRAIT_LAYER_PARAMS = Object.freeze({
  headPrior: true,
  headZone: 1.0,
  darkLightness: 35,
  darkOpen: 0.008,
  torsoWidth: 0.35,
  torsoShare: 0.35,
  edgeCut: true,
  lineLightness: 45,
  torsoDeltaE: 12,
  hairDeltaE: 16,
  paletteSize: 6,
  seedMinShare: 0.05,
  skinDeltaE: 14,
  workSize: 768,
})

// ------------------------------------------------------------ raster helpers

/** OpenCV-compatible elliptic structuring element as [dx, dy] offsets around the anchor. */
export function ellipseKernel(size) {
  const r = Math.floor(size / 2)
  const c = Math.floor(size / 2)
  const invR2 = r ? 1 / (r * r) : 0
  const offsets = []
  for (let i = 0; i < size; i += 1) {
    const dy = i - r
    if (Math.abs(dy) > r) continue
    const dx = Math.round(c * Math.sqrt((r * r - dy * dy) * invR2))
    for (let j = Math.max(c - dx, 0); j < Math.min(c + dx + 1, size); j += 1) offsets.push([j - c, i - r])
  }
  return offsets
}

const rectKernel = (size) => {
  const anchor = Math.floor(size / 2)
  const offsets = []
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) offsets.push([x - anchor, y - anchor])
  return offsets
}

/** Dilate (`erode=false`) or erode a 0/1 mask; pixels outside the image never contribute (OpenCV default border). */
export function morphology(mask, width, height, kernel, erode) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = erode ? 1 : 0
      for (const [dx, dy] of kernel) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const v = mask[yy * width + xx]
        if (erode && !v) { value = 0; break }
        if (!erode && v) { value = 1; break }
      }
      out[y * width + x] = value
    }
  }
  return out
}

const dilate = (m, w, h, k) => morphology(m, w, h, k, false)
const erode = (m, w, h, k) => morphology(m, w, h, k, true)
const closeMask = (m, w, h, k) => erode(dilate(m, w, h, k), w, h, k)
const openMask = (m, w, h, k) => dilate(erode(m, w, h, k), w, h, k)

/** OpenCV RGB2GRAY (fixed point). */
export function grayFromRgb(rgb, n) {
  const gray = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) gray[i] = (rgb[i * 3] * 4899 + rgb[i * 3 + 1] * 9617 + rgb[i * 3 + 2] * 1868 + 8192) >> 14
  return gray
}

const reflect101 = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i)
const clampIndex = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i)

/** 3x3 Gaussian blur (sigma from size, kernel 1-2-1), reflect-101 border, rounded to 8 bits. */
export function gaussianBlur3(gray, width, height) {
  const out = new Uint8Array(gray.length)
  const w = [1, 2, 1]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let j = -1; j <= 1; j += 1) {
        const row = reflect101(y + j, height) * width
        for (let i = -1; i <= 1; i += 1) sum += w[j + 1] * w[i + 1] * gray[row + reflect101(x + i, width)]
      }
      out[y * width + x] = (sum + 8) >> 4
    }
  }
  return out
}

/** Canny edges (3x3 Sobel, L1 magnitude, replicate border) like `cv2.Canny(img, low, high)`. */
export function cannyEdges(gray, width, height, low, high) {
  const n = width * height
  const dx = new Int32Array(n)
  const dy = new Int32Array(n)
  const mag = new Int32Array(n)
  const px = (x, y) => gray[clampIndex(y, height) * width + clampIndex(x, width)]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gx = (px(x + 1, y - 1) + 2 * px(x + 1, y) + px(x + 1, y + 1)) - (px(x - 1, y - 1) + 2 * px(x - 1, y) + px(x - 1, y + 1))
      const gy = (px(x - 1, y + 1) + 2 * px(x, y + 1) + px(x + 1, y + 1)) - (px(x - 1, y - 1) + 2 * px(x, y - 1) + px(x + 1, y - 1))
      const i = y * width + x
      dx[i] = gx
      dy[i] = gy
      mag[i] = Math.abs(gx) + Math.abs(gy)
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mag[y * width + x])
  const TG22 = 13573
  // 0 = not an edge, 1 = weak candidate, 2 = strong edge
  const map = new Uint8Array(n)
  const stack = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const m = mag[i]
      if (m <= low) continue
      const ax = Math.abs(dx[i])
      const ay = Math.abs(dy[i]) << 15
      const tg22x = ax * TG22
      let isMax
      if (ay < tg22x) isMax = m > at(x - 1, y) && m >= at(x + 1, y)
      else if (ay > tg22x + ax * 65536) isMax = m > at(x, y - 1) && m >= at(x, y + 1)
      else {
        const s = (dx[i] ^ dy[i]) < 0 ? -1 : 1
        isMax = m > at(x - s, y - 1) && m > at(x + s, y + 1)
      }
      if (!isMax) continue
      if (m > high) { map[i] = 2; stack.push(i) } else map[i] = 1
    }
  }
  while (stack.length) {
    const i = stack.pop()
    const x = i % width
    const y = (i - x) / width
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const nx = x + ox
        const ny = y + oy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (map[j] === 1) { map[j] = 2; stack.push(j) }
      }
    }
  }
  const edges = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) edges[i] = map[i] === 2 ? 1 : 0
  return edges
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2

/**
 * Deterministic k-means++ (best of 3 attempts, up to 30 iterations, eps 0.5),
 * like `cv2.kmeans(..., KMEANS_PP_CENTERS)` with a fixed seed. Returns the
 * centres and their member counts; tiny inputs collapse to the mean.
 */
export function kmeans(points, k, seed = 12345) {
  if (points.length < k * 5) {
    const mean = [0, 0, 0]
    for (const p of points) for (let c = 0; c < 3; c += 1) mean[c] += p[c] / Math.max(points.length, 1)
    return { centers: [mean], counts: [points.length] }
  }
  const random = seededRandom(seed)
  let best = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const centers = [points[Math.floor(random() * points.length)].slice()]
    const nearest = points.map((p) => dist2(p, centers[0]))
    while (centers.length < k) {
      const total = nearest.reduce((a, b) => a + b, 0)
      let r = random() * total
      let pick = points.length - 1
      for (let i = 0; i < points.length; i += 1) { r -= nearest[i]; if (r <= 0) { pick = i; break } }
      centers.push(points[pick].slice())
      for (let i = 0; i < points.length; i += 1) nearest[i] = Math.min(nearest[i], dist2(points[i], centers[centers.length - 1]))
    }
    const labels = new Int32Array(points.length)
    let compactness = 0
    for (let iter = 0; iter < 30; iter += 1) {
      compactness = 0
      for (let i = 0; i < points.length; i += 1) {
        let bestC = 0
        let bestD = Infinity
        for (let c = 0; c < k; c += 1) { const d = dist2(points[i], centers[c]); if (d < bestD) { bestD = d; bestC = c } }
        labels[i] = bestC
        compactness += bestD
      }
      const sums = Array.from({ length: k }, () => [0, 0, 0, 0])
      for (let i = 0; i < points.length; i += 1) { const s = sums[labels[i]]; s[0] += points[i][0]; s[1] += points[i][1]; s[2] += points[i][2]; s[3] += 1 }
      let shift = 0
      for (let c = 0; c < k; c += 1) {
        if (!sums[c][3]) continue
        const next = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]
        shift = Math.max(shift, Math.sqrt(dist2(next, centers[c])))
        centers[c] = next
      }
      if (shift < 0.5) break
    }
    if (!best || compactness < best.compactness) {
      const counts = new Array(k).fill(0)
      for (const label of labels) counts[label] += 1
      best = { centers: centers.map((c) => c.slice()), counts, compactness }
    }
  }
  return { centers: best.centers, counts: best.counts }
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

function channelMedian(lab, mask) {
  const pick = (channel) => {
    const values = []
    for (let i = 0; i < mask.length; i += 1) if (mask[i]) values.push(channel[i])
    if (!values.length) return NaN
    values.sort((a, b) => a - b)
    const mid = values.length >> 1
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
  }
  return [pick(lab.L), pick(lab.A), pick(lab.B)]
}

const countMask = (mask) => { let n = 0; for (const v of mask) n += v; return n }

/** Nearest-neighbour resize of a 0/1 mask (OpenCV INTER_NEAREST index mapping). */
export function resizeMaskNearest(mask, width, height, outWidth, outHeight) {
  if (width === outWidth && height === outHeight) return mask
  const out = new Uint8Array(outWidth * outHeight)
  for (let y = 0; y < outHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y * height) / outHeight))
    for (let x = 0; x < outWidth; x += 1) out[y * outWidth + x] = mask[sy * width + Math.min(width - 1, Math.floor((x * width) / outWidth))]
  }
  return out
}

// ------------------------------------------------------------ segmentation

/**
 * @param {{ rgb: Uint8Array, alpha: Uint8Array, width: number, height: number }} image
 *   working-size raster (long side <= workSize) with a cutout alpha
 * @param {number[][]} keypoints 28 landmarks in the same pixel space
 */
export function segmentPortraitLayers(image, keypoints, params = PORTRAIT_LAYER_PARAMS) {
  const P = params
  const { width: W, height: H } = image
  const n = W * H
  const g = faceGeometry(keypoints)
  const [x0, x1, fw, fh, brow, chin] = [g.x0, g.x1, g.fw, g.fh, g.brow, g.chin]
  const mouthY = g.mouth[1]
  const split = chin + 0.15 * fh
  const cx = (x0 + x1) / 2
  const fg = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) fg[i] = image.alpha[i] > 127 ? 1 : 0
  const lab = windowLab(image, { left: 0, top: 0, width: W, height: H })
  const labAt = (i) => [lab.L[i], lab.A[i], lab.B[i]]
  const grid = (predicate) => {
    const mask = new Uint8Array(n)
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (predicate(x, y, y * W + x)) mask[y * W + x] = 1
    return mask
  }

  const c = g.contour
  const top = brow - 0.35 * fh
  const poly = [c[0], c[1], c[2], c[3], c[4], [c[4][0], top], [c[0][0], top]].map((p) => [Math.trunc(p[0]), Math.trunc(p[1])])
  const face = grid((x, y) => insidePolygon(poly, x + 0.5, y + 0.5))
  const faceLow = grid((x, y, i) => face[i] && y > brow - 0.05 * fh)

  const [ex0, ex1] = [g.eye1[0], g.eye2[0]].sort((a, b) => a - b)
  const ey = Math.max(g.eye1[1], g.eye2[1])
  const cheek = grid((x, y, i) => fg[i] && x > ex0 && x < ex1 && y > ey + 0.12 * fh && y < mouthY - 0.03 * fh)
  let skin = countMask(cheek) > 20 ? channelMedian(lab, cheek) : channelMedian(lab, grid((x, y, i) => faceLow[i] && fg[i]))
  if (skin.some(Number.isNaN)) skin = [70, 10, 15]
  const dskin = new Float32Array(n)
  for (let i = 0; i < n; i += 1) dskin[i] = Math.sqrt(dist2(labAt(i), skin))

  const seed = grid((x, y, i) => {
    if (!fg[i] || dskin[i] <= P.skinDeltaE || faceLow[i]) return false
    const above = y < brow - 0.08 * fh && y > brow - 1.6 * fh && x > x0 - 0.3 * fw && x < x1 + 0.3 * fw
    const side = y > brow && y < mouthY
      && ((x > x0 - 0.3 * fw && x < x0 - 0.06 * fw) || (x < x1 + 0.3 * fw && x > x1 + 0.06 * fw))
    return above || side
  })

  let hair = new Uint8Array(n)
  let palette = []
  const seedCount = countMask(seed)
  if (seedCount > 50) {
    const seedPoints = []
    for (let i = 0; i < n; i += 1) if (seed[i]) seedPoints.push(labAt(i))
    const km = kmeans(seedPoints, P.paletteSize)
    const total = km.counts.reduce((a, b) => a + b, 0)
    palette = km.centers.filter((_, k) => km.counts[k] >= P.seedMinShare * total)
    const hairColours = palette.slice()
    let conflict = palette.map(() => false)
    // palette colours that are also the dominant clothing colours (narrow central torso column)
    const torso = grid((x, y, i) => fg[i] && Math.abs(x - cx) < P.torsoWidth * fw && y > chin + 0.35 * fh && y < chin + 1.2 * fh && dskin[i] > P.skinDeltaE)
    const torsoCount = countMask(torso)
    let torsoColours = []
    if (torsoCount > 50) {
      const torsoPoints = []
      for (let i = 0; i < n; i += 1) if (torso[i]) torsoPoints.push(labAt(i))
      const tk = kmeans(torsoPoints, 3)
      const tt = tk.counts.reduce((a, b) => a + b, 0)
      torsoColours = tk.centers.filter((_, k) => tk.counts[k] >= P.torsoShare * tt)
      conflict = palette.map((p) => Math.min(...torsoColours.map((t) => Math.sqrt(dist2(p, t)))) < P.torsoDeltaE)
    }
    const dark = palette.map((p) => p[0] < P.darkLightness)
    // palette colours shared with the clothing are only trusted above the neck line
    const match = (useDark) => grid((x, y, i) => {
      if (!fg[i] || faceLow[i]) return false
      let safe = Infinity
      let shared = Infinity
      const p = labAt(i)
      for (let k = 0; k < palette.length; k += 1) {
        if (dark[k] !== useDark) continue
        const d = Math.sqrt(dist2(p, palette[k]))
        if (conflict[k]) shared = Math.min(shared, d)
        else safe = Math.min(safe, d)
      }
      return safe < P.hairDeltaE || (shared < P.hairDeltaE && y < split)
    })
    let candidate = closeMask(match(false), W, H, rectKernel(3))
    for (let i = 0; i < n; i += 1) candidate[i] = candidate[i] && fg[i] && !faceLow[i] ? 1 : 0
    const gray = grayFromRgb(image.rgb, n)
    let edges = new Uint8Array(n)
    if (P.edgeCut) {
      edges = cannyEdges(gaussianBlur3(gray, W, H), W, H, 40, 110)
      for (let i = 0; i < n; i += 1) {
        if (gray[i] < P.lineLightness) edges[i] = 1 // line art
        if (edges[i]) candidate[i] = 0
      }
    }
    if (dark.some(Boolean)) {
      // dark hair shares the line-art colour: an opening drops 1-3 px outlines, keeps hair masses
      const kernel = ellipseKernel(Math.max(3, Math.round(P.darkOpen * Math.max(H, W))))
      const darkHair = closeMask(openMask(match(true), W, H, kernel), W, H, kernel)
      for (let i = 0; i < n; i += 1) if (darkHair[i] && fg[i] && !faceLow[i] && dskin[i] > P.skinDeltaE) candidate[i] = 1
    }
    const { labels } = connectedComponents(candidate, W, H)
    const keep = new Set()
    for (let i = 0; i < n; i += 1) if (seed[i] && candidate[i]) keep.add(labels[i])
    for (let i = 0; i < n; i += 1) hair[i] = keep.has(labels[i]) && labels[i] > 0 ? 1 : 0
    hair = closeMask(hair, W, H, rectKernel(5))
    for (let i = 0; i < n; i += 1) hair[i] = hair[i] && fg[i] && !faceLow[i] ? 1 : 0

    if (P.headPrior) {
      // non-skin pixels around the face that touch the hair move with the head
      // (multicolour strands, ponytail roots, hats, animal ears)
      const faceDilated = dilate(faceLow, W, H, rectKernel(Math.max(3, Math.trunc(0.04 * fw))))
      const region = grid((x, y, i) => fg[i] && !faceDilated[i] && dskin[i] > P.skinDeltaE
        && (y < chin || (y < split && Math.abs(x - cx) > 0.5 * fw))
        && Math.abs(x - cx) < P.headZone * fw && y > brow - 2.2 * fh)
      const regionLabels = connectedComponents(region, W, H).labels
      const hairTouch = dilate(hair, W, H, rectKernel(3))
      const touched = new Set()
      for (let i = 0; i < n; i += 1) if (hairTouch[i] && region[i]) touched.add(regionLabels[i])
      const headHair = grid((x, y, i) => regionLabels[i] > 0 && touched.has(regionLabels[i]))
      for (let i = 0; i < n; i += 1) if (headHair[i]) hair[i] = 1
      // head-region hair colours may continue below the neck line (ponytails, long multicolour hair)
      if (countMask(headHair) > 50) {
        const points = []
        for (let i = 0; i < n; i += 1) if (headHair[i]) points.push(labAt(i))
        const hk = kmeans(points, 4)
        const ht = hk.counts.reduce((a, b) => a + b, 0)
        let colours = hk.centers.filter((_, k) => hk.counts[k] >= 0.08 * ht)
        if (torsoCount > 50) colours = colours.filter((col) => Math.min(...torsoColours.map((t) => Math.sqrt(dist2(col, t)))) >= P.torsoDeltaE)
        if (colours.length) {
          hairColours.push(...colours)
          for (let y = 0; y < H; y += 1) {
            if (y < split) continue
            for (let x = 0; x < W; x += 1) {
              const i = y * W + x
              if (!fg[i] || dskin[i] <= P.skinDeltaE || (P.edgeCut && edges[i])) continue
              const p = labAt(i)
              if (colours.some((col) => Math.sqrt(dist2(p, col)) < P.hairDeltaE)) hair[i] = 1
            }
          }
        }
      }
    }
    // Hair acceptance has a wider radius than the torso-palette conflict
    // test. In that overlap, prefer an observed torso colour when its pixel
    // evidence is stronger. Apply after every expansion so head priors and
    // morphology cannot reintroduce clothing below the neck line.
    if (torsoColours.length) {
      for (let y = Math.max(0, Math.ceil(split)); y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const i = y * W + x
          if (!hair[i]) continue
          const p = labAt(i)
          const torsoDistance = Math.min(...torsoColours.map((colour) => dist2(p, colour)))
          const hairDistance = Math.min(...hairColours.map((colour) => dist2(p, colour)))
          if (torsoDistance < P.torsoDeltaE ** 2 && torsoDistance < hairDistance) hair[i] = 0
        }
      }
    }
    // below the neck line hair must hang down: lateral growth <= 1 px per 2 rows
    const sp = Math.trunc(Math.min(H - 1, split))
    let prev = hair.slice(sp * W, sp * W + W)
    for (let y = sp + 1; y < H; y += 1) {
      const grow = prev.slice()
      if (y % 2 === 0) for (let x = 0; x < W; x += 1) if (prev[x]) { if (x + 1 < W) grow[x + 1] = 1; if (x > 0) grow[x - 1] = 1 }
      for (let x = 0; x < W; x += 1) { const v = hair[y * W + x] && grow[x] ? 1 : 0; hair[y * W + x] = v; prev[x] = v }
      prev = prev.slice()
    }
  }

  const splitRow = Math.trunc(Math.min(H - 1, split))
  const rest = grid((x, y, i) => fg[i] && !hair[i])
  const above = grid((x, y, i) => rest[i] && y < splitRow)
  const { labels, stats } = connectedComponents(above, W, H)
  const sumX = new Float64Array(stats.length)
  const touchesCore = new Uint8Array(stats.length)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const label = labels[y * W + x]
      if (!label) continue
      sumX[label] += x
      if (x > x0 && x < x1 && y > brow && y < splitRow) touchesCore[label] = 1
    }
  }
  const headLabel = stats.map((s, label) => {
    if (!s) return false
    const bottom = s.maxY + 1
    const centroidX = sumX[label] / s.area
    return Boolean(touchesCore[label]) || (bottom <= chin && centroidX > x0 - 0.5 * fw && centroidX < x1 + 0.5 * fw)
  })
  const head = grid((x, y, i) => labels[i] > 0 && headLabel[labels[i]])
  const body = grid((x, y, i) => rest[i] && !head[i])

  // gate measures: body pixels at face level beside the face (raised arms, props),
  // and bare-skin blobs around the neck/jaw outside the face (hands), ears excluded
  const inBand = (x) => x > x0 - 0.6 * fw && x < x1 + 0.6 * fw
  let armPixels = 0
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (body[y * W + x] && inBand(x) && y < chin) armPixels += 1
  const faceWide = dilate(face, W, H, rectKernel(7))
  const eyeTop = Math.min(g.eye1[1], g.eye2[1]) - 0.25 * fh
  let skinBlob = grid((x, y, i) => {
    if (!fg[i] || hair[i] || dskin[i] >= 10 || faceWide[i]) return false
    if (!(y > brow && y < splitRow + 0.35 * fh && inBand(x))) return false
    const ear = y > eyeTop && y < mouthY
      && ((x > x0 - 0.22 * fw && x < x0 + 0.05 * fw) || (x > x1 - 0.05 * fw && x < x1 + 0.22 * fw))
    const neck = Math.abs(x - cx) < 0.3 * fw && y > chin - 0.05 * fh
    return !ear && !neck
  })
  skinBlob = openMask(skinBlob, W, H, rectKernel(3))

  return {
    hair,
    head,
    body,
    split: splitRow,
    metrics: {
      armBody: armPixels / (fw * fh),
      handSkin: countMask(skinBlob) / (fw * fh),
      hairShare: countMask(hair) / Math.max(countMask(fg), 1),
      seedPixels: seedCount,
      paletteSize: palette.length,
    },
  }
}

/**
 * Foreground alpha for an opaque image on a plain background (v0.5 scope):
 * pixels connected to the border whose Lab colour is within `tolerance` of
 * the border median are background. Transparent PNGs should use their own
 * alpha instead; this is a stand-in until a cutout model is chosen.
 */
export function plainBackgroundAlpha(image, tolerance = 8) {
  const { width: W, height: H } = image
  const n = W * H
  const lab = windowLab(image, { left: 0, top: 0, width: W, height: H })
  const border = new Uint8Array(n)
  for (let x = 0; x < W; x += 1) { border[x] = 1; border[(H - 1) * W + x] = 1 }
  for (let y = 0; y < H; y += 1) { border[y * W] = 1; border[y * W + W - 1] = 1 }
  const ref = channelMedian(lab, border)
  const near = (i) => Math.sqrt(dist2([lab.L[i], lab.A[i], lab.B[i]], ref)) < tolerance
  const background = new Uint8Array(n)
  const stack = []
  for (let i = 0; i < n; i += 1) if (border[i] && near(i)) { background[i] = 1; stack.push(i) }
  while (stack.length) {
    const i = stack.pop()
    const x = i % W
    const y = (i - x) / W
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (!background[j] && near(j)) { background[j] = 1; stack.push(j) }
    }
  }
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) alpha[i] = background[i] ? 0 : 255
  return alpha
}
