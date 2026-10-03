import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'

import {
  ISNET_INPUT_SIZE,
  isnetInputTensor,
  isnetMaskFromOutput,
  resizeLanczosLikePillow,
  runIsnetCutout,
} from '../electron/services/portraitGenerator/cutoutModel.js'
import {
  CUTOUT_FOREGROUND_RANGE,
  CUTOUT_DECODE_LONG_SIDE_PX,
  decodeCutoutInput,
  runPortraitCutout,
} from '../electron/services/portraitGenerator/cutoutStage.js'
import { CUTOUT_MODEL_FILES } from '../electron/services/portraitGenerator/landmarkModels.js'
import { createWorkerLandmarkEngine } from '../electron/services/portraitGenerator/landmarkRuntime.js'
import { PORTRAIT_MODEL_CATALOG } from '../shared/portraitModels.js'

let workDir = ''
before(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-cutout-')) })
after(async () => { if (workDir) await fs.rm(workDir, { recursive: true, force: true }) })

const N = ISNET_INPUT_SIZE * ISNET_INPUT_SIZE
const PILLOW_8_TO_3 = [2, 213, 119]
const PILLOW_3_TO_7 = [0, 8, 49, 128, 206, 247, 255]

test('isnet input: divided by the image maximum, ImageNet mean subtracted, std 1, NCHW (spike cutout.py)', () => {
  const size = 2
  const rgb = Uint8Array.from([200, 100, 0, 0, 0, 0, 100, 200, 50, 0, 0, 0])
  const x = isnetInputTensor(rgb, size)
  assert.equal(x.length, 12)
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`)
  close(x[0], 1 - 0.485) // R of pixel 0 = 200/200
  close(x[4 + 0], 0.5 - 0.456) // G plane, pixel 0 = 100/200
  close(x[8 + 2], 0.25 - 0.406) // B plane, pixel 2 = 50/200
  close(x[1], -0.485)
  const black = isnetInputTensor(new Uint8Array(12), size)
  close(black[0], -0.485)
  assert.throws(() => isnetInputTensor(new Uint8Array(10), size))
})

test('isnet output: min-max normalised then truncated to 0..255', () => {
  assert.deepEqual([...isnetMaskFromOutput(Float32Array.from([-2, 0, 2, 1.99]))], [0, 127, 254, 254])
  assert.deepEqual([...isnetMaskFromOutput(Float32Array.from([3, 3]))], [0, 0], 'a flat output is all background')
})

test('Lanczos resize reproduces Pillow (reference values from Pillow 12.3 Image.resize(..., LANCZOS))', () => {
  // 1-D ramp with an edge, 8 -> 3 (downscale) and 3 -> 7 (upscale); single channel, one row.
  const row = Uint8Array.from([0, 0, 40, 200, 255, 255, 90, 10])
  assert.deepEqual([...resizeLanczosLikePillow(row, 8, 1, 1, 3, 1)], PILLOW_8_TO_3)
  assert.deepEqual([...resizeLanczosLikePillow(Uint8Array.from([0, 128, 255]), 3, 1, 1, 7, 1)], PILLOW_3_TO_7)
  // Same size is a copy; channels are independent; separable in x and y.
  const rgb = Uint8Array.from([10, 20, 30, 40, 50, 60])
  const same = resizeLanczosLikePillow(rgb, 2, 1, 3, 2, 1)
  assert.deepEqual([...same], [...rgb])
  assert.notEqual(same, rgb)
  const column = resizeLanczosLikePillow(row, 1, 8, 1, 1, 3)
  assert.deepEqual([...column], PILLOW_8_TO_3)
  const flat = resizeLanczosLikePillow(new Uint8Array(40 * 30 * 3).fill(77), 40, 30, 3, 13, 17)
  assert.ok(flat.every((v) => v === 77), 'a flat image stays flat (weights sum to 1 in fixed point)')
})

test('runIsnetCutout feeds the first input and reads the first output', async () => {
  const seen: Array<{ name: string, dims: number[] }> = []
  class Tensor {
    type: string
    data: Float32Array
    dims: number[]
    constructor(type: string, data: Float32Array, dims: number[]) { this.type = type; this.data = data; this.dims = dims }
  }
  const session = {
    inputNames: ['img'],
    outputNames: ['mask', 'side1'],
    run: async (feeds: Record<string, Tensor>) => {
      for (const [name, t] of Object.entries(feeds)) seen.push({ name, dims: t.dims })
      const data = new Float32Array(N)
      data[5] = 1
      return { mask: { data }, side1: { data: new Float32Array(4) } }
    },
  }
  const square = { rgb: new Uint8Array(N * 3), width: 1024, height: 1024 }
  const mask = await runIsnetCutout(square, { width: 1024, height: 1024 }, session, { Tensor } as never)
  assert.deepEqual(seen, [{ name: 'img', dims: [1, 3, 1024, 1024] }])
  assert.equal(mask.length, N)
  assert.equal(mask[5], 254)
  assert.equal(mask[0], 0)
  const small = await runIsnetCutout({ rgb: new Uint8Array(300 * 200 * 3), width: 300, height: 200 }, { width: 30, height: 20 }, session, { Tensor } as never)
  assert.equal(small.length, 600, 'any input size in, the requested mask size out')
  const bad = { ...session, run: async () => ({ mask: { data: new Float32Array(10) } }) }
  await assert.rejects(runIsnetCutout(square, { width: 4, height: 4 }, bad, { Tensor } as never))
  await assert.rejects(runIsnetCutout({ rgb: new Uint8Array(5), width: 2, height: 2 }, { width: 4, height: 4 }, session, { Tensor } as never))
})

test('catalog: the cutout model is wired and pinned like the face models', () => {
  const isnet = PORTRAIT_MODEL_CATALOG.find((m) => m.role === 'cutout')
  assert.ok(isnet)
  assert.equal(isnet.wired, true)
  assert.deepEqual(CUTOUT_MODEL_FILES.cutout, { fileName: 'isnetis.onnx', sizeBytes: 176_069_933, sha256: 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99' })
})

// ------------------------------------------------------------ worker engine

const wasmPaths = { mjs: 'file:///x/ort.mjs', wasm: 'file:///x/ort.wasm' }

class FakeWorker extends EventEmitter {
  terminated = 0
  posted: Array<Record<string, unknown>> = []
  transfers: unknown[][] = []
  behaviour: (worker: FakeWorker, job: Record<string, unknown>) => void
  constructor(behaviour: (worker: FakeWorker, job: Record<string, unknown>) => void) { super(); this.behaviour = behaviour }
  postMessage(job: Record<string, unknown>, transfer: unknown[] = []) { this.posted.push(job); this.transfers.push(transfer); queueMicrotask(() => this.behaviour(this, job)) }
  terminate() { this.terminated += 1; return Promise.resolve(0) }
}

test('worker engine cutout: separate prepare, one worker per job, buffer transferred, mask or stable code, worker terminated', async () => {
  const inspected: unknown[] = []
  const inspect = async (_dir: string, options: { files: Record<string, unknown> }) => {
    inspected.push(Object.keys(options.files))
    return { ready: true, files: { cutout: { filePath: '/m/isnetis.onnx', status: 'ok' } } }
  }
  const workers: FakeWorker[] = []
  const behaviours: Array<(w: FakeWorker) => void> = [
    (w) => w.emit('message', { ok: true, mask: new Uint8Array(32 * 32) }),
    (w) => w.emit('message', { ok: false, code: 'load_failed' }),
    (w) => w.emit('message', { ok: true, mask: new Uint8Array(5) }),
    (w) => w.emit('error', new Error('wasm oom')),
    () => {},
  ]
  const createWorker = () => { const w = new FakeWorker(behaviours[workers.length]); workers.push(w); return w as never }
  const engine = createWorkerLandmarkEngine({ directory: '/m', wasmPaths, threads: 3, inspect: inspect as never, createWorker, timeoutMs: 50 })
  const job = () => ({ rgb: new Uint8Array(6 * 4 * 3), width: 6, height: 4 })
  const output = { width: 32, height: 32 }
  assert.deepEqual(await engine.cutout(job(), output), { ok: false, code: 'missing' }, 'no worker before a ready prepare')
  assert.equal(workers.length, 0)
  assert.deepEqual(await engine.prepareCutout(), { status: 'ready' })
  assert.deepEqual(inspected, [['cutout']])
  const image = job()
  const first = await engine.cutout(image, output)
  assert.equal(first.ok, true)
  assert.equal(first.ok && first.mask.length, 32 * 32)
  assert.deepEqual(workers[0].transfers[0], [image.rgb.buffer], 'the input is transferred, not copied')
  assert.equal(workers[0].posted[0].task, 'cutout')
  assert.deepEqual(workers[0].posted[0].output, output)
  assert.deepEqual(workers[0].posted[0].modelPaths, { cutout: '/m/isnetis.onnx' })
  assert.equal(workers[0].posted[0].threads, 3)
  for (const code of ['load_failed', 'analysis_failed', 'analysis_failed', 'timeout']) {
    assert.deepEqual(await engine.cutout(job(), output), { ok: false, code }, code)
  }
  assert.deepEqual(workers.map((w) => w.terminated), [1, 1, 1, 1, 1])

  const missing = createWorkerLandmarkEngine({ directory: '/m', wasmPaths, inspect: (async () => ({ ready: false, files: { cutout: { filePath: '', status: 'missing' } } })) as never, createWorker })
  assert.deepEqual(await missing.prepareCutout(), { status: 'missing' })
  const invalid = createWorkerLandmarkEngine({ directory: '/m', wasmPaths, inspect: (async () => ({ ready: false, files: { cutout: { filePath: '', status: 'hash_mismatch' } } })) as never, createWorker })
  assert.deepEqual(await invalid.prepareCutout(), { status: 'invalid' })
  assert.deepEqual(await createWorkerLandmarkEngine({ directory: '/m', wasmPaths: null, createWorker }).prepareCutout(), { status: 'runtime_unavailable' })
})

test('worker engine: cutout and landmark jobs share one lock (never two model heaps at once)', async () => {
  let active = 0
  let peak = 0
  const createWorker = () => {
    active += 1; peak = Math.max(peak, active)
    const w = new FakeWorker((worker, job) => setTimeout(() => worker.emit('message', job.task === 'cutout' ? { ok: true, mask: new Uint8Array(4) } : { ok: true, verdict: { accepted: true } }), 15))
    const terminate = w.terminate.bind(w)
    w.terminate = () => { active -= 1; return terminate() }
    return w as never
  }
  const inspect = async (_dir: string, options: { files: Record<string, unknown> }) => ({
    ready: true,
    files: Object.fromEntries(Object.keys(options.files).map((role) => [role, { filePath: `/m/${role}.onnx`, status: 'ok' }])),
  })
  const engine = createWorkerLandmarkEngine({ directory: '/m', wasmPaths, inspect: inspect as never, createWorker })
  await engine.prepare()
  await engine.prepareCutout()
  const image = { rgb: new Uint8Array(12), alpha: null, width: 2, height: 2 }
  const cut = () => engine.cutout({ rgb: new Uint8Array(12), width: 2, height: 2 }, { width: 2, height: 2 })
  const results = await Promise.all([cut(), engine.evaluate(image), cut()])
  assert.equal(peak, 1)
  assert.deepEqual(results.map((r) => ('ok' in r ? r.ok : r.accepted)), [true, true, true])
})

test('real worker thread reports load_failed for an unreadable cutout model', async () => {
  const bad = path.join(workDir, 'isnetis.onnx')
  await fs.writeFile(bad, 'not an onnx model')
  const inspect = async () => ({ ready: true, files: { cutout: { filePath: bad, status: 'ok' } } })
  const engine = createWorkerLandmarkEngine({ directory: workDir, inspect: inspect as never, threads: 1 })
  assert.deepEqual(await engine.prepareCutout(), { status: 'ready' })
  assert.deepEqual(await engine.cutout({ rgb: new Uint8Array(12), width: 2, height: 2 }, { width: 2, height: 2 }), { ok: false, code: 'load_failed' })
})

// ------------------------------------------------------------ stage (sharp side)

/** 600x400 opaque image: white background, a dark rectangle in the middle. */
async function writeBlock(name: string) {
  const filePath = path.join(workDir, name)
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } })
    .composite([{ input: { create: { width: 200, height: 200, channels: 3, background: '#203060' } }, left: 200, top: 100 }])
    .png()
    .toFile(filePath)
  return filePath
}

/** Engine stub whose "model" marks every non-white pixel as foreground. */
function thresholdEngine(overrides: Record<string, unknown> = {}) {
  const calls: number[][] = []
  return {
    calls,
    engine: {
      prepareCutout: async () => ({ status: 'ready' }),
      cutout: async (image: { rgb: Uint8Array, width: number, height: number }, output: { width: number, height: number }) => {
        calls.push([image.width, image.height, output.width, output.height])
        const resized = resizeLanczosLikePillow(image.rgb, image.width, image.height, 3, output.width, output.height)
        const mask = new Uint8Array(output.width * output.height)
        for (let i = 0; i < mask.length; i += 1) mask[i] = resized[i * 3] < 128 ? 255 : 0
        return { ok: true, mask }
      },
      ...overrides,
    },
  }
}

test('decode keeps the original size (RGB, alpha dropped, EXIF-rotated); only huge images are pre-shrunk', async () => {
  const filePath = await writeBlock('block.png')
  const decoded = await decodeCutoutInput({ filePath })
  assert.deepEqual([decoded.width, decoded.height, decoded.rgb.length], [600, 400, 600 * 400 * 3])
  const at = (x: number, y: number) => decoded.rgb[(y * 600 + x) * 3]
  assert.equal(at(300, 200), 0x20)
  assert.equal(at(20, 20), 255)
  const rgba = await sharp({ create: { width: 10, height: 20, channels: 4, background: { r: 9, g: 8, b: 7, alpha: 0.5 } } }).png().toBuffer()
  const fromRgba = await decodeCutoutInput({ buffer: rgba })
  assert.equal(fromRgba.rgb.length, 10 * 20 * 3)
  const rotated = await sharp({ create: { width: 10, height: 20, channels: 3, background: '#000' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const turned = await decodeCutoutInput({ buffer: rotated })
  assert.deepEqual([turned.width, turned.height], [20, 10])
  // Embedded ICC profiles are ignored (stored values, like Pillow's convert('RGB') in the spike).
  const tagged = await sharp(Buffer.from(Uint8Array.from({ length: 8 * 8 * 3 }, (_, i) => (i * 37) % 256)), { raw: { width: 8, height: 8, channels: 3 } })
    .withIccProfile('p3')
    .png()
    .toBuffer()
  const stored = await sharp(tagged, { ignoreIcc: true }).raw().toBuffer()
  const managed = await sharp(tagged).raw().toBuffer()
  assert.notDeepEqual([...managed], [...stored], 'the fixture really carries a non-sRGB profile')
  assert.deepEqual([...(await decodeCutoutInput({ buffer: tagged })).rgb], [...stored])
  const huge = await sharp({ create: { width: CUTOUT_DECODE_LONG_SIDE_PX + 200, height: 100, channels: 3, background: '#fff' } }).png().toBuffer()
  assert.equal((await decodeCutoutInput({ buffer: huge })).width, CUTOUT_DECODE_LONG_SIDE_PX)
})

test('runPortraitCutout: mask at the requested size, foreground share, and stable statuses for every failure', async () => {
  const filePath = await writeBlock('block2.png')
  const { engine, calls } = thresholdEngine()
  const ok = await runPortraitCutout({ filePath }, engine, { width: 300, height: 200 })
  assert.equal(ok.status, 'ok')
  if (ok.status !== 'ok' || !('alpha' in ok)) return
  assert.deepEqual(calls, [[600, 400, 300, 200]], 'full-size RGB in, working-size mask requested')
  assert.equal(ok.alpha.length, 300 * 200)
  assert.ok(Math.abs(ok.foreground - (200 * 200) / (600 * 400)) < 0.01, String(ok.foreground))
  assert.equal(ok.alpha[100 * 300 + 150], 255)
  assert.equal(ok.alpha[5 * 300 + 5], 0)

  const size = { width: 30, height: 20 }
  assert.deepEqual(await runPortraitCutout({ filePath }, {} as never, size), { status: 'runtime_unavailable' }, 'an engine without cutout support')
  assert.deepEqual(await runPortraitCutout({ filePath }, thresholdEngine({ prepareCutout: async () => ({ status: 'missing' }) }).engine, size), { status: 'missing' })
  assert.deepEqual(await runPortraitCutout({ filePath }, thresholdEngine({ cutout: async () => ({ ok: false, code: 'timeout' }) }).engine, size), { status: 'timeout' })
  assert.deepEqual(await runPortraitCutout({ filePath }, thresholdEngine({ cutout: async () => ({ ok: true, mask: new Uint8Array(7) }) }).engine, size), { status: 'analysis_failed' }, 'a mask of the wrong size')
  assert.deepEqual(await runPortraitCutout({ filePath }, thresholdEngine({ cutout: async () => { throw new Error('boom') } }).engine, size), { status: 'analysis_failed' })
  assert.deepEqual(await runPortraitCutout({ filePath: path.join(workDir, 'nope.png') }, thresholdEngine().engine, size), { status: 'analysis_failed' })
  for (const fill of [0, 255]) {
    const flat = await runPortraitCutout({ filePath }, thresholdEngine({ cutout: async () => ({ ok: true, mask: new Uint8Array(30 * 20).fill(fill) }) }).engine, size)
    assert.deepEqual(flat, { status: 'empty' }, `an all-${fill} mask is not trusted`)
  }
  assert.ok(CUTOUT_FOREGROUND_RANGE.min > 0 && CUTOUT_FOREGROUND_RANGE.max < 1)
})
