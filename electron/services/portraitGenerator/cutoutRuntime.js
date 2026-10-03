/**
 * Verified ISNet model -> fresh WASM worker -> cutout alpha. Shares the
 * landmark runtime's model directory, streamed integrity cache, WASM paths,
 * and CPU thread limit. No image, path, or model download crosses IPC here.
 * Jobs wait for worker termination before starting the next allocation.
 */
import { Worker } from 'node:worker_threads'

import { PORTRAIT_MODEL_CATALOG } from '../../../shared/portraitModels.js'
import { cutoutUnavailable } from '../../../shared/portraitCutoutGate.js'
import { createAsyncLock } from '../asyncLock.js'
import { validateCutoutAlpha } from './cutoutModel.js'
import { inspectLandmarkModels } from './landmarkModels.js'
import { defaultLandmarkThreads, resolveOrtWasmPaths } from './landmarkRuntime.js'

export const CUTOUT_WORKER_TIMEOUT_MS = 180_000
const MODEL = PORTRAIT_MODEL_CATALOG.find((model) => model.role === 'cutout')
const WORKER_URL = new URL('./cutoutWorker.js', import.meta.url)

/**
 * @param {{ directory: string, createWorker?: (url: URL) => import('node:worker_threads').Worker,
 * inspect?: typeof inspectLandmarkModels, wasmPaths?: { mjs: string, wasm: string } | null,
 * threads?: number, timeoutMs?: number }} options
 */
export function createWorkerCutoutEngine(options) {
  const inspect = options.inspect ?? inspectLandmarkModels
  const createWorker = options.createWorker ?? ((url) => new Worker(url))
  const wasmPaths = options.wasmPaths === undefined ? resolveOrtWasmPaths() : options.wasmPaths
  const threads = options.threads ?? defaultLandmarkThreads()
  const withLock = createAsyncLock()
  let modelPath = null
  let status = 'missing'

  function runInWorker(image) {
    return new Promise((resolve) => {
      let worker
      try { worker = createWorker(WORKER_URL) } catch { resolve(cutoutUnavailable('runtime_unavailable')); return }
      let settled = false
      const finish = async (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { await worker.terminate() } catch { /* A dead worker already released its memory. */ }
        resolve(result)
      }
      const timer = setTimeout(() => { void finish(cutoutUnavailable('timeout')) }, options.timeoutMs ?? CUTOUT_WORKER_TIMEOUT_MS)
      worker.once('message', (message) => {
        void finish(message?.ok
          ? validateCutoutAlpha(message.alpha, image.width, image.height)
            ? { accepted: true, alpha: message.alpha } : cutoutUnavailable('invalid_mask')
          : cutoutUnavailable(message?.code))
      })
      worker.once('error', () => { void finish(cutoutUnavailable('analysis_failed')) })
      worker.once('exit', () => { void finish(cutoutUnavailable('analysis_failed')) })
      try { worker.postMessage({ modelPath, wasmPaths, threads, image }, [image.rgb.buffer]) } catch { void finish(cutoutUnavailable('analysis_failed')) }
    })
  }

  return {
    async prepare() {
      modelPath = null
      if (!wasmPaths) { status = 'runtime_unavailable'; return { status } }
      try {
        const inspection = await inspect(options.directory, { files: { cutout: MODEL } })
        status = inspection.ready ? 'ready' : inspection.files.cutout?.status === 'missing' ? 'missing' : 'invalid'
        if (inspection.ready) modelPath = inspection.files.cutout.filePath
      } catch { status = 'invalid' }
      return { status }
    },
    /** The caller transfers a dedicated RGB copy so its layer raster remains intact. */
    evaluate(image) {
      return withLock(() => modelPath ? runInWorker(image) : Promise.resolve(cutoutUnavailable(status)))
    },
  }
}
