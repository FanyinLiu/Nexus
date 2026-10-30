/**
 * Smart Turn v3 ONNX runner (main process).
 *
 * The model is Whisper-Tiny's encoder plus a linear head: input is the
 * `[1, 80, 800]` log-mel tensor built by `shared/smartTurnFeatures.js`, output
 * is a single sigmoid probability that the buffered audio is a finished turn.
 *
 * This module is pure Node (no Electron) so the bench script can reuse it.
 * onnxruntime-web is used because onnxruntime-node is deliberately excluded
 * from the packaged app (it would add ~210 MB for a single 8 MB model); the
 * wasm backend needs one real `session.run` warm-up before latency is stable.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  extractSmartTurnFeatures,
  SMART_TURN_FRAME_COUNT,
  SMART_TURN_MEL_BINS,
} from '../shared/smartTurnFeatures.js'

/** Model run budget; a probe above this is treated as unavailable. */
export const SMART_TURN_MAX_INFERENCE_MS = 150

const FEATURE_LENGTH = SMART_TURN_MEL_BINS * SMART_TURN_FRAME_COUNT

/**
 * Load onnxruntime-web and point the wasm backend at the runtime copy that
 * ships with the app. In a packaged build `node_modules/onnxruntime-web` is
 * excluded, so the caller supplies the API entry and wasm glue under
 * `resources/smart-turn-ort`; the 12 MB wasm binary itself is read from the
 * existing `dist/vendor/ort` copy already used by the browser VAD.
 */
async function loadOrt(options) {
  let ort
  if (options.ortEntry) {
    ort = await import(pathToFileURL(options.ortEntry).href)
  } else {
    ort = await import('onnxruntime-web')
  }

  if (ort?.env?.wasm) {
    // Electron's wasm backend scales across worker threads (measured ~48 ms
    // with 4 threads vs ~150 ms with 1 on an M-series Mac). The proxy moves
    // the run to a worker so the main process stays responsive.
    const available = os.availableParallelism?.() ?? os.cpus().length ?? 2
    ort.env.wasm.numThreads = options.wasmThreads ?? Math.max(1, Math.min(4, available))
    ort.env.wasm.proxy = options.wasmProxy ?? true
    if (options.wasmDirectory) {
      ort.env.wasm.wasmPaths = `${options.wasmDirectory}${path.sep}`
    }
    if (options.wasmBinaryPath) {
      const wasm = fs.readFileSync(options.wasmBinaryPath)
      ort.env.wasm.wasmBinary = new Uint8Array(wasm.buffer, wasm.byteOffset, wasm.byteLength)
    }
  }
  return ort
}

/**
 * Create a warmed-up Smart Turn runner.
 *
 * @param {object} options
 * @param {string} options.modelPath Absolute path to the int8 ONNX file.
 * @param {string} [options.ortEntry] Absolute path to `ort.node.min.mjs`.
 * @param {string} [options.wasmDirectory] Directory holding the ORT wasm glue.
 * @param {string} [options.wasmBinaryPath] Optional pre-read wasm binary.
 * @param {number} [options.wasmThreads] Override the wasm worker-thread count.
 * @param {boolean} [options.wasmProxy] Run the wasm session in a worker.
 * @returns {Promise<{ predict: (samples: Float32Array) => Promise<{probability: number, featureMs: number, inferenceMs: number, totalMs: number}>, dispose: () => Promise<void> }>}
 */
export async function createSmartTurnEngine(options) {
  if (!options?.modelPath) throw new Error('Smart Turn model path is required')

  const ort = await loadOrt(options)
  const model = fs.readFileSync(options.modelPath)
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })

  const inputName = session.inputNames?.[0] ?? 'input_features'
  const outputName = session.outputNames?.[0] ?? 'logits'

  // The first wasm run pays JIT/plan costs. Warm up with silence so the first
  // real probe reports a representative latency instead of a timeout.
  const warmup = new ort.Tensor('float32', new Float32Array(FEATURE_LENGTH), [1, SMART_TURN_MEL_BINS, SMART_TURN_FRAME_COUNT])
  await session.run({ [inputName]: warmup })

  return {
    async predict(samples) {
      const started = performance.now()
      const features = extractSmartTurnFeatures(samples)
      const featuresReady = performance.now()
      const tensor = new ort.Tensor(
        'float32',
        features,
        [1, SMART_TURN_MEL_BINS, SMART_TURN_FRAME_COUNT],
      )
      const output = await session.run({ [inputName]: tensor })
      const finished = performance.now()
      const data = output?.[outputName]?.data
      const probability = Number(data?.[0])
      return {
        probability: Number.isFinite(probability) ? probability : 0,
        featureMs: featuresReady - started,
        inferenceMs: finished - featuresReady,
        totalMs: finished - started,
      }
    },
    async dispose() {
      try {
        await session.release?.()
      } catch {
        // Best-effort teardown; the process owns the wasm heap.
      }
    },
  }
}
