/**
 * Main-process side of the landmark gate runtime: onnxruntime-web (WASM) in
 * a dedicated worker thread, so model loading and inference never block the
 * main event loop (and with it every companion window).
 *
 * - `prepare()` checks the model files (size + SHA-256, cached per process)
 *   and that the WASM runtime files can be located.
 * - `prepareCutout()` / `cutout(rgb)` do the same for the isnet-anime
 *   cutout model (a separate worker job, so the two never share a heap).
 * - `evaluate(image)` starts a fresh worker per job, transfers the raster,
 *   and always terminates the worker afterwards to free its memory (peak
 *   ~1.5 GB in the round-2 measurement). Jobs are serialised so two checks
 *   never hold two copies of the models.
 *
 * Packaged builds load the runtime straight from `app.asar`: Electron's asar
 * support covers the WASM file reads and the loader's thread workers
 * (verified in a packaged build), so nothing is unpacked.
 */

import { createRequire } from 'node:module'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import { createAsyncLock } from '../asyncLock.js'
import { landmarkStageUnavailable } from './landmarkGate.js'
import { CUTOUT_MODEL_FILES, LANDMARK_MODEL_FILES, inspectLandmarkModels } from './landmarkModels.js'

export const LANDMARK_WORKER_TIMEOUT_MS = 180_000

const WORKER_URL = new URL('./landmarkWorker.js', import.meta.url)

/**
 * File URLs of the onnxruntime-web WASM loader + binary (inside `app.asar`
 * in packaged builds). Null when the runtime files are not installed.
 * @param {(specifier: string) => string} [resolveModule]
 */
export function resolveOrtWasmPaths(resolveModule = createRequire(import.meta.url).resolve) {
  try {
    // Resolve the WASM subpath exports themselves: the package's CJS entry
    // is deliberately not packaged (see package.json build.files).
    return {
      mjs: pathToFileURL(resolveModule('onnxruntime-web/ort-wasm-simd-threaded.mjs')).href,
      wasm: pathToFileURL(resolveModule('onnxruntime-web/ort-wasm-simd-threaded.wasm')).href,
    }
  } catch {
    return null
  }
}

/** Leave one core for the UI; WASM threads beyond 4 barely help these models. */
export function defaultLandmarkThreads(cores = os.availableParallelism?.() ?? os.cpus().length) {
  return Math.max(1, Math.min(4, cores - 1))
}

const inspectionStatus = (inspection) => {
  const statuses = Object.values(inspection.files).map((entry) => entry.status)
  return statuses.includes('missing') ? 'missing' : 'invalid'
}

/**
 * @param {{
 *   directory: string,
 *   createWorker?: (url: URL) => import('node:worker_threads').Worker,
 *   inspect?: typeof inspectLandmarkModels,
 *   wasmPaths?: { mjs: string, wasm: string } | null,
 *   threads?: number,
 *   timeoutMs?: number,
 * }} options
 */
export function createWorkerLandmarkEngine(options) {
  const createWorker = options.createWorker ?? ((url) => new Worker(url))
  const inspect = options.inspect ?? inspectLandmarkModels
  const wasmPaths = options.wasmPaths === undefined ? resolveOrtWasmPaths() : options.wasmPaths
  const threads = options.threads ?? defaultLandmarkThreads()
  const timeoutMs = options.timeoutMs ?? LANDMARK_WORKER_TIMEOUT_MS
  const withLock = createAsyncLock()
  let modelPaths = null
  let cutoutPath = null

  /**
   * One fresh worker for one job; resolves `{ ok: true, message }` or
   * `{ ok: false, code }` and always terminates the worker.
   */
  function runInWorker(job, transfer) {
    return new Promise((resolve) => {
      let worker
      try {
        worker = createWorker(WORKER_URL)
      } catch {
        resolve({ ok: false, code: 'runtime_unavailable' })
        return
      }
      let settled = false
      const finish = (outcome) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        Promise.resolve(worker.terminate()).catch(() => {})
        resolve(outcome)
      }
      const timer = setTimeout(() => finish({ ok: false, code: 'timeout' }), timeoutMs)
      worker.once('message', (message) => {
        finish(message?.ok ? { ok: true, message } : { ok: false, code: message?.code ?? 'analysis_failed' })
      })
      worker.once('error', () => finish({ ok: false, code: 'analysis_failed' }))
      worker.once('exit', () => finish({ ok: false, code: 'analysis_failed' }))
      worker.postMessage({ threads, wasmPaths, ...job }, transfer)
    })
  }

  return {
    async prepare() {
      if (!wasmPaths) return { status: 'runtime_unavailable' }
      const inspection = await inspect(options.directory, { files: LANDMARK_MODEL_FILES })
      if (!inspection.ready) return { status: inspectionStatus(inspection) }
      modelPaths = { detector: inspection.files.detector.filePath, landmarks: inspection.files.landmarks.filePath }
      return { status: 'ready' }
    },
    /**
     * @param {object} image decoded raster (its buffers are transferred)
     * @param {{ keepKeypoints?: boolean }} [options]
     */
    evaluate(image, options = {}) {
      if (!modelPaths) return Promise.resolve(landmarkStageUnavailable('missing'))
      const transfer = [image.rgb.buffer, image.alpha?.buffer].filter(Boolean)
      return withLock(async () => {
        const outcome = await runInWorker({ task: 'landmarks', modelPaths, image, keepKeypoints: options.keepKeypoints === true }, transfer)
        return outcome.ok ? outcome.message.verdict : landmarkStageUnavailable(outcome.code)
      })
    },
    /** Same as `prepare`, for the isnet-anime cutout model. */
    async prepareCutout() {
      if (!wasmPaths) return { status: 'runtime_unavailable' }
      const inspection = await inspect(options.directory, { files: CUTOUT_MODEL_FILES })
      if (!inspection.ready) return { status: inspectionStatus(inspection) }
      cutoutPath = inspection.files.cutout.filePath
      return { status: 'ready' }
    },
    /**
     * @param {{ rgb: Uint8Array, width: number, height: number }} image interleaved RGB (its buffer is transferred)
     * @param {{ width: number, height: number }} output mask size
     * @returns {Promise<{ ok: true, mask: Uint8Array } | { ok: false, code: string }>}
     */
    cutout(image, output) {
      if (!cutoutPath) return Promise.resolve({ ok: false, code: 'missing' })
      return withLock(async () => {
        const outcome = await runInWorker({ task: 'cutout', modelPaths: { cutout: cutoutPath }, image, output }, [image.rgb.buffer])
        if (!outcome.ok) return outcome
        const mask = outcome.message.mask
        return mask instanceof Uint8Array && mask.length === output.width * output.height
          ? { ok: true, mask }
          : { ok: false, code: 'analysis_failed' }
      })
    },
  }
}
