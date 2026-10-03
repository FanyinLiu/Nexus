import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'

import {
  cannyEdges,
  ellipseKernel,
  gaussianBlur3,
  kmeans,
  plainBackgroundAlpha,
  resizeMaskNearest,
  segmentPortraitLayers,
} from '../electron/services/portraitGenerator/portraitLayers.js'
import { splitPortraitLayers } from '../electron/services/portraitGenerator/portraitLayerStage.js'

let workDir = ''
before(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-layers-')) })
after(async () => { if (workDir) await fs.rm(workDir, { recursive: true, force: true }) })

type Point = [number, number, number]
type RGB = [number, number, number]

function frontalKeypoints(cx = 300, cy = 300, s = 1): Point[] {
  const p = (dx: number, dy: number): Point => [cx + dx * s, cy + dy * s, 0.9]
  const eye = (ex: number) => [p(ex - 15, -35), p(ex - 8, -42), p(ex + 8, -42), p(ex + 15, -35), p(ex + 8, -28), p(ex - 8, -28)]
  return [
    p(-100, -50), p(-85, 50), p(0, 100), p(85, 50), p(100, -50),
    p(-70, -85), p(-50, -88), p(-30, -85), p(30, -85), p(50, -88), p(70, -85),
    ...eye(-50), ...eye(50), p(0, 20), p(-15, 60), p(0, 55), p(15, 60), p(0, 65),
  ]
}

function insidePolygon(points: number[][], x: number, y: number) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const SKIN: RGB = [246, 214, 190]
const HAIR: RGB = [214, 112, 160]
const SHIRT: RGB = [40, 70, 160]

/** Flat half-body character on white: pink hair cap + side locks, face, eyes, neck, shirt; optional raised sleeve. */
function paintCharacter(options: { arm?: boolean } = {}) {
  const width = 600
  const height = 700
  const rgb = new Uint8Array(width * height * 3).fill(255)
  const kp = frontalKeypoints()
  const facePoly = [...kp.slice(0, 5).map((q) => [q[0], q[1]]), [400, 185], [200, 185]]
  const regions = { hair: new Uint8Array(width * height), face: new Uint8Array(width * height), shirt: new Uint8Array(width * height) }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      let c: RGB | null = null
      if ((x - 300) ** 2 / 130 ** 2 + (y - 230) ** 2 / 140 ** 2 < 1 && y < 330) { c = HAIR; regions.hair[i] = 1 }
      if (y >= 200 && y < 360 && ((x >= 172 && x < 205) || (x >= 395 && x < 428))) { c = HAIR; regions.hair[i] = 1 }
      if (y >= 380 && y < 470 && x >= 265 && x < 335) c = [220, 186, 164]
      if (y >= 460 && x >= 150 && x < 450) { c = SHIRT; regions.shirt[i] = 1 }
      if (options.arm && x >= 470 && x < 515 && y >= 280 && y < 480) { c = SHIRT; regions.shirt[i] = 1 }
      if (insidePolygon(facePoly, x + 0.5, y + 0.5)) {
        c = SKIN; regions.hair[i] = 0; regions.face[i] = 1
        for (const ex of [250, 350]) if ((x - ex) ** 2 / 15 ** 2 + (y - 265) ** 2 / 10 ** 2 < 1) c = [60, 40, 80]
        if ((x - 300) ** 2 / 14 ** 2 + (y - 360) ** 2 / 4 ** 2 < 1) c = [200, 110, 110]
      }
      if (c) rgb.set(c, i * 3)
    }
  }
  return { image: { rgb, width, height }, kp, regions }
}

const share = (mask: Uint8Array, region: Uint8Array) => {
  let hit = 0
  let total = 0
  for (let i = 0; i < region.length; i += 1) if (region[i]) { total += 1; if (mask[i]) hit += 1 }
  return hit / Math.max(total, 1)
}

test('elliptic structuring element matches OpenCV', () => {
  const grid = (size: number) => {
    const rows = Array.from({ length: size }, () => new Array(size).fill(0))
    const half = Math.floor(size / 2)
    for (const [dx, dy] of ellipseKernel(size)) rows[dy + half][dx + half] = 1
    return rows.map((r) => r.join('')).join('/')
  }
  assert.equal(grid(3), '010/111/010')
  assert.equal(grid(5), '00100/11111/11111/11111/00100')
})

test('blur + Canny finds a straight step edge and nothing in flat areas', () => {
  const width = 40
  const height = 30
  const gray = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) gray[y * width + x] = x < 20 ? 30 : 200
  const edges = cannyEdges(gaussianBlur3(gray, width, height), width, height, 40, 110)
  for (let y = 0; y < height; y += 1) {
    const row = [...edges.slice(y * width, y * width + width)]
    assert.equal(row.reduce((a, b) => a + b, 0), 1, `row ${y} has exactly one edge pixel`)
    assert.ok(row.indexOf(1) === 19 || row.indexOf(1) === 20)
  }
})

