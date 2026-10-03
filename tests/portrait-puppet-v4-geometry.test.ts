import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizePortraitPuppetV4Manifest } from '../shared/portraitPuppetV4Contract.js'
import type { PortraitPuppetV4Point } from '../shared/portraitPuppetV4Contract.js'
import {
  applyPortraitPuppetV4Matrix,
  resolvePortraitPuppetV4PartLocalState,
  resolvePortraitPuppetV4Parts,
  type PortraitPuppetV4Matrix,
} from '../src/features/pet/portraitPuppetV4Runtime.ts'

type Canvas = { width: number; height: number }
type Transform = { pivot: PortraitPuppetV4Point; translate: PortraitPuppetV4Point; scale: PortraitPuppetV4Point; rotateDeg: number }

function authoredPart(id: string, transform: Transform, parentId = '') {
  return {
    id, parentId, role: 'custom', path: `parts/${id}.png`, pivot: transform.pivot,
    mesh: { columns: 1, rows: 1 },
    bindings: [{ parameter: 'ParamAngleZ', keyforms: [{ value: 1, ...transform }] }],
  }
}

function pixelPoint(matrix: PortraitPuppetV4Matrix, point: PortraitPuppetV4Point, canvas: Canvas): PortraitPuppetV4Point {
  const normalized = applyPortraitPuppetV4Matrix(matrix, [point[0] / canvas.width, point[1] / canvas.height])
  return [normalized[0] * canvas.width, normalized[1] * canvas.height]
}

