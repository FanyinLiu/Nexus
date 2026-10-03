import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizePortraitPuppetV4Manifest } from '../shared/portraitPuppetV4Contract.js'
import {
  createPortraitPuppetV4Mesh,
  drawPortraitPuppetV4Frame,
} from '../src/features/pet/components/portraitPuppetV4Renderer.ts'

type Point = readonly [number, number]
type CanvasMatrix = [number, number, number, number, number, number]

function recordingContext() {
  const identity: CanvasMatrix = [1, 0, 0, 1, 0, 0]
  let matrix = identity
  const stack: Array<{ matrix: CanvasMatrix; composite: GlobalCompositeOperation }> = []
  const draws: Array<{
    image: CanvasImageSource
    matrix: CanvasMatrix
    composite: GlobalCompositeOperation
  }> = []
  const context = {
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    save() { stack.push({ matrix, composite: this.globalCompositeOperation }) },
    restore() {
      const saved = stack.pop()
      assert.ok(saved)
      matrix = saved.matrix
      this.globalCompositeOperation = saved.composite
    },
    setTransform(...values: CanvasMatrix) { matrix = values },
    transform(...values: CanvasMatrix) {
      // Mesh triangles start from identity; no general Canvas emulator is needed.
      assert.deepEqual(matrix, identity)
      matrix = values
    },
    drawImage(image: CanvasImageSource) {
      draws.push({ image, matrix, composite: this.globalCompositeOperation })
    },
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() {},
  }
  return { context: context as unknown as CanvasRenderingContext2D, draws }
}

function rendererManifest(parts: unknown[], masks: unknown[] = []) {
  return normalizePortraitPuppetV4Manifest({
    id: 'renderer-fixture',
    kind: 'portrait-puppet',
    formatVersion: 4,
    renderMode: 'layered-artmesh-v1',
    portraitPath: 'preview.png',
    canvas: { width: 400, height: 800 },
    parts,
    masks,
  })
}

// The oracle works in authored pixels, independently of runtime normalized matrices.
function rotatePixels(point: Point, pivot: Point, degrees: number, translate: Point): Point {
  const radians = degrees * Math.PI / 180
  const x = point[0] - pivot[0]
  const y = point[1] - pivot[1]
  return [
    pivot[0] + translate[0] + x * Math.cos(radians) - y * Math.sin(radians),
    pivot[1] + translate[1] + x * Math.sin(radians) + y * Math.cos(radians),
  ]
}

function assertDrawPoint(matrix: CanvasMatrix, source: Point, expectedPixels: Point) {
  const actual = [
    matrix[0] * source[0] + matrix[2] * source[1] + matrix[4],
    matrix[1] * source[0] + matrix[3] * source[1] + matrix[5],
  ]
  // A 400x800 portrait fits a 600x500 destination at 0.625 scale, with 175px side inset.
  const expected = [175 + expectedPixels[0] * 0.625, expectedPixels[1] * 0.625]
  expected.forEach((value, axis) => {
    assert.ok(Math.abs(actual[axis] - value) < 1e-9,
      `axis ${axis}: expected ${value}, received ${actual[axis]}`)
  })
}

test('v4 renderer mesh has complete stable coverage for generated parts', () => {
  const mesh = createPortraitPuppetV4Mesh(3, 4)
  assert.equal(mesh.points.length, 20)
  assert.equal(mesh.triangles.length, 24)
  assert.deepEqual(mesh.points[0], [0, 0])
  assert.deepEqual(mesh.points.at(-1), [1, 1])
  assert.deepEqual(mesh.triangles[0], [0, 4, 1])
  assert.deepEqual(mesh.triangles.at(-1), [15, 18, 19])
})

test('v4 renderer clamps hostile mesh dimensions to bounded work', () => {
  const mesh = createPortraitPuppetV4Mesh(10_000, -20)
  assert.equal(mesh.points.length, 50)
  assert.equal(mesh.triangles.length, 48)
})