test('k-means is deterministic and separates obvious clusters', () => {
  const points: number[][] = []
  for (let i = 0; i < 60; i += 1) points.push([10 + (i % 3), 0, 0], [80 - (i % 4), 20, 20])
  const a = kmeans(points, 2)
  const b = kmeans(points, 2)
  assert.deepEqual(a, b)
  const sorted = [...a.centers].sort((p, q) => p[0] - q[0])
  assert.ok(Math.abs(sorted[0][0] - 11) < 1 && Math.abs(sorted[1][0] - 78.5) < 1)
  assert.deepEqual(kmeans(points.slice(0, 4), 2).counts, [4], 'tiny inputs collapse to the mean')
})

test('nearest-neighbour mask resize follows OpenCV index mapping', () => {
  assert.deepEqual([...resizeMaskNearest(Uint8Array.from([1, 0, 0, 1]), 2, 2, 4, 4)], [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1])
})

test('plain-background alpha keeps the character and drops the white border region', () => {
  const { image, regions } = paintCharacter()
  const alpha = plainBackgroundAlpha(image)
  assert.equal(alpha[0], 0)
  assert.equal(share(alpha.map((v) => (v ? 1 : 0)), regions.face), 1)
  assert.ok(share(alpha.map((v) => (v ? 1 : 0)), regions.hair) > 0.99)
})

test('segmentation: hair, head and body land where they were painted', () => {
  const { image, kp, regions } = paintCharacter()
  const result = segmentPortraitLayers({ ...image, alpha: plainBackgroundAlpha(image) }, kp)
  assert.ok(share(result.hair, regions.hair) > 0.9, `hair ${share(result.hair, regions.hair)}`)
  assert.equal(share(result.hair, regions.face), 0, 'the face below the brows is never hair')
  assert.ok(share(result.head, regions.face) > 0.9, `head ${share(result.head, regions.face)}`)
  assert.ok(share(result.body, regions.shirt) > 0.95, `body ${share(result.body, regions.shirt)}`)
  assert.equal(result.split, Math.trunc(400 + 0.15 * 185))
  assert.ok(result.metrics.armBody < 0.02)
})

test('a raised sleeve beside the face counts as body at face level (armBody)', () => {
  const { image, kp } = paintCharacter({ arm: true })
  const result = segmentPortraitLayers({ ...image, alpha: plainBackgroundAlpha(image) }, kp)
  assert.ok(result.metrics.armBody > 0.1, `armBody ${result.metrics.armBody}`)
})

/** Similar-but-distinct hair and garment colours whose acceptance ranges overlap. */
function paintColourOverlap(hairColour: RGB, garmentColour: RGB, longHair: boolean, slopedCollar: boolean) {
  const { image, kp, regions } = paintCharacter()
  const { width, height, rgb } = image
  const belowHair = new Uint8Array(width * height)
  const belowGarment = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (regions.hair[i]) rgb.set(hairColour, i * 3)
      let garment = Boolean(regions.shirt[i])
      if (y >= 360 && y < 460 && !regions.face[i]) {
        const spread = slopedCollar ? (y - 360) * 0.2 : 0
        garment ||= (x >= 160 && x < 220 + spread) || (x >= 380 - spread && x < 440)
      }
      if (garment) rgb.set(garmentColour, i * 3)
      const hangingHair = longHair && y >= 350 && y < 650 && ((x >= 182 && x < 198) || (x >= 402 && x < 418))
      if (hangingHair) { rgb.set(hairColour, i * 3); garment = false }
      if (y >= 435) {
        belowHair[i] = hangingHair ? 1 : 0
        belowGarment[i] = garment ? 1 : 0
      }
    }
  }
  const alpha = plainBackgroundAlpha(image).map((value) => value ? 200 : 0)
  return { image: { ...image, alpha }, kp, belowHair, belowGarment }
}

for (const variant of [
  { name: 'neutral short hair and straight collar', hair: [140, 140, 140], garment: [175, 175, 175], longHair: false, sloped: false },
  { name: 'cool long side locks and sloped collar', hair: [105, 135, 155], garment: [145, 165, 180], longHair: true, sloped: true },
  { name: 'warm long side locks and straight collar', hair: [175, 135, 160], garment: [205, 170, 185], longHair: true, sloped: false },
  { name: 'dark short hair and sloped collar', hair: [70, 70, 70], garment: [103, 103, 103], longHair: false, sloped: true },
]) {
  test(`stronger torso colour evidence keeps clothing out of hair: ${variant.name}`, () => {
    const { image, kp, belowHair, belowGarment } = paintColourOverlap(variant.hair as RGB, variant.garment as RGB, variant.longHair, variant.sloped)
    const originalAlpha = image.alpha.slice()
    const result = segmentPortraitLayers(image, kp)
    assert.equal(share(result.hair, belowGarment), 0, 'head prior and morphology cannot grow hair back into clearly observed torso colours')
    assert.equal(share(result.body, belowGarment), 1)
    if (variant.longHair) assert.ok(share(result.hair, belowHair) > 0.95, 'distinct hanging hair remains hair')
    for (let i = 0; i < image.alpha.length; i += 1) {
      assert.equal(result.hair[i] + result.head[i] + result.body[i], image.alpha[i] > 127 ? 1 : 0, 'layer masks are disjoint and their union preserves the cutout')
    }
    assert.deepEqual(image.alpha, originalAlpha, 'segmentation never edits the supplied soft alpha')
  })
}