/** Polar rotation of a scaled pixel vector is independent of the affine matrix coefficients. */
function pixelOracle(point: PortraitPuppetV4Point, canvas: Canvas, transform: Transform): PortraitPuppetV4Point {
  const pivot = [transform.pivot[0] * canvas.width, transform.pivot[1] * canvas.height]
  const x = (point[0] - pivot[0]) * transform.scale[0]
  const y = (point[1] - pivot[1]) * transform.scale[1]
  const radius = Math.hypot(x, y)
  const angle = Math.atan2(y, x) + transform.rotateDeg * Math.PI / 180
  return [
    pivot[0] + radius * Math.cos(angle) + transform.translate[0] * canvas.width,
    pivot[1] + radius * Math.sin(angle) + transform.translate[1] * canvas.height,
  ]
}

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`)
}

function closePoint(actual: PortraitPuppetV4Point, expected: PortraitPuppetV4Point, label: string) {
  close(actual[0], expected[0], `${label} x`)
  close(actual[1], expected[1], `${label} y`)
}

for (const sample of [
  { name: 'landscape 2:1 positive angle, centred pivot', width: 1200, height: 600, angle: 30, pivot: [0.5, 0.5] },
  { name: 'portrait 1:2 negative angle, eccentric pivot', width: 600, height: 1200, angle: -45, pivot: [0.2, 0.7] },
  { name: 'landscape 3:2 negative angle, eccentric pivot', width: 900, height: 600, angle: -75, pivot: [0.7, 0.25] },
  { name: 'portrait 2:3 positive angle, centred pivot', width: 600, height: 900, angle: 60, pivot: [0.5, 0.5] },
  { name: 'wide 4:1 quarter turn, eccentric pivot', width: 1600, height: 400, angle: 90, pivot: [0.3, 0.6] },
  { name: 'square negative angle, eccentric pivot', width: 800, height: 800, angle: -37, pivot: [0.2, 0.7] },
]) {
  test(`v4 rigid rotation preserves pixel lengths, angles and positions: ${sample.name}`, () => {
    const canvas = { width: sample.width, height: sample.height }
    const transform: Transform = { pivot: sample.pivot as PortraitPuppetV4Point, translate: [0, 0], scale: [1, 1], rotateDeg: sample.angle }
    const manifest = normalizePortraitPuppetV4Manifest({ canvas, parts: [authoredPart('part', transform)] })
    const [resolved] = resolvePortraitPuppetV4Parts(manifest, { ParamAngleZ: 1 })
    const pivot: PortraitPuppetV4Point = [transform.pivot[0] * canvas.width, transform.pivot[1] * canvas.height]
    const points: PortraitPuppetV4Point[] = [pivot, [pivot[0] + 40, pivot[1]], [pivot[0], pivot[1] + 75], [pivot[0] - 32, pivot[1] - 21]]
    const output = points.map((point) => pixelPoint(resolved.matrix, point, canvas))
    output.forEach((point, index) => closePoint(point, pixelOracle(points[index], canvas, transform), `point ${index}`))
    const horizontal = [output[1][0] - output[0][0], output[1][1] - output[0][1]]
    const vertical = [output[2][0] - output[0][0], output[2][1] - output[0][1]]
    close(Math.hypot(...horizontal), 40, 'horizontal length')
    close(Math.hypot(...vertical), 75, 'vertical length')
    close(horizontal[0] * vertical[0] + horizontal[1] * vertical[1], 0, 'right angle dot product')
    close(Math.atan2(horizontal[1], horizontal[0]) * 180 / Math.PI, sample.angle, 'signed rotation in pixels')
  })
}

test('v4 positive and negative quarter turns move an eighty-pixel arm exactly around a normalized pivot', () => {
  for (const canvas of [{ width: 1024, height: 1536 }, { width: 1536, height: 1024 }]) {
    for (const sign of [-1, 1]) {
      const transform: Transform = { pivot: [0.25, 0.75], translate: [0.05, -0.125], scale: [1, 1], rotateDeg: sign * 90 }
      const manifest = normalizePortraitPuppetV4Manifest({ canvas, parts: [authoredPart('part', transform)] })
      const [part] = resolvePortraitPuppetV4Parts(manifest, { ParamAngleZ: 1 })
      const pivot: PortraitPuppetV4Point = [canvas.width / 4, canvas.height * 3 / 4]
      closePoint(pixelPoint(part.matrix, [pivot[0] + 80, pivot[1]], canvas), [pivot[0] + canvas.width * 0.05, pivot[1] - canvas.height * 0.125 + sign * 80], 'quarter turn')
    }
  }
})

test('v4 zero-angle transforms retain normalized pivot, nonuniform scale and translation for every aspect ratio', () => {
  for (const canvas of [{ width: 500, height: 1500 }, { width: 1500, height: 500 }, { width: 900, height: 900 }]) {
    const transform: Transform = { pivot: [0.2, 0.7], translate: [0.1, -0.2], scale: [1.5, 0.5], rotateDeg: 0 }
    const manifest = normalizePortraitPuppetV4Manifest({ canvas, parts: [authoredPart('part', transform)] })
    const part = manifest.parts[0]
    const local = resolvePortraitPuppetV4PartLocalState(part, { ParamAngleZ: 1 }, canvas)
    closePoint(applyPortraitPuppetV4Matrix(local.matrix, [0.4, 0.3]), [0.6, 0.3], 'scaled translated point')
    closePoint(applyPortraitPuppetV4Matrix(local.matrix, part.pivot), [0.3, 0.5], 'translated pivot')
    const idle = normalizePortraitPuppetV4Manifest({ canvas, parts: [{ ...authoredPart('idle', transform), bindings: [] }] })
    const [rest] = resolvePortraitPuppetV4Parts(idle, {})
    assert.deepEqual(rest.matrix, [1, 0, 0, 1, 0, 0])
  }
})

for (const canvas of [{ width: 640, height: 1280 }, { width: 1440, height: 640 }]) {
  test(`v4 scales in pixel axes before rotating around an eccentric pivot on ${canvas.width}x${canvas.height}`, () => {
    const transform: Transform = { pivot: [0.23, 0.68], translate: [-0.03, 0.07], scale: [1.4, 0.6], rotateDeg: -33 }
    const manifest = normalizePortraitPuppetV4Manifest({ canvas, parts: [authoredPart('part', transform)] })
    const local = resolvePortraitPuppetV4PartLocalState(manifest.parts[0], { ParamAngleZ: 1 }, canvas)
    const [resolved] = resolvePortraitPuppetV4Parts(manifest, { ParamAngleZ: 1 })
    assert.deepEqual(local.matrix, resolved.matrix)
    for (const point of [[90, 170], [400, 330], [canvas.width * 0.23, canvas.height * 0.68]] as PortraitPuppetV4Point[]) {
      closePoint(pixelPoint(resolved.matrix, point, canvas), pixelOracle(point, canvas, transform), 'scaled rotation')
    }
  })

  test(`v4 child transforms compose in pixel space without inheriting parent mesh offsets on ${canvas.width}x${canvas.height}`, () => {
    const parent: Transform = { pivot: [0.2, 0.65], translate: [-0.03, 0.06], scale: [1.1, 0.8], rotateDeg: 33 }
    const child: Transform = { pivot: [0.7, 0.25], translate: [0.04, 0.02], scale: [0.7, 1.3], rotateDeg: -51 }
    const parentPart = authoredPart('parent', parent)
    const childPart = authoredPart('child', child, 'parent')
    const childOffsets: PortraitPuppetV4Point[] = [[0.01, -0.02], [0, 0.01], [-0.02, 0.03], [0.04, 0]]
    const manifest = normalizePortraitPuppetV4Manifest({ canvas, parts: [
      { ...childPart, zIndex: 1, opacity: 0.6, maskId: 'parent-mask', bindings: [{ parameter: 'ParamAngleZ', keyforms: [{ ...childPart.bindings[0].keyforms[0], vertexOffsets: childOffsets }] }] },
      { ...parentPart, zIndex: 2, opacity: 0.4, bindings: [{ parameter: 'ParamAngleZ', keyforms: [{ ...parentPart.bindings[0].keyforms[0], vertexOffsets: Array.from({ length: 4 }, () => [0.2, -0.1]) }] }] },
    ], masks: [{ id: 'parent-mask', parentId: 'parent', path: 'masks/parent.png' }] })
    const before = structuredClone(manifest)
    const parts = resolvePortraitPuppetV4Parts(manifest, { ParamAngleZ: 1 })
    assert.deepEqual(parts.map((entry) => entry.part.id), ['child', 'parent'])
    assert.equal(parts[0].opacity, 0.6, 'parent opacity is not a new inherited binding')
    assert.deepEqual(parts[0].vertexOffsets, childOffsets)
    const vertices: PortraitPuppetV4Point[] = [[0, 0], [1, 0], [0, 1], [1, 1]]
    vertices.forEach((point, index) => {
      const offset = parts[0].vertexOffsets[index]
      const deformed: PortraitPuppetV4Point = [(point[0] + offset[0]) * canvas.width, (point[1] + offset[1]) * canvas.height]
      const expected = pixelOracle(pixelOracle(deformed, canvas, child), canvas, parent)
      closePoint(pixelPoint(parts[0].matrix, deformed, canvas), expected, `child vertex ${index}`)
    })
    assert.deepEqual(manifest, before, 'resolution leaves authored pivots, offsets and mask parenting untouched')
  })
}

test('v4 rigid parent and child rotations preserve pixel lengths, right angles and their net signed angle', () => {
  for (const canvas of [{ width: 640, height: 1280 }, { width: 1440, height: 640 }]) {
    const parent: Transform = { pivot: [0.2, 0.65], translate: [-0.03, 0.08], scale: [1, 1], rotateDeg: 7 }
    const child: Transform = { pivot: [0.75, 0.3], translate: [0.06, -0.025], scale: [1, 1], rotateDeg: -33 }
    const manifest = normalizePortraitPuppetV4Manifest({ canvas, parts: [authoredPart('parent', parent), authoredPart('child', child, 'parent')] })
    const resolved = resolvePortraitPuppetV4Parts(manifest, { ParamAngleZ: 1 }).find((entry) => entry.part.id === 'child')!
    const origin: PortraitPuppetV4Point = [canvas.width * 0.37, canvas.height * 0.46]
    const points: PortraitPuppetV4Point[] = [origin, [origin[0] + 80, origin[1]], [origin[0], origin[1] + 55]]
    const output = points.map((point) => pixelPoint(resolved.matrix, point, canvas))
    const horizontal = [output[1][0] - output[0][0], output[1][1] - output[0][1]]
    const vertical = [output[2][0] - output[0][0], output[2][1] - output[0][1]]
    close(Math.hypot(...horizontal), 80, 'composed horizontal length')
    close(Math.hypot(...vertical), 55, 'composed vertical length')
    close(horizontal[0] * vertical[0] + horizontal[1] * vertical[1], 0, 'composed right angle dot product')
    close(Math.atan2(horizontal[1], horizontal[0]) * 180 / Math.PI, -26, 'net signed angle')
    output.forEach((point, index) => closePoint(point, pixelOracle(pixelOracle(points[index], canvas, child), canvas, parent), `composed position ${index}`))
  }
})

test('v4 multiple bindings retain additive normalized offsets and rotation with multiplicative scales and opacity', () => {
  const canvas = { width: 700, height: 1200 }
  const pivot: PortraitPuppetV4Point = [0.35, 0.6]
  const manifest = normalizePortraitPuppetV4Manifest({ canvas, parts: [{
    ...authoredPart('part', { pivot, translate: [0, 0], scale: [1, 1], rotateDeg: 0 }), opacity: 0.7,
    bindings: [
      { parameter: 'ParamAngleZ', keyforms: [{ value: 1, translate: [0.03, -0.02], rotateDeg: 20, scale: [1.2, 0.8], opacity: 0.5, vertexOffsets: Array.from({ length: 4 }, () => [0.01, 0.02]) }] },
      { parameter: 'ParamBodyAngleZ', keyforms: [{ value: 1, translate: [-0.01, 0.05], rotateDeg: -45, scale: [0.5, 1.5], opacity: 0.8, vertexOffsets: Array.from({ length: 4 }, () => [-0.03, 0.01]) }] },
    ],
  }] })
  const [resolved] = resolvePortraitPuppetV4Parts(manifest, { ParamAngleZ: 1, ParamBodyAngleZ: 1 })
  const combined: Transform = { pivot, translate: [0.02, 0.03], rotateDeg: -25, scale: [0.6, 1.2] }
  close(resolved.opacity, 0.28, 'combined opacity')
  for (const offset of resolved.vertexOffsets) closePoint(offset, [-0.02, 0.03], 'combined normalized offset')
  closePoint(pixelPoint(resolved.matrix, [350, 400], canvas), pixelOracle([350, 400], canvas, combined), 'combined transform')
})
