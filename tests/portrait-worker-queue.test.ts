import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { createAsyncLock } from '../electron/services/asyncLock.js'
import { createWorkerLandmarkEngine } from '../electron/services/portraitGenerator/landmarkRuntime.js'
import { createWorkerCutoutEngine } from '../electron/services/portraitGenerator/cutoutRuntime.js'

type Kind = 'landmark' | 'cutout'
type Inspection = { ready: boolean; files: Record<string, { filePath: string; status: string }> }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const raster = () => ({ rgb: new Uint8Array(12), width: 2, height: 2 })
const alpha = new Uint8Array([0, 128, 255, 255])
const verdict = { accepted: true, reasonCode: null, keypoints: [[1, 1, 0.9]] }
const flushJobs = () => new Promise<void>((resolve) => setImmediate(resolve))
const ready = (kind: Kind): Inspection => ({ ready: true, files: Object.fromEntries(
  (kind === 'landmark' ? ['detector', 'landmarks'] : ['cutout'])
    .map((role) => [role, { filePath: `/fixture/${role}.onnx`, status: 'ok' }]),
) })

class ControlledWorker extends EventEmitter {
  terminated = 0
  onPost = () => {}
  onTerminated = () => {}
  termination: Promise<void> = Promise.resolve()
  postMessage() { this.onPost() }
  async terminate() {
    this.terminated += 1
    await this.termination
    this.onTerminated()
    return 0
  }
  succeed(kind: Kind) {
    this.emit('message', kind === 'landmark' ? { ok: true, verdict } : { ok: true, alpha })
  }
}

function engine(kind: Kind, runExclusive: ReturnType<typeof createAsyncLock>, createWorker: () => ControlledWorker,
  inspect: () => Promise<Inspection> = async () => ready(kind)) {
  const options = {
    directory: '/fixture', wasmPaths: { mjs: 'file:///fixture/ort.mjs', wasm: 'file:///fixture/ort.wasm' },
    runExclusive, inspect: inspect as never, createWorker: () => createWorker() as never,
  }
  return kind === 'landmark' ? createWorkerLandmarkEngine(options) : createWorkerCutoutEngine(options)
}

test('one shared queue holds both engines until each preceding worker actually terminates', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const runExclusive = createAsyncLock()
  const barriers = [deferred<void>(), deferred<void>()]
  const workers: Array<{ kind: Kind; worker: ControlledWorker }> = []
  const create = (kind: Kind) => () => {
    const worker = new ControlledWorker()
    worker.termination = barriers[workers.length]?.promise ?? Promise.resolve()
    workers.push({ kind, worker })
    return worker
  }
  const landmarks = engine('landmark', runExclusive, create('landmark'))
  const cutout = engine('cutout', runExclusive, create('cutout'))
  await Promise.all([landmarks.prepare(), cutout.prepare()])
  let firstSettled = false
  const first = landmarks.evaluate(raster()).then((value) => { firstSettled = true; return value })
  assert.deepEqual(workers.map(({ kind }) => kind), ['landmark'])
  workers[0].worker.succeed('landmark')
  await flushJobs()
  assert.equal(workers[0].worker.terminated, 1)
  assert.equal(firstSettled, false)
  const second = cutout.evaluate(raster())
  assert.equal(workers.length, 1, 'a reply does not mean the old WASM heap has exited')
  barriers[0].resolve()
  assert.deepEqual(await first, verdict)
  await flushJobs()
  assert.deepEqual(workers.map(({ kind }) => kind), ['landmark', 'cutout'])
  const third = landmarks.evaluate(raster())
  workers[1].worker.succeed('cutout')
  await flushJobs()
  assert.equal(workers.length, 2, 'cutout termination must also keep the shared slot')
  barriers[1].resolve()
  assert.deepEqual(await second, { accepted: true, alpha })
  await flushJobs()
  assert.deepEqual(workers.map(({ kind }) => kind), ['landmark', 'cutout', 'landmark'])
  workers[2].worker.succeed('landmark')
  assert.deepEqual(await third, verdict)
  assert.deepEqual(workers.map(({ worker }) => worker.terminated), [1, 1, 1])
})

