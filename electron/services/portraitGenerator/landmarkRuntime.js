/**
 * Main-process side of the landmark gate runtime: onnxruntime-web (WASM) in
 * a dedicated worker thread, so model loading and inference never block the
 * main event loop (and with it every companion window).
 *
 * - `prepare()` checks the model files (size + SHA-256, cached per process)
 *   and that the WASM runtime files can be located.
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
import { inspectLandmarkModels } from './landmarkModels.js'

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

  function runInWorker(image) {
    return new Promise((resolve) => {
      let worker
      try {
        worker = createWorker(WORKER_URL)
      } catch {
        resolve(landmarkStageUnavailable('runtime_unavailable'))
        return
      }
      let settled = false
      const finish = (verdict) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        Promise.resolve(worker.terminate()).catch(() => {})
        resolve(verdict)
      }
      const timer = setTimeout(() => finish(landmarkStageUnavailable('timeout')), timeoutMs)
      worker.once('message', (message) => {
        finish(message?.ok ? message.verdict : landmarkStageUnavailable(message?.code ?? 'analysis_failed'))
      })
      worker.once('error', () => finish(landmarkStageUnavailable('analysis_failed')))
      worker.once('exit', () => finish(landmarkStageUnavailable('analysis_failed')))
      const transfer = [image.rgb.buffer, image.alpha?.buffer].filter(Boolean)
      worker.postMessage({ threads, wasmPaths, modelPaths, image }, transfer)
    })
  }

  return {
    async prepare() {
      if (!wasmPaths) return { status: 'runtime_unavailable' }
      const inspection = await inspect(options.directory)
      if (!inspection.ready) {
        const statuses = Object.values(inspection.files).map((entry) => entry.status)
        return { status: statuses.includes('missing') ? 'missing' : 'invalid' }
      }
      modelPaths = { detector: inspection.files.detector.filePath, landmarks: inspection.files.landmarks.filePath }
      return { status: 'ready' }
    },
    evaluate(image) {
      if (!modelPaths) return Promise.resolve(landmarkStageUnavailable('missing'))
      return withLock(() => runInWorker(image))
    },
  }
}
