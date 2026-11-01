/**
 * Optional SenseVoice micro-benchmark.
 *
 * The model is not bundled. When the on-demand catalog copy is absent
 * the pass is skipped and the tier stays hardware-only. A present model
 * is timed on a worker and abandoned at 15s. Tests inject `measure` so
 * they never load sherpa.
 */

import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { MAX_VOICE_BENCHMARK_MS, runWithBudget } from '../../shared/voiceProfileBudget.js'
import { VOICE_BENCHMARK_WORKER_READY } from './voiceBenchmarkWorker.js'

/**
 * @param {AbortSignal} signal
 * @param {string} modelDir
 */
function runWorkerBenchmark(signal, modelDir) {
  if (!VOICE_BENCHMARK_WORKER_READY) {
    return Promise.resolve({ status: 'skipped', reason: 'worker-unavailable' })
  }
  return new Promise((resolve) => {
    let settled = false
    const worker = new Worker(new URL('./voiceBenchmarkWorker.js', import.meta.url), /** @type {import('node:worker_threads').WorkerOptions} */ ({
      type: 'module',
      workerData: {
        modelPath: path.join(modelDir, 'model.int8.onnx'),
        tokensPath: path.join(modelDir, 'tokens.txt'),
      },
    }))
    const finish = (/** @type {unknown} */ result) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      worker.terminate().catch(() => {}) // silent-catch-ok: benchmark worker teardown is best-effort after settling
      resolve(result)
    }
    const onAbort = () => finish({ status: 'timeout' })
    if (signal.aborted) {
      finish({ status: 'timeout' })
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.once('message', (message) => {
      finish(message && typeof message === 'object' ? message : { status: 'error' })
    })
    worker.once('error', () => finish({ status: 'error' }))
  })
}

/**
 * Default measure: look up the catalog SenseVoice directory. Importing
 * model paths pulls Electron, so unit tests pass their own measure.
 * @param {AbortSignal} signal
 */
async function measureInstalledSenseVoice(signal) {
  if (signal.aborted) return { status: 'timeout' }
  let findModelDir
  try {
    const paths = await import('./modelPaths.js')
    findModelDir = paths.findModelDir
  } catch {
    return { status: 'skipped', reason: 'model-lookup-failed' }
  }
  const dir = findModelDir('sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')
  if (!dir) return { status: 'skipped', reason: 'model-missing' }
  return runWorkerBenchmark(signal, dir)
}

/**
 * @param {{ budgetMs?: number, measure?: (signal: AbortSignal) => Promise<unknown> }} [options]
 */
export async function runVoiceBenchmark(options = {}) {
  const measure = options.measure ?? measureInstalledSenseVoice
  const budgetMs = options.budgetMs ?? MAX_VOICE_BENCHMARK_MS
  return runWithBudget((signal) => measure(signal), budgetMs, MAX_VOICE_BENCHMARK_MS)
}
