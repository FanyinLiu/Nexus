/**
 * Worker-thread entry for the portrait landmark gate. One job per worker:
 * load onnxruntime-web (WASM) and both face models, run the gate on the
 * raster it was sent, post the verdict, release the sessions. The main
 * process then terminates the worker, which is the only reliable way to hand
 * the ~1-1.5 GB of WASM memory back (`session.release()` does not shrink it).
 *
 * Never posts paths or pixels back; failures are reported as stable codes.
 */

import fs from 'node:fs/promises'
import { parentPort } from 'node:worker_threads'

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

/**
 * @param {{ threads: number, wasmPaths: object | null, modelPaths: { detector: string, landmarks: string }, image: object }} job
 */
async function runJob(job) {
  const ort = await loadRuntime(job)
  const opened = []
  try {
    const sessions = {}
    for (const role of ['detector', 'landmarks']) {
      try {
        const session = await ort.InferenceSession.create(new Uint8Array(await fs.readFile(job.modelPaths[role])))
        opened.push(session)
        sessions[role] = adaptOrtSession(ort, session)
      } catch {
        throw new StageFailure('load_failed')
      }
    }
    return await evaluateLandmarksWithSessions(job.image, sessions)
  } finally {
    for (const session of opened) await session.release().catch(() => {})
  }
}

parentPort?.once('message', (job) => {
  runJob(job).then(
    (verdict) => parentPort.postMessage({ ok: true, verdict }),
    (error) => parentPort.postMessage({ ok: false, code: error instanceof StageFailure ? error.code : 'analysis_failed' }),
  )
})
