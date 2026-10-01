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

test('stage wrapper decodes, scales landmarks to the working size, and picks the alpha source', async () => {
  const { image, kp, regions } = paintCharacter()
  const big = path.join(workDir, 'big.png')
  await sharp(Buffer.from(image.rgb), { raw: { width: 600, height: 700, channels: 3 } }).resize(1200, 1400, { kernel: 'nearest' }).png().toFile(big)
  const result = await splitPortraitLayers({ filePath: big }, kp.map((p) => [p[0] * 2, p[1] * 2, p[2]]))
  assert.equal(result.alphaSource, 'plain_background')
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
