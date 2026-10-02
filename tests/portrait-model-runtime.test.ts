import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PORTRAIT_MODEL_CATALOG,
  PORTRAIT_MODEL_RELEASE,
  describePortraitModel,
  selectPortraitModels,
} from '../shared/portraitModels.js'
import {
  PORTRAIT_MODEL_DOWNLOAD_ERRORS as E,
  PortraitModelDownloadError,
  downloadPortraitModels,
  getPortraitModelStatus,
  runPortraitModelDownload,
} from '../electron/services/portraitGenerator/portraitModelDownloader.js'
import {
  createWorkerLandmarkEngine,
  defaultLandmarkThreads,
  resolveOrtWasmPaths,
} from '../electron/services/portraitGenerator/landmarkRuntime.js'
import { LANDMARK_MODEL_FILES } from '../electron/services/portraitGenerator/landmarkModels.js'
import { validateModelDownloadUrl, validateModelIntegrity } from '../electron/services/modelDownloadSecurity.js'
import { PORTRAIT_LANDMARK_GATE_REASONS } from '../shared/portraitLandmarkGate.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let workDir = ''
let dirCount = 0
const freshDir = async () => fs.mkdtemp(path.join(workDir, `d${(dirCount += 1)}-`))

before(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-models-'))
})

after(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true })
})

// ------------------------------------------------------------ catalog

test('catalog: pinned release URLs on allowlisted hosts, valid integrity, licences, and a placeholder release', () => {
  assert.equal(PORTRAIT_MODEL_RELEASE.published, false, 'stays false until the owner publishes the release')
  assert.equal(PORTRAIT_MODEL_RELEASE.baseUrl, `https://github.com/FanyinLiu/Nexus/releases/download/${PORTRAIT_MODEL_RELEASE.tag}`)
  const ids = new Set()
  for (const model of PORTRAIT_MODEL_CATALOG) {
    assert.ok(!ids.has(model.id)); ids.add(model.id)
    assert.equal(model.url, `${PORTRAIT_MODEL_RELEASE.baseUrl}/${model.fileName}`)
    assert.doesNotThrow(() => validateModelDownloadUrl(model.url))
    assert.deepEqual(validateModelIntegrity(model), { sizeBytes: model.sizeBytes, sha256: model.sha256 })
    assert.ok(['MIT', 'Apache-2.0'].includes(model.license.spdx), model.id)
    assert.match(model.license.url, /^https:\/\//)
    assert.match(model.source.url, /^https:\/\/huggingface\.co\//)
    assert.match(model.source.revision, /^[0-9a-f]{40}$/, 'source pinned to a commit')
    assert.equal(model.trainingDataDocumented, false, 'upstream does not document training data')
  }
  assert.deepEqual(selectPortraitModels().map((m) => m.id), ['anime-face-yolov3', 'anime-face-hrnetv2'])
  assert.deepEqual(selectPortraitModels({ includePlanned: true }).map((m) => m.id), ['anime-face-yolov3', 'anime-face-hrnetv2', 'isnet-anime'])
  assert.equal(PORTRAIT_MODEL_CATALOG.find((m) => m.id === 'isnet-anime')?.license.spdx, 'Apache-2.0')
  assert.deepEqual(Object.values(LANDMARK_MODEL_FILES).map((f) => f.fileName), ['anime_face_yolov3.onnx', 'anime_face_hrnetv2_flip.onnx'])

  const described = describePortraitModel(PORTRAIT_MODEL_CATALOG[0])
  assert.deepEqual(Object.keys(described).sort(), ['id', 'licenseSpdx', 'licenseUrl', 'role', 'sizeBytes', 'sourceName', 'sourceUrl', 'trainingDataDocumented', 'wired'])
})

test('docs and third-party notices carry the attribution for every catalog model', async () => {
  const docs = await fs.readFile(path.join(ROOT, 'docs/PORTRAIT_LANDMARK_MODELS.md'), 'utf8')
  const notices = await fs.readFile(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  for (const model of PORTRAIT_MODEL_CATALOG) {
    for (const text of [docs, notices]) {
      assert.ok(text.includes(model.source.url), `${model.id} source url`)
      assert.ok(text.includes(model.license.spdx), `${model.id} licence`)
    }
    assert.ok(docs.includes(model.sha256), `${model.id} sha256 in docs`)
    assert.ok(docs.includes(model.source.revision), `${model.id} revision in docs`)
  }
  assert.match(docs, /training[- ]data provenance/i)
  assert.ok(docs.includes(PORTRAIT_MODEL_RELEASE.tag))
})

// ------------------------------------------------------------ downloader

type FakeModel = { id: string, role: string, wired: boolean, fileName: string, sizeBytes: number, sha256: string, url: string, source: object, license: object, trainingDataDocumented: boolean }

function fakeModel(id: string, size: number, seed: number): { model: FakeModel, bytes: Buffer } {
  const bytes = Buffer.alloc(size)
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + seed) & 0xff
  return {
    bytes,
    model: {
      id, role: 'detector', wired: true, fileName: `${id}.onnx`, sizeBytes: size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      url: `https://github.com/FanyinLiu/Nexus/releases/download/test/${id}.onnx`,
      source: {}, license: {}, trainingDataDocumented: false,
    },
  }
}

const published = { tag: 'test', published: true }

function streamOf(bytes: Buffer, options: { chunk?: number, failAfter?: number, onChunk?: (sent: number) => void } = {}) {
  const chunk = options.chunk ?? 256 * 1024
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (options.failAfter !== undefined && sent >= options.failAfter) { controller.error(new TypeError('socket hang up')); return }
      if (sent >= bytes.length) { controller.close(); return }
      const next = bytes.subarray(sent, Math.min(bytes.length, sent + chunk))
      sent += next.length
      controller.enqueue(new Uint8Array(next))
      options.onChunk?.(sent)
    },
  })
}

