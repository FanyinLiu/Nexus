/**
 * Worker-thread entry for the portrait models. One job per worker:
 * - `task: 'landmarks'` (default): load onnxruntime-web (WASM) and both face
 *   models, run the gate on the raster it was sent, post the verdict;
 * - `task: 'cutout'`: load isnet-anime, cut out the RGB image it was sent,
 *   post the alpha mask at the requested size (its buffer is transferred).
 * Sessions are released before replying. The main
 * process then terminates the worker, which is the only reliable way to hand
 * the ~1-1.5 GB of WASM memory back (`session.release()` does not shrink it).
 *
 * Never posts paths or pixels back; failures are reported as stable codes.
 */

import fs from 'node:fs/promises'
import { parentPort } from 'node:worker_threads'

import { runIsnetCutout } from './cutoutModel.js'
import { adaptOrtSession, evaluateLandmarksWithSessions } from './landmarkEngine.js'

class StageFailure extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

async function loadRuntime(job) {
  try {
    const ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = job.threads
    if (job.wasmPaths) ort.env.wasm.wasmPaths = job.wasmPaths
    return ort
  } catch {
    throw new StageFailure('runtime_unavailable')
  }
}

async function openSession(ort, filePath) {
  try {
    return await ort.InferenceSession.create(new Uint8Array(await fs.readFile(filePath)))
  } catch {
    throw new StageFailure('load_failed')
  }
}

/** @param {{ threads: number, wasmPaths: object | null, modelPaths: { cutout: string }, image: { rgb: Uint8Array, width: number, height: number }, output: { width: number, height: number } }} job */
async function runCutoutJob(job) {
  const ort = await loadRuntime(job)
  const session = await openSession(ort, job.modelPaths.cutout)
  try {
    return await runIsnetCutout(job.image, job.output, session, ort)
  } finally {
    await session.release().catch(() => {})
  }
}

/**
 * @param {{ threads: number, wasmPaths: object | null, modelPaths: { detector: string, landmarks: string }, image: object, keepKeypoints?: boolean }} job
 */
async function runLandmarkJob(job) {
  const ort = await loadRuntime(job)
  const opened = []
  try {
    const sessions = {}
    for (const role of ['detector', 'landmarks']) {
      const session = await openSession(ort, job.modelPaths[role])
      opened.push(session)
      sessions[role] = adaptOrtSession(ort, session)
    }
    return await evaluateLandmarksWithSessions(job.image, sessions, { keepKeypoints: job.keepKeypoints === true })
  } finally {
    for (const session of opened) await session.release().catch(() => {})
  }
}

const failureCode = (error) => (error instanceof StageFailure ? error.code : 'analysis_failed')

parentPort?.once('message', (job) => {
  if (job?.task === 'cutout') {
    runCutoutJob(job).then(
      (mask) => parentPort.postMessage({ ok: true, mask }, [mask.buffer]),
      (error) => parentPort.postMessage({ ok: false, code: failureCode(error) }),
    )
    return
  }
  runLandmarkJob(job).then(
    (verdict) => parentPort.postMessage({ ok: true, verdict }),
    (error) => parentPort.postMessage({ ok: false, code: failureCode(error) }),
  )
})
