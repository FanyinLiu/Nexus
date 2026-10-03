import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

import { cutoutUnavailable, isPortraitCutoutGateReason } from '../shared/portraitCutoutGate.js'
import { PORTRAIT_MODEL_CATALOG } from '../shared/portraitModels.js'
import { CUTOUT_INPUT_SIZE, decodeCutoutMask, prepareCutoutInput, validateCutoutAlpha } from '../electron/services/portraitGenerator/cutoutModel.js'
import { createWorkerCutoutEngine } from '../electron/services/portraitGenerator/cutoutRuntime.js'
import { splitPortraitLayers } from '../electron/services/portraitGenerator/portraitLayerStage.js'

const size = CUTOUT_INPUT_SIZE
const raster = () => ({ rgb: new Uint8Array([255, 128, 0, 0, 64, 255]), width: 2, height: 1 })
const wasmPaths = { mjs: 'file:///test/ort.mjs', wasm: 'file:///test/ort.wasm' }
const readyInspect = async () => ({ ready: true, files: { cutout: { status: 'ok', filePath: '/models/isnetis.onnx' } } })

test('ISNet uses float RGB /255, centred zero letterbox, and NCHW 1024 without a second normalisation', () => {
  const input = prepareCutoutInput(raster())
  assert.deepEqual(input.dims, [1, 3, 1024, 1024])
  assert.deepEqual([input.resizedWidth, input.resizedHeight, input.left, input.top], [1024, 512, 0, 256])
  assert.equal(input.data[0], 0)
  assert.equal(input.data[256 * size], 1)
  assert.ok(Math.abs(input.data[size * size + 256 * size] - 128 / 255) < 1e-7)
  assert.equal(input.data[2 * size * size + 256 * size + size - 1], 1)
  assert.equal(input.data[768 * size], 0)
  const portrait = prepareCutoutInput({ ...raster(), width: 1, height: 2 })
  assert.deepEqual([portrait.resizedWidth, portrait.resizedHeight, portrait.left, portrait.top], [512, 1024, 256, 0])
  assert.throws(() => prepareCutoutInput({ ...raster(), width: 3 }), /cutout_input_invalid/)
})

test('mask decoding removes the centred letterbox, preserves soft alpha, and does not apply sigmoid', () => {
  const input = prepareCutoutInput(raster())
  const data = new Float32Array(size * size).fill(1)
  for (let y = input.top; y < input.top + input.resizedHeight; y += 1) {
    data.fill(0.25, y * size, y * size + size / 2)
    data.fill(0.75, y * size + size / 2, (y + 1) * size)
  }
  assert.deepEqual(Array.from(decodeCutoutMask({ data, dims: [1, 1, size, size] }, input)), [63, 191])
})

test('mask decoding rejects malformed shapes, NaN, outside probabilities, empty and full foreground', () => {
  const input = prepareCutoutInput(raster())
  for (const value of [0, 1, NaN, Infinity, -0.1, 1.1]) {
    assert.throws(() => decodeCutoutMask({ data: new Float32Array(size * size).fill(value), dims: [1, 1, size, size] }, input), /cutout_mask_invalid/)
  }
  assert.throws(() => decodeCutoutMask({ data: new Float32Array(size * size), dims: [1, size, size] }, input), /cutout_mask_invalid/)
  assert.throws(() => decodeCutoutMask({ data: new Float32Array(8), dims: [1, 1, size, size] }, input), /cutout_mask_invalid/)
  assert.equal(validateCutoutAlpha([0, 255], 2, 1), false)
  assert.equal(validateCutoutAlpha(new Uint8Array([0, 255]), 2, 1), true)
})

test('mask resampling uses bilinear half-pixel coordinates for non-square odd geometry', () => {
  const input = prepareCutoutInput({ rgb: new Uint8Array(18), width: 3, height: 2 })
  assert.deepEqual([input.resizedWidth, input.resizedHeight, input.left, input.top], [1024, 682, 0, 171])
  const data = new Float32Array(size * size)
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) data[y * size + x] = x / (size - 1)
  assert.deepEqual(Array.from(decodeCutoutMask({ data, dims: [1, 1, size, size] }, input)), [42, 127, 212, 42, 127, 212])
})