const respond = (status: number, body: Buffer | null, headers: Record<string, string> = {}, stream?: ReadableStream) =>
  new Response(stream ?? (body ? streamOf(body) : null), { status, headers: body ? { 'content-length': String(body.length), ...headers } : headers })

/** fetch stub serving `files` by URL with Range support; `script` can override individual calls. */
function fakeFetch(files: Map<string, Buffer>, script: Array<((url: string, init: RequestInit) => Response | Promise<Response>) | undefined> = []) {
  const calls: Array<{ url: string, range: string | null }> = []
  const impl = async (url: string, init: RequestInit = {}) => {
    const range = (init.headers as Record<string, string> | undefined)?.Range ?? null
    calls.push({ url, range })
    const override = script[calls.length - 1]
    if (override) return override(url, init)
    const bytes = files.get(url)
    if (!bytes) return respond(404, null)
    const m = range ? /bytes=(\d+)-/.exec(range) : null
    if (m) {
      const start = Number(m[1])
      return respond(206, bytes.subarray(start), { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` })
    }
    return respond(200, bytes)
  }
  return { impl: impl as unknown as typeof fetch, calls }
}

const noSleep = { sleeps: [] as number[], sleep: async function (ms: number) { this.sleeps.push(ms) } }

test('download refuses while the release is unpublished and never fetches', async () => {
  let fetched = 0
  const options = { directory: await freshDir(), fetchImpl: (async () => { fetched += 1; return respond(200, Buffer.alloc(1)) }) as unknown as typeof fetch }
  await assert.rejects(downloadPortraitModels(options), (error: unknown) => error instanceof PortraitModelDownloadError && error.code === E.RELEASE_UNPUBLISHED)
  assert.deepEqual(await runPortraitModelDownload(options), { ok: false, code: E.RELEASE_UNPUBLISHED })
  assert.equal(fetched, 0)
})

test('download installs verified files with progress events, then reports them as already present', async () => {
  const a = fakeModel('a', 3 * 1024 * 1024 + 17, 1)
  const b = fakeModel('b', 1000, 2)
  const dir = await freshDir()
  const { impl, calls } = fakeFetch(new Map([[a.model.url, a.bytes], [b.model.url, b.bytes]]))
  const events: Array<Record<string, unknown>> = []
  const result = await downloadPortraitModels({ directory: dir, models: [a.model, b.model] as never, release: published, fetchImpl: impl, onProgress: (e: Record<string, unknown>) => events.push(e) })
  assert.deepEqual(result, { installed: ['a', 'b'], alreadyPresent: [] })
  assert.deepEqual(await fs.readFile(path.join(dir, 'a.onnx')), a.bytes)
  assert.equal(existsSync(path.join(dir, 'a.onnx.partial')), false)
  assert.equal(calls.length, 2)
  assert.deepEqual(events[0], { phase: 'start', totalBytes: a.bytes.length + b.bytes.length, models: ['a', 'b'] })
  const progress = events.filter((e) => e.phase === 'downloading' && e.modelId === 'a').map((e) => e.receivedBytes as number)
  assert.ok(progress.length >= 3, 'progress at least every MiB')
  assert.equal(progress.at(-1), a.bytes.length)
  assert.deepEqual(events.slice(-1), [{ phase: 'done' }])
  assert.ok(!JSON.stringify(events).includes(dir), 'progress never carries paths')

  const again = await runPortraitModelDownload({ directory: dir, models: [a.model, b.model] as never, release: published, fetchImpl: impl })
  assert.deepEqual(again, { ok: true, installed: [], alreadyPresent: ['a', 'b'] })
  assert.equal(calls.length, 2, 'verified files are not fetched again')
})

test('an interrupted download resumes with Range from the partial file; a server ignoring Range restarts it', async () => {
  const a = fakeModel('a', 900_000, 3)
  const dir = await freshDir()
  await fs.writeFile(path.join(dir, 'a.onnx.partial'), a.bytes.subarray(0, 300_000))
  const { impl, calls } = fakeFetch(new Map([[a.model.url, a.bytes]]))
  await downloadPortraitModels({ directory: dir, models: [a.model] as never, release: published, fetchImpl: impl })
  assert.deepEqual(calls.map((c) => c.range), ['bytes=300000-'])
  assert.deepEqual(await fs.readFile(path.join(dir, 'a.onnx')), a.bytes)

  const dir2 = await freshDir()
  await fs.writeFile(path.join(dir2, 'a.onnx.partial'), Buffer.alloc(300_000, 0xee))
  const ignoring = fakeFetch(new Map(), [async () => respond(200, a.bytes)])
  await downloadPortraitModels({ directory: dir2, models: [a.model] as never, release: published, fetchImpl: ignoring.impl })
  assert.deepEqual(await fs.readFile(path.join(dir2, 'a.onnx')), a.bytes, 'stale partial bytes are discarded on a 200')
})

test('network drops and 5xx are retried with backoff and resume; 404 is not retried', async () => {
  const a = fakeModel('a', 700_000, 4)
  const dir = await freshDir()
  const timer = { ...noSleep, sleeps: [] as number[] }
  const { impl, calls } = fakeFetch(new Map([[a.model.url, a.bytes]]), [
    async () => { throw new TypeError('fetch failed') },
    async () => respond(503, null),
    async () => new Response(streamOf(a.bytes, { failAfter: 262_144 }), { status: 200, headers: { 'content-length': String(a.bytes.length) } }),
  ])
  const events: Array<Record<string, unknown>> = []
  await downloadPortraitModels({ directory: dir, models: [a.model] as never, release: published, fetchImpl: impl, sleep: timer.sleep.bind(timer), onProgress: (e: Record<string, unknown>) => events.push(e) })
  assert.deepEqual(await fs.readFile(path.join(dir, 'a.onnx')), a.bytes)
  assert.deepEqual(timer.sleeps, [1000, 4000, 10000])
  assert.deepEqual(events.filter((e) => e.phase === 'retrying').map((e) => e.code), [E.NETWORK, E.HTTP_STATUS, E.NETWORK])
  assert.equal(calls[3].range, 'bytes=262144-', 'the 4th attempt resumes after the dropped stream')

  const missing = fakeFetch(new Map())
  const result = await runPortraitModelDownload({ directory: await freshDir(), models: [a.model] as never, release: published, fetchImpl: missing.impl, sleep: async () => {} })
  assert.deepEqual(result, { ok: false, code: E.HTTP_STATUS })
  assert.equal(missing.calls.length, 1)
})

test('a hash mismatch discards the partial file and retries once; wrong sizes fail without retry', async () => {
  const a = fakeModel('a', 50_000, 5)
  const corrupt = Buffer.from(a.bytes); corrupt[100] ^= 0xff
  const dir = await freshDir()
  const bad = fakeFetch(new Map([[a.model.url, corrupt]]))
  const events: Array<Record<string, unknown>> = []
  await assert.rejects(
    downloadPortraitModels({ directory: dir, models: [a.model] as never, release: published, fetchImpl: bad.impl, sleep: async () => {}, onProgress: (e: Record<string, unknown>) => events.push(e) }),
    (error: unknown) => (error as PortraitModelDownloadError).code === E.HASH_MISMATCH,
  )
  assert.equal(bad.calls.length, 2)
  assert.deepEqual(bad.calls.map((c) => c.range), [null, null], 'the retry starts from zero')
  assert.equal(existsSync(path.join(dir, 'a.onnx')), false)
  assert.equal(existsSync(path.join(dir, 'a.onnx.partial')), false)
  assert.deepEqual(events.at(-1), { phase: 'error', modelId: 'a', code: E.HASH_MISMATCH })

  const longer = fakeFetch(new Map([[a.model.url, Buffer.concat([a.bytes, Buffer.alloc(10)])]]))
  assert.deepEqual(await runPortraitModelDownload({ directory: await freshDir(), models: [a.model] as never, release: published, fetchImpl: longer.impl, sleep: async () => {} }), { ok: false, code: E.SIZE_MISMATCH })
  assert.equal(longer.calls.length, 1)
})

test('redirects are followed only to allowlisted HTTPS hosts', async () => {
  const a = fakeModel('a', 2_000, 6)
  const cdn = 'https://release-assets.githubusercontent.com/asset/a'
  const ok = fakeFetch(new Map([[cdn, a.bytes]]), [async () => respond(302, null, { location: cdn })])
  await downloadPortraitModels({ directory: await freshDir(), models: [a.model] as never, release: published, fetchImpl: ok.impl })
  assert.deepEqual(ok.calls.map((c) => c.url), [a.model.url, cdn])

  for (const location of ['http://release-assets.githubusercontent.com/a', 'https://evil.example/a', 'https://github.com:8443/a']) {
    const unsafe = fakeFetch(new Map(), [async () => respond(302, null, { location })])
    assert.deepEqual(await runPortraitModelDownload({ directory: await freshDir(), models: [a.model] as never, release: published, fetchImpl: unsafe.impl, sleep: async () => {} }), { ok: false, code: E.UNSAFE_URL }, location)
    assert.equal(unsafe.calls.length, 1, 'no retry and no request to the unsafe host')
  }
  const offList = { ...a.model, url: 'https://example.com/a.onnx' }
  assert.deepEqual(await runPortraitModelDownload({ directory: await freshDir(), models: [offList] as never, release: published, fetchImpl: ok.impl }), { ok: false, code: E.UNSAFE_URL })
})

test('aborting stops the download with a stable code and keeps the partial file for a later resume', async () => {
  const a = fakeModel('a', 2_000_000, 7)
  const dir = await freshDir()
  const controller = new AbortController()
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const stream = streamOf(a.bytes, { chunk: 100_000, onChunk: (sent) => { if (sent >= 500_000) controller.abort() } })
    init.signal?.addEventListener('abort', () => { stream.cancel().catch(() => {}) })
    return new Response(stream, { status: 200, headers: { 'content-length': String(a.bytes.length) } })
  }) as unknown as typeof fetch
  const result = await runPortraitModelDownload({ directory: dir, models: [a.model] as never, release: published, fetchImpl, signal: controller.signal, sleep: async () => {} })
  assert.deepEqual(result, { ok: false, code: E.ABORTED })
  const partial = await fs.stat(path.join(dir, 'a.onnx.partial'))
  assert.ok(partial.size > 0 && partial.size < a.bytes.length)
})

test('a stalled transfer is reported as stalled and retried', async () => {
  const a = fakeModel('a', 10_000, 8)
  let call = 0
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    call += 1
    if (call === 1) {
      const stream = new ReadableStream({ start(controller) { init.signal?.addEventListener('abort', () => controller.error(new Error('aborted'))) } })
      return new Response(stream, { status: 200, headers: { 'content-length': String(a.bytes.length) } })
    }
    return respond(200, a.bytes)
  }) as unknown as typeof fetch
  const events: Array<Record<string, unknown>> = []
  const result = await runPortraitModelDownload({ directory: await freshDir(), models: [a.model] as never, release: published, fetchImpl, stallMs: 50, sleep: async () => {}, onProgress: (e: Record<string, unknown>) => events.push(e) })
  assert.equal(result.ok, true)
  assert.deepEqual(events.filter((e) => e.phase === 'retrying').map((e) => e.code), [E.STALLED])
})

test('model status lists attribution and install state without paths; planned models do not count towards the download', async () => {
  const dir = await freshDir()
  const status = await getPortraitModelStatus({ directory: dir })
  assert.equal(status.releasePublished, false)
  assert.equal(status.releaseTag, PORTRAIT_MODEL_RELEASE.tag)
  assert.deepEqual(status.models.map((m: { id: string, installed: string }) => [m.id, m.installed]), [['anime-face-yolov3', 'missing'], ['anime-face-hrnetv2', 'missing'], ['isnet-anime', 'missing']])
  assert.equal(status.downloadBytes, 246_035_424 + 39_046_070)
  await fs.writeFile(path.join(dir, 'anime_face_hrnetv2_flip.onnx'), Buffer.alloc(10))
  const partial = await getPortraitModelStatus({ directory: dir })
  assert.equal(partial.models[1].installed, 'invalid')
  assert.ok(!JSON.stringify(partial).includes(dir))
  assert.equal(partial.models[0].licenseSpdx, 'MIT')
  assert.equal(partial.models[2].licenseSpdx, 'Apache-2.0')
})

// ------------------------------------------------------------ worker engine

const R = PORTRAIT_LANDMARK_GATE_REASONS
const readyInspect = async () => ({ ready: true, files: { detector: { filePath: '/m/d.onnx', status: 'ok' }, landmarks: { filePath: '/m/l.onnx', status: 'ok' } } })
const wasmPaths = { mjs: 'file:///x/ort.mjs', wasm: 'file:///x/ort.wasm' }
const image = () => ({ rgb: new Uint8Array(12), alpha: null, width: 2, height: 2 })

class FakeWorker extends EventEmitter {
  terminated = 0
  posted: unknown[] = []
  behaviour: (worker: FakeWorker, job: unknown) => void
  constructor(behaviour: (worker: FakeWorker, job: unknown) => void) { super(); this.behaviour = behaviour }
  transfers: unknown[][] = []
  postMessage(job: unknown, transfer: unknown[] = []) { this.posted.push(job); this.transfers.push(transfer); queueMicrotask(() => this.behaviour(this, job)) }
  terminate() { this.terminated += 1; return Promise.resolve(0) }
}

test('worker engine: prepare reports runtime and model problems; evaluate before a ready prepare never starts a worker', async () => {
  let built = 0
  const createWorker = () => { built += 1; return new FakeWorker(() => {}) as never }
  assert.deepEqual(await createWorkerLandmarkEngine({ directory: '/m', wasmPaths: null, inspect: readyInspect, createWorker }).prepare(), { status: 'runtime_unavailable' })
  const missing = async () => ({ ready: false, files: { detector: { filePath: '', status: 'missing' }, landmarks: { filePath: '', status: 'ok' } } })
  const invalid = async () => ({ ready: false, files: { detector: { filePath: '', status: 'hash_mismatch' }, landmarks: { filePath: '', status: 'ok' } } })
  const engine = createWorkerLandmarkEngine({ directory: '/m', wasmPaths, inspect: missing as never, createWorker })
  assert.deepEqual(await engine.prepare(), { status: 'missing' })
  assert.equal((await engine.evaluate(image())).detail, 'missing')
  assert.deepEqual(await createWorkerLandmarkEngine({ directory: '/m', wasmPaths, inspect: invalid as never, createWorker }).prepare(), { status: 'invalid' })
  assert.equal(built, 0)
})

test('worker engine: one worker per job, raster transferred, verdict or stable code returned, worker always terminated', async () => {
  const workers: FakeWorker[] = []
  const behaviours: Array<(w: FakeWorker, job: unknown) => void> = [
    (w) => w.emit('message', { ok: true, verdict: { accepted: true, reasonCode: null } }),
    (w) => w.emit('message', { ok: false, code: 'load_failed' }),
    (w) => w.emit('error', new Error('wasm trap')),
    (w) => w.emit('exit', 1),
    () => {},
  ]
  const createWorker = () => { const w = new FakeWorker(behaviours[workers.length]); workers.push(w); return w as never }
  const engine = createWorkerLandmarkEngine({ directory: '/m', wasmPaths, threads: 2, inspect: readyInspect as never, createWorker, timeoutMs: 50 })
  assert.deepEqual(await engine.prepare(), { status: 'ready' })
  const raster = image()
  assert.deepEqual(await engine.evaluate(raster), { accepted: true, reasonCode: null })
  assert.deepEqual(workers[0].transfers[0], [raster.rgb.buffer], 'the raster buffer is transferred, not copied')
  const job = workers[0].posted[0] as Record<string, unknown>
  assert.deepEqual(job.modelPaths, { detector: '/m/d.onnx', landmarks: '/m/l.onnx' })
  assert.deepEqual(job.wasmPaths, wasmPaths)
  assert.equal(job.threads, 2)
  for (const detail of ['load_failed', 'analysis_failed', 'analysis_failed', 'timeout']) {
    const verdict = await engine.evaluate(image())
    assert.equal(verdict.reasonCode, R.MODELS_UNAVAILABLE)
    assert.equal(verdict.detail, detail)
  }
  assert.deepEqual(workers.map((w) => w.terminated), [1, 1, 1, 1, 1])
})

test('worker engine: jobs are serialised (never two model copies) and a failing constructor is runtime_unavailable', async () => {
  let active = 0
  let peak = 0
  const createWorker = () => {
    active += 1; peak = Math.max(peak, active)
    const w = new FakeWorker((worker) => setTimeout(() => worker.emit('message', { ok: true, verdict: { accepted: true } }), 20))
    const terminate = w.terminate.bind(w)
    w.terminate = () => { active -= 1; return terminate() }
    return w as never
  }
  const engine = createWorkerLandmarkEngine({ directory: '/m', wasmPaths, inspect: readyInspect as never, createWorker })
  await engine.prepare()
  await Promise.all([engine.evaluate(image()), engine.evaluate(image()), engine.evaluate(image())])
  assert.equal(peak, 1)

  const broken = createWorkerLandmarkEngine({ directory: '/m', wasmPaths, inspect: readyInspect as never, createWorker: () => { throw new Error('no workers') } })
  await broken.prepare()
  assert.equal((await broken.evaluate(image())).detail, 'runtime_unavailable')
})

test('real worker thread loads onnxruntime-web and reports load_failed for unreadable models', async () => {
  const dir = await freshDir()
  await fs.writeFile(path.join(dir, 'd.onnx'), Buffer.from('not an onnx model'))
  const inspect = async () => ({ ready: true, files: { detector: { filePath: path.join(dir, 'd.onnx'), status: 'ok' }, landmarks: { filePath: path.join(dir, 'missing.onnx'), status: 'ok' } } })
  const engine = createWorkerLandmarkEngine({ directory: dir, inspect: inspect as never, threads: 1 })
  assert.deepEqual(await engine.prepare(), { status: 'ready' })
  const verdict = await engine.evaluate(image())
  assert.equal(verdict.reasonCode, R.MODELS_UNAVAILABLE)
  assert.equal(verdict.detail, 'load_failed')
})

test('WASM runtime paths resolve the subpath exports to real files', () => {
  const resolved = resolveOrtWasmPaths()
  assert.ok(resolved)
  for (const href of Object.values(resolved)) assert.ok(existsSync(fileURLToPath(href)), href)
  assert.match(resolved.mjs, /onnxruntime-web\/dist\/ort-wasm-simd-threaded\.mjs$/)
  assert.match(resolved.wasm, /onnxruntime-web\/dist\/ort-wasm-simd-threaded\.wasm$/)
  const asked: string[] = []
  resolveOrtWasmPaths((specifier: string) => { asked.push(specifier); return path.join(os.tmpdir(), specifier) })
  assert.deepEqual(asked, ['onnxruntime-web/ort-wasm-simd-threaded.mjs', 'onnxruntime-web/ort-wasm-simd-threaded.wasm'], 'never the excluded CJS entry')
  assert.equal(resolveOrtWasmPaths(() => { throw new Error('MODULE_NOT_FOUND') }), null)
  assert.deepEqual([1, 2, 3, 8, 32].map((cores) => defaultLandmarkThreads(cores)), [1, 1, 2, 4, 4])
})