test('stage wrapper decodes, scales landmarks to the working size, and picks the alpha source', async () => {
  const { image, kp, regions } = paintCharacter()
  const big = path.join(workDir, 'big.png')
  await sharp(Buffer.from(image.rgb), { raw: { width: 600, height: 700, channels: 3 } }).resize(1200, 1400, { kernel: 'nearest' }).png().toFile(big)
  const result = await splitPortraitLayers({ filePath: big }, kp.map((p) => [p[0] * 2, p[1] * 2, p[2]]), {
    getCutoutEngine: () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async (raster) => ({ accepted: true, alpha: plainBackgroundAlpha(raster) }) }),
  })
  assert.equal(result.alphaSource, 'isnet')
  assert.equal(result.width, 658)
  assert.ok(Math.abs(result.scale - 768 / 1400) < 1e-9)
  const scaledHair = resizeMaskNearest(result.hair, result.width, result.height, 600, 700)
  assert.ok(share(scaledHair, regions.hair) > 0.85)

  const rgba = new Uint8Array(600 * 700 * 4)
  for (let i = 0; i < 600 * 700; i += 1) {
    rgba.set(image.rgb.subarray(i * 3, i * 3 + 3), i * 4)
    rgba[i * 4 + 3] = image.rgb[i * 3] === 255 && image.rgb[i * 3 + 1] === 255 && image.rgb[i * 3 + 2] === 255 ? 0 : 255
  }
  const transparent = await sharp(Buffer.from(rgba), { raw: { width: 600, height: 700, channels: 4 } }).png().toBuffer()
  assert.equal((await splitPortraitLayers({ buffer: transparent }, kp)).alphaSource, 'image')
})

test('layer stage aligns neck split and masks with the actual integer raster dimensions', async () => {
  const width = 1400, height = 1201
  const foreground = await sharp({ create: { width: width - 100, height: height - 100, channels: 4, background: '#dcbeaa' } }).png().toBuffer()
  const buffer = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: foreground, left: 50, top: 50 }]).png().toBuffer()
  const kp = frontalKeypoints(700, 900)
  for (let i = 5; i < 11; i += 1) kp[i][1] = 800
  const result = await splitPortraitLayers({ buffer }, kp)
  assert.equal(result.width, 768)
  assert.equal(result.height, 658)
  assert.equal(result.split, 564, 'chin 1000 and brow 800 map the neck line to row 564, not nominal-scale row 565')
  const expected = segmentPortraitLayers(result, kp.map(([x, y, confidence]) => [x * 768 / width, y * 658 / height, confidence]))
  assert.deepEqual(result.hair, expected.hair)
  assert.deepEqual(result.head, expected.head)
  assert.deepEqual(result.body, expected.body)
  assert.equal(result.scale, 768 / 1400, 'legacy scale metadata remains the nominal resize factor')
  assert.deepEqual(result.geometry.source, { width, height })
  assert.deepEqual(result.geometry.sourceToWork, { x: 768 / width, y: 658 / height })
  const recorded = segmentPortraitLayers(result, result.geometry.workPoints)
  assert.equal(recorded.split, 564)
  for (const layer of ['hair', 'head', 'body']) assert.deepEqual(recorded[layer], result[layer], 'saved points replay the actual split')
})

test('layer geometry retains EXIF-oriented source dimensions and the actual work points without rounding scores', async () => {
  const buffer = await sharp({ create: { width: 1400, height: 1201, channels: 4, background: { r: 140, g: 120, b: 100, alpha: 0.5 } } })
    .withMetadata({ orientation: 6 }).png().toBuffer()
  const kp = frontalKeypoints(600, 700)
  kp[0][2] = -0.01
  kp[1][2] = 1.25
  const result = await splitPortraitLayers({ buffer }, kp, {
    getCutoutEngine: () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async ({ width, height }) => {
      const alpha = new Uint8Array(width * height).fill(180)
      alpha.fill(0, 0, width * 10)
      return { accepted: true, alpha }
    } }),
  })
  assert.equal(result.accepted, true)
  assert.deepEqual(result.geometry.source, { width: 1201, height: 1400 })
  assert.deepEqual([result.width, result.height], [658, 768])
  assert.deepEqual(result.geometry.sourceToWork, { x: 658 / 1201, y: 768 / 1400 })
  assert.deepEqual(result.geometry.workPoints, kp.map(([x, y, score]) => [x * (658 / 1201), y * (768 / 1400), score]))
  const replay = segmentPortraitLayers(result, result.geometry.workPoints)
  for (const layer of ['hair', 'head', 'body']) assert.deepEqual(replay[layer], result[layer])
})