for (const rotateDeg of [-30, 30]) {
  test(`v4 frame draws ${rotateDeg} degree portrait rotation about an off-center pixel pivot`, () => {
    const manifest = rendererManifest([{
      id: 'head',
      path: 'parts/head.png',
      pivot: [0.25, 0.4],
      mesh: { columns: 1, rows: 1 },
      bindings: [{
        parameter: 'ParamAngleZ',
        keyforms: [{
          value: 1,
          rotateDeg,
          translate: [0.025, -0.015],
          vertexOffsets: [[0.04, -0.02], [0, 0], [-0.025, 0.015], [0, 0]],
        }],
      }],
    }])
    const image = { naturalWidth: 200, naturalHeight: 400 } as HTMLImageElement
    const recorder = recordingContext()
    drawPortraitPuppetV4Frame(recorder.context, { parts: { head: image }, masks: {} },
      manifest, { ParamAngleZ: 1 }, 600, 500)

    assert.equal(recorder.draws.length, 2)
    const source: Point[] = [[0, 0], [200, 0], [0, 400], [200, 400]]
    const deformedPixels: Point[] = [[16, -16], [400, 0], [-10, 812], [400, 800]]
    const triangles = [[0, 2, 1], [1, 2, 3]]
    recorder.draws.forEach((draw, index) => {
      assert.equal(draw.image, image)
      for (const vertex of triangles[index]) {
        const expected = rotatePixels(deformedPixels[vertex], [100, 320], rotateDeg, [10, -12])
        assertDrawPoint(draw.matrix, source[vertex], expected)
      }
    })
  })
}

test('v4 frame draws a parented mask with its named parent world transform', () => {
  const manifest = rendererManifest([
    {
      id: 'body',
      path: 'parts/body.png',
      pivot: [0.6, 0.2],
      bindings: [{ parameter: 'ParamBodyAngleZ', keyforms: [{ value: 1, rotateDeg: -20 }] }],
    },
    {
      id: 'head',
      path: 'parts/head.png',
      parentId: 'body',
      pivot: [0.25, 0.4],
      bindings: [{
        parameter: 'ParamAngleZ',
        keyforms: [{ value: 1, rotateDeg: 30, translate: [0.025, -0.015] }],
      }],
    },
    {
      id: 'eye',
      path: 'parts/eye.png',
      parentId: 'head',
      maskId: 'eye-mask',
      pivot: [0.7, 0.65],
      mesh: { columns: 1, rows: 1 },
      bindings: [{ parameter: 'ParamEyeBallX', keyforms: [{ value: 1, rotateDeg: -15 }] }],
    },
  ], [{ id: 'eye-mask', path: 'masks/eye.png', parentId: 'head' }])
  const image = { naturalWidth: 200, naturalHeight: 400 } as HTMLImageElement
  const mask = { naturalWidth: 100, naturalHeight: 200 } as HTMLImageElement
  const recorder = recordingContext()
  const scratch = recordingContext()
  const scratchCanvas = {
    width: 600, height: 500, getContext: () => scratch.context,
  } as unknown as HTMLCanvasElement
  drawPortraitPuppetV4Frame(recorder.context, {
    parts: { eye: image }, masks: { 'eye-mask': mask }, scratchCanvas,
  }, manifest, { ParamBodyAngleZ: 1, ParamAngleZ: 1, ParamEyeBallX: 1 }, 600, 500)

  assert.equal(scratch.draws.length, 3)
  assert.deepEqual(scratch.draws.slice(0, 2).map((draw) => draw.image), [image, image])
  const maskDraw = scratch.draws[2]
  assert.equal(maskDraw.image, mask)
  assert.equal(maskDraw.composite, 'destination-in')
  for (const source of [[0, 0], [100, 0], [0, 200]] as const) {
    const head = rotatePixels([source[0] * 4, source[1] * 4], [100, 320], 30, [10, -12])
    const world = rotatePixels(head, [240, 160], -20, [0, 0])
    assertDrawPoint(maskDraw.matrix, source, world)
  }
  assert.equal(recorder.draws.length, 1)
  assert.equal(recorder.draws[0].image, scratchCanvas)
})