test('cutout failures carry a known localizable code and never arbitrary worker exception text', () => {
  for (const detail of ['missing', 'invalid', 'runtime_unavailable', 'load_failed', 'timeout', 'analysis_failed']) {
    const result = cutoutUnavailable(detail)
    assert.equal(result.reasonCode, 'cutout_models_unavailable')
    assert.equal(result.detail, detail)
    assert.equal(isPortraitCutoutGateReason(result.reasonCode), true)
  }
  assert.equal(cutoutUnavailable('invalid_mask').reasonCode, 'cutout_mask_invalid')
  assert.equal(isPortraitCutoutGateReason('/private/model.onnx'), false)
  assert.ok(!JSON.stringify(cutoutUnavailable('/private/model.onnx')).includes('/private'))
})

class FakeWorker extends EventEmitter {
  terminated = 0
  posted: Record<string, unknown>[] = []
  transfers: unknown[][] = []
  behaviour: (w: FakeWorker, job: Record<string, unknown>) => void
  constructor(behaviour: (w: FakeWorker, job: Record<string, unknown>) => void) { super(); this.behaviour = behaviour }
  postMessage(job: Record<string, unknown>, transfer: unknown[]) { this.posted.push(job); this.transfers.push(transfer); queueMicrotask(() => this.behaviour(this, job)) }
  async terminate() { this.terminated += 1; return 0 }
}

test('cutout prepare shares the catalog integrity guard and never starts workers for missing/invalid files', async () => {
  let started = 0
  const createWorker = () => { started += 1; return new FakeWorker(() => {}) as never }
  const engine = createWorkerCutoutEngine({ directory: '/models', wasmPaths, createWorker,
    inspect: async (_dir, options) => {
      assert.deepEqual(options?.files, { cutout: PORTRAIT_MODEL_CATALOG.find((entry) => entry.role === 'cutout') })
      return { ready: false, files: { cutout: { status: 'missing', filePath: '/models/isnetis.onnx' } } }
    },
  })
  assert.equal((await engine.evaluate(raster())).detail, 'missing')
  assert.deepEqual(await engine.prepare(), { status: 'missing' })
  assert.equal((await engine.evaluate(raster())).detail, 'missing')
  const invalid = createWorkerCutoutEngine({ directory: '/models', wasmPaths, createWorker, inspect: async () => ({ ready: false, files: { cutout: { status: 'hash_mismatch', filePath: '/models/isnetis.onnx' } } }) })
  assert.deepEqual(await invalid.prepare(), { status: 'invalid' })
  assert.equal((await invalid.evaluate(raster())).detail, 'invalid')
  assert.deepEqual(await createWorkerCutoutEngine({ directory: '/models', wasmPaths: null, createWorker }).prepare(), { status: 'runtime_unavailable' })
  assert.equal(started, 0)
})

test('fresh cutout workers transfer RGB and always terminate on success, failure, crash, exit and timeout', async () => {
  const behaviours = [
    (w: FakeWorker) => w.emit('message', { ok: true, alpha: new Uint8Array([0, 255]) }),
    (w: FakeWorker) => w.emit('message', { ok: false, code: 'load_failed' }),
    (w: FakeWorker) => w.emit('message', { ok: true, alpha: new Uint8Array([255, 255]) }),
    (w: FakeWorker) => w.emit('error', new Error('/private/model.onnx')),
    (w: FakeWorker) => w.emit('exit', 1),
    () => {},
  ]
  const workers: FakeWorker[] = []
  const engine = createWorkerCutoutEngine({ directory: '/models', wasmPaths, inspect: readyInspect as never, timeoutMs: 30, threads: 2,
    createWorker: () => { const worker = new FakeWorker(behaviours[workers.length]); workers.push(worker); return worker as never },
  })
  await engine.prepare()
  const image = raster()
  const success = await engine.evaluate(image)
  assert.equal(success.accepted, true)
  assert.deepEqual(success.alpha, new Uint8Array([0, 255]))
  assert.deepEqual(workers[0].transfers, [[image.rgb.buffer]])
  assert.equal(workers[0].posted[0].modelPath, '/models/isnetis.onnx')
  assert.equal(workers[0].posted[0].threads, 2)
  for (const detail of ['load_failed', 'invalid_mask', 'analysis_failed', 'analysis_failed', 'timeout']) {
    assert.equal((await engine.evaluate(raster())).detail, detail)
  }
  assert.deepEqual(workers.map((w) => w.terminated), [1, 1, 1, 1, 1, 1])
})