test('time waiting in the shared queue does not consume the next worker 180-second timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const runExclusive = createAsyncLock()
  const termination = deferred<void>()
  const firstWorker = new ControlledWorker()
  firstWorker.termination = termination.promise
  const nextWorker = new ControlledWorker()
  let cutoutStarted = 0
  let cutoutSettled = false
  const landmarks = engine('landmark', runExclusive, () => firstWorker)
  const cutout = engine('cutout', runExclusive, () => { cutoutStarted += 1; return nextWorker })
  await Promise.all([landmarks.prepare(), cutout.prepare()])
  const first = landmarks.evaluate(raster())
  const next = cutout.evaluate(raster()).then((value) => { cutoutSettled = true; return value })
  firstWorker.succeed('landmark')
  await flushJobs()
  t.mock.timers.tick(180_001)
  await flushJobs()
  assert.equal(cutoutStarted, 0)
  assert.equal(cutoutSettled, false)
  termination.resolve()
  await first
  await flushJobs()
  assert.equal(cutoutStarted, 1)
  t.mock.timers.tick(179_999)
  await flushJobs()
  assert.equal(nextWorker.terminated, 0)
  assert.equal(cutoutSettled, false)
  t.mock.timers.tick(1)
  assert.equal((await next).detail, 'timeout')
  assert.equal(nextWorker.terminated, 1)
})

const failures = [
  { kind: 'landmark', mode: 'worker error', detail: 'analysis_failed' },
  { kind: 'cutout', mode: 'constructor', detail: 'runtime_unavailable' },
  { kind: 'landmark', mode: 'postMessage', detail: 'analysis_failed' },
  { kind: 'cutout', mode: 'timeout', detail: 'timeout' },
] as const

for (const { kind, mode, detail } of failures) {
  test(`the other engine can finish after ${kind} ${mode}, without overlapping live workers`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const runExclusive = createAsyncLock()
    const failedWorker = new ControlledWorker()
    const nextWorker = new ControlledWorker()
    let active = 0
    let peak = 0
    const started = (worker: ControlledWorker) => {
      active += 1
      peak = Math.max(peak, active)
      worker.onTerminated = () => { active -= 1 }
      return worker
    }
    if (mode === 'postMessage') failedWorker.onPost = () => { throw new Error('synthetic transfer failure') }
    const failing = engine(kind, runExclusive, () => {
      if (mode === 'constructor') throw new Error('synthetic worker constructor failure')
      return started(failedWorker)
    })
    const nextKind = kind === 'landmark' ? 'cutout' : 'landmark'
    const following = engine(nextKind, runExclusive, () => started(nextWorker))
    await Promise.all([failing.prepare(), following.prepare()])
    const first = failing.evaluate(raster()).catch((unexpectedError: unknown) => ({ detail: undefined, unexpectedError }))
    const next = following.evaluate(raster())
    if (mode === 'worker error') failedWorker.emit('error', new Error('synthetic WASM failure'))
    if (mode === 'timeout') t.mock.timers.tick(180_000)
    assert.equal((await first).detail, detail)
    await flushJobs()
    nextWorker.succeed(nextKind)
    assert.equal((await next).accepted, true)
    assert.equal(peak, 1)
    assert.equal(active, 0)
    assert.equal(failedWorker.terminated, mode === 'constructor' ? 0 : 1)
    assert.equal(nextWorker.terminated, 1)
  })
}

test('failed landmark reinspection clears old paths and never holds the shared worker queue', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const failure of ['missing', 'hash_mismatch', 'exception']) {
    const runExclusive = createAsyncLock()
    const inspection = deferred<Inspection>()
    let inspections = 0
    let landmarkWorkers = 0
    const autoWorker = (kind: Kind) => {
      const worker = new ControlledWorker()
      worker.onPost = () => queueMicrotask(() => worker.succeed(kind))
      return worker
    }
    const landmarks = engine('landmark', runExclusive, () => { landmarkWorkers += 1; return autoWorker('landmark') },
      async () => ++inspections === 1 ? ready('landmark') : inspection.promise)
    const cutout = engine('cutout', runExclusive, () => autoWorker('cutout'))
    await Promise.all([landmarks.prepare(), cutout.prepare()])
    const prepared = landmarks.prepare().catch((error: unknown) => ({ error }))
    let cutoutFinished = false
    const other = cutout.evaluate(raster()).then((value) => { cutoutFinished = true; return value })
    await flushJobs()
    assert.equal(cutoutFinished, true, 'pending model inspection must not block another prepared engine')
    assert.equal((await other).accepted, true)
    if (failure === 'exception') inspection.reject(new Error('synthetic inspection failure'))
    else inspection.resolve({ ready: false, files: { detector: { filePath: '/fixture/detector.onnx', status: failure } } })
    const preparation = await prepared
    if (failure === 'exception') assert.ok('error' in preparation)
    else assert.deepEqual(preparation, { status: failure === 'missing' ? 'missing' : 'invalid' })
    assert.equal((await landmarks.evaluate(raster())).detail, 'missing')
    assert.equal(landmarkWorkers, 0, 'a previously ready path must not survive unsuccessful reinspection')
    assert.equal((await cutout.evaluate(raster())).accepted, true)
  }
})
