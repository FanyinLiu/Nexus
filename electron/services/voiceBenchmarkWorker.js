/**
 * SenseVoice timing pass. Runs only off the main thread so a slow
 * native load cannot freeze the pet. The parent terminates this worker
 * when the shared 15s budget fires.
 */

import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

/** True when this module loaded. The parent imports it so the worker file stays a real dependency. */
export const VOICE_BENCHMARK_WORKER_READY = true

const SAMPLE_RATE = 16_000

/**
 * @param {unknown} message
 */
function post(message) {
  parentPort?.postMessage(message)
}

/**
 * @param {string | undefined} modelPath
 * @param {string | undefined} tokensPath
 */
function measure(modelPath, tokensPath) {
  if (!modelPath || !tokensPath || !existsSync(modelPath) || !existsSync(tokensPath)) {
    post({ status: 'skipped', reason: 'model-missing' })
    return
  }
  let sherpa
  try {
    sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
  } catch {
    post({ status: 'error', reason: 'runtime-missing' })
    return
  }
  if (!sherpa?.OfflineRecognizer) {
    post({ status: 'error', reason: 'runtime-missing' })
    return
  }
  const loadStarted = Date.now()
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: modelPath, useInverseTextNormalization: 1 },
      tokens: tokensPath,
      numThreads: 2,
      debug: 0,
      provider: 'cpu',
    },
  })
  const sttLoadMs = Date.now() - loadStarted
  const samples = new Float32Array(SAMPLE_RATE)
  const decodeStarted = Date.now()
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE })
  recognizer.decode(stream)
  const decodeMs = Math.max(0, Date.now() - decodeStarted)
  post({ status: 'ok', sttRtf: decodeMs / 1000, sttLoadMs })
}

if (!isMainThread) {
  try {
    measure(workerData?.modelPath, workerData?.tokensPath)
  } catch {
    post({ status: 'error', reason: 'benchmark-failed' })
  }
}
