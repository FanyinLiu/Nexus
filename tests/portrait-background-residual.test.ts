import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'

import { backgroundResidualFeatures, isBusyBackgroundResidual } from '../electron/services/portraitGenerator/backgroundResidual.js'
import { splitPortraitLayers } from '../electron/services/portraitGenerator/portraitLayerStage.js'

function raster(width: number, height: number, colour = 100) {
  return { width, height, rgb: new Uint8Array(width * height * 3).fill(colour) }
}

test('foreground dilation covers a square neighbourhood, clips at corners, and preserves its inputs', () => {
  const image = raster(10, 10)
  const mask = new Uint8Array(100)
  mask[55] = 128
  const original = mask.slice()
  assert.deepEqual(backgroundResidualFeatures(image, mask), { outside: 91 / 100, offColour: 0, textured: 0 })
  assert.deepEqual(mask, original)
  assert.deepEqual(image.rgb, new Uint8Array(300).fill(100))
  mask.fill(0)
  mask[0] = 128
  assert.equal(backgroundResidualFeatures(image, mask).outside, 96 / 100)
  mask[0] = 127
  assert.equal(backgroundResidualFeatures(image, mask).outside, 1, 'soft alpha at 127 is outside the foreground')
})

test('the three-percent dilation is an odd kernel width, not a radius', () => {
  const image = raster(200, 200)
  const mask = new Uint8Array(40_000)
  mask[100 * 200 + 100] = 255
  assert.equal(backgroundResidualFeatures(image, mask).outside, (40_000 - 49) / 40_000, 'a seven-wide square covers 49 pixels')
})

test('less than two percent outside abstains, while exactly two percent is measured', () => {
  const image = raster(100, 100)
  for (let y = 0; y < 100; y += 1) for (let x = 0; x < 2; x += 1) image.rgb.fill(y % 2 ? 255 : 0, (y * 100 + x) * 3, (y * 100 + x) * 3 + 3)
  const mask = new Uint8Array(10_000)
  for (let y = 0; y < 100; y += 1) mask.fill(255, y * 100 + 2, (y + 1) * 100)
  const insufficient = backgroundResidualFeatures(image, mask)
  assert.deepEqual(insufficient, { outside: 0.01, offColour: 0, textured: 0 })
  assert.equal(isBusyBackgroundResidual(insufficient), false, 'insufficient evidence is not a clean-background guarantee')
  for (let y = 0; y < 100; y += 1) mask[y * 100 + 2] = 0
  assert.deepEqual(backgroundResidualFeatures(image, mask), { outside: 0.02, offColour: 0.5, textured: 1 })
})

test('colour distance is per-channel and strict at 24, independently of texture', () => {
  const image = raster(2, 1)
  const mask = new Uint8Array(2)
  image.rgb[3] = 124
  assert.deepEqual(backgroundResidualFeatures(image, mask), { outside: 1, offColour: 0, textured: 0 })
  image.rgb[3] = 125
  assert.deepEqual(backgroundResidualFeatures(image, mask), { outside: 1, offColour: 0.5, textured: 0 })
})

test('the dominant colour is the actual winning-bin mean, and ties retain the first encountered bin', () => {
  const image = raster(4, 1)
  for (const [i, red] of [96, 100, 103, 124].entries()) image.rgb[i * 3] = red
  assert.equal(backgroundResidualFeatures(image, new Uint8Array(4)).offColour, 0.25, '124 is more than 24 from the mean 299/3')
  const tied = raster(3, 1)
  for (const [i, red] of [0, 24, 48].entries()) tied.rgb[i * 3] = red
  assert.equal(backgroundResidualFeatures(tied, new Uint8Array(3)).offColour, 1 / 3)
  tied.rgb[0] = 24
  tied.rgb[3] = 0
  assert.equal(backgroundResidualFeatures(tied, new Uint8Array(3)).offColour, 0)
})

test('clipped local texture windows use strict standard deviation above six', () => {
  const image = raster(1, 2, 0)
  const mask = new Uint8Array(2)
  image.rgb.fill(12, 3)
  assert.deepEqual(backgroundResidualFeatures(image, mask), { outside: 1, offColour: 0, textured: 0 }, 'two equal-weight greys 0 and 12 have standard deviation 6')
  image.rgb.fill(13, 3)
  assert.deepEqual(backgroundResidualFeatures(image, mask), { outside: 1, offColour: 0, textured: 1 })
})

test('either evidence channel can reject, but equality at either limit does not', () => {
  assert.equal(isBusyBackgroundResidual({ outside: 1, offColour: 0.05, textured: 0.04 }), false)
  assert.equal(isBusyBackgroundResidual({ outside: 1, offColour: 0.051, textured: 0 }), true)
  assert.equal(isBusyBackgroundResidual({ outside: 1, offColour: 0, textured: 0.041 }), true)
})

test('the layer stage checks original model alpha before partitioning and does not mutate RGB or soft alpha', async () => {
  const image = raster(20, 20, 255)
  for (let y = 0; y < 20; y += 1) for (let x = 0; x < 10; x += 1) image.rgb.fill(0, (y * 20 + x) * 3, (y * 20 + x) * 3 + 3)
  const alpha = new Uint8Array(400).fill(30)
  alpha[210] = 180
  const before = alpha.slice()
  const buffer = await sharp(Buffer.from(image.rgb), { raw: { width: 20, height: 20, channels: 3 } }).png().toBuffer()
  let transferred: Uint8Array | undefined
  const result = await splitPortraitLayers({ buffer }, [], {
    getCutoutEngine: () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async (input) => {
      transferred = input.rgb
      assert.deepEqual(input.rgb, image.rgb)
      structuredClone(input.rgb, { transfer: [input.rgb.buffer] })
      return { accepted: true, alpha }
    } }),
  })
  assert.deepEqual(result, { accepted: false, reasonCode: 'busy_background', detail: 'background_residual', messageKey: 'settings.pet.portrait_gate.busy_background', messageParams: {} })
  assert.equal(transferred?.byteLength, 0, 'background analysis must use the retained raster after the engine transfers its copy')
  assert.deepEqual(alpha, before, 'analysis must preserve all soft alpha, including values below the partition threshold')
})