test('cutout queue waits for actual worker termination and recovers from constructor/postMessage failures', async () => {
  let active = 0
  let peak = 0
  const engine = createWorkerCutoutEngine({ directory: '/models', wasmPaths, inspect: readyInspect as never,
    createWorker: () => {
      active += 1; peak = Math.max(peak, active)
      const worker = new FakeWorker((w) => w.emit('message', { ok: true, alpha: new Uint8Array([0, 255]) }))
      worker.terminate = async () => { await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1; return 0 }
      return worker as never
    },
  })
  await engine.prepare()
  await Promise.all([engine.evaluate(raster()), engine.evaluate(raster()), engine.evaluate(raster())])
  assert.equal(peak, 1)
  assert.equal(active, 0)
  const broken = createWorkerCutoutEngine({ directory: '/models', wasmPaths, inspect: readyInspect as never, createWorker: () => { throw new Error('unavailable') } })
  await broken.prepare()
  assert.equal((await broken.evaluate(raster())).detail, 'runtime_unavailable')
  const w = new FakeWorker(() => {})
  w.postMessage = () => { throw new Error('cannot transfer') }
  const transferFailure = createWorkerCutoutEngine({ directory: '/models', wasmPaths, inspect: readyInspect as never, createWorker: () => w as never })
  await transferFailure.prepare()
  assert.equal((await transferFailure.evaluate(raster())).detail, 'analysis_failed')
  assert.equal(w.terminated, 1)
})

test('real cutout worker loads WASM and rejects a corrupt ONNX with a stable code', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-cutout-'))
  try {
    const filePath = path.join(directory, 'invalid.onnx')
    await fs.writeFile(filePath, 'not ONNX')
    const engine = createWorkerCutoutEngine({ directory, threads: 1, inspect: async () => ({ ready: true, files: { cutout: { status: 'ok', filePath } } }) })
    assert.deepEqual(await engine.prepare(), { status: 'ready' })
    assert.equal((await engine.evaluate(raster())).detail, 'load_failed')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

test('layer stage retains meaningful original alpha including soft edges without requesting any cutout model', async () => {
  const width = 20, height = 20
  const rgba = new Uint8Array(width * height * 4).fill(128)
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = i < 40 ? 0 : i < 80 ? 180 : 255
    rgba[i * 4 + 3] = alpha[i]
  }
  const buffer = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
  const result = await splitPortraitLayers({ buffer }, Array.from({ length: 28 }, () => [10, 10, 1]), { getCutoutEngine: () => { throw new Error('original alpha does not need ISNet') } })
  assert.equal(result.accepted, true)
  assert.equal(result.alphaSource, 'image')
  assert.deepEqual(result.alpha, alpha)
})

test('a single noisy alpha pixel cannot bypass ISNet; unavailable or broken inference does not silently fall back', async () => {
  const width = 20, height = 20
  const rgba = new Uint8Array(width * height * 4).fill(255)
  rgba[3] = 254
  const buffer = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
  const points = Array.from({ length: 28 }, () => [10, 10, 1])
  assert.equal((await splitPortraitLayers({ buffer }, points)).detail, 'missing')
  for (const status of ['missing', 'invalid', 'runtime_unavailable']) {
    const result = await splitPortraitLayers({ buffer }, points, { getCutoutEngine: () => ({ prepare: async () => ({ status }), evaluate: async () => { throw new Error('not reached') } }) })
    assert.equal(result.accepted, false)
    assert.equal(result.detail, status)
  }
  const broken = await splitPortraitLayers({ buffer }, points, { getCutoutEngine: () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async () => ({ accepted: true, alpha: new Uint8Array(400).fill(255) }) }) })
  assert.equal(broken.reasonCode, 'cutout_mask_invalid')
})

test('layer stage uses returned ISNet alpha exactly and retains the RGB raster after transfer', async () => {
  const width = 20, height = 20
  const rgb = new Uint8Array(width * height * 3).fill(150)
  const alpha = new Uint8Array(width * height).fill(180)
  alpha.fill(0, 0, 40)
  const buffer = await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer()
  const result = await splitPortraitLayers({ buffer }, Array.from({ length: 28 }, () => [10, 10, 1]), {
    getCutoutEngine: () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async (image) => {
      structuredClone(image, { transfer: [image.rgb.buffer] })
      return { accepted: true, alpha }
    } }),
  })
  assert.equal(result.accepted, true)
  assert.equal(result.alphaSource, 'isnet')
  assert.deepEqual(result.alpha, alpha)
  assert.deepEqual(result.rgb, rgb)
})
